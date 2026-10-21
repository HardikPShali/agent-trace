import { test } from "node:test";
import assert from "node:assert/strict";
import { alignSteps, diffLines, evaluateRun, percentile, runCost, runOutcome, totalDuration, visibleSteps } from "../lib/trace/analysis.ts";
import { createRun, reducer } from "../lib/trace/reducer.ts";
import { scenarioById } from "../lib/trace/scenarios.ts";
import { createSeed } from "../lib/trace/seed.ts";

const NOW = new Date("2026-10-21T12:00:00Z");
const SETTINGS = createSeed(NOW).settings;
let n = 0;
const run = (state, action) => reducer(state, { ...action, at: new Date(NOW.getTime() + ++n * 1000).toISOString(), uid: `uid${n}abcde` });
const make = (scenarioId, model, promptVersion, seed) =>
  createRun({ id: `run_${scenarioId}${seed}`, scenarioId, model, promptVersion, seed, startedAt: NOW.toISOString(), status: "completed" });
const evaluate = (r) => evaluateRun(r, scenarioById(r.scenarioId), SETTINGS);
const check = (r, id) => evaluate(r).checks.find((c) => c.id === id);

test("simulation is deterministic for the same configuration", () => {
  assert.deepEqual(make("refund", "gpt-5.2", "v3", 42), make("refund", "gpt-5.2", "v3", 42));
  assert.notDeepEqual(make("refund", "gpt-5.2", "v3", 42).steps, make("refund", "gpt-5.2", "v3", 43).steps);
});

test("parallel steps overlap and duration is the latest end", () => {
  const r = make("takeover", "gpt-5.2", "v2", 1);
  const sessions = r.steps.find((s) => s.name === "auth.getSessions");
  const risk = r.steps.find((s) => s.name === "risk.score");
  assert.equal(sessions.startMs, risk.startMs);
  assert.equal(totalDuration(r.steps), Math.max(...r.steps.map((s) => s.startMs + s.durationMs)));
});

test("prompt v1 skips the policy lookup and fails policy compliance", () => {
  const r = make("refund", "gpt-5.2", "v1", 2);
  assert.ok(!r.steps.some((s) => s.name === "policy.search"));
  const policy = check(r, "policy");
  assert.equal(policy.passed, false);
  assert.match(policy.detail, /payments.refund ran without policy.search/);
  assert.equal(runOutcome(r, scenarioById("refund"), SETTINGS), "failed");
});

test("notifying before containment is an ordering violation", () => {
  const v1 = make("takeover", "gpt-5.2", "v1", 3);
  assert.match(check(v1, "policy").detail, /notify.customer ran before auth.revokeSessions finished/);
  assert.equal(check(make("takeover", "gpt-5.2", "v2", 3), "policy").passed, true);
});

test("grounding flags facts that never appear in a tool call", () => {
  const r = { ...make("address", "gpt-5.2", "v2", 5), claims: ["Keizersgracht 221", "Wednesday"] };
  const grounding = check(r, "grounding");
  assert.equal(grounding.score, 50);
  assert.match(grounding.detail, /Wednesday/);
});

test("budgets drive latency and cost checks", () => {
  const r = make("refund", "gpt-5.2", "v3", 11);
  const tight = evaluateRun(r, scenarioById("refund"), { ...SETTINGS, latencyBudgetMs: 100, costBudget: 0.001 });
  assert.equal(tight.checks.find((c) => c.id === "latency").passed, false);
  assert.equal(tight.checks.find((c) => c.id === "cost").passed, false);
  assert.ok(runCost(r) > 0);
});

test("live runs reveal steps over time; stopping discards in-flight work", () => {
  let state = { schema: 1, runs: [], settings: SETTINGS };
  state = run(state, { type: "run/start", scenarioId: "refund", model: "gpt-5.2", promptVersion: "v3", seed: 9 });
  const live = state.runs[0];
  assert.equal(live.status, "running");
  assert.equal(visibleSteps(live, 0).length, 1);
  assert.equal(visibleSteps(live, Infinity).length, live.steps.length);

  const cut = live.steps[2].startMs + 1;
  const stopped = run(state, { type: "run/stop", runId: live.id, elapsedMs: cut }).runs[0];
  assert.equal(stopped.status, "stopped");
  assert.ok(stopped.steps.every((s) => s.startMs + s.durationMs <= cut));
  assert.ok(stopped.steps.length < live.steps.length);

  const done = run(state, { type: "run/complete", runId: live.id }).runs[0];
  assert.equal(done.status, "completed");
});

test("notes and feedback are stored per run", () => {
  let state = createSeed(NOW);
  const r = state.runs[0];
  state = run(state, { type: "run/note", runId: r.id, stepId: r.steps[0].id, text: "  looks right  " });
  state = run(state, { type: "run/feedback", runId: r.id, value: "up" });
  assert.equal(state.runs[0].notes[r.steps[0].id], "looks right");
  assert.equal(state.runs[0].feedback, "up");
  state = run(state, { type: "run/note", runId: r.id, stepId: r.steps[0].id, text: "" });
  assert.equal(state.runs[0].notes[r.steps[0].id], undefined);
});

test("step alignment and prompt diffs", () => {
  const a = make("refund", "gpt-5.2", "v1", 2);
  const b = make("refund", "gpt-5.2", "v2", 2);
  const rows = alignSteps(a.steps, b.steps);
  assert.ok(rows.some((r) => r.kind === "onlyB" && r.b.name === "policy.search"));
  const diff = diffLines("a\nb\nc", "a\nx\nc");
  assert.deepEqual(diff.map((d) => `${d.kind}:${d.text}`), ["same:a", "del:b", "add:x", "same:c"]);
});

test("seed has passing and failing runs, and percentile works", () => {
  const seed = createSeed(NOW);
  const outcomes = seed.runs.map((r) => runOutcome(r, scenarioById(r.scenarioId), seed.settings));
  assert.ok(outcomes.includes("passed") && outcomes.includes("failed"));
  assert.equal(percentile([1, 2, 3, 4, 100], 95), 100);
  assert.equal(percentile([], 95), 0);
});
