"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Toaster, toast } from "sonner";
import {
  Activity, ChevronRight, CircleStop, Command, Download, GitCompare, LayoutDashboard, PanelLeft, Play, Search,
  Settings2, TestTube2, ThumbsDown, ThumbsUp, Trash2, X,
} from "lucide-react";
import { Confirm } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { evaluateRun, formatCost, formatMs, runCost, runOutcome, totalDuration, visibleSteps } from "@/lib/trace/analysis";
import { runIdFor } from "@/lib/trace/reducer";
import { scenarioById } from "@/lib/trace/scenarios";
import { MODELS } from "@/lib/trace/simulate";
import type { Run, RunOutcome } from "@/lib/trace/types";
import { CompareTab } from "./CompareTab";
import { NewRunModal, SettingsModal } from "./Dialogs";
import { EvalsTab } from "./EvalsTab";
import { OverviewView } from "./OverviewView";
import { Empty, OutcomeBadge, timeAgo } from "./shared";
import { TraceProvider, download, elapsedMs, useTrace } from "./store";
import { TraceTab } from "./TraceTab";

const noopSubscribe = () => () => {};

export function TraceApp() {
  // Runs live in localStorage, so render only after mount to avoid hydration mismatches.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!mounted) return <main className="shell booting" aria-busy="true"><aside className="side" /><section className="work" /></main>;
  return (
    <TraceProvider>
      <Workspace />
      <Toaster theme="dark" position="bottom-right" closeButton />
    </TraceProvider>
  );
}

type Route = { view: "overview" } | { view: "run"; runId?: string };

function readRoute(): Route {
  const hash = window.location.hash.slice(1);
  if (hash === "overview") return { view: "overview" };
  return { view: "run", runId: hash.startsWith("run_") ? hash : undefined };
}

const FILTERS: { id: "" | RunOutcome; label: string }[] = [
  { id: "", label: "All" },
  { id: "passed", label: "Passed" },
  { id: "failed", label: "Failed" },
  { id: "running", label: "Live" },
];

function Workspace() {
  const { state, now } = useTrace();
  const [route, setRoute] = useState<Route>(readRoute);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"" | RunOutcome>("");
  const [drawer, setDrawer] = useState(false);
  const [newRun, setNewRun] = useState(false);
  const [settings, setSettings] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.matches("input, textarea, select");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".run-search input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = useCallback((next: Route) => {
    window.location.hash = next.view === "overview" ? "overview" : (next.runId ?? "");
    setRoute(next);
    setDrawer(false);
  }, []);

  const outcomeOf = (r: Run) => runOutcome(r, scenarioById(r.scenarioId), state.settings);
  const q = query.trim().toLowerCase();
  const filtered = state.runs.filter((r) =>
    (!q || `${r.task} ${r.id} ${r.model} ${r.promptVersion}`.toLowerCase().includes(q)) && (!filter || outcomeOf(r) === filter),
  );
  const run = route.view === "run" ? (state.runs.find((r) => r.id === route.runId) ?? state.runs[0]) : undefined;

  return (
    <main className="shell">
      {drawer ? <button className="scrim" aria-label="Close menu" onClick={() => setDrawer(false)} /> : null}
      <aside className={drawer ? "side open" : "side"} aria-label="Runs">
        <div className="logo"><Command /><b>AGENT TRACE</b><button className="close-drawer" onClick={() => setDrawer(false)} aria-label="Close menu"><X /></button></div>
        <button className="new-run" onClick={() => setNewRun(true)}><Play /> New run</button>
        <button className={route.view === "overview" ? "nav-link active" : "nav-link"} onClick={() => go({ view: "overview" })}><LayoutDashboard />Overview</button>
        <label className="run-search"><Search /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search runs" aria-label="Search runs" /><kbd>/</kbd></label>
        <div className="run-filters" role="group" aria-label="Filter runs">
          {FILTERS.map((f) => <button key={f.id} className={filter === f.id ? "active" : undefined} onClick={() => setFilter(f.id)}>{f.label}</button>)}
        </div>
        <div className="side-label">Recent runs <span>{filtered.length}</span></div>
        <div className="run-list">
          {filtered.map((r) => {
            const outcome = outcomeOf(r);
            return (
              <button key={r.id} className={route.view === "run" && run?.id === r.id ? "run active" : "run"} onClick={() => go({ view: "run", runId: r.id })}>
                <span className={`run-dot ${outcome}`} aria-label={outcome} />
                <span><b>{r.task}</b><small>{r.id} · {r.model} · {r.promptVersion} · {timeAgo(r.startedAt, now)}</small></span>
                <ChevronRight />
              </button>
            );
          })}
          {!filtered.length ? <p className="muted-note">No runs match.</p> : null}
        </div>
        <div className="side-foot">
          <button onClick={() => setSettings(true)}><Settings2 /> Project settings</button>
          <div><span>{state.settings.owner.split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase()}</span><p><b>{state.settings.owner}</b><small>Personal workspace</small></p></div>
        </div>
      </aside>

      <section className="work">
        {route.view === "overview" ? (
          <>
            <header>
              <button className="menu" aria-label="Open menu" onClick={() => setDrawer(true)}><PanelLeft /></button>
              <div><span className="crumb">Project / overview</span><h1>Quality, cost and latency</h1></div>
              <div className="head-actions"><button className="primary" onClick={() => setNewRun(true)}><Play /> New run</button></div>
            </header>
            <OverviewView onOpenRun={(id) => go({ view: "run", runId: id })} />
          </>
        ) : run ? (
          <RunView key={run.id} run={run} onMenu={() => setDrawer(true)} onOpenRun={(id) => go({ view: "run", runId: id })} onOpenSettings={() => setSettings(true)} />
        ) : (
          <>
            <header><button className="menu" aria-label="Open menu" onClick={() => setDrawer(true)}><PanelLeft /></button><div><h1>No runs yet</h1></div></header>
            <Empty title="Start your first run">Use “New run” to simulate an agent and inspect its trace.</Empty>
          </>
        )}
      </section>

      {newRun ? <NewRunModal open onOpenChange={setNewRun} onStarted={(id) => go({ view: "run", runId: id })} /> : null}
      {settings ? <SettingsModal open onOpenChange={setSettings} /> : null}
    </main>
  );
}

