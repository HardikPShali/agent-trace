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
- **AI review** – on the Evaluations tab, "Explain this run" sends the trace and its evaluation results to a language model, which streams back what happened, the root cause and a concrete prompt fix.
- Data persists in the browser; the layout becomes a drawer-based flow on small screens.

## Engineering decisions

- The domain lives in `lib/trace/` as plain TypeScript: `simulate.ts` (seeded PRNG, sequential/parallel step scheduling, model pricing), `scenarios.ts` (tasks, prompt versions and how each version behaves), `analysis.ts` (evaluators, metrics, LCS-based step alignment and prompt diffs) and a pure `reducer.ts`.
- Runs are generated from `(task, model, prompt, seed)`, so any trace can be replayed exactly and prompt regressions are reproducible.
- Pass/fail is derived from evaluations rather than stored, so changing a budget re-scores history immediately.
- Live runs store their full plan and reveal steps by elapsed time; a single ticker completes them, so reloading mid-run resumes correctly.
- Radix tabs and dialogs provide accessible views; status always pairs color with an icon and a label.

## AI review: how it works

- `lib/ai/review.ts` turns a run into a compact request (long step inputs and outputs are clipped) and builds the prompt. It is pure TypeScript and unit-tested, including the streaming parser.
- `worker/ai.ts` exposes `POST /api/ai/review` on the Cloudflare Worker. It validates and size-limits the request, calls an OpenAI-compatible Chat Completions endpoint (Gemini's free tier by default) with `stream: true`, and re-streams only the text deltas to the browser as plain text.
- The API key never reaches the browser. Provider errors are logged on the server and replaced with a safe message for the user.
- `components/trace/AiReview.tsx` streams the answer in as it is written, can be stopped mid-answer (AbortController) and resets when you switch runs.
- Free by default: it uses Google's free Gemini API tier through its OpenAI-compatible endpoint. Set `AI_BASE_URL` to switch to OpenAI, Azure OpenAI (the Worker then uses the `api-key` header) or Groq.

### Configure (free)

1. Create a free Gemini API key in Google AI Studio (https://aistudio.google.com/apikey).
2. **Vercel (live site):** in the project's Settings → Environment Variables, add `AI_API_KEY` with that key, then redeploy. `api/ai/review.ts` is a Vercel Edge Function that serves `POST /api/ai/review` with the same handler as the Worker.
3. **Cloudflare (optional):** `npx wrangler secret put AI_API_KEY`.

Optional variables: `AI_MODEL` (default `gemini-flash-latest`), `AI_BASE_URL`, `AI_API_VERSION` (Azure). For local development put `AI_API_KEY=...` in a `.dev.vars` file (git-ignored). Without a key the feature shows a "not configured" message.

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
