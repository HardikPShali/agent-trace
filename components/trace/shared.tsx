"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { Braces, BookOpen, CircleCheck, CircleSlash, CircleX, LoaderCircle, Sparkles, Wrench } from "lucide-react";
import type { RunOutcome, StepType } from "@/lib/trace/types";

export function timeAgo(at: string, now = Date.now()): string {
  const ms = now - Date.parse(at);
  if (ms < 60_000) return "just now";
  return `${formatDistanceToNowStrict(new Date(at), { addSuffix: false })} ago`;
}

export const STEP_ICON: Record<StepType, React.ReactNode> = {
  model: <Sparkles />,
  tool: <Wrench />,
  decision: <Braces />,
  retrieval: <BookOpen />,
};

const OUTCOME_ICON: Record<RunOutcome, React.ReactNode> = {
  running: <LoaderCircle className="spin" />,
  passed: <CircleCheck />,
  failed: <CircleX />,
  stopped: <CircleSlash />,
};

/** Status always ships with an icon and a label, never color alone. */
export function OutcomeBadge({ outcome }: { outcome: RunOutcome }) {
  return <span className={`result ${outcome}`}>{OUTCOME_ICON[outcome]} {outcome}</span>;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children ? <p>{children}</p> : null}
    </div>
  );
}
