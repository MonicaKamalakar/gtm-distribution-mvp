/**
 * Report export builders (shared by both export formats).
 *
 * `buildReportMarkdown` renders the complete report — all nine sections,
 * including evidence blocks and feedback state — as GitHub-flavored Markdown.
 * The PDF builder lives in `reportExportPdf.ts` and is loaded on demand so the
 * PDF library never enters the initial page bundle.
 *
 * Both builders are pure: they take the existing report API payload (already
 * fetched by the report page) plus the feedback recorded this session, and
 * return export text. They never fetch data and never change report state.
 */

import { confidenceLevel } from "./ConfidenceLabel";
import { formatDate } from "./ui";

/** Feedback a user can give on one opportunity. */
export type FeedbackState = "useful" | "not_useful";
/** Opportunity title → feedback recorded this session (absent = "Not rated"). */
export type FeedbackByTitle = Record<string, FeedbackState>;

type Section<T> = { result: T; model: string } | null;

export type ExportEvidence = {
  source: string;
  source_url: string;
  retrieved_at: string;
  confidence: number;
  excerpt?: string | null;
};

export type ExportScoreComponent = {
  raw: number;
  normalized: number;
  weight: number;
  weighted: number;
};

export type ExportScoreComponents = {
  formula: string;
  impact: ExportScoreComponent;
  urgency: ExportScoreComponent;
  confidence: ExportScoreComponent;
  effort: { raw: number; multiplier: number };
  base: number;
  priority_score: number;
};

export type ExportOpportunity = {
  title: string;
  problem: string;
  recommended_action: string;
  impact: number;
  effort: number;
  confidence: number;
  urgency: number;
  priority_score: number;
  score_components: ExportScoreComponents;
};

export type ExportPlanAction = {
  title: string;
  why: string;
  effort: string;
  expected_outcome: string;
};

export type ExportVisibilityRow = {
  query: string;
  appears: boolean;
  position: number | null;
  competitors_found: string[];
  timestamp: string;
};

/** Structural mirror of the report page's data (checked at the call site). */
export type ExportReport = {
  project: {
    id: number;
    name: string;
    website_url: string;
    description: string | null;
    created_at: string;
  };
  run: {
    id: number;
    status: string;
    started_at: string | null;
    completed_at: string | null;
  };
  product:
    | Section<{
        product_summary: string;
        problem_solved: string;
        value_proposition: string;
        product_category: string;
        key_capabilities: string[];
      }>
    | undefined;
  icp:
    | Section<{
        primary_icp: string;
        buyer_role: string;
        company_characteristics: string[];
        pain_points: string[];
        trigger_events: string[];
        exclusions: string[];
        confidence: number;
      }>
    | undefined;
  competitors:
    | { name: string; url: string | null; type: string; reason_relevant: string }[]
    | undefined;
  buyer_questions:
    | Section<{
        questions: {
          question: string;
          intent: string;
          audience: string;
          evidence: ExportEvidence[];
        }[];
      }>
    | undefined;
  visibility: ExportVisibilityRow[] | undefined;
  distribution_gaps:
    | Section<{
        gaps: {
          category: string;
          title: string;
          description: string;
          evidence: ExportEvidence[];
          confidence: number;
        }[];
      }>
    | undefined;
  opportunities: Section<{ opportunities: ExportOpportunity[] }> | undefined;
  action_plan:
    | Section<{ weeks: { week: number; actions: ExportPlanAction[] }[] }>
    | undefined;
};

/** Human label for opportunity feedback state. */
export function feedbackLabel(state: FeedbackState | undefined): string {
  if (state === "useful") return "Useful";
  if (state === "not_useful") return "Not useful";
  return "Not rated";
}

/** Confidence rendered the same way as the UI: "90 (High)". */
export function confidenceText(value: number): string {
  const v = Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : 0;
  return `${v} (${confidenceLevel(v)})`;
}

