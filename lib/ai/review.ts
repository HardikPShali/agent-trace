import { evaluateRun, formatCost, formatMs, runCost, totalDuration } from "../trace/analysis.ts";
import type { Run, Scenario, Settings, Step } from "../trace/types.ts";

/** Longest input/output excerpt sent per step, so a long trace stays within a small, predictable token budget. */
export const MAX_FIELD_CHARS = 400;
/** Hard cap on the request body the worker accepts. */
export const MAX_REQUEST_BYTES = 32_000;

export type ReviewRequest = {
  task: string;
  model: string;
  promptVersion: string;
  promptText: string;
  outcome: "passed" | "failed" | "stopped";
  score: number;
  durationMs: number;
  cost: string;
  checks: { name: string; score: number; passed: boolean; detail: string }[];
  steps: { title: string; type: string; name: string; status: string; durationMs: number; input: string; output: string; note?: string }[];
};

const clip = (text: string, max = MAX_FIELD_CHARS) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** Turns a finished run into the compact, model-friendly summary the AI reviewer reads. Pure and unit-tested. */
export function buildReviewRequest(run: Run, steps: Step[], scenario: Scenario | undefined, settings: Settings): ReviewRequest {
  const evaluation = evaluateRun(run, scenario, settings, steps);
  const prompt = scenario?.prompts.find((p) => p.id === run.promptVersion);
  return {
    task: run.task,
    model: run.model,
    promptVersion: run.promptVersion,
    promptText: clip(prompt?.text ?? "", 1500),
    outcome: run.status === "stopped" ? "stopped" : evaluation.passed ? "passed" : "failed",
    score: evaluation.score,
    durationMs: totalDuration(steps),
    cost: formatCost(runCost(run, steps)),
    checks: evaluation.checks.map(({ name, score, passed, detail }) => ({ name, score, passed, detail })),
    steps: steps.map((s) => ({
      title: s.title,
      type: s.type,
      name: s.name,
      status: s.status,
      durationMs: s.durationMs,
      input: clip(s.input),
      output: clip(s.output),
      ...(s.note ? { note: s.note } : {}),
    })),
  };
}

export const SYSTEM_PROMPT = `You are a senior AI reliability engineer reviewing one run of a tool-using AI agent.
You receive the task, the system prompt version, every step of the trace and the results of automated evaluations.
Answer in plain text (no markdown tables), under 220 words, with exactly these three headings on their own lines:
What happened
Root cause
Suggested fix
Under "Suggested fix", propose one concrete change to the system prompt or tool policy, quoting the exact sentence to add or change.
Only use facts present in the trace. If the run passed, say what made it reliable and suggest one improvement.`;

/** Formats the request as the user message, with durations made human-readable. */
export function reviewUserMessage(req: ReviewRequest): string {
  const lines = [
    `Task: ${req.task}`,
    `Model: ${req.model} | Prompt version: ${req.promptVersion} | Outcome: ${req.outcome} | Score: ${req.score}/100`,
    `Duration: ${formatMs(req.durationMs)} | Cost: ${req.cost}`,
    `System prompt (${req.promptVersion}):\n${req.promptText}`,
    `Evaluations:\n${req.checks.map((c) => `- ${c.name}: ${c.score}% ${c.passed ? "PASS" : "FAIL"} — ${c.detail}`).join("\n")}`,
    `Trace:\n${req.steps
      .map((s, i) => `${i + 1}. [${s.type}] ${s.title} (${s.name}, ${s.status}, ${formatMs(s.durationMs)})${s.note ? ` NOTE: ${s.note}` : ""}\n   in: ${s.input}\n   out: ${s.output}`)
      .join("\n")}`,
  ];
  return lines.join("\n\n");
}

/**
 * Extracts the text deltas from a chunk of an OpenAI-compatible server-sent event stream.
 * Returns the text found and any incomplete trailing line to prepend to the next chunk.
 */
export function parseSseChunk(buffer: string): { text: string; rest: string; done: boolean } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  let text = "";
  let done = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") {
      done = true;
      continue;
    }
    try {
      const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
      if (typeof delta === "string") text += delta;
    } catch {
      // Ignore keep-alives and malformed lines rather than breaking the stream.
    }
  }
  return { text, rest, done };
}
