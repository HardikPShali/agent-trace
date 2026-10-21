"use client";

import { CircleCheck, CircleX, Settings2 } from "lucide-react";
import { EVAL_WEIGHTS, evaluateRun } from "@/lib/trace/analysis";
import { scenarioById } from "@/lib/trace/scenarios";
import type { Run, Step } from "@/lib/trace/types";
import { Empty } from "./shared";
import { useTrace } from "./store";

export function EvalsTab({ run, steps, onOpenSettings }: { run: Run; steps: Step[]; onOpenSettings: () => void }) {
  const { state } = useTrace();
  if (run.status === "running") return <Empty title="Evaluations run when the agent finishes" />;
  const { checks, score, passed } = evaluateRun(run, scenarioById(run.scenarioId), state.settings, steps);

  return (
    <div className="evals">
      <div className="eval-summary">
        <div>
          <span>Overall score</span>
          <b className={passed ? "ok" : "bad"}>{score}<small>/100</small></b>
        </div>
        <p>
          {run.status === "stopped"
            ? "This run was stopped, so it is scored on the steps that finished."
            : passed
              ? `Passes: the score is at least ${state.settings.passThreshold} and policy and grounding checks pass.`
              : `Fails: a run needs at least ${state.settings.passThreshold}, full policy compliance and fully grounded answers.`}
        </p>
        <button className="ghost" onClick={onOpenSettings}><Settings2 />Budgets & threshold</button>
      </div>
      <div className="eval-grid">
        {checks.map((c) => (
          <article key={c.id} className={c.passed ? "" : "failing"}>
            <span>{c.name} <em>weight {Math.round(EVAL_WEIGHTS[c.id] * 100)}%</em></span>
            <b>{c.score}%</b>
            <div className="meter" role="meter" aria-valuenow={c.score} aria-valuemin={0} aria-valuemax={100} aria-label={c.name}><i style={{ width: `${c.score}%` }} /></div>
            <small className={c.passed ? "ok" : "bad"}>{c.passed ? <CircleCheck /> : <CircleX />}{c.passed ? "Passed" : "Failed"}</small>
            <p>{c.detail}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
