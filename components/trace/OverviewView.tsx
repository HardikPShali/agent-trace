"use client";

import { useState } from "react";
import { evaluateRun, formatCost, formatMs, percentile, runCost, totalDuration } from "@/lib/trace/analysis";
import { MODELS } from "@/lib/trace/simulate";
import { SCENARIOS, scenarioById } from "@/lib/trace/scenarios";
import type { EvalCheck } from "@/lib/trace/types";
import { Empty } from "./shared";
import { useTrace } from "./store";

type Group = { key: string; label: string; sub: string; runs: number; passRate: number; avgScore: number; avgCost: number; p95: number };

export function OverviewView({ onOpenRun }: { onOpenRun: (id: string) => void }) {
  const { state } = useTrace();
  const [scenarioId, setScenarioId] = useState("");
  const done = state.runs.filter((r) => r.status === "completed" && (!scenarioId || r.scenarioId === scenarioId));
  const evaluated = done.map((r) => ({ run: r, ev: evaluateRun(r, scenarioById(r.scenarioId), state.settings) }));

  if (!evaluated.length) {
    return <section className="page"><Filters scenarioId={scenarioId} setScenarioId={setScenarioId} /><Empty title="No finished runs yet">Start a run to see quality, cost and latency trends.</Empty></section>;
  }

  const passRate = Math.round((evaluated.filter((e) => e.ev.passed).length / evaluated.length) * 100);
  const avgCost = evaluated.reduce((s, e) => s + runCost(e.run), 0) / evaluated.length;
  const p95 = percentile(evaluated.map((e) => totalDuration(e.run.steps)), 95);
  const avgScore = Math.round(evaluated.reduce((s, e) => s + e.ev.score, 0) / evaluated.length);

  const groups = new Map<string, typeof evaluated>();
  for (const e of evaluated) {
    const key = `${e.run.scenarioId}|${e.run.promptVersion}|${e.run.model}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const rows: Group[] = [...groups.entries()].map(([key, items]) => {
    const [sid, prompt, model] = key.split("|");
    return {
      key,
      label: `${scenarioById(sid!)?.task ?? sid}`,
      sub: `prompt ${prompt} · ${MODELS.find((m) => m.id === model)?.label ?? model}`,
      runs: items.length,
      passRate: Math.round((items.filter((e) => e.ev.passed).length / items.length) * 100),
      avgScore: Math.round(items.reduce((s, e) => s + e.ev.score, 0) / items.length),
      avgCost: items.reduce((s, e) => s + runCost(e.run), 0) / items.length,
      p95: percentile(items.map((e) => totalDuration(e.run.steps)), 95),
    };
  }).sort((a, b) => a.label.localeCompare(b.label) || a.sub.localeCompare(b.sub));

  // Pass rate per prompt version: the question "did the prompt change help?" in one chart.
  const byPrompt = new Map<string, typeof evaluated>();
  for (const e of evaluated) {
    const key = `${scenarioById(e.run.scenarioId)?.task ?? e.run.scenarioId} · ${e.run.promptVersion}`;
    byPrompt.set(key, [...(byPrompt.get(key) ?? []), e]);
  }
  const bars = [...byPrompt.entries()]
    .map(([label, items]) => ({ label, runs: items.length, rate: Math.round((items.filter((e) => e.ev.passed).length / items.length) * 100) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const failures = new Map<EvalCheck["id"], { name: string; count: number }>();
  for (const e of evaluated) for (const c of e.ev.checks) if (!c.passed) failures.set(c.id, { name: c.name, count: (failures.get(c.id)?.count ?? 0) + 1 });
  const worst = evaluated.filter((e) => !e.ev.passed).sort((a, b) => a.ev.score - b.ev.score).slice(0, 4);

  return (
    <section className="page">
      <Filters scenarioId={scenarioId} setScenarioId={setScenarioId} />
      <div className="tiles">
        <div><span>Finished runs</span><b>{evaluated.length}</b></div>
        <div><span>Pass rate</span><b>{passRate}%</b></div>
        <div><span>Average score</span><b>{avgScore}</b></div>
        <div><span>Average cost</span><b>{formatCost(avgCost)}</b></div>
        <div><span>p95 latency</span><b>{formatMs(p95)}</b><small className={p95 > state.settings.latencyBudgetMs ? "bad" : "ok"}>budget {formatMs(state.settings.latencyBudgetMs)}</small></div>
      </div>

      <div className="panel-pair">
        <section className="panel">
          <h2>Pass rate by prompt version</h2>
          <p className="muted-note">Share of finished runs that pass all gates. Hover a bar for counts.</p>
          <div className="hbars" role="list">
            {bars.map((b) => (
              <div key={b.label} className="hbar" role="listitem" tabIndex={0} aria-label={`${b.label}: ${b.rate}% of ${b.runs} runs`}>
                <span className="hbar-label">{b.label}</span>
                <span className="hbar-track"><i style={{ width: `${Math.max(b.rate, 1)}%` }} /></span>
                <span className="hbar-value">{b.rate}%</span>
                <span className="tip" role="tooltip">{b.label}<br /><b>{b.rate}%</b> passed · {b.runs} run{b.runs === 1 ? "" : "s"}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2>Why runs fail</h2>
          <p className="muted-note">Failed checks across finished runs.</p>
          {failures.size ? (
            <ul className="reasons">
              {[...failures.values()].sort((a, b) => b.count - a.count).map((f) => <li key={f.name}><span>{f.name}</span><b>{f.count}</b></li>)}
            </ul>
          ) : <p className="muted-note">Every check passes.</p>}
          {worst.length ? (
            <>
              <h3>Lowest-scoring failures</h3>
              <ul className="worst">
                {worst.map(({ run, ev }) => (
                  <li key={run.id}><button className="link" onClick={() => onOpenRun(run.id)}>{run.id}</button><span>{run.task} · {run.model} · {run.promptVersion}</span><b>{ev.score}</b></li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      </div>

      <section className="panel">
        <h2>Breakdown</h2>
        <div className="table-wrap">
          <table className="breakdown">
            <thead><tr><th>Task and configuration</th><th>Runs</th><th>Pass rate</th><th>Avg score</th><th>Avg cost</th><th>p95 latency</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <th>{r.label}<small>{r.sub}</small></th>
                  <td>{r.runs}</td><td className={r.passRate < 50 ? "bad" : ""}>{r.passRate}%</td><td>{r.avgScore}</td><td>{formatCost(r.avgCost)}</td><td>{formatMs(r.p95)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function Filters({ scenarioId, setScenarioId }: { scenarioId: string; setScenarioId: (id: string) => void }) {
  return (
    <div className="filters" role="group" aria-label="Filter by task">
      <button className={!scenarioId ? "pill active" : "pill"} onClick={() => setScenarioId("")}>All tasks</button>
      {SCENARIOS.map((s) => <button key={s.id} className={scenarioId === s.id ? "pill active" : "pill"} onClick={() => setScenarioId(s.id)}>{s.task}</button>)}
    </div>
  );
}
