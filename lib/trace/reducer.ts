import { BUILDERS, scenarioById } from "./scenarios.ts";
import { simulateRun } from "./simulate.ts";
import type { Run, Settings, TraceState } from "./types.ts";

/** Every action carries a timestamp and a unique id stamped by the caller, which keeps the reducer pure. */
type Stamp = { at: string; uid: string };

export type TraceAction = Stamp &
  (
    | { type: "run/start"; scenarioId: string; model: string; promptVersion: string; seed: number }
    | { type: "run/complete"; runId: string }
    | { type: "run/stop"; runId: string; elapsedMs: number }
    | { type: "run/delete"; runId: string }
    | { type: "run/feedback"; runId: string; value: "up" | "down" | undefined }
    | { type: "run/note"; runId: string; stepId: string; text: string }
    | { type: "settings/update"; patch: Partial<Settings> }
    | { type: "state/replace"; state: TraceState }
  );

export type ActionInput = TraceAction extends infer A ? (A extends TraceAction ? Omit<A, "at" | "uid"> : never) : never;

export const runIdFor = (uid: string) => `run_${uid.slice(-5)}`;

export function createRun(opts: { id: string; scenarioId: string; model: string; promptVersion: string; seed: number; startedAt: string; status: Run["status"] }): Run | undefined {
  const scenario = scenarioById(opts.scenarioId);
  const builder = BUILDERS[opts.scenarioId];
  if (!scenario || !builder) return undefined;
  const { steps, claims } = simulateRun(builder, { runId: opts.id, model: opts.model, prompt: opts.promptVersion, seed: opts.seed });
  return { ...opts, task: scenario.task, steps, claims, notes: {} };
}

const updateRun = (state: TraceState, runId: string, fn: (run: Run) => Run): TraceState => ({
  ...state,
  runs: state.runs.map((r) => (r.id === runId ? fn(r) : r)),
});

export function reducer(state: TraceState, action: TraceAction): TraceState {
  switch (action.type) {
    case "run/start": {
      const run = createRun({
        id: runIdFor(action.uid),
        scenarioId: action.scenarioId,
        model: action.model,
        promptVersion: action.promptVersion,
        seed: action.seed,
        startedAt: action.at,
        status: "running",
      });
      return run ? { ...state, runs: [run, ...state.runs] } : state;
    }
    case "run/complete":
      return updateRun(state, action.runId, (r) => (r.status === "running" ? { ...r, status: "completed" } : r));
    case "run/stop":
      return updateRun(state, action.runId, (r) =>
        r.status === "running"
          ? {
              ...r,
              status: "stopped",
              stoppedAtMs: Math.round(action.elapsedMs),
              // Work still in flight when the run was stopped never produced a result.
              steps: r.steps.filter((s) => s.startMs + s.durationMs <= action.elapsedMs),
              claims: [],
            }
          : r,
      );
    case "run/delete":
      return { ...state, runs: state.runs.filter((r) => r.id !== action.runId) };
    case "run/feedback":
      return updateRun(state, action.runId, (r) => ({ ...r, feedback: action.value }));
    case "run/note":
      return updateRun(state, action.runId, (r) => {
        const notes = { ...r.notes };
        if (action.text.trim()) notes[action.stepId] = action.text.trim();
        else delete notes[action.stepId];
        return { ...r, notes };
      });
    case "settings/update":
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case "state/replace":
      return action.state;
  }
}
