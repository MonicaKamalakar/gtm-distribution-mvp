"use client";

import { useEffect, useState } from "react";
import ConfidenceLabel from "./ConfidenceLabel";
import { formatDate } from "./ui";

export type Evidence = {
  source: string;
  source_url: string;
  retrieved_at: string;
  confidence: number;
  /** Optional supporting excerpt; not recorded for every evidence type. */
  excerpt?: string;
};

const rowLabelStyles: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  color: "#6b7280",
  marginBottom: 3,
};

/**
 * Clickable evidence items. Clicking one opens the Evidence drawer showing
 * source, URL, retrieved date, supporting excerpt, and confidence.
 */
export default function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  const [selected, setSelected] = useState<Evidence | null>(null);

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  if (evidence.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: "#9ca3af" }}>
        No evidence recorded
      </p>
    );
  }

  return (
    <>
      <ul
        style={{
          margin: 0,
          paddingLeft: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {evidence.map((e, index) => (
          // Index keeps keys unique when several evidence items cite the same
          // retrieval (same source + URL + timestamp, different excerpts).
          <li key={`${e.source}|${e.source_url}|${e.retrieved_at}|${index}`}>
            <button
              type="button"
              onClick={() => setSelected(e)}
              aria-label={`Open evidence details for ${e.source}`}
              style={{
                width: "100%",
                textAlign: "left",
                font: "inherit",
                cursor: "pointer",
                fontSize: 13,
                color: "#4b5563",
                border: "1px solid #f3f4f6",
                borderRadius: 6,
                padding: "6px 10px",
                background: "#f9fafb",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span style={{ fontWeight: 600, color: "#374151" }}>
                  {e.source}
                </span>
                <ConfidenceLabel value={e.confidence} showValue={false} />
              </div>
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
                View evidence details →
              </div>
            </button>
          </li>
        ))}
      </ul>

      {selected && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Evidence details"
          style={{ position: "fixed", inset: 0, zIndex: 50 }}
        >
          {/* Backdrop */}
          <div
            onClick={() => setSelected(null)}
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(17, 24, 39, 0.4)",
            }}
          />
          {/* Drawer */}
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              height: "100%",
              width: "min(420px, 92vw)",
              background: "white",
              boxShadow: "-8px 0 24px rgba(0,0,0,0.15)",
              padding: "20px 24px",
              boxSizing: "border-box",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h3 style={{ margin: 0, fontSize: 16, color: "#111827" }}>
                Evidence
              </h3>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close evidence drawer"
                style={{
                  border: "none",
                  background: "#f3f4f6",
                  borderRadius: 6,
                  padding: "4px 10px",
                  font: "inherit",
                  fontSize: 13,
                  cursor: "pointer",
                  color: "#374151",
                }}
              >
                Close
              </button>
            </div>

            <div>
              <div style={rowLabelStyles}>Source</div>
              <p style={{ margin: 0, fontSize: 14, color: "#111827", fontWeight: 600 }}>
                {selected.source}
              </p>
            </div>

            <div>
              <div style={rowLabelStyles}>URL</div>
              {selected.source_url ? (
                <a
                  href={selected.source_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 13, color: "#2563eb", wordBreak: "break-all" }}
                >
                  {selected.source_url}
                </a>
              ) : (
                <span style={{ fontSize: 13, color: "#9ca3af" }}>
                  Not available
                </span>
              )}
            </div>

            <div>
              <div style={rowLabelStyles}>Retrieved</div>
              <p style={{ margin: 0, fontSize: 14, color: "#374151" }}>
                {formatDate(selected.retrieved_at)}
              </p>
            </div>

            <div>
              <div style={rowLabelStyles}>Supporting excerpt</div>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  color: "#374151",
                  fontStyle: selected.excerpt ? "normal" : "italic",
                }}
              >
                {selected.excerpt || "Not recorded for this evidence."}
              </p>
            </div>

            <div>
              <div style={rowLabelStyles}>Confidence</div>
              <ConfidenceLabel value={selected.confidence} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
