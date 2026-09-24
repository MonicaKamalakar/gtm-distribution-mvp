"use client";

import { useCallback, useEffect, useState } from "react";
import { InsightFeedback } from "./FeedbackButtons";
import { labelStyles, sectionStyles } from "./ui";

export type ProductInfo = {
  product_summary: string;
  problem_solved: string;
  value_proposition: string;
  product_category: string;
  key_capabilities: string[];
};

type State =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "loaded"; info: ProductInfo; model: string }
  | { kind: "error"; message: string };

export default function ProductUnderstanding({
  projectId,
  initial,
}: {
  projectId: number;
  /** undefined = not fetched yet, null = confirmed no analysis, object = data */
  initial?: { result: ProductInfo; model: string } | null;
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
      const res = await fetch(
        `/api/v1/projects/${projectId}/product-analysis`,
        { cache: "no-store" },
      );
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() is async; state updates happen after await, never synchronously.
    load();
    // Refresh when the Analyze button finishes a run.
    window.addEventListener("analysis-completed", load);
    window.addEventListener("analysis-failed", load);
    return () => {
      window.removeEventListener("analysis-completed", load);
      window.removeEventListener("analysis-failed", load);
    };
  }, [load]);

  return (
    <section style={sectionStyles} aria-label="Product Understanding">
      <h2 style={{ fontSize: 18, marginBottom: 4, color: "#111827" }}>
        Product Understanding
      </h2>

      {state.kind === "loading" && (
        <p style={{ fontSize: 14, color: "#6b7280" }} role="status">
          Loading product understanding…
        </p>
      )}

      {state.kind === "none" && (
        <p style={{ fontSize: 14, color: "#6b7280" }}>
          No analysis yet — run <strong>Analyze</strong> to generate the product
          understanding.
        </p>
      )}

      {state.kind === "error" && (
        <p style={{ fontSize: 14, color: "#dc2626" }} role="alert">
          Failed to load product analysis: {state.message}
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
            <div style={labelStyles}>Product summary</div>
            <p style={{ margin: 0, fontSize: 14, color: "#374151" }}>
              {state.info.product_summary}
            </p>
          </div>

          <div>
            <div style={labelStyles}>Problem</div>
            <p style={{ margin: 0, fontSize: 14, color: "#374151" }}>
              {state.info.problem_solved}
            </p>
          </div>

          <div>
            <div style={labelStyles}>Value proposition</div>
            <p style={{ margin: 0, fontSize: 14, color: "#374151" }}>
              {state.info.value_proposition}
            </p>
          </div>

          <div>
            <div style={labelStyles}>Category</div>
            <p style={{ margin: 0, fontSize: 14, color: "#374151" }}>
              {state.info.product_category}
            </p>
          </div>

          <div>
            <div style={labelStyles}>Capabilities</div>
            {state.info.key_capabilities.length > 0 ? (
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
                {state.info.key_capabilities.map((cap) => (
                  <li key={cap}>{cap}</li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: 0, fontSize: 14, color: "#9ca3af" }}>
                None identified
              </p>
            )}
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
              entityType="product"
              entityRef="Product Understanding"
            />
          </div>
        </div>
      )}
    </section>
  );
}