/** File name base for exports, e.g. "notion-report". */
export function reportFileBase(report: ExportReport): string {
  const slug = report.project.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "project"}-report`;
}

/** Score-component rows, mirroring the report page's breakdown. */
export function scoreRows(components: ExportScoreComponents): Array<{
  label: string;
  detail: string;
}> {
  return [
    {
      label: "Impact",
      detail: `${components.impact.raw}/5 → ${components.impact.normalized} × ${components.impact.weight} = ${components.impact.weighted}`,
    },
    {
      label: "Urgency",
      detail: `${components.urgency.raw}/5 → ${components.urgency.normalized} × ${components.urgency.weight} = ${components.urgency.weighted}`,
    },
    {
      label: "Confidence",
      detail: `${components.confidence.raw} × ${components.confidence.weight} = ${components.confidence.weighted}`,
    },
    { label: "Weighted base", detail: String(components.base) },
    {
      label: "Effort multiplier",
      detail: `${components.effort.raw}/5 → × ${components.effort.multiplier}`,
    },
    { label: "Priority score", detail: `${components.priority_score} / 100` },
  ];
}

/** Collapse whitespace so evidence excerpts stay on one line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Escape a value for a Markdown table cell. */
function mdCell(text: string): string {
  return oneLine(text).replace(/\|/g, "\\|");
}

/** Bullet list lines, or the UI's "None identified" placeholder. */
function mdBullets(items: string[]): string[] {
  if (items.length === 0) return ["- None identified"];
  return items.map((item) => `- ${item}`);
}

/** Evidence block: source, URL, retrieved date, excerpt, confidence. */
function mdEvidence(evidence: ExportEvidence[]): string[] {
  if (evidence.length === 0) {
    return ["**Evidence**", "", "_No evidence recorded._", ""];
  }
  const out: string[] = ["**Evidence**", ""];
  evidence.forEach((e, index) => {
    out.push(
      `${index + 1}. **${oneLine(e.source)}** — [${e.source_url}](${e.source_url})`,
    );
    out.push(
      `   - Retrieved: ${formatDate(e.retrieved_at)} · Confidence: ${confidenceText(e.confidence)}`,
    );
    out.push(
      e.excerpt
        ? `   - Excerpt: "${oneLine(e.excerpt)}"`
        : "   - Excerpt: _Not recorded for this evidence._",
    );
  });
  out.push("");
  return out;
}

/** "Generated by {model}" attribution line shown by the report page. */
function mdModel(model: string): string[] {
  return [`_Generated by ${model}_`, ""];
}

/**
 * The complete report as GitHub-flavored Markdown: headings, lists, tables,
 * links and evidence — all nine sections, in report order.
 */
export function buildReportMarkdown(
  report: ExportReport,
  feedback: FeedbackByTitle = {},
): string {
  const questions = report.buyer_questions?.result.questions ?? [];
  const gaps = report.distribution_gaps?.result.gaps ?? [];
  const opportunities = report.opportunities?.result.opportunities ?? [];
  const weeks = report.action_plan?.result.weeks ?? [];
  const visibility = report.visibility ?? [];
  const competitors = report.competitors ?? [];
  const appearing = visibility.filter((v) => v.appears).length;
  const topOpportunity = opportunities[0] ?? null;

  const md: string[] = [];

  // Header
  md.push(`# ${report.project.name} — Report`, "");
  const meta: string[] = [`Analysis #${report.run.id}`];
  if (report.run.completed_at) {
    meta.push(`completed ${formatDate(report.run.completed_at)}`);
  }
  meta.push(`[${report.project.website_url}](${report.project.website_url})`);
  md.push(meta.join(" · "), "");

  // 1. Executive Summary
  md.push("## 1. Executive Summary", "");
  if (report.product?.result) {
    md.push(`**What this product is:** ${report.product.result.product_summary}`, "");
  } else {
    md.push("_Product analysis unavailable for this run._", "");
  }
  md.push(
    `- **Search visibility:** ${appearing} of ${visibility.length} discovery queries surfaced the company`,
    `- **Distribution gaps:** ${gaps.length} identified`,
    `- **Opportunities:** ${opportunities.length} prioritized`,
  );
  if (topOpportunity) {
    md.push(
      `- **Top priority opportunity:** ${topOpportunity.title} (priority ${topOpportunity.priority_score}/100)`,
    );
  }
  if (weeks.length > 0) {
    const totalActions = weeks.reduce((n, w) => n + w.actions.length, 0);
    md.push(
      `- **30-day plan:** ${totalActions} actions across ${weeks.length} weeks`,
    );
  }
  md.push("");

  // 2. Product Understanding
  md.push("## 2. Product Understanding", "");
  const product = report.product?.result;
  if (product) {
    md.push(`- **Product summary:** ${product.product_summary}`);
    md.push(`- **Problem:** ${product.problem_solved}`);
    md.push(`- **Value proposition:** ${product.value_proposition}`);
    md.push(`- **Category:** ${product.product_category}`);
    if (product.key_capabilities.length > 0) {
      md.push("- **Capabilities:**");
      for (const cap of product.key_capabilities) md.push(`  - ${cap}`);
    } else {
      md.push("- **Capabilities:** None identified");
    }
    md.push("", ...mdModel(report.product!.model));
  } else {
    md.push("_Not available._", "");
  }

  // 3. ICP
  md.push("## 3. ICP", "");
  const icp = report.icp?.result;
  if (icp) {
    md.push(`- **Primary ICP:** ${icp.primary_icp}`);
    md.push(`- **Buyer:** ${icp.buyer_role}`);
    md.push(`- **Company characteristics:**`);
    md.push(...indent(mdBullets(icp.company_characteristics)));
    md.push(`- **Pain points:**`);
    md.push(...indent(mdBullets(icp.pain_points)));
    md.push(`- **Trigger events:**`);
    md.push(...indent(mdBullets(icp.trigger_events)));
    md.push(`- **Exclusions:**`);
    md.push(...indent(mdBullets(icp.exclusions)));
    md.push(`- **Confidence:** ${confidenceText(icp.confidence)}`);
    md.push("", ...mdModel(report.icp!.model));
  } else {
    md.push("_Not available._", "");
  }

  // 4. Competitors
  md.push("## 4. Competitors", "");
  if (competitors.length > 0) {
    for (const c of competitors) {
      md.push(`### ${c.name} — ${c.type}`, "");
      md.push(`- **Why relevant:** ${c.reason_relevant}`);
      md.push(
        c.url
          ? `- **Website:** [${c.url}](${c.url})`
          : "- **Website:** Not available",
      );
      md.push("");
    }
  } else {
    md.push("_None identified._", "");
  }

  // 5. Buyer Questions + evidence
  md.push("## 5. Buyer Questions", "");
  if (questions.length > 0) {
    questions.forEach((q, index) => {
      md.push(`### ${index + 1}. ${q.question}`, "");
      md.push(`- **Intent:** ${q.intent}`);
      md.push(`- **Audience:** ${q.audience}`);
      md.push("");
      md.push(...mdEvidence(q.evidence));
    });
    if (report.buyer_questions) {
      md.push(...mdModel(report.buyer_questions.model));
    }
  } else {
    md.push("_Not available._", "");
  }

  // 6. Visibility (table)
  md.push("## 6. Visibility", "");
  if (visibility.length > 0) {
    md.push("| Query | Appears | Position | Competitors found |");
    md.push("| --- | --- | --- | --- |");
    for (const row of visibility) {
      const position = row.position !== null ? `#${row.position}` : "—";
      const found =
        row.competitors_found.length > 0 ? row.competitors_found.join(", ") : "—";
      md.push(
        `| ${mdCell(row.query)} | ${row.appears ? "Yes" : "No"} | ${position} | ${mdCell(found)} |`,
      );
    }
    md.push("");
  } else {
    md.push("_No visibility results._", "");
  }

  // 7. Distribution Gaps + evidence
  md.push("## 7. Distribution Gaps", "");
  if (gaps.length > 0) {
    for (const gap of gaps) {
      md.push(`### ${gap.title}`, "");
      md.push(`- **Category:** ${gap.category}`);
      md.push(`- **Confidence:** ${confidenceText(gap.confidence)}`);
      md.push(`- **Description:** ${gap.description}`);
      md.push("");
      md.push(...mdEvidence(gap.evidence));
    }
    if (report.distribution_gaps) {
      md.push(...mdModel(report.distribution_gaps.model));
    }
  } else {
    md.push("_Not available._", "");
  }

  // 8. Opportunities + feedback state
  md.push("## 8. Opportunities", "");
  if (opportunities.length > 0) {
    for (const opp of opportunities) {
      const state = feedback[opp.title];
      md.push(`### ${opp.title}`, "");
      md.push(`- **Priority:** ${opp.priority_score}/100`);
      md.push(`- **Problem:** ${opp.problem}`);
      md.push(`- **Recommended action:** ${opp.recommended_action}`);
      md.push(
        `- **Impact:** ${opp.impact}/5 · **Effort:** ${opp.effort}/5 · **Urgency:** ${opp.urgency}/5 · **Confidence:** ${confidenceText(opp.confidence)}`,
      );
      md.push("", "**Score components**", "");
      md.push("| Component | Detail |");
      md.push("| --- | --- |");
      for (const row of scoreRows(opp.score_components)) {
        md.push(`| ${row.label} | ${mdCell(row.detail)} |`);
      }
      md.push("");
      md.push(`- **Feedback:** ${feedbackLabel(state)}`);
      md.push("", `_${opp.score_components.formula}_`, "");
    }
    if (report.opportunities) {
      md.push(...mdModel(report.opportunities.model));
    }
  } else {
    md.push("_Not available._", "");
  }

  // 9. 30-Day Plan
  md.push("## 9. 30-Day Plan", "");
  if (weeks.length > 0) {
    for (const week of weeks) {
      md.push(`### Week ${week.week}`, "");
      if (week.actions.length === 0) {
        md.push("_No actions planned._", "");
        continue;
      }
      for (const action of week.actions) {
        md.push(`- **${action.title}** (${action.effort})`);
        md.push(`  - **Why:** ${action.why}`);
        md.push(`  - **Expected outcome:** ${action.expected_outcome}`);
      }
      md.push("");
    }
    if (report.action_plan) {
      md.push(...mdModel(report.action_plan.model));
    }
  } else {
    md.push("_Not available._", "");
  }

  return md.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Indent every line of a block by two spaces (nested Markdown lists). */
function indent(lines: string[]): string[] {
  return lines.map((line) => `  ${line}`);
}
