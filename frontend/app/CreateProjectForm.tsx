"use client";

import { FormEvent, useState } from "react";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; id: number }
  | { kind: "error"; message: string };

const INVALID_URL_MESSAGE =
  "Invalid website URL — enter a full public URL like https://example.com.";

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      Boolean(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export default function CreateProjectForm() {
  const [name, setName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [description, setDescription] = useState("");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Friendly invalid-URL error state before hitting the backend.
    if (!isValidHttpUrl(websiteUrl)) {
      setState({ kind: "error", message: INVALID_URL_MESSAGE });
      return;
    }
    setState({ kind: "submitting" });
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          website_url: websiteUrl,
          description: description.trim() === "" ? null : description,
        }),
      });
      if (res.status === 422) {
        // Backend rejected the payload — almost always the URL shape.
        throw new Error(INVALID_URL_MESSAGE);
      }
      if (!res.ok) {
        throw new Error(`Backend responded with ${res.status}`);
      }
      const data = await res.json();
      setState({ kind: "success", id: data.id });
      setName("");
      setWebsiteUrl("");
      setDescription("");
      // Let the dashboard list refresh.
      window.dispatchEvent(new Event("project-created"));
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Request failed",
      });
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    fontSize: 14,
    font: "inherit",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    marginBottom: 4,
    fontSize: 13,
    fontWeight: 600,
    color: "#374151",
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        maxWidth: 420,
        textAlign: "left",
        margin: "24px auto 0",
      }}
    >
      <div>
        <label htmlFor="project-name" style={labelStyle}>
          Project name
        </label>
        <input
          id="project-name"
          type="text"
          required
          maxLength={255}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Marketing Site"
          style={inputStyle}
        />
      </div>

      <div>
        <label htmlFor="project-url" style={labelStyle}>
          Website URL
        </label>
        <input
          id="project-url"
          type="url"
          required
          maxLength={2000}
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          placeholder="https://example.com"
          style={inputStyle}
        />
      </div>

      <div>
        <label htmlFor="project-description" style={labelStyle}>
          Description <span style={{ fontWeight: 400, color: "#6b7280" }}>(optional)</span>
        </label>
        <textarea
          id="project-description"
          rows={3}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Anything about this project"
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </div>

      <button
        type="submit"
        disabled={state.kind === "submitting"}
        style={{
          padding: "9px 16px",
          borderRadius: 6,
          border: "none",
          background: state.kind === "submitting" ? "#9ca3af" : "#111827",
          color: "white",
          fontSize: 14,
          fontWeight: 600,
          cursor: state.kind === "submitting" ? "default" : "pointer",
          font: "inherit",
        }}
      >
        {state.kind === "submitting" ? "Creating…" : "Create Project"}
      </button>

      {state.kind === "success" && (
        <p style={{ margin: 0, fontSize: 13, color: "#16a34a" }} role="status">
          Project created (id {state.id}).
        </p>
      )}
      {state.kind === "error" && (
        <p style={{ margin: 0, fontSize: 13, color: "#dc2626" }} role="alert">
          Failed to create project: {state.message}
        </p>
      )}
    </form>
  );
}
