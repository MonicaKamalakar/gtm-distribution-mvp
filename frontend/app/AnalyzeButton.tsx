"use client";

import { useEffect, useRef, useState } from "react";
import { friendlyError } from "./errorText";

type Status = "queued" | "running" | "completed" | "failed";

export type RunInfo = {
  id: number;
  status: Status;
  error: string | null;
};

export type StepInfo = {
  step: string;
  status: "pending" | "running" | "completed" | "failed";
  error: string | null;
  started_at?: string | null;
  completed_at?: string | null;
};

const statusLabels: Record<Status, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

const statusColors: Record<Status, { background: string; text: string }> = {
  queued: { background: "#fef3c7", text: "#92400e" },
  running: { background: "#dbeafe", text: "#1d4ed8" },
  completed: { background: "#dcfce7", text: "#166534" },
  failed: { background: "#fee2e2", text: "#b91c1c" },
};

const stepLabels: Record<string, string> = {
  crawl: "Crawl website",
  product: "Product analysis",
  icp: "ICP analysis",
  competitors: "Competitor research",
  buyer_questions: "Buyer questions",
  visibility: "Visibility check",
  gaps: "Distribution gaps",
  opportunities: "Opportunities",
  action_plan: "30-day plan",
};

const stepStatus: Record<
  StepInfo["status"],
  { symbol: string; color: string }
> = {
  pending: { symbol: "○", color: "#d1d5db" },
  running: { symbol: "◔", color: "#2563eb" },
  completed: { symbol: "✓", color: "#166534" },
  failed: { symbol: "✕", color: "#b91c1c" },
};

export default function AnalyzeButton({
  projectId,
  initialRun = null,
  initialSteps = null,
}: {
  projectId: number;
  initialRun?: RunInfo | null;
  initialSteps?: StepInfo[] | null;
}) {
  const [runId, setRunId] = useState<number | null>(initialRun?.id ?? null);
  const [status, setStatus] = useState<Status | null>(
    initialRun?.status ?? null,
  );
  const [runError, setRunError] = useState<string | null>(
    initialRun?.error ?? null,
  );
  const [steps, setSteps] = useState<StepInfo[]>(initialSteps ?? []);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const intervalRef = useRef<number | null>(null);

  function stopPolling() {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  async function pollOnce(id: number) {
    try {
      const [runRes, stepsRes] = await Promise.all([
        fetch(`/api/v1/projects/${projectId}/analysis/${id}`, {
          cache: "no-store",
        }),
        fetch(`/api/v1/projects/${projectId}/analysis/${id}/steps`, {
          cache: "no-store",
        }),
      ]);
      if (stepsRes.ok) {
        const stepRows: StepInfo[] = await stepsRes.json();
        if (Array.isArray(stepRows)) setSteps(stepRows);
      }
      if (!runRes.ok) return;
      const run: RunInfo = await runRes.json();
      setRunError(run.error ?? null);
      setStatus(run.status);
      if (run.status === "completed" || run.status === "failed") {
        stopPolling();
        // Let the report sections refresh.
        window.dispatchEvent(
          new Event(
            run.status === "completed" ? "analysis-completed" : "analysis-failed",
          ),
        );
      }
    } catch {
      // Transient poll error — keep trying until the run finishes.
    }
  }

  function startPolling(id: number) {
    stopPolling();
    intervalRef.current = window.setInterval(() => {
      void pollOnce(id);
    }, 700);
  }

  // Resume polling for a run that was active when the page rendered; always
  // clear the interval on unmount.
  useEffect(() => {
    if (
      initialRun &&
      (initialRun.status === "queued" || initialRun.status === "running")
    ) {
      startPolling(initialRun.id);
    }
    return () => {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAnalyze() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/analysis`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`Backend responded with ${res.status}`);
      const run = await res.json();
      setRunId(run.id);
      setStatus("queued");
      setRunError(null);
      setSteps([]);
      startPolling(run.id);
      void pollOnce(run.id);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setStarting(false);
    }
  }

  async function handleRetry(step: string) {
    if (runId === null) return;
    setRetrying(step);
    setStartError(null);
    try {
      const res = await fetch(
        `/api/v1/projects/${projectId}/analysis/${runId}/steps/${step}/retry`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          detail?: string;
        };
        throw new Error(body.detail ?? `Backend responded with ${res.status}`);
      }
      setStatus("running");
      setRunError(null);
      startPolling(runId);
      void pollOnce(runId);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setRetrying(null);
    }
  }

  const active = status === "queued" || status === "running";
  const failedStep = steps.find((s) => s.status === "failed") ?? null;
  const rawError =
    failedStep?.error ?? (status === "failed" ? runError : null);
  const friendly =
    status === "failed" && rawError ? friendlyError(rawError) : null;

  return (
    <div
      style={{
        marginTop: 28,
        width: "100%",
        maxWidth: 560,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={handleAnalyze}
          disabled={starting || active}
          style={{
            padding: "10px 20px",
            borderRadius: 6,
            border: "none",
            background: starting || active ? "#9ca3af" : "#111827",
            color: "white",
            fontSize: 15,
            fontWeight: 600,
            cursor: starting || active ? "default" : "pointer",
            font: "inherit",
          }}
        >
          {starting ? "Starting…" : "Analyze"}
        </button>

        {status && (
          <span
            role="status"
            aria-live="polite"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 600,
              background: statusColors[status].background,
              color: statusColors[status].text,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: statusColors[status].text,
                animation: active ? "pulse 1s ease-in-out infinite" : undefined,
              }}
            />
            {statusLabels[status]}
          </span>
        )}
      </div>

      {startError && (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: "#dc2626" }}>
          {startError}
        </p>
      )}

      {steps.length > 0 && (
        <ol
          aria-label="Analysis steps"
          style={{
            listStyle: "none",
            margin: 0,
            padding: "10px 14px",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            background: "white",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {steps.map((s) => {
            const meta = stepStatus[s.status];
            const label = stepLabels[s.step] ?? s.step;
            return (
              <li
                key={s.step}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  color: s.status === "pending" ? "#9ca3af" : "#374151",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 16,
                    textAlign: "center",
                    color: meta.color,
                    fontWeight: 700,
                  }}
                >
                  {meta.symbol}
                </span>
                <span>{label}</span>
                {s.status === "running" && (
                  <span style={{ fontSize: 12, color: "#1d4ed8" }}>
                    Working…
                  </span>
                )}
                {s.status === "failed" && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#b91c1c" }}>
                    Failed
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {friendly && (
        <div
          role="alert"
          style={{
            border: "1px solid #fee2e2",
            background: "#fef2f2",
            borderRadius: 8,
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: "#b91c1c" }}>
            {friendly.title}
          </div>
          <div style={{ fontSize: 13, color: "#7f1d1d" }}>{friendly.message}</div>
          {rawError && (
            <div
              style={{
                fontSize: 12,
                color: "#9ca3af",
                fontFamily: "ui-monospace, monospace",
                wordBreak: "break-word",
              }}
            >
              {rawError}
            </div>
          )}
          {failedStep && (
            <button
              type="button"
              onClick={() => handleRetry(failedStep.step)}
              disabled={retrying !== null}
              style={{
                alignSelf: "flex-start",
                padding: "6px 14px",
                borderRadius: 6,
                border: "none",
                background: retrying ? "#9ca3af" : "#111827",
                color: "white",
                fontSize: 13,
                fontWeight: 600,
                cursor: retrying ? "default" : "pointer",
                font: "inherit",
              }}
            >
              {retrying === failedStep.step
                ? "Retrying…"
                : `Retry ${stepLabels[failedStep.step] ?? failedStep.step}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
