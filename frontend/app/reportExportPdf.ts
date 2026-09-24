/**
 * PDF export for the full report.
 *
 * Renders all nine sections — headings, lists, tables, links, evidence blocks
 * and feedback state — with jsPDF (+ autotable for tables) into a clean,
 * paginated A4 document with a footer on every page. Loaded on demand from the
 * export button so the PDF library never enters the initial page bundle.
 *
 * Pure like the Markdown builder: takes the existing report API payload plus
 * the feedback recorded this session and returns a jsPDF document. It never
 * fetches data and never changes report state.
 */

import autoTable from "jspdf-autotable";
import { jsPDF } from "jspdf";
import { formatDate } from "./ui";
import {
  confidenceText,
  feedbackLabel,
  scoreRows,
  type ExportEvidence,
  type ExportReport,
  type FeedbackByTitle,
  type FeedbackState,
} from "./reportExport";

const PAGE_W = 210;
const PAGE_H = 297;
const ML = 18; // left margin (mm)
const MR = 18; // right margin (mm)
const MT = 16; // top margin (mm)
const MB = 16; // bottom margin (mm) — footer lives below this line
const CONTENT_W = PAGE_W - ML - MR;

type RGB = [number, number, number];

const INK: RGB = [17, 24, 39];
const BODY: RGB = [55, 65, 81];
const MUTED: RGB = [107, 114, 128];
const FAINT: RGB = [156, 163, 175];
const RULE: RGB = [229, 231, 235];
const LINK: RGB = [37, 99, 235];

/** Gap category badge colors, mirroring the report page. */
function categoryColor(category: string): RGB {
  if (category === "discovery") return [29, 78, 216];
  if (category === "positioning") return [124, 58, 237];
  if (category === "authority") return [180, 83, 9];
  return [15, 118, 110];
}

function lineH(size: number): number {
  return size * 0.45;
}

/**
 * jsPDF's built-in fonts use WinAnsi (cp1252). Map arrows to "->" and replace
 * anything else outside that encoding so nothing renders as a broken glyph.
 */
function pdfSafe(text: string): string {
  return text
    .replace(/→/g, "->")
    .replace(
      /[^\x20-\x7E\xA0-\xFF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC\u2122]/g,
      "?",
    );
}

