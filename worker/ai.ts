/**
 * POST /api/ai/review: streams an AI review of one agent run.
 *
 * The API key lives only in the Worker's environment (a Cloudflare secret), never in the browser.
 * Works with any OpenAI-compatible Chat Completions endpoint, including Azure OpenAI.
 */
import { MAX_REQUEST_BYTES, SYSTEM_PROMPT, parseSseChunk, reviewUserMessage, type ReviewRequest } from "../lib/ai/review.ts";

export interface AiEnv {
  /** Required. Set with `npx wrangler secret put OPENAI_API_KEY`. */
  OPENAI_API_KEY?: string;
  /** Optional. Defaults to https://api.openai.com/v1. For Azure: https://<resource>.openai.azure.com/openai/deployments/<deployment> */
  OPENAI_BASE_URL?: string;
  /** Optional. Defaults to gpt-4.1-mini. */
  OPENAI_MODEL?: string;
  /** Optional, Azure only, e.g. 2024-10-21. */
  OPENAI_API_VERSION?: string;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

function isReviewRequest(value: unknown): value is ReviewRequest {
  const v = value as ReviewRequest;
  return !!v && typeof v.task === "string" && typeof v.model === "string" && Array.isArray(v.steps) && Array.isArray(v.checks) && v.steps.length <= 60;
}

export async function handleAiReview(request: Request, env: AiEnv): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "Use POST." });
  if (!env.OPENAI_API_KEY) return json(503, { error: "AI review is not configured on this deployment." });

  const raw = await request.text();
  if (raw.length > MAX_REQUEST_BYTES) return json(413, { error: "This run is too large to review." });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "Invalid JSON." });
  }
  if (!isReviewRequest(body)) return json(400, { error: "Missing run details." });

  const base = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const isAzure = base.includes(".azure.com");
  const url = `${base}/chat/completions${isAzure ? `?api-version=${env.OPENAI_API_VERSION || "2024-10-21"}` : ""}`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (isAzure) headers["api-key"] = env.OPENAI_API_KEY;
  else headers.authorization = `Bearer ${env.OPENAI_API_KEY}`;

  const upstream = await fetch(url, {
    method: "POST",
    headers,
    signal: request.signal,
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4.1-mini",
      stream: true,
      temperature: 0.2,
      max_tokens: 450,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: reviewUserMessage(body) },
      ],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    // Log the provider's error server-side; never forward it, since it can echo account details.
    console.error("AI review upstream error", upstream.status, await upstream.text().catch(() => ""));
    const status = upstream.status === 429 ? 429 : 502;
    return json(status, { error: status === 429 ? "The AI service is busy. Try again in a minute." : "The AI service did not respond." });
  }

  // Re-stream only the text deltas as plain text, so the client needs no SSE parsing.
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const stream = upstream.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const { text, rest } = parseSseChunk(buffer + decoder.decode(chunk, { stream: true }));
        buffer = rest;
        if (text) controller.enqueue(encoder.encode(text));
      },
      flush(controller) {
        const { text } = parseSseChunk(`${buffer}\n`);
        if (text) controller.enqueue(encoder.encode(text));
      },
    }),
  );

  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
