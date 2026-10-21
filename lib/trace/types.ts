export type StepType = "model" | "tool" | "decision" | "retrieval";
export type StepStatus = "ok" | "warning" | "error";

export type Step = {
  id: string;
  type: StepType;
  title: string;
  /** Model id for model steps, function name for tool steps. */
  name: string;
  /** Milliseconds from run start. Parallel steps share overlapping ranges. */
  startMs: number;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  status: StepStatus;
  input: string;
  output: string;
  /** Short explanation shown when a step is a warning or error. */
  note?: string;
};

export type RunStatus = "running" | "completed" | "stopped";
/** What the UI shows: completed runs become passed or failed from their evaluation. */
export type RunOutcome = "running" | "passed" | "failed" | "stopped";

export type Run = {
  id: string;
  scenarioId: string;
  task: string;
  model: string;
  promptVersion: string;
  seed: number;
  startedAt: string;
  /** Set when the run was stopped early; steps that had not finished by then are discarded. */
  stoppedAtMs?: number;
  status: RunStatus;
  steps: Step[];
  /** Factual claims in the final answer, checked against tool outputs. */
  claims: string[];
  feedback?: "up" | "down";
  notes: Record<string, string>;
};

export type Model = { id: string; label: string; inputPer1k: number; outputPer1k: number };

export type PromptVersion = { id: string; label: string; text: string; createdAt: string };

export type Scenario = {
  id: string;
  task: string;
  description: string;
  expectedTools: string[];
  /** Pairs [before, after]: `before` must run before `after` for policy compliance. */
  orderedTools: [string, string][];
  prompts: PromptVersion[];
};

export type EvalCheck = {
  id: "policy" | "tools" | "grounding" | "latency" | "cost";
  name: string;
  score: number;
  passed: boolean;
  detail: string;
};

export type Settings = {
  latencyBudgetMs: number;
  costBudget: number;
  passThreshold: number;
  owner: string;
};

export type TraceState = {
  schema: 1;
  runs: Run[];
  settings: Settings;
};