/** Collapse whitespace so excerpts stay on one line. */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function buildReportPdf(
  report: ExportReport,
  feedback: FeedbackByTitle = {},
): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: false });
  let y = MT + 6; // current line's baseline (mm)

  function setColor(c: RGB): void {
    doc.setTextColor(c[0], c[1], c[2]);
  }

  /** Break to a new page unless `height` fits below the cursor. */
  function ensure(height: number): void {
    if (y + height > PAGE_H - MB) {
      doc.addPage();
      y = MT + 4;
    }
  }

  /** Numbered section heading with a rule, as on the report page. */
  function sectionHeading(number: number, title: string): void {
    ensure(20);
    y += 7;
    doc.setFont("helvetica", "bold").setFontSize(13);
    setColor(INK);
    doc.text(pdfSafe(`${number}. ${title}`), ML, y);
    y += 4.5;
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]).setLineWidth(0.3);
    doc.line(ML, y, PAGE_W - MR, y);
    y += 6.5;
  }

  /** Small uppercase field label. */
  function label(text: string): void {
    ensure(lineH(8) + 3);
    y += 2.5;
    doc.setFont("helvetica", "bold").setFontSize(8);
    setColor(MUTED);
    doc.text(pdfSafe(text.toUpperCase()), ML, y);
    y += lineH(8);
  }

  type TextOpts = {
    size?: number;
    style?: "normal" | "bold" | "italic";
    indent?: number;
    color?: RGB;
    bullet?: boolean;
    gap?: number;
  };

  /** Wrapped paragraph; breaks to a new page as needed. */
  function writeWrapped(text: string, opts: TextOpts = {}): void {
    const size = opts.size ?? 9.5;
    const indent = opts.indent ?? 0;
    const prefix = opts.bullet ? "\u2022 " : "";
    doc.setFont("helvetica", opts.style ?? "normal").setFontSize(size);
    setColor(opts.color ?? BODY);
    const lines = doc.splitTextToSize(
      pdfSafe(prefix + text),
      CONTENT_W - indent,
    ) as string[];
    for (const line of lines) {
      ensure(lineH(size));
      doc.text(line, ML + indent, y);
      y += lineH(size);
    }
    if (opts.gap) y += opts.gap;
  }

  /** Label-above-value field. */
  function field(name: string, value: string): void {
    label(name);
    writeWrapped(value, { gap: 2 });
  }

  /**
   * Bold prefix and normal-weight remainder on one flowing line (wraps with a
   * hanging indent when the remainder is long).
   */
  function writeInline(
    prefix: string,
    rest: string,
    opts: { size?: number; indent?: number; color?: RGB } = {},
  ): void {
    const size = opts.size ?? 9;
    const indent = opts.indent ?? 0;
    const lh = lineH(size);
    ensure(lh);
    doc.setFont("helvetica", "bold").setFontSize(size);
    setColor(INK);
    doc.text(pdfSafe(prefix), ML + indent, y);
    const w = doc.getTextWidth(pdfSafe(prefix));
    doc.setFont("helvetica", "normal");
    setColor(opts.color ?? BODY);
    const avail = Math.max(CONTENT_W - indent - w, 30);
    const lines = doc.splitTextToSize(pdfSafe(rest), avail) as string[];
    if (lines.length === 0) {
      y += lh;
      return;
    }
    doc.text(lines[0], ML + indent + w, y);
    y += lh;
    for (const line of lines.slice(1)) {
      ensure(lh);
      doc.text(line, ML + indent + 3, y);
      y += lh;
    }
  }

  /** Bullet with a bold label and flowing remainder (executive summary). */
  function bulletInline(prefix: string, rest: string): void {
    ensure(lineH(9) * 2);
    doc.setFont("helvetica", "normal").setFontSize(9);
    setColor(INK);
    doc.text("\u2022", ML + 1, y);
    writeInline(prefix, rest, { indent: 4 });
  }

  /** Bold wrapped sub-heading (competitor, question, gap, week…). */
  function subHeading(text: string): void {
    ensure(14);
    y += 4.5;
    doc.setFont("helvetica", "bold").setFontSize(10);
    setColor(INK);
    const lines = doc.splitTextToSize(pdfSafe(text), CONTENT_W) as string[];
    for (const line of lines) {
      ensure(lineH(10));
      doc.text(line, ML, y);
      y += lineH(10);
    }
    y += 1.5;
  }

  /** "Generated by {model}" attribution line shown by the report page. */
  function modelLine(model: string): void {
    writeWrapped(`Generated by ${model}`, {
      size: 8,
      style: "italic",
      color: FAINT,
      gap: 2,
    });
  }

  /** Bulleted list, or the UI's "None identified" placeholder. */
  function labelList(name: string, items: string[]): void {
    label(name);
    if (items.length === 0) {
      writeWrapped("None identified", { color: FAINT, gap: 1 });
      return;
    }
    for (const item of items) writeWrapped(item, { bullet: true });
    y += 1.5;
  }

  /** URL as a clickable blue link (wrapped, each line linked). */
  function drawLink(url: string, indent = 0, size = 9): void {
    doc.setFont("helvetica", "normal").setFontSize(size);
    setColor(LINK);
    const lines = doc.splitTextToSize(pdfSafe(url), CONTENT_W - indent) as string[];
    for (const line of lines) {
      ensure(lineH(size));
      doc.textWithLink(line, ML + indent, y, { url });
      y += lineH(size);
    }
  }

  /** Evidence: source, link, retrieved date, excerpt (or honest null note). */
  function evidenceBlock(evidence: ExportEvidence[]): void {
    label("Evidence");
    if (evidence.length === 0) {
      writeWrapped("No evidence recorded.", {
        style: "italic",
        color: FAINT,
        gap: 2,
      });
      return;
    }
    for (const e of evidence) {
      ensure(22);
      doc.setFont("helvetica", "bold").setFontSize(9);
      setColor(INK);
      const sourceLines = doc.splitTextToSize(
        pdfSafe(e.source),
        CONTENT_W - 5,
      ) as string[];
      for (const line of sourceLines.length > 0 ? sourceLines : [""]) {
        ensure(lineH(9));
        doc.text(line, ML + 5, y);
        y += lineH(9);
      }
      drawLink(e.source_url, 5, 8);
      writeWrapped(
        `Retrieved ${formatDate(e.retrieved_at)} · Confidence ${confidenceText(e.confidence)}`,
        { size: 8, indent: 5, color: MUTED },
      );
      if (e.excerpt) {
        writeWrapped(`"${collapse(e.excerpt)}"`, {
          size: 8.5,
          indent: 5,
          style: "italic",
          color: BODY,
        });
      } else {
        writeWrapped("Not recorded for this evidence.", {
          size: 8.5,
          indent: 5,
          style: "italic",
          color: FAINT,
        });
      }
      y += 2.5;
    }
    y += 1;
  }

  /** Table via autotable; advances the cursor past the drawn table. */
  function table(
    head: string[],
    rows: string[][],
    opts: { size?: number; columnStyles?: Record<string, { cellWidth?: number }> } = {},
  ): void {
    ensure(18);
    const size = opts.size ?? 8.5;
    autoTable(doc, {
      head: [head.map(pdfSafe)],
      body: rows.map((row) => row.map((cell) => pdfSafe(cell))),
      startY: y,
      margin: { left: ML, right: MR, top: MT, bottom: MB },
      styles: {
        font: "helvetica",
        fontSize: size,
        cellPadding: 1.5,
        textColor: BODY,
        lineColor: RULE,
        lineWidth: 0.1,
        overflow: "linebreak",
        valign: "top",
      },
      headStyles: {
        fillColor: INK,
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: size,
      },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      columnStyles: opts.columnStyles,
    });
    const finalY = (
      doc as unknown as { lastAutoTable?: { finalY?: number } }
    ).lastAutoTable?.finalY;
    y = typeof finalY === "number" ? finalY + 5 : y + 5;
  }

  const questions = report.buyer_questions?.result.questions ?? [];
  const gaps = report.distribution_gaps?.result.gaps ?? [];
  const opportunities = report.opportunities?.result.opportunities ?? [];
  const weeks = report.action_plan?.result.weeks ?? [];
  const visibility = report.visibility ?? [];
  const competitors = report.competitors ?? [];
  const appearing = visibility.filter((row) => row.appears).length;
  const topOpportunity = opportunities[0] ?? null;

  // ----- Title block -----
  doc.setFont("helvetica", "bold").setFontSize(18);
  setColor(INK);
  doc.text(pdfSafe(`${report.project.name} — Report`), ML, y);
  y += 8;
  doc.setFont("helvetica", "normal").setFontSize(9);
  setColor(MUTED);
  const meta: string[] = [`Analysis #${report.run.id}`];
  if (report.run.completed_at) {
    meta.push(`completed ${formatDate(report.run.completed_at)}`);
  }
  doc.text(pdfSafe(meta.join("  ·  ")), ML, y);
  y += 4.5;
  drawLink(report.project.website_url);
  y += 3;
  doc.setDrawColor(RULE[0], RULE[1], RULE[2]).setLineWidth(0.4);
  doc.line(ML, y, PAGE_W - MR, y);
  y += 4;

  // ----- 1. Executive Summary -----
  sectionHeading(1, "Executive Summary");
  if (report.product?.result) {
    writeWrapped(report.product.result.product_summary, { gap: 3 });
  } else {
    writeWrapped("Product analysis unavailable for this run.", {
      style: "italic",
      color: FAINT,
      gap: 3,
    });
  }
  bulletInline(
    "Search visibility: ",
    `${appearing} of ${visibility.length} discovery queries surfaced the company`,
  );
  bulletInline("Distribution gaps: ", `${gaps.length} identified`);
  bulletInline("Opportunities: ", `${opportunities.length} prioritized`);
  if (topOpportunity) {
    bulletInline(
      "Top priority opportunity: ",
      `${topOpportunity.title} (priority ${topOpportunity.priority_score}/100)`,
    );
  }
  if (weeks.length > 0) {
    const totalActions = weeks.reduce((n, week) => n + week.actions.length, 0);
    bulletInline(
      "30-day plan: ",
      `${totalActions} actions across ${weeks.length} weeks`,
    );
  }
  y += 3;

  // ----- 2. Product Understanding -----
  sectionHeading(2, "Product Understanding");
  const product = report.product?.result;
  if (product && report.product) {
    field("Product summary", product.product_summary);
    field("Problem", product.problem_solved);
    field("Value proposition", product.value_proposition);
    field("Category", product.product_category);
    labelList("Capabilities", product.key_capabilities);
    modelLine(report.product.model);
  } else {
    writeWrapped("Not available.", { style: "italic", color: FAINT, gap: 2 });
  }

  // ----- 3. ICP -----
  sectionHeading(3, "ICP");
  const icp = report.icp?.result;
  if (icp && report.icp) {
    field("Primary ICP", icp.primary_icp);
    field("Buyer", icp.buyer_role);
    labelList("Company characteristics", icp.company_characteristics);
    labelList("Pain points", icp.pain_points);
    labelList("Trigger events", icp.trigger_events);
    labelList("Exclusions", icp.exclusions);
    writeInline("Confidence: ", confidenceText(icp.confidence));
    y += 2;
    modelLine(report.icp.model);
  } else {
    writeWrapped("Not available.", { style: "italic", color: FAINT, gap: 2 });
  }

  // ----- 4. Competitors -----
  sectionHeading(4, "Competitors");
  if (competitors.length === 0) {
    writeWrapped("None identified.", { style: "italic", color: FAINT, gap: 2 });
  }
  for (const competitor of competitors) {
    subHeading(`${competitor.name} — ${competitor.type}`);
    writeInline("Why relevant: ", competitor.reason_relevant);
    if (competitor.url) {
      label("Website");
      drawLink(competitor.url);
      y += 2;
    } else {
      writeWrapped("Website: Not available", { color: MUTED, gap: 2 });
    }
  }

  // ----- 5. Buyer Questions + evidence -----
  sectionHeading(5, "Buyer Questions");
  if (questions.length === 0 || !report.buyer_questions) {
    writeWrapped("Not available.", { style: "italic", color: FAINT, gap: 2 });
  }
  questions.forEach((question, index) => {
    subHeading(`${index + 1}. ${question.question}`);
    writeInline("Intent: ", question.intent);
    writeInline("Audience: ", question.audience);
    evidenceBlock(question.evidence);
    y += 2;
  });
  if (report.buyer_questions && questions.length > 0) {
    modelLine(report.buyer_questions.model);
  }

  // ----- 6. Visibility (table) -----
  sectionHeading(6, "Visibility");
  if (visibility.length === 0) {
    writeWrapped("No visibility results.", {
      style: "italic",
      color: FAINT,
      gap: 2,
    });
  } else {
    table(
      ["Query", "Appears", "Position", "Competitors found"],
      visibility.map((row) => [
        row.query,
        row.appears ? "Yes" : "No",
        row.position !== null ? `#${row.position}` : "-",
        row.competitors_found.length > 0 ? row.competitors_found.join(", ") : "-",
      ]),
      { columnStyles: { 1: { cellWidth: 22 }, 2: { cellWidth: 20 } } },
    );
  }

  // ----- 7. Distribution Gaps + evidence -----
  sectionHeading(7, "Distribution Gaps");
  if (gaps.length === 0 || !report.distribution_gaps) {
    writeWrapped("Not available.", { style: "italic", color: FAINT, gap: 2 });
  }
  for (const gap of gaps) {
    subHeading(gap.title);
    ensure(lineH(9) + 2);
    doc.setFont("helvetica", "bold").setFontSize(8);
    setColor(categoryColor(gap.category));
    doc.text(pdfSafe(gap.category.toUpperCase()), ML, y);
    const badgeW = doc.getTextWidth(pdfSafe(gap.category.toUpperCase()));
    doc.setFont("helvetica", "normal").setFontSize(8.5);
    setColor(MUTED);
    doc.text(
      pdfSafe(`  ·  Confidence ${confidenceText(gap.confidence)}`),
      ML + badgeW,
      y,
    );
    y += lineH(9);
    writeWrapped(gap.description, { gap: 2 });
    evidenceBlock(gap.evidence);
    y += 2;
  }
  if (report.distribution_gaps && gaps.length > 0) {
    modelLine(report.distribution_gaps.model);
  }

  // ----- 8. Opportunities + feedback state -----
  sectionHeading(8, "Opportunities");
  if (opportunities.length === 0 || !report.opportunities) {
    writeWrapped("Not available.", { style: "italic", color: FAINT, gap: 2 });
  }
  for (const opportunity of opportunities) {
    ensure(40);
    subHeading(opportunity.title);
    writeWrapped(
      `Priority ${opportunity.priority_score}/100 · Impact ${opportunity.impact}/5 · Effort ${opportunity.effort}/5 · Urgency ${opportunity.urgency}/5 · Confidence ${confidenceText(opportunity.confidence)}`,
      { size: 8.5, color: MUTED, gap: 2 },
    );
    field("Problem", opportunity.problem);
    field("Recommended action", opportunity.recommended_action);
    label("Score components");
    table(
      ["Component", "Detail"],
      scoreRows(opportunity.score_components).map((row) => [
        row.label,
        row.detail,
      ]),
      { columnStyles: { 0: { cellWidth: 42 } } },
    );
    writeWrapped(opportunity.score_components.formula, {
      size: 8,
      style: "italic",
      color: FAINT,
      gap: 2,
    });
    const state: FeedbackState | undefined = feedback[opportunity.title];
    const feedbackColor: RGB =
      state === "useful"
        ? [22, 101, 52]
        : state === "not_useful"
          ? [185, 28, 28]
          : MUTED;
    writeInline("Feedback: ", feedbackLabel(state), { color: feedbackColor });
    y += 3;
  }
  if (report.opportunities && opportunities.length > 0) {
    modelLine(report.opportunities.model);
  }

  // ----- 9. 30-Day Plan -----
  sectionHeading(9, "30-Day Plan");
  if (weeks.length === 0 || !report.action_plan) {
    writeWrapped("Not available.", { style: "italic", color: FAINT, gap: 2 });
  }
  for (const week of weeks) {
    subHeading(`Week ${week.week}`);
    if (week.actions.length === 0) {
      writeWrapped("No actions planned.", { style: "italic", color: FAINT });
      continue;
    }
    for (const action of week.actions) {
      writeWrapped(`\u2022 ${action.title} (${action.effort})`, {
        style: "bold",
        size: 9.5,
      });
      writeInline("Why: ", action.why, { indent: 4, size: 9 });
      writeInline("Expected outcome: ", action.expected_outcome, {
        indent: 4,
        size: 9,
      });
      y += 1.5;
    }
    y += 2;
  }
  if (report.action_plan && weeks.length > 0) {
    modelLine(report.action_plan.model);
  }

  // ----- Footer on every page -----
  const footerTop = PAGE_H - MB + 4;
  const footerBase = PAGE_H - MB + 8.5;
  const pages = doc.getNumberOfPages();
  const footerId = pdfSafe(
    `${report.project.name} — Report · Analysis #${report.run.id}`,
  );
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]).setLineWidth(0.3);
    doc.line(ML, footerTop, PAGE_W - MR, footerTop);
    doc.setFont("helvetica", "normal").setFontSize(7);
    setColor(FAINT);
    doc.text(footerId, ML, footerBase);
    doc.text(`Page ${page} of ${pages}`, PAGE_W - MR, footerBase, {
      align: "right",
    });
  }

  return doc;
}
