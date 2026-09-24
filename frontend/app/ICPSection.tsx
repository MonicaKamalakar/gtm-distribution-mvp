"use client";

import { useCallback, useEffect, useState } from "react";
import ConfidenceLabel from "./ConfidenceLabel";
import { InsightFeedback } from "./FeedbackButtons";
import { labelStyles, sectionStyles } from "./ui";

export type ICPInfo = {
  primary_icp: string;
  buyer_role: string;
  company_characteristics: string[];
  pain_points: string[];
  trigger_events: string[];
  exclusions: string[];
  confidence: number;
};

type State =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "loaded"; info: ICPInfo; model: string }
  | { kind: "error"; message: string };

function ListOrNone({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p style={{ margin: 0, fontSize: 14, color: "#9ca3af" }}>None identified</p>;
  }
  return (
    <ul
      style={{
        margin: 0,
        paddingLeft: 18,
        fontSize: 14,
        color: "#374151",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export default function ICPSection({
  projectId,
  initial,
}: {
  projectId: number;
  /** undefined = not fetched yet, null = confirmed no analysis, object = data */
  initial?: { result: ICPInfo; model: string } | null;
}) {
  const [state, setState] = useState<State>(
    initial === undefined
      ? { kind: "loading" }
      : initial === null
        ? { kind: "none" }
        : { kind: "loaded", info: initial.result, model: initial.model },
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/icp-analysis`, {
        cache: "no-store",
      });
      if (res.status === 404) {
        setState({ kind: "none" });
        return;
      }
      if (!res.ok) throw new Error(`Backend responded with ${res.status}`);
      const data = await res.json();
      setState({ kind: "loaded", info: data.result, model: data.model });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Request failed",
      });
    }
  }, [projectId]);

  useEffect(() => {
    // Only fetch on mount when the server did not preload a definitive state.
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
    <section style={sectionStyles} aria-label="ICP">
      <h2 style={{ fontSize: 18, marginBottom: 4, color: "#111827" }}>
        Ideal Customer Profile
      </h2>

      {state.kind === "loading" && (
        <p style={{ fontSize: 14, color: "#6b7280" }} role="status">
          Loading ICP analysis…
        </p>
      )}

      {state.kind === "none" && (
        <p style={{ fontSize: 14, color: "#6b7280" }}>
          No ICP analysis yet — run <strong>Analyze</strong> to generate it.
        </p>
      )}

      {state.kind === "error" && (
        <p style={{ fontSize: 14, color: "#dc2626" }} role="alert">
          Failed to load ICP analysis: {state.message}
        </p>
      )}

      {state.kind === "loaded" && (
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            background: "white",
            padding: "14px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div>
            <div style={labelStyles}>Primary ICP</div>
            <p style={{ margin: 0, fontSize: 14, color: "#374151" }}>
              {state.info.primary_icp}
            </p>
          </div>

          <div>
            <div style={labelStyles}>Buyer</div>
            <p style={{ margin: 0, fontSize: 14, color: "#374151" }}>
              {state.info.buyer_role}
            </p>
          </div>

          <div>
            <div style={labelStyles}>Company characteristics</div>
            <ListOrNone items={state.info.company_characteristics} />
          </div>

          <div>
            <div style={labelStyles}>Pain points</div>
            <ListOrNone items={state.info.pain_points} />
          </div>

          <div>
            <div style={labelStyles}>Trigger events</div>
            <ListOrNone items={state.info.trigger_events} />
          </div>

          <div>
            <div style={labelStyles}>Exclusions</div>
            <ListOrNone items={state.info.exclusions} />
          </div>

          <div>
            <div style={labelStyles}>Confidence</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  flex: 1,
                  height: 8,
                  borderRadius: 999,
                  background: "#e5e7eb",
                  overflow: "hidden",
                  maxWidth: 200,
                }}
              >
                <div
                  style={{
                    width: `${Math.max(0, Math.min(100, state.info.confidence))}%`,
                    height: "100%",
                    background: "#2563eb",
                  }}
                />
              </div>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                {Math.max(0, Math.min(100, state.info.confidence))}%
              </span>
              <ConfidenceLabel value={state.info.confidence} showValue={false} />
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 11, color: "#9ca3af" }}>
              Generated by {state.model}
            </span>
            <InsightFeedback
              projectId={projectId}
              entityType="icp"
              entityRef="Ideal Customer Profile"
            />
          </div>
        </div>
      )}
    </section>
  );
}
