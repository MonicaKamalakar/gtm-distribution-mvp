"use client";

import { useCallback, useEffect, useState } from "react";
import { InsightFeedback } from "./FeedbackButtons";
import { labelStyles, sectionStyles } from "./ui";

export type Competitor = {
  name: string;
  url: string | null;
  type: string;
  reason_relevant: string;
};

type State =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "loaded"; competitors: Competitor[] }
  | { kind: "error"; message: string };

export default function CompetitorsSection({
  projectId,
  initial,
}: {
  projectId: number;
  /** undefined = not fetched yet, null/[] = confirmed none, array = data */
  initial?: Competitor[] | null;
}) {
  const [state, setState] = useState<State>(
    initial === undefined
      ? { kind: "loading" }
      : initial === null || initial.length === 0
        ? { kind: "none" }
        : { kind: "loaded", competitors: initial },
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/competitors`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Backend responded with ${res.status}`);
      const competitors: Competitor[] = await res.json();
      setState(
        competitors.length === 0
          ? { kind: "none" }
          : { kind: "loaded", competitors },
      );
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Request failed",
      });
    }
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() is async; state updates happen after await, never synchronously.
    if (initial === undefined) load();
    window.addEventListener("analysis-completed", load);
    window.addEventListener("analysis-failed", load);
    return () => {
      window.removeEventListener("analysis-completed", load);
      window.removeEventListener("analysis-failed", load);
    };
  }, [initial, load]);

  return (
    <section style={sectionStyles} aria-label="Competitors">
      <h2 style={{ fontSize: 18, marginBottom: 4, color: "#111827" }}>
        Competitors
      </h2>

      {state.kind === "loading" && (
        <p style={{ fontSize: 14, color: "#6b7280" }} role="status">
          Loading competitors…
        </p>
      )}

      {state.kind === "none" && (
        <p style={{ fontSize: 14, color: "#6b7280" }}>
          No competitor research yet — run <strong>Analyze</strong> to generate it.
        </p>
      )}

      {state.kind === "error" && (
        <p style={{ fontSize: 14, color: "#dc2626" }} role="alert">
          Failed to load competitors: {state.message}
        </p>
      )}

      {state.kind === "loaded" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {state.competitors.map((c) => (
            <div
              key={c.name}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                background: "white",
                padding: "12px 16px",
              }}
            >
              <strong style={{ fontSize: 15, color: "#111827" }}>{c.name}</strong>

              <div style={{ marginTop: 8 }}>
                <div style={labelStyles}>Type</div>
                <span
                  style={{
                    display: "inline-block",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#1d4ed8",
                    background: "#dbeafe",
                    borderRadius: 999,
                    padding: "2px 8px",
                  }}
                >
                  {c.type}
                </span>
              </div>

              <div style={{ marginTop: 8 }}>
                <div style={labelStyles}>Why relevant</div>
                <p style={{ margin: 0, fontSize: 14, color: "#374151" }}>
                  {c.reason_relevant}
                </p>
              </div>

              <div style={{ marginTop: 8 }}>
                <div style={labelStyles}>Website</div>
                {c.url ? (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      fontSize: 13,
                      color: "#2563eb",
                      wordBreak: "break-all",
                    }}
                  >
                    {c.url}
                  </a>
                ) : (
                  <span style={{ fontSize: 13, color: "#9ca3af" }}>
                    Not available
                  </span>
                )}
              </div>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <InsightFeedback
              projectId={projectId}
              entityType="competitors"
              entityRef="Competitors"
            />
          </div>
        </div>
      )}
    </section>
  );
}
