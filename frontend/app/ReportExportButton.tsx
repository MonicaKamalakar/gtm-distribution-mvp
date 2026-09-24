"use client";

import { useEffect, useRef, useState } from "react";
import { getFeedback } from "./feedbackStore";
import {
  buildReportMarkdown,
  reportFileBase,
  type ExportReport,
  type FeedbackByTitle,
} from "./reportExport";

/** Feedback recorded this session for each opportunity in the report. */
function collectFeedback(report: ExportReport): FeedbackByTitle {
  const out: FeedbackByTitle = {};
  for (const opportunity of report.opportunities?.result.opportunities ?? []) {
    const value = getFeedback("opportunity", opportunity.title);
    if (value === "useful" || value === "not_useful") {
      out[opportunity.title] = value;
    }
  }
  return out;
}

type Busy = "pdf" | "markdown" | null;

const buttonStyle: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 8,
  border: "1px solid #111827",
  background: "#111827",
  color: "white",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  font: "inherit",
};

const itemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "8px 12px",
  fontSize: 13,
  fontWeight: 500,
  color: "#111827",
  background: "transparent",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  font: "inherit",
};

/**
 * Export menu for the full report: Download PDF and Download Markdown (.md).
 * Both exports render the complete report (all nine sections, including
 * evidence and the feedback recorded this session) from the report data the
 * page already holds — no extra fetching, no changes to report logic.
 */
export default function ReportExportButton({
  report,
}: {
  report: ExportReport;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function downloadMarkdown(): Promise<void> {
    setBusy("markdown");
    setError(null);
    try {
      const markdown = buildReportMarkdown(report, collectFeedback(report));
      const blob = new Blob([markdown], {
        type: "text/markdown;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${reportFileBase(report)}.md`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  async function downloadPdf(): Promise<void> {
    setBusy("pdf");
    setError(null);
    try {
      // Load the PDF library only when the user asks for a PDF.
      const { buildReportPdf } = await import("./reportExportPdf");
      const doc = buildReportPdf(report, collectFeedback(report));
      doc.save(`${reportFileBase(report)}.pdf`);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", display: "inline-block" }}
    >
      <style>{`
        .report-export-button:hover { background: #1f2937; border-color: #1f2937; }
        .report-export-item:hover { background: #f3f4f6; }
        .report-export-item:disabled { color: #9ca3af; cursor: default; }
      `}</style>
      <button
        type="button"
        className="report-export-button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={buttonStyle}
      >
        Export ▾
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 230,
            background: "white",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(17, 24, 39, 0.12)",
            padding: 4,
            zIndex: 20,
          }}
        >
          <button
            type="button"
            role="menuitem"
            className="report-export-item"
            disabled={busy !== null}
            onClick={() => void downloadPdf()}
            style={itemStyle}
          >
            {busy === "pdf" ? "Preparing PDF…" : "Download PDF"}
          </button>
          <button
            type="button"
            role="menuitem"
            className="report-export-item"
            disabled={busy !== null}
            onClick={() => void downloadMarkdown()}
            style={itemStyle}
          >
            {busy === "markdown"
              ? "Preparing Markdown…"
              : "Download Markdown (.md)"}
          </button>
          {error && (
            <p
              role="alert"
              style={{
                margin: "6px 8px 4px",
                fontSize: 12,
                color: "#dc2626",
              }}
            >
              Export failed: {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
