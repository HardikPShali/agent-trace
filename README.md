# Agent Trace

Agent Trace is a visual workspace for understanding what an AI agent did, why it made each decision and where a run became unreliable.

## Why this project exists

AI products are easy to demo and difficult to debug. A final response rarely explains whether the model misunderstood the task, selected the wrong tool, used stale context or simply took too long. Agent Trace makes that path inspectable.

## Product capabilities

- **Runs** – start a run from a task, model, prompt version and seed. It streams step by step and can be stopped mid-flight (unfinished work is discarded). "Run again" replays the configuration with a new seed. Search and filter runs by outcome; export, delete or rate (👍/👎) any run.
- **Trace** – model, tool, retrieval and decision steps in execution order, as a list or a latency waterfall (parallel calls overlap). Keyboard navigation (↑/↓ or j/k), an inspector with input, output, telemetry and cost, warnings explained inline, the raw span as JSON, and per-step review notes.
- **Compare** – pick any other run: metric deltas (duration, tokens, cost, score), a line diff of the prompt versions, and an aligned decision path that highlights where the runs diverged.
- **Evaluations** – five deterministic checks with weights: policy compliance (tool ordering and approval rules), tool selection, answer groundedness (every quoted fact must appear in a tool call), latency budget and cost budget. A run passes on score ≥ threshold *and* clean policy and grounding.
- **Overview** – pass rate, average score and cost, p95 latency against budget, pass rate by prompt version, the most common failure reasons and a breakdown by task × prompt × model.
- **Project settings** – latency and cost budgets and the pass threshold (all evaluations recalculate), plus validated JSON export/import and a demo reset.
- Data persists in the browser; the layout becomes a drawer-based flow on small screens.

## Engineering decisions

- The domain lives in `lib/trace/` as plain TypeScript: `simulate.ts` (seeded PRNG, sequential/parallel step scheduling, model pricing), `scenarios.ts` (tasks, prompt versions and how each version behaves), `analysis.ts` (evaluators, metrics, LCS-based step alignment and prompt diffs) and a pure `reducer.ts`.
- Runs are generated from `(task, model, prompt, seed)`, so any trace can be replayed exactly and prompt regressions are reproducible.
- Pass/fail is derived from evaluations rather than stored, so changing a budget re-scores history immediately.
- Live runs store their full plan and reveal steps by elapsed time; a single ticker completes them, so reloading mid-run resumes correctly.
- Radix tabs and dialogs provide accessible views; status always pairs color with an icon and a label.

## Run locally

```bash
npm ci
npm run dev
```

## Verify

```bash
npm run build
npm run lint
npm test   # builds, then runs the simulator, evaluator and reducer tests in tests/
```

## Next step

A production version would ingest OpenTelemetry spans, stream active runs through server-sent events and store versioned prompts so regressions can be traced to an exact change.