type RunViewProps = { run: Run; onMenu: () => void; onOpenRun: (id: string) => void; onOpenSettings: () => void };

function RunView({ run, onMenu, onOpenRun, onOpenSettings }: RunViewProps) {
  const { state, now, dispatch } = useTrace();
  const [deleting, setDeleting] = useState(false);
  const scenario = scenarioById(run.scenarioId);
  const elapsed = elapsedMs(run, now);
  const live = run.status === "running";
  const steps = visibleSteps(run, elapsed);
  const outcome = runOutcome(run, scenario, state.settings);
  const evaluation = live ? undefined : evaluateRun(run, scenario, state.settings);
  const duration = live ? Math.min(elapsed, totalDuration(run.steps)) : totalDuration(run.steps);
  const failing = evaluation?.checks.filter((c) => !c.passed).length ?? 0;

  const runAgain = () => {
    const uid = dispatch({ type: "run/start", scenarioId: run.scenarioId, model: run.model, promptVersion: run.promptVersion, seed: Math.floor(Math.random() * 10_000) });
    onOpenRun(runIdFor(uid));
    toast("Run started", { description: `Same task, model and prompt (${run.promptVersion}) with a new seed.` });
  };

  const stop = () => {
    dispatch({ type: "run/stop", runId: run.id, elapsedMs: elapsed });
    toast("Run stopped", { description: "Steps still in flight were discarded." });
  };

  const feedback = (value: "up" | "down") => dispatch({ type: "run/feedback", runId: run.id, value: run.feedback === value ? undefined : value });

  return (
    <>
      <header>
        <button className="menu" aria-label="Open menu" onClick={onMenu}><PanelLeft /></button>
        <div><span className="crumb">Runs / {run.id}</span><h1>{run.task}</h1></div>
        <div className="head-actions">
          {!live ? (
            <span className="feedback" role="group" aria-label="Rate this run">
              <button aria-pressed={run.feedback === "up"} onClick={() => feedback("up")} aria-label="Good run"><ThumbsUp /></button>
              <button aria-pressed={run.feedback === "down"} onClick={() => feedback("down")} aria-label="Bad run"><ThumbsDown /></button>
            </span>
          ) : null}
          <button onClick={() => download(`${run.id}.json`, JSON.stringify(run, null, 2), "application/json")} aria-label="Export run JSON" title="Export run JSON"><Download /></button>
          <button onClick={() => setDeleting(true)} disabled={live} aria-label="Delete run" title="Delete run"><Trash2 /></button>
          {live ? <button className="stop" onClick={stop}><CircleStop /> Stop</button> : null}
          <button className="primary" onClick={runAgain}><Play /> Run again</button>
        </div>
      </header>

      <div className="summary">
        <div>
          <OutcomeBadge outcome={outcome} />
          <p>{live ? `Running for ${formatMs(elapsed)}` : run.status === "stopped" ? `Stopped after ${formatMs(run.stoppedAtMs ?? duration)}` : "Completed"} · started {timeAgo(run.startedAt, now)}</p>
        </div>
        <dl>
          <div><dt>Duration</dt><dd>{formatMs(duration)}</dd></div>
          <div><dt>Model</dt><dd>{MODELS.find((m) => m.id === run.model)?.label ?? run.model}</dd></div>
          <div><dt>Prompt</dt><dd>{run.promptVersion}</dd></div>
          <div><dt>Cost</dt><dd>{formatCost(runCost(run, steps.filter((s) => s.startMs + s.durationMs <= (live ? elapsed : Infinity))))}</dd></div>
          <div><dt>Evaluation</dt><dd className={evaluation && !evaluation.passed ? "low" : ""}>{evaluation ? `${evaluation.score}/100` : "pending"}</dd></div>
        </dl>
      </div>

      <Tabs defaultValue="trace" className="tabs">
        <TabsList variant="line" className="tab-list">
          <TabsTrigger value="trace"><Activity />Trace</TabsTrigger>
          <TabsTrigger value="compare"><GitCompare />Compare</TabsTrigger>
          <TabsTrigger value="evals"><TestTube2 />Evaluations{failing ? <em className="tab-badge">{failing}</em> : null}</TabsTrigger>
        </TabsList>
        <TabsContent value="trace"><TraceTab run={run} steps={steps} elapsed={elapsed} /></TabsContent>
        <TabsContent value="compare"><CompareTab run={run} /></TabsContent>
        <TabsContent value="evals"><EvalsTab run={run} steps={steps} onOpenSettings={onOpenSettings} /></TabsContent>
      </Tabs>

      <Confirm open={deleting} onOpenChange={setDeleting} title={`Delete ${run.id}?`} description="The trace, notes and feedback for this run are removed." confirmLabel="Delete run" danger
        onConfirm={() => {
          const next = state.runs.find((r) => r.id !== run.id);
          dispatch({ type: "run/delete", runId: run.id });
          if (next) onOpenRun(next.id);
          toast.success(`${run.id} deleted`);
        }} />
    </>
  );
}
