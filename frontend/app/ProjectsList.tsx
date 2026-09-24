"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Project = {
  id: number;
  name: string;
  website_url: string;
  description: string | null;
  created_at: string;
};

type ListState =
  | { kind: "loading" }
  | { kind: "loaded"; projects: Project[] }
  | { kind: "error"; message: string };

export default function ProjectsList() {
  const [state, setState] = useState<ListState>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/projects", { cache: "no-store" });
      if (!res.ok) throw new Error(`Backend responded with ${res.status}`);
      const projects: Project[] = await res.json();
      setState({ kind: "loaded", projects });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Request failed",
      });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() is async; state updates happen after await, never synchronously.
    load();
    // Refresh the list whenever the create form succeeds.
    window.addEventListener("project-created", load);
    return () => window.removeEventListener("project-created", load);
  }, [load]);

  return (
    <section
      style={{
        maxWidth: 560,
        margin: "32px auto 0",
        textAlign: "left",
        width: "100%",
      }}
      aria-label="Your projects"
    >
      <h2 style={{ fontSize: 18, marginBottom: 12, color: "#111827" }}>
        Your projects
      </h2>

      {state.kind === "loading" && (
        <p
          style={{ fontSize: 14, color: "#6b7280", margin: 0 }}
          role="status"
        >
          Loading projects…
        </p>
      )}

      {state.kind === "error" && (
        <p style={{ fontSize: 14, color: "#dc2626", margin: 0 }} role="alert">
          Failed to load projects: {state.message}
        </p>
      )}

      {state.kind === "loaded" && state.projects.length === 0 && (
        <p style={{ fontSize: 14, color: "#6b7280", margin: 0 }}>
          No projects yet. Create one above.
        </p>
      )}

      {state.kind === "loaded" && state.projects.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {state.projects.map((p) => (
            <li
              key={p.id}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                padding: "10px 14px",
                background: "white",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <Link
                  href={`/projects/${p.id}`}
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#111827",
                    textDecoration: "none",
                  }}
                >
                  {p.name}
                </Link>
                <span style={{ fontSize: 12, color: "#9ca3af" }}>
                  #{p.id}
                </span>
              </div>
              <a
                href={p.website_url}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 13, color: "#2563eb", wordBreak: "break-all" }}
              >
                {p.website_url}
              </a>
              {p.description && (
                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: 13,
                    color: "#4b5563",
                  }}
                >
                  {p.description}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
