/**
 * Confidence labels for AI inferences: High / Medium / Low.
 *
 * Thresholds: >= 80 High, 50-79 Medium, < 50 Low (on the 0-100 scale).
 * Displayed wherever a confidence value is shown.
 */

type Level = "High" | "Medium" | "Low";

const colors: Record<Level, { background: string; text: string }> = {
  High: { background: "#dcfce7", text: "#166534" },
  Medium: { background: "#fef3c7", text: "#92400e" },
  Low: { background: "#fee2e2", text: "#b91c1c" },
};

export function confidenceLevel(value: number): Level {
  const v = Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;
  if (v >= 80) return "High";
  if (v >= 50) return "Medium";
  return "Low";
}

export default function ConfidenceLabel({
  value,
  showValue = true,
}: {
  value: number;
  /** Append the numeric percentage after the label (default true). */
  showValue?: boolean;
}) {
  const v = Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : 0;
  const level = confidenceLevel(v);

  return (
    <span
      title={`Confidence: ${v}% (${level})`}
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 600,
        color: colors[level].text,
        background: colors[level].background,
        borderRadius: 999,
        padding: "2px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {level}
      {showValue ? ` · ${v}%` : ""}
    </span>
  );
}
