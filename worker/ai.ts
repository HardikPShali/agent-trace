/**
 * POST /api/ai/review: streams an AI review of one agent run.
 *
 * The API key lives only in the Worker's environment (a Cloudflare secret), never in the browser.
 * Defaults to Google's free Gemini API tier through its OpenAI-compatible endpoint, and works with
 * any other OpenAI-compatible provider (OpenAI, Azure OpenAI, Groq) by changing AI_BASE_URL.
 */
import { MAX_REQUEST_BYTES, SYSTEM_PROMPT, parseSseChunk, reviewUserMessage, type ReviewRequest } from "../lib/ai/review.ts";

export interface AiEnv {
  /** Required. A free Gemini key from Google AI Studio, or any provider's key. `npx wrangler secret put AI_API_KEY` */
  AI_API_KEY?: string;
  /** Optional. Defaults to Gemini's OpenAI-compatible endpoint. */
  AI_BASE_URL?: string;
  /** Optional. Defaults to gemini-flash-latest. */
  AI_MODEL?: string;
  /** Optional, Azure only, e.g. 2024-10-21. */
  AI_API_VERSION?: string;
  /** Older names, still accepted. */
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
}

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

function isReviewRequest(value: unknown): value is ReviewRequest {
  const v = value as ReviewRequest;
  return !!v && typeof v.task === "string" && typeof v.model === "string" && Array.isArray(v.steps) && Array.isArray(v.checks) && v.steps.length <= 60;
}

export async function handleAiReview(request: Request, env: AiEnv): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "Use POST." });
  const apiKey = env.AI_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) return json(503, { error: "AI review is not configured on this deployment." });

  const raw = await request.text();
  if (raw.length > MAX_REQUEST_BYTES) return json(413, { error: "This run is too large to review." });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "Invalid JSON." });
  }
  if (!isReviewRequest(body)) return json(400, { error: "Missing run details." });
  // Build the prompt up front: a request that passes the shape check but has malformed items
  // must get a clear 400, not crash the function.
  let userMessage: string;
  try {
    userMessage = reviewUserMessage(body);
  } catch {
    return json(400, { error: "Malformed request." });
  }

  const base = (env.AI_BASE_URL || env.OPENAI_BASE_URL || GEMINI_BASE_URL).replace(/\/$/, "");
  const isAzure = base.includes(".azure.com");
  const isGemini = base.includes("generativelanguage.googleapis.com");
  const url = `${base}/chat/completions${isAzure ? `?api-version=${env.AI_API_VERSION || "2024-10-21"}` : ""}`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (isAzure) headers["api-key"] = apiKey;
  else headers.authorization = `Bearer ${apiKey}`;

  const upstream = await fetch(url, {
    method: "POST",
    headers,
    signal: request.signal,
    body: JSON.stringify({
      model: env.AI_MODEL || env.OPENAI_MODEL || "gemini-flash-latest",
      // Gemini models think before answering; keep that short so the token budget goes to the answer.
      ...(isGemini ? { reasoning_effort: "low" } : {}),
      stream: true,
      temperature: 0.2,
      max_tokens: 900,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
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
