import type { CSSProperties } from "react";

/** Shared section styling for the analysis report sections. */
export const sectionStyles: CSSProperties = {
  maxWidth: 560,
  margin: "32px auto 0",
  textAlign: "left",
  width: "100%",
};

/** Shared uppercase field label styling. */
export const labelStyles: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  color: "#6b7280",
  marginBottom: 4,
};

/** Shared card container styling. */
export const cardStyles: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  background: "white",
  padding: "14px 18px",
};

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}
