"use client";

import { useState } from "react";
import { recordFeedback } from "./feedbackStore";

type FeedbackValue = "useful" | "not_useful" | "incorrect";

async function submitFeedback(payload: {
  project_id: number;
  entity_type: string;
  entity_ref: string;
  value: FeedbackValue;
}): Promise<void> {
  const res = await fetch("/api/v1/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Backend responded with ${res.status}`);
}

function buttonStyle(active: boolean, tone: "green" | "gray"): React.CSSProperties {
  return {
    padding: "4px 12px",
    borderRadius: 999,
    border: active
      ? "1px solid transparent"
      : "1px solid #d1d5db",
    background: active
      ? tone === "green"
        ? "#dcfce7"
        : "#e5e7eb"
      : "white",
    color: active ? (tone === "green" ? "#166534" : "#374151") : "#4b5563",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    font: "inherit",
  };
}

const rowLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  color: "#6b7280",
};

/** Useful / Not useful feedback buttons for one generated opportunity. */
export function OpportunityFeedback({
  projectId,
  title,
}: {
  projectId: number;
  title: string;
}) {
  const [selected, setSelected] = useState<FeedbackValue | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(value: FeedbackValue) {
    if (saving || selected === value) return;
    setSaving(true);
    setError(null);
    try {
      await submitFeedback({
        project_id: projectId,
        entity_type: "opportunity",
        entity_ref: title,
        value,
      });
      setSelected(value);
      recordFeedback("opportunity", title, value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginTop: 10,
        flexWrap: "wrap",
      }}
    >
      <span style={rowLabel}>Feedback</span>
      <button
        type="button"
        onClick={() => choose("useful")}
        disabled={saving}
        aria-pressed={selected === "useful"}
        style={buttonStyle(selected === "useful", "green")}
      >
        Useful
      </button>
      <button
        type="button"
        onClick={() => choose("not_useful")}
        disabled={saving}
        aria-pressed={selected === "not_useful"}
        style={buttonStyle(selected === "not_useful", "gray")}
      >
        Not useful
      </button>
      {selected && !error && (
        <span style={{ fontSize: 12, color: "#166534" }} role="status">
          Saved — thanks!
        </span>
      )}
      {error && (
        <span style={{ fontSize: 12, color: "#dc2626" }} role="alert">
          Could not save feedback: {error}
        </span>
      )}
    </div>
  );
}

/** "This is incorrect" button for an AI-generated insight section. */
export function InsightFeedback({
  projectId,
  entityType,
  entityRef,
}: {
  projectId: number;
  /** Which insight this feedback is about, e.g. "product", "icp". */
  entityType: string;
  /** Human label of the insight, e.g. "Product Understanding". */
  entityRef: string;
}) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reportIncorrect() {
    if (saving || saved) return;
    setSaving(true);
    setError(null);
    try {
      await submitFeedback({
        project_id: projectId,
        entity_type: entityType,
        entity_ref: entityRef,
        value: "incorrect",
      });
      setSaved(true);
      recordFeedback(entityType, entityRef, "incorrect");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <span style={{ fontSize: 12, color: "#166534" }} role="status">
        Feedback saved — thank you.
      </span>
    );
  }

  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
    >
      <button
        type="button"
        onClick={reportIncorrect}
        disabled={saving}
        style={{
          padding: "3px 10px",
          borderRadius: 999,
          border: "1px solid #e5e7eb",
          background: "white",
          color: "#6b7280",
          fontSize: 12,
          fontWeight: 600,
          cursor: saving ? "default" : "pointer",
          font: "inherit",
        }}
      >
        {saving ? "Saving…" : "This is incorrect"}
      </button>
      {error && (
        <span style={{ fontSize: 12, color: "#dc2626" }} role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
