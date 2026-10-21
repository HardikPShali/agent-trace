import { MODELS } from "./simulate.ts";
import type { EvalCheck, Run, RunOutcome, Scenario, Settings, Step } from "./types.ts";

/** Steps that have started `elapsedMs` into a live run; finished and stopped runs show every recorded step. */
export function visibleSteps(run: Run, elapsedMs: number): Step[] {
  return run.status === "running" ? run.steps.filter((s) => s.startMs <= elapsedMs) : run.steps;
}

export function stepEnd(step: Step): number {
  return step.startMs + step.durationMs;
}

export function totalDuration(steps: Step[]): number {
  return steps.reduce((m, s) => Math.max(m, stepEnd(s)), 0);
}

export function totalTokens(steps: Step[]): number {
  return steps.reduce((n, s) => n + s.tokensIn + s.tokensOut, 0);
}

export function stepCost(step: Step, modelId: string): number {
  const model = MODELS.find((m) => m.id === modelId);
  if (!model || step.type !== "model") return 0;
  return (step.tokensIn / 1000) * model.inputPer1k + (step.tokensOut / 1000) * model.outputPer1k;
}

export function runCost(run: Run, steps: Step[] = run.steps): number {
  return steps.reduce((sum, s) => sum + stepCost(s, run.model), 0);
}

export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export function formatCost(cost: number): string {
  return `$${cost.toFixed(3)}`;
}

const toolSteps = (steps: Step[]) => steps.filter((s) => s.type === "tool" || s.type === "retrieval");

export type Evaluation = { checks: EvalCheck[]; score: number; passed: boolean };

export const EVAL_WEIGHTS: Record<EvalCheck["id"], number> = { policy: 0.35, tools: 0.25, grounding: 0.25, latency: 0.1, cost: 0.05 };

export function evaluateRun(run: Run, scenario: Scenario | undefined, settings: Settings, steps: Step[] = run.steps): Evaluation {
  const tools = toolSteps(steps);
  const firstStart = (name: string) => tools.find((s) => s.name === name)?.startMs;
  const firstEnd = (name: string) => {
    const s = tools.find((x) => x.name === name);
    return s ? stepEnd(s) : undefined;
  };

  // Policy: ordering rules plus any step the agent itself flagged as a warning.
  const violations: string[] = [];
  for (const [before, after] of scenario?.orderedTools ?? []) {
    const afterStart = firstStart(after);
    if (afterStart === undefined) continue;
    const beforeEnd = firstEnd(before);
    if (beforeEnd === undefined) violations.push(`${after} ran without ${before}`);
    else if (beforeEnd > afterStart) violations.push(`${after} ran before ${before} finished`);
  }
  for (const s of steps) if (s.status === "warning" && s.note) violations.push(s.note);
  const policyScore = Math.max(0, 100 - violations.length * 40);

  // Tool selection: share of calls that hit an expected tool, minus failed calls.
  const expected = new Set(scenario?.expectedTools ?? []);
  const correct = tools.filter((s) => expected.has(s.name)).length;
  const errors = steps.filter((s) => s.status === "error").length;
  const toolScore = tools.length ? Math.max(0, Math.round((correct / tools.length) * 100) - errors * 10) : 0;
  const wrong = tools.filter((s) => !expected.has(s.name)).map((s) => s.name);

  // Grounding: every quoted fact must appear in some tool call's arguments or result.
  const evidence = tools.map((s) => `${s.input}\n${s.output}`.toLowerCase()).join("\n");
  const ungrounded = run.claims.filter((c) => !evidence.includes(c.toLowerCase()));
  const groundingScore = run.claims.length ? Math.round(((run.claims.length - ungrounded.length) / run.claims.length) * 100) : 100;

  const duration = totalDuration(steps);
  const latencyScore = duration <= settings.latencyBudgetMs ? 100 : Math.round((settings.latencyBudgetMs / duration) * 100);
  const cost = runCost(run, steps);
  const costScore = cost <= settings.costBudget ? 100 : Math.round((settings.costBudget / cost) * 100);

  const checks: EvalCheck[] = [
    {
      id: "policy", name: "Policy compliance", score: policyScore, passed: violations.length === 0,
      detail: violations.length ? violations.join(" · ") : "All ordering and approval rules were followed.",
    },
    {
      id: "tools", name: "Tool selection", score: toolScore, passed: toolScore >= 80,
      detail: wrong.length ? `Unexpected tool${wrong.length === 1 ? "" : "s"}: ${wrong.join(", ")}.` : `${correct} of ${tools.length} tool calls matched the expected toolset.`,
    },
    {
      id: "grounding", name: "Answer groundedness", score: groundingScore, passed: ungrounded.length === 0,
      detail: ungrounded.length ? `Not found in any tool call: ${ungrounded.map((c) => `“${c}”`).join(", ")}.` : `${run.claims.length} quoted fact${run.claims.length === 1 ? "" : "s"} traced to tool calls.`,
    },
    {
      id: "latency", name: "Latency budget", score: latencyScore, passed: duration <= settings.latencyBudgetMs,
      detail: `${formatMs(duration)} against a ${formatMs(settings.latencyBudgetMs)} budget.`,
    },
    {
      id: "cost", name: "Cost budget", score: costScore, passed: cost <= settings.costBudget,
      detail: `${formatCost(cost)} against a ${formatCost(settings.costBudget)} budget.`,
    },
  ];
  const score = Math.round(checks.reduce((sum, c) => sum + c.score * EVAL_WEIGHTS[c.id], 0));
  const passed = score >= settings.passThreshold && checks[0]!.passed && checks[2]!.passed;
  return { checks, score, passed };
}

