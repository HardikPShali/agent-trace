"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Dices, Download, Play, RotateCcw, Upload } from "lucide-react";
import { Confirm, Modal } from "@/components/ui/dialog";
import { runIdFor } from "@/lib/trace/reducer";
import { SCENARIOS } from "@/lib/trace/scenarios";
import { MODELS } from "@/lib/trace/simulate";
import type { Settings } from "@/lib/trace/types";
import { download, parseState, useTrace } from "./store";

const randomSeed = () => Math.floor(Math.random() * 10_000);

type NewRunProps = { open: boolean; onOpenChange: (open: boolean) => void; onStarted: (runId: string) => void };

export function NewRunModal({ open, onOpenChange, onStarted }: NewRunProps) {
  const { dispatch } = useTrace();
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0]!.id);
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
  const [promptVersion, setPromptVersion] = useState(scenario.prompts.at(-1)!.id);
  const [model, setModel] = useState(MODELS[0]!.id);
  const [seed, setSeed] = useState(randomSeed);
  const prompt = scenario.prompts.find((p) => p.id === promptVersion) ?? scenario.prompts.at(-1)!;

  const start = (e: React.FormEvent) => {
    e.preventDefault();
    const uid = dispatch({ type: "run/start", scenarioId, model, promptVersion: prompt.id, seed });
    onStarted(runIdFor(uid));
    onOpenChange(false);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="New run" description="Runs are simulated from a seed, so the same configuration always replays the same trace." wide>
      <form className="form" onSubmit={start}>
        <div className="form-grid">
          <label>
            Task
            <select value={scenarioId} onChange={(e) => {
              const next = SCENARIOS.find((s) => s.id === e.target.value)!;
              setScenarioId(next.id);
              setPromptVersion(next.prompts.at(-1)!.id);
            }}>
              {SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.task}</option>)}
            </select>
            <small className="hint">{scenario.description}</small>
          </label>
          <label>
            Model
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} · ${m.inputPer1k}/${m.outputPer1k} per 1k tokens</option>)}
            </select>
          </label>
          <label>
            Prompt version
            <select value={prompt.id} onChange={(e) => setPromptVersion(e.target.value)}>
              {scenario.prompts.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <label>
            Seed
            <span className="seed">
              <input type="number" min={0} value={seed} onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
              <button type="button" className="ghost" onClick={() => setSeed(randomSeed())} aria-label="Random seed"><Dices /></button>
            </span>
          </label>
        </div>
        <div className="prompt-preview"><span>System prompt · {prompt.label}</span><pre>{prompt.text}</pre></div>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => onOpenChange(false)}>Cancel</button>
          <button className="primary"><Play />Start run</button>
        </div>
      </form>
    </Modal>
  );
}

type SettingsProps = { open: boolean; onOpenChange: (open: boolean) => void };

export function SettingsModal({ open, onOpenChange }: SettingsProps) {
  const { state, dispatch, reset } = useTrace();
  const [form, setForm] = useState<Settings>(state.settings);
  const [resetting, setResetting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const valid = form.latencyBudgetMs >= 100 && form.costBudget > 0 && form.passThreshold >= 0 && form.passThreshold <= 100 && form.owner.trim().length > 0;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    dispatch({ type: "settings/update", patch: { ...form, owner: form.owner.trim() } });
    toast.success("Project settings saved", { description: "Evaluations were recalculated with the new budgets." });
    onOpenChange(false);
  };

  const importFile = async (file: File) => {
    try {
      const next = parseState(JSON.parse(await file.text()));
      dispatch({ type: "state/replace", state: next });
      toast.success(`Imported ${next.runs.length} runs`);
      onOpenChange(false);
    } catch {
      toast.error("That file is not a valid Agent Trace export.");
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Project settings" description="Budgets and the pass threshold apply to every run's evaluation." wide>
      <form className="form" onSubmit={save}>
        <div className="form-grid">
          <label>Latency budget (ms)<input type="number" min={100} step="any" value={form.latencyBudgetMs} onChange={(e) => setForm({ ...form, latencyBudgetMs: Number(e.target.value) })} /></label>
          <label>Cost budget per run ($)<input type="number" min={0.001} step="any" value={form.costBudget} onChange={(e) => setForm({ ...form, costBudget: Number(e.target.value) })} /></label>
          <label>Pass threshold (0–100)<input type="number" min={0} max={100} value={form.passThreshold} onChange={(e) => setForm({ ...form, passThreshold: Number(e.target.value) })} /></label>
          <label>Workspace owner<input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} maxLength={40} /></label>
        </div>
        {!valid ? <small className="error">Budgets must be positive and the threshold between 0 and 100.</small> : null}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => onOpenChange(false)}>Cancel</button>
          <button className="primary" disabled={!valid}>Save settings</button>
        </div>
      </form>
      <div className="data-actions">
        <span>Data</span>
        <button className="ghost" onClick={() => download("agent-trace-export.json", JSON.stringify(state, null, 2), "application/json")}><Download />Export all runs</button>
        <button className="ghost" onClick={() => fileInput.current?.click()}><Upload />Import</button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} />
        <button className="ghost danger-text" onClick={() => setResetting(true)}><RotateCcw />Reset demo data</button>
      </div>
      <Confirm open={resetting} onOpenChange={setResetting} title="Reset demo data?" description="All runs, notes and settings return to the sample workspace." confirmLabel="Reset" danger
        onConfirm={() => { reset(); onOpenChange(false); toast.success("Workspace reset"); }} />
    </Modal>
  );
}
