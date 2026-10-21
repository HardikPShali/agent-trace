"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { z } from "zod";
import { totalDuration } from "@/lib/trace/analysis";
import { reducer, type ActionInput, type TraceAction } from "@/lib/trace/reducer";
import { createSeed } from "@/lib/trace/seed";
import type { Run, TraceState } from "@/lib/trace/types";

const STORAGE_KEY = "agent-trace:workspace:v1";

const stepSchema = z.object({
  id: z.string(), type: z.enum(["model", "tool", "decision", "retrieval"]), title: z.string(), name: z.string(),
  startMs: z.number(), durationMs: z.number(), tokensIn: z.number(), tokensOut: z.number(),
  status: z.enum(["ok", "warning", "error"]), input: z.string(), output: z.string(), note: z.string().optional(),
});
const runSchema = z.object({
  id: z.string(), scenarioId: z.string(), task: z.string(), model: z.string(), promptVersion: z.string(), seed: z.number(),
  startedAt: z.string(), stoppedAtMs: z.number().optional(), status: z.enum(["running", "completed", "stopped"]),
  steps: z.array(stepSchema), claims: z.array(z.string()), feedback: z.enum(["up", "down"]).optional(), notes: z.record(z.string()),
});
const stateSchema = z.object({
  schema: z.literal(1),
  runs: z.array(runSchema),
  settings: z.object({ latencyBudgetMs: z.number().positive(), costBudget: z.number().positive(), passThreshold: z.number().min(0).max(100), owner: z.string() }),
});

export function parseState(input: unknown): TraceState {
  return stateSchema.parse(input) as TraceState;
}

export function makeId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

type Store = {
  state: TraceState;
  /** Wall clock in ms, ticking while any run is live. */
  now: number;
  /** Applies an action and returns its unique id (new runs derive their id from it). */
  dispatch: (action: ActionInput) => string;
  reset: () => void;
};

const StoreContext = createContext<Store | null>(null);

function load(): TraceState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return parseState(JSON.parse(raw));
  } catch {
    // Corrupt or unavailable storage falls back to the demo workspace.
  }
  return createSeed();
}

export function elapsedMs(run: Run, now: number): number {
  return Math.max(0, now - Date.parse(run.startedAt));
}

export function TraceProvider({ children }: { children: React.ReactNode }) {
  const [state, rawDispatch] = useReducer(reducer, undefined, load);
  const [now, setNow] = useState(() => Date.now());
  const first = useRef(true);
  const live = state.runs.filter((r) => r.status === "running");
  const hasLive = live.length > 0;

  const dispatch = useCallback((action: ActionInput) => {
    const uid = makeId();
    rawDispatch({ ...action, at: new Date().toISOString(), uid } as TraceAction);
    return uid;
  }, []);

  // Tick quickly while a run streams, and slowly otherwise so relative times stay fresh.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), hasLive ? 100 : 30_000);
    return () => window.clearInterval(t);
  }, [hasLive]);

  useEffect(() => {
    for (const run of live) {
      if (elapsedMs(run, now) >= totalDuration(run.steps)) dispatch({ type: "run/complete", runId: run.id });
    }
  }, [live, now, dispatch]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage may be full or blocked; the session still works in memory.
    }
  }, [state]);

  const reset = useCallback(() => dispatch({ type: "state/replace", state: createSeed() }), [dispatch]);
  const value = useMemo(() => ({ state, now, dispatch, reset }), [state, now, dispatch, reset]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useTrace(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useTrace must be used inside TraceProvider");
  return store;
}

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