/** Longest-common-subsequence alignment used by both step and prompt diffs. */
function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [number, number][] {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = eq(a[i]!, b[j]!) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (eq(a[i]!, b[j]!)) {
      pairs.push([i++, j++]);
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

function merge<T, R>(a: T[], b: T[], eq: (x: T, y: T) => boolean, row: (x?: T, y?: T) => R): R[] {
  const out: R[] = [];
  let i = 0;
  let j = 0;
  for (const [pi, pj] of lcs(a, b, eq)) {
    while (i < pi) out.push(row(a[i++], undefined));
    while (j < pj) out.push(row(undefined, b[j++]));
    out.push(row(a[i++], b[j++]));
  }
  while (i < a.length) out.push(row(a[i++], undefined));
  while (j < b.length) out.push(row(undefined, b[j++]));
  return out;
}

export type StepRow = { a?: Step; b?: Step; kind: "same" | "changed" | "onlyA" | "onlyB" };

const stepKey = (s: Step) => `${s.type}:${s.type === "model" ? "" : s.name}:${s.title}`;

export function alignSteps(a: Step[], b: Step[]): StepRow[] {
  return merge(a, b, (x, y) => stepKey(x) === stepKey(y), (x, y) => ({
    a: x,
    b: y,
    kind: !x ? "onlyB" : !y ? "onlyA" : x.status !== y.status || x.output !== y.output ? "changed" : "same",
  }));
}

export type LineDiff = { kind: "same" | "add" | "del"; text: string };

export function diffLines(before: string, after: string): LineDiff[] {
  return merge(before.split("\n"), after.split("\n"), (x, y) => x === y, (x, y) =>
    x !== undefined && y !== undefined ? { kind: "same" as const, text: x } : x !== undefined ? { kind: "del" as const, text: x } : { kind: "add" as const, text: y! },
  );
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

export function runOutcome(run: Run, scenario: Scenario | undefined, settings: Settings): RunOutcome {
  if (run.status !== "completed") return run.status;
  return evaluateRun(run, scenario, settings).passed ? "passed" : "failed";
}
