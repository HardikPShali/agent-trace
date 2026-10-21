import { createRun } from "./reducer.ts";
import type { Run, TraceState } from "./types.ts";

const MIN = 60_000;

/** [run id, scenario, model, prompt version, seed, minutes ago] */
const HISTORY: [string, string, string, string, number, number][] = [
  ["run_9fa21", "refund", "gpt-5.2", "v3", 11, 2],
  ["run_9f8dc", "refund", "gpt-5.2", "v2", 7, 18],
  ["run_9f02a", "takeover", "gpt-5.1", "v2", 4, 34],
  ["run_9e991", "address", "gpt-5.1", "v2", 9, 60],
  ["run_9e4b0", "refund", "gpt-5-mini", "v3", 21, 95],
  ["run_9e117", "takeover", "gpt-5.2", "v1", 3, 140],
  ["run_9dc63", "address", "gpt-5-mini", "v2", 5, 190],
  ["run_9d8f2", "refund", "gpt-5.1", "v1", 2, 260],
  ["run_9d310", "takeover", "gpt-5-mini", "v2", 17, 330],
  ["run_9cd77", "address", "gpt-5.2", "v1", 8, 420],
  ["run_9c902", "refund", "gpt-5.2", "v3", 31, 560],
  ["run_9c4e5", "takeover", "gpt-5.2", "v2", 12, 720],
  ["run_9bf1c", "refund", "gpt-5-mini", "v2", 14, 900],
  ["run_9b7a8", "address", "gpt-5.1", "v2", 6, 1300],
];

export function createSeed(now: Date = new Date()): TraceState {
  const runs = HISTORY.map(([id, scenarioId, model, promptVersion, seed, minutesAgo]) =>
    createRun({ id, scenarioId, model, promptVersion, seed, startedAt: new Date(now.getTime() - minutesAgo * MIN).toISOString(), status: "completed" }),
  ).filter((r): r is Run => !!r);
  // The seeded failing refund carries reviewer feedback so annotations are visible on first load.
  const failing = runs.find((r) => r.id === "run_9f8dc");
  if (failing) {
    failing.feedback = "down";
    const refundStep = failing.steps.find((s) => s.name === "payments.refund");
    if (refundStep) failing.notes[refundStep.id] = "Check whether this amount needed approval. Compare with run_9fa21 (prompt v3).";
  }
  return {
    schema: 1,
    runs,
    settings: { latencyBudgetMs: 3500, costBudget: 0.08, passThreshold: 80, owner: "Hardik Shali" },
  };
}
