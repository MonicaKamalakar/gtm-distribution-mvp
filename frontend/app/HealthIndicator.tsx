"use client";

import { useEffect, useState } from "react";

type Status = "checking" | "online" | "offline";

const colors: Record<Status, string> = {
  checking: "#f59e0b",
  online: "#22c55e",
  offline: "#ef4444",
};

const labels: Record<Status, string> = {
  checking: "API checking…",
  online: "API online",
  offline: "API offline",
};

export default function HealthIndicator() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const data = res.ok ? await res.json() : null;
        if (!cancelled) {
          setStatus(data?.status === "ok" ? "online" : "offline");
        }
      } catch {
        if (!cancelled) setStatus("offline");
      }
    }

    check();
    const interval = setInterval(check, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid #e5e7eb",
        background: "white",
        fontSize: 12,
        fontFamily: "var(--font-geist-sans), sans-serif",
        color: "#374151",
        boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        zIndex: 1000,
      }}
      role="status"
      aria-live="polite"
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: colors[status],
        }}
      />
      {labels[status]}
    </div>
  );
}
