"use client";

import { useEffect, useRef, useState } from "react";
import { CircleStop, RotateCcw, Sparkles } from "lucide-react";
import { buildReviewRequest } from "@/lib/ai/review";
import { scenarioById } from "@/lib/trace/scenarios";
import type { Run, Step } from "@/lib/trace/types";
import { useTrace } from "./store";

type Status = "idle" | "streaming" | "done" | "error";

/** Asks the Worker for an AI root-cause review of the run and streams the answer in as it is written. */
export function AiReview({ run, steps }: { run: Run; steps: Step[] }) {
  const { state } = useTrace();
  const [status, setStatus] = useState<Status>("idle");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // Cancel an in-flight review on unmount. The parent keys this component by run id,
  // so switching runs unmounts it and starts the next run with a clean state.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function start() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("streaming");
    setText("");
    setError("");
    try {
      const res = await fetch("/api/ai/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildReviewRequest(run, steps, scenarioById(run.scenarioId), state.settings)),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status}).`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        setText((t) => t + decoder.decode(value, { stream: true }));
      }
      setStatus("done");
    } catch (e) {
      if (controller.signal.aborted) {
        setStatus((s) => (s === "streaming" ? "done" : s));
        return;
      }
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStatus("error");
    }
  }

  const stop = () => abortRef.current?.abort();

  return (
    <section className="ai-review" aria-labelledby="ai-review-title">
      <div className="ai-review-head">
        <div>
          <h3 id="ai-review-title"><Sparkles />AI review</h3>
          <p>A language model reads this trace and its evaluations, then explains what went wrong and how to fix the prompt.</p>
        </div>
        {status === "streaming" ? (
          <button className="ghost" onClick={stop}><CircleStop />Stop</button>
        ) : (
          <button className="primary" onClick={start}>
            {status === "idle" ? <><Sparkles />Explain this run</> : <><RotateCcw />Review again</>}
          </button>
        )}
      </div>
      <div className="ai-review-body" aria-live="polite" aria-busy={status === "streaming"}>
        {status === "error" ? <p className="bad" role="alert">{error}</p> : null}
        {text ? <pre>{text}{status === "streaming" ? <span className="caret" aria-hidden="true">▍</span> : null}</pre> : null}
        {status === "streaming" && !text ? <p className="muted-note">Reading the trace…</p> : null}
      </div>
    </section>
  );
}
