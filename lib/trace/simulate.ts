import type { Model, Run, Step, StepStatus, StepType } from "./types.ts";

export const MODELS: Model[] = [
  { id: "gpt-5.2", label: "GPT-5.2", inputPer1k: 0.0125, outputPer1k: 0.05 },
  { id: "gpt-5.1", label: "GPT-5.1", inputPer1k: 0.01, outputPer1k: 0.04 },
  { id: "gpt-5-mini", label: "GPT-5 mini", inputPer1k: 0.0025, outputPer1k: 0.01 },
];

/** Relative speed of model steps; tool latency does not depend on the model. */
const MODEL_SPEED: Record<string, number> = { "gpt-5.2": 1, "gpt-5.1": 1.15, "gpt-5-mini": 0.6 };

/** Small deterministic PRNG so a (scenario, model, prompt, seed) tuple always replays the same trace. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type StepSpec = {
  type: StepType;
  title: string;
  name?: string;
  ms: number;
  tokensIn?: number;
  tokensOut?: number;
  status?: StepStatus;
  input: unknown;
  output: unknown;
  note?: string;
};

export type BuildContext = {
  model: string;
  prompt: string;
  rng: () => number;
  /** True with probability p. */
  chance: (p: number) => boolean;
  /** Appends a step after everything scheduled so far. */
  seq: (spec: StepSpec) => void;
  /** Runs steps concurrently, starting together after everything scheduled so far. */
  par: (specs: StepSpec[]) => void;
  claim: (...claims: string[]) => void;
};

export type ScenarioBuilder = (ctx: BuildContext) => void;

const text = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

export function simulateRun(
  builder: ScenarioBuilder,
  opts: { runId: string; model: string; prompt: string; seed: number },
): Pick<Run, "steps" | "claims"> {
  const rng = mulberry32(opts.seed);
  const speed = MODEL_SPEED[opts.model] ?? 1;
  const steps: Step[] = [];
  const claims: string[] = [];
  let cursor = 0;

  const make = (spec: StepSpec, start: number): Step => {
    const jitter = 0.8 + rng() * 0.45;
    const base = spec.type === "model" ? spec.ms * speed : spec.ms;
    const tokensIn = spec.type === "model" ? Math.round((spec.tokensIn ?? 0) * (0.92 + rng() * 0.16)) : 0;
    const tokensOut = spec.type === "model" ? Math.round((spec.tokensOut ?? 0) * (0.85 + rng() * 0.3)) : 0;
    return {
      id: `${opts.runId}-s${steps.length + 1}`,
      type: spec.type,
      title: spec.title,
      name: spec.type === "model" ? opts.model : (spec.name ?? spec.type),
      startMs: start,
      durationMs: Math.max(8, Math.round(base * jitter)),
      tokensIn,
      tokensOut,
      status: spec.status ?? "ok",
      input: text(spec.input),
      output: text(spec.output),
      note: spec.note,
    };
  };

  const ctx: BuildContext = {
    model: opts.model,
    prompt: opts.prompt,
    rng,
    chance: (p) => rng() < p,
    seq: (spec) => {
      const step = make(spec, cursor);
      steps.push(step);
      cursor = step.startMs + step.durationMs;
    },
    par: (specs) => {
      const start = cursor;
      for (const spec of specs) {
        const step = make(spec, start);
        steps.push(step);
        cursor = Math.max(cursor, step.startMs + step.durationMs);
      }
    },
    claim: (...c) => claims.push(...c),
  };
  builder(ctx);
  return { steps, claims };
}
