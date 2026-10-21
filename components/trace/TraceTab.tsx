"use client";

import { useRef, useState } from "react";
import { AlertCircle, ArrowRight, Box, Check, Clock3, Copy, List, MessageSquareText, OctagonX } from "lucide-react";
import { Modal } from "@/components/ui/dialog";
import { formatCost, formatMs, stepCost, stepEnd, totalDuration, totalTokens } from "@/lib/trace/analysis";
import type { Run, Step } from "@/lib/trace/types";
import { Empty, STEP_ICON } from "./shared";
import { useTrace } from "./store";

type Props = { run: Run; steps: Step[]; elapsed: number };

export function TraceTab({ run, steps, elapsed }: Props) {
  const { dispatch } = useTrace();
  const live = run.status === "running";
  const flagged = steps.find((s) => s.status !== "ok");
  const [selectedId, setSelectedId] = useState<string | undefined>(flagged?.id ?? steps[0]?.id);
  const [mode, setMode] = useState<"list" | "waterfall">("list");
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // While streaming, follow the newest step unless the user picked one.
  const selected = steps.find((s) => s.id === selectedId) ?? (live ? steps[steps.length - 1] : steps[0]);
  const span = Math.max(live ? elapsed : 0, totalDuration(steps), 1);
  const inFlight = (s: Step) => live && stepEnd(s) > elapsed;
  const finished = steps.filter((s) => !inFlight(s));

  const move = (delta: number) => {
    if (!selected) return;
    const i = steps.findIndex((s) => s.id === selected.id);
    const next = steps[Math.min(steps.length - 1, Math.max(0, i + delta))];
    if (!next) return;
    setSelectedId(next.id);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-step="${next.id}"]`)?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); move(1); }
    if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); move(-1); }
  };

  const copy = () => {
    if (!selected) return;
    void navigator.clipboard?.writeText(selected.output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  if (!steps.length) {
    return <Empty title={live ? "Waiting for the first step…" : "This run recorded no steps"}>{live ? "Steps appear here as the agent works." : "It was stopped before any step finished."}</Empty>;
  }

  return (
    <div className="trace-grid">
      <section className="flow">
        <div className="flow-head">
          <div><span>Execution path</span><b>{steps.length} step{steps.length === 1 ? "" : "s"} · {totalTokens(finished).toLocaleString()} tokens{live ? " · streaming" : ""}</b></div>
          <div className="segmented" role="group" aria-label="Trace layout">
            <button aria-pressed={mode === "list"} onClick={() => setMode("list")}><List />List</button>
            <button aria-pressed={mode === "waterfall"} onClick={() => setMode("waterfall")}><Clock3 />Waterfall</button>
          </div>
        </div>
        <div className={mode === "list" ? "steps" : "steps waterfall"} ref={listRef} onKeyDown={onKeyDown} role="listbox" aria-label="Steps" aria-activedescendant={selected?.id}>
          {steps.map((s, i) => {
            const running = inFlight(s);
            return (
              <button key={s.id} id={s.id} data-step={s.id} role="option" aria-selected={selected?.id === s.id}
                className={`step ${selected?.id === s.id ? "selected" : ""} st-${s.status}`} onClick={() => setSelectedId(s.id)}
                tabIndex={selected?.id === s.id ? 0 : -1}>
                <span className={`step-icon ${s.type}`}>{STEP_ICON[s.type]}</span>
                {mode === "list" ? <span className="step-line" /> : null}
                <span className="step-copy">
                  <small>Step {i + 1} · {s.type}{run.notes[s.id] ? " · note" : ""}</small>
                  <b>{s.title}</b>
                  <em>{s.type === "model" && !running ? `${s.name} · ${(s.tokensIn + s.tokensOut).toLocaleString()} tokens` : s.name}</em>
                  {mode === "waterfall" ? (
                    <span className="bar-track" aria-hidden>
                      <i className={s.type} style={{ left: `${(s.startMs / span) * 100}%`, width: `${(Math.min(s.durationMs, running ? elapsed - s.startMs : s.durationMs) / span) * 100}%` }} />
                    </span>
                  ) : null}
                </span>
                <span className="duration">{running ? "running" : formatMs(s.durationMs)}</span>
                {s.status === "warning" ? <AlertCircle className="alert" aria-label="Warning" /> : s.status === "error" ? <OctagonX className="alert error" aria-label="Error" /> : <span />}
              </button>
            );
          })}
        </div>
        <p className="kbd-hint">Use <kbd>↑</kbd> <kbd>↓</kbd> or <kbd>j</kbd> <kbd>k</kbd> to move between steps.</p>
      </section>

      {selected ? (
        <aside className="inspector" aria-label="Step inspector">
          <div className="inspect-head">
            <span>Step {steps.indexOf(selected) + 1} of {steps.length}</span>
            <div>
              <button onClick={copy} aria-label="Copy output" title="Copy output">{copied ? <Check /> : <Copy />}</button>
            </div>
          </div>
          <div className="inspect-title">
            <span className={`step-icon ${selected.type}`}>{STEP_ICON[selected.type]}</span>
            <div><small>{selected.type} · {selected.name}</small><h2>{selected.title}</h2></div>
          </div>
          {selected.note && !inFlight(selected) ? <div className={`callout st-${selected.status}`}><AlertCircle /><p>{selected.note}</p></div> : null}
          <div className="inspect-block"><span>Input</span><pre>{selected.input}</pre></div>
          <div className="inspect-block"><span>Output</span><pre>{inFlight(selected) ? "…waiting for result" : selected.output}</pre></div>
          <div className="inspect-block">
            <span>Telemetry</span>
            <dl>
              <div><dt>Started at</dt><dd>+{formatMs(selected.startMs)}</dd></div>
              {inFlight(selected) ? (
                <>
                  <div><dt>Running for</dt><dd>{formatMs(elapsed - selected.startMs)}</dd></div>
                  <div><dt>Status</dt><dd className="st-running">Running</dd></div>
                </>
              ) : (
                <>
                  <div><dt>Latency</dt><dd>{formatMs(selected.durationMs)}</dd></div>
                  <div><dt>Tokens in / out</dt><dd>{selected.type === "model" ? `${selected.tokensIn.toLocaleString()} / ${selected.tokensOut.toLocaleString()}` : "None"}</dd></div>
                  <div><dt>Cost</dt><dd>{selected.type === "model" ? formatCost(stepCost(selected, run.model)) : "—"}</dd></div>
                  <div><dt>Status</dt><dd className={`st-${selected.status}`}>{selected.status === "ok" ? "Completed" : selected.status === "warning" ? "Completed with warning" : "Failed"}</dd></div>
                </>
              )}
            </dl>
          </div>
          <NoteEditor key={`${run.id}:${selected.id}`} initial={run.notes[selected.id] ?? ""}
            onSave={(text) => dispatch({ type: "run/note", runId: run.id, stepId: selected.id, text })} />
          <button className="open-log" onClick={() => setRaw(true)}><Box /> Open raw event <ArrowRight /></button>
          <Modal open={raw} onOpenChange={setRaw} title={`Raw event · ${selected.id}`} description="The span exactly as it was recorded." wide>
            <pre className="raw">{JSON.stringify({ runId: run.id, ...selected, input: tryParse(selected.input), output: tryParse(selected.output) }, null, 2)}</pre>
          </Modal>
        </aside>
      ) : null}
    </div>
  );
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function NoteEditor({ initial, onSave }: { initial: string; onSave: (text: string) => void }) {
  const [text, setText] = useState(initial);
  const dirty = text.trim() !== initial;
  return (
    <div className="inspect-block note">
      <span><MessageSquareText /> Review note</span>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="What should the team know about this step?" aria-label="Review note" />
      <div className="note-actions">
        {initial ? <button className="ghost" onClick={() => { setText(""); onSave(""); }}>Remove</button> : null}
        <button className="primary small" disabled={!dirty} onClick={() => onSave(text)}>{initial ? "Update note" : "Save note"}</button>
      </div>
    </div>
  );
}
