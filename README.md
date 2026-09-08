# Agent Trace

Agent Trace is a visual workspace for understanding what an AI agent did, why it made each decision and where a run became unreliable.

## Why this project exists

AI products are easy to demo and difficult to debug. A final response rarely explains whether the model misunderstood the task, selected the wrong tool, used stale context or simply took too long. Agent Trace makes that path inspectable.

## Product capabilities

- Browse and search recent agent runs.
- Inspect model, tool and decision steps in execution order.
- Review output, latency and token telemetry for each step.
- Compare run-level cost, duration and evaluation scores.
- View policy compliance, tool selection and grounding evaluations.
- Navigate the core interface using mouse, keyboard or touch.

## Engineering decisions

- React and TypeScript drive the interactive workspace.
- Derived state keeps search results predictable without duplicate data.
- Radix-based tabs provide accessible trace, comparison and evaluation views.
- The split-panel layout becomes a stacked inspection flow on smaller screens.
- Reduced-motion preferences are respected.
- Synthetic data keeps the repository safe to run without credentials.

## Run locally

```bash
npm ci
npm run dev
```

## Verify

```bash
npm run build
npm run lint
```

## Next step

A production version would ingest OpenTelemetry spans, stream active runs through server-sent events and store versioned prompts so regressions can be traced to an exact change.
