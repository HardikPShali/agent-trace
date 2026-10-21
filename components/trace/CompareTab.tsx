"use client";

import { useState } from "react";
import { GitCompare } from "lucide-react";
import { alignSteps, diffLines, evaluateRun, formatCost, formatMs, runCost, runOutcome, totalDuration, totalTokens } from "@/lib/trace/analysis";
import { scenarioById } from "@/lib/trace/scenarios";
import type { Run } from "@/lib/trace/types";
import { Empty, OutcomeBadge, STEP_ICON, timeAgo } from "./shared";
import { useTrace } from "./store";

export function CompareTab({ run }: { run: Run }) {
  const { state } = useTrace();
  const candidates = state.runs.filter((r) => r.id !== run.id && r.status !== "running");
  // Default to the most recent finished run of the same task, which is the comparison people want first.
  const fallback = candidates.find((r) => r.scenarioId === run.scenarioId) ?? candidates[0];
  const [otherId, setOtherId] = useState(fallback?.id ?? "");
  const other = candidates.find((r) => r.id === otherId) ?? fallback;

  if (run.status === "running") return <Empty title="Comparison is available when the run finishes" />;
  if (!other) return <Empty title="No other runs to compare">Start another run to compare decisions side by side.</Empty>;

  const scenario = scenarioById(run.scenarioId);
  const otherScenario = scenarioById(other.scenarioId);
  const evalA = evaluateRun(run, scenario, state.settings);
  const evalB = evaluateRun(other, otherScenario, state.settings);
  const rows = alignSteps(run.steps, other.steps);
  const promptA = scenario?.prompts.find((p) => p.id === run.promptVersion);
  const promptB = otherScenario?.prompts.find((p) => p.id === other.promptVersion);
  const promptDiff = promptA && promptB && promptA !== promptB ? diffLines(promptB.text, promptA.text) : null;

  const metrics: { label: string; a: number; b: number; fmt: (n: number) => string; better: "lower" | "higher" }[] = [
    { label: "Duration", a: totalDuration(run.steps), b: totalDuration(other.steps), fmt: formatMs, better: "lower" },
    { label: "Tokens", a: totalTokens(run.steps), b: totalTokens(other.steps), fmt: (n) => n.toLocaleString(), better: "lower" },
    { label: "Cost", a: runCost(run), b: runCost(other), fmt: formatCost, better: "lower" },
    { label: "Evaluation", a: evalA.score, b: evalB.score, fmt: (n) => `${n}/100`, better: "higher" },
    { label: "Steps", a: run.steps.length, b: other.steps.length, fmt: String, better: "lower" },
  ];

  return (
    <div className="compare">
      <div className="compare-pick">
        <GitCompare />
        <label>
          Compare <b>{run.id}</b> with
          <select value={other.id} onChange={(e) => setOtherId(e.target.value)}>
            {candidates.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.task} · {r.model} · prompt {r.promptVersion}</option>)}
          </select>
        </label>
      </div>

      <div className="compare-cols">
        {[run, other].map((r, i) => (
          <div key={r.id} className="compare-card">
            <small>{i === 0 ? "This run" : "Comparison"}</small>
            <b>{r.id}</b>
            <span>{r.model} · prompt {r.promptVersion} · {timeAgo(r.startedAt)}</span>
            <OutcomeBadge outcome={runOutcome(r, scenarioById(r.scenarioId), state.settings)} />
          </div>
        ))}
      </div>

      <table className="delta">
        <thead><tr><th>Metric</th><th>This run</th><th>Comparison</th><th>Change</th></tr></thead>
        <tbody>
          {metrics.map((m) => {
            const diff = m.a - m.b;
            const good = diff === 0 ? "" : (diff < 0) === (m.better === "lower") ? "better" : "worse";
            return (
              <tr key={m.label}>
                <th>{m.label}</th><td>{m.fmt(m.a)}</td><td>{m.fmt(m.b)}</td>
                <td className={good}>{diff === 0 ? "No change" : `${diff > 0 ? "+" : "−"}${m.fmt(Math.abs(diff))}`}{good ? ` · ${good}` : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {promptDiff ? (
        <section className="compare-section">
          <h3>Prompt changes <span>{promptB!.label} → {promptA!.label}</span></h3>
          <pre className="prompt-diff">
            {promptDiff.map((l, i) => <span key={i} className={l.kind}>{l.kind === "add" ? "+ " : l.kind === "del" ? "− " : "  "}{l.text}{"\n"}</span>)}
          </pre>
        </section>
      ) : run.scenarioId === other.scenarioId ? <p className="muted-note">Both runs used the same prompt ({run.promptVersion}).</p> : <p className="muted-note">These runs solve different tasks, so their prompts are not compared.</p>}

      <section className="compare-section">
        <h3>Decision path <span>Aligned by step; divergences highlighted</span></h3>
        <div className="align">
          {rows.map((row, i) => (
            <div key={i} className={`align-row ${row.kind}`}>
              {[row.a, row.b].map((s, j) => s ? (
                <div key={j} className={`align-cell st-${s.status}`}>
                  <span className={`step-icon ${s.type}`}>{STEP_ICON[s.type]}</span>
                  <p><b>{s.title}</b><small>{s.type === "model" ? s.type : s.name} · {formatMs(s.durationMs)}{s.status !== "ok" ? ` · ${s.status}` : ""}</small></p>
                </div>
              ) : <div key={j} className="align-cell missing">{j === 0 ? "Not in this run" : "Not in comparison"}</div>)}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
