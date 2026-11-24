import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_FIELD_CHARS, MAX_REQUEST_BYTES, buildReviewRequest, parseSseChunk, reviewUserMessage } from "../lib/ai/review.ts";
import { createRun } from "../lib/trace/reducer.ts";
import { scenarioById } from "../lib/trace/scenarios.ts";
import { createSeed } from "../lib/trace/seed.ts";

const NOW = new Date("2026-10-21T12:00:00Z");
const SETTINGS = createSeed(NOW).settings;
const make = (scenarioId, model, promptVersion, seed) =>
  createRun({ id: `run_${scenarioId}${seed}`, scenarioId, model, promptVersion, seed, startedAt: NOW.toISOString(), status: "completed" });

test("review request carries the outcome, every check and every step", () => {
  const run = make("refund", "gpt-5.2", "v1", 7);
  const req = buildReviewRequest(run, run.steps, scenarioById(run.scenarioId), SETTINGS);
  assert.equal(req.steps.length, run.steps.length);
  assert.equal(req.checks.length, 5);
  assert.ok(["passed", "failed"].includes(req.outcome));
  assert.ok(req.promptText.length > 0, "includes the prompt version text");
});

test("long step fields are clipped so the request stays small", () => {
  const run = make("takeover", "gpt-5.2", "v2", 3);
  const long = { ...run.steps[0], input: "x".repeat(5000), output: "y".repeat(5000) };
  const req = buildReviewRequest(run, [long, ...run.steps.slice(1)], scenarioById(run.scenarioId), SETTINGS);
  assert.ok(req.steps[0].input.length <= MAX_FIELD_CHARS + 1);
  assert.ok(JSON.stringify(req).length < MAX_REQUEST_BYTES);
});

test("user message lists failing checks and numbered steps", () => {
  const run = make("refund", "gpt-5.2", "v1", 7);
  const msg = reviewUserMessage(buildReviewRequest(run, run.steps, scenarioById(run.scenarioId), SETTINGS));
  assert.match(msg, /Evaluations:/);
  assert.match(msg, /^1\. \[/m);
});

test("SSE parser joins deltas, keeps partial lines and detects the end", () => {
  const first = parseSseChunk('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\ndata: {"choi');
  assert.equal(first.text, "Hello");
  assert.equal(first.rest, 'data: {"choi');
  const second = parseSseChunk(first.rest + 'ces":[{"delta":{"content":"!"}}]}\n: keep-alive\ndata: [DONE]\n');
  assert.equal(second.text, "!");
  assert.equal(second.done, true);
});
