import Link from "next/link";
import { notFound } from "next/navigation";
import ConfidenceLabel from "../../../ConfidenceLabel";
import EvidenceList, { type Evidence } from "../../../EvidenceDrawer";
import {
  InsightFeedback,
  OpportunityFeedback,
} from "../../../FeedbackButtons";
import ReportExportButton from "../../../ReportExportButton";
import type { Competitor } from "../../../CompetitorsSection";
import type { ICPInfo } from "../../../ICPSection";
import type { ProductInfo } from "../../../ProductUnderstanding";
import { cardStyles, formatDate, labelStyles } from "../../../ui";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

type Section<T> = { result: T; model: string } | null;

type BuyerQuestion = {
  question: string;
  intent: string;
  audience: string;
  evidence: Evidence[];
};

type Gap = {
  category: string;
  title: string;
  description: string;
  evidence: Evidence[];
  confidence: number;
};

type ScoreComponent = {
  raw: number;
  normalized: number;
  weight: number;
  weighted: number;
};

type ScoreComponents = {
  formula: string;
  impact: ScoreComponent;
  urgency: ScoreComponent;
  confidence: ScoreComponent;
  effort: { raw: number; multiplier: number };
  base: number;
  priority_score: number;
};

type Opportunity = {
  title: string;
  problem: string;
  recommended_action: string;
  impact: number;
  effort: number;
  confidence: number;
  urgency: number;
  priority_score: number;
  score_components: ScoreComponents;
};

type PlanAction = {
  title: string;
  why: string;
  effort: string;
  expected_outcome: string;
};

type Week = { week: number; actions: PlanAction[] };

type VisibilityRow = {
  query: string;
  appears: boolean;
  position: number | null;
  competitors_found: string[];
  timestamp: string;
};

type Report = {
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
  product: Section<ProductInfo>;
  icp: Section<ICPInfo>;
  competitors: Competitor[];
  buyer_questions: Section<{ questions: BuyerQuestion[] }>;
  visibility: VisibilityRow[];
  distribution_gaps: Section<{ gaps: Gap[] }>;
  opportunities: Section<{ opportunities: Opportunity[] }>;
  action_plan: Section<{ weeks: Week[] }>;
};

const pageStyles: React.CSSProperties = {
  maxWidth: 640,
  margin: "40px auto 64px",
  textAlign: "left",
  width: "100%",
  padding: "0 16px",
  boxSizing: "border-box",
};

const sectionStyles: React.CSSProperties = {
  marginTop: 40,
  width: "100%",
};

function SectionHeading({ number, title }: { number: number; title: string }) {
  return (
    <h2 style={{ fontSize: 18, marginBottom: 10, color: "#111827" }}>
      {number}. {title}
    </h2>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={labelStyles}>{label}</div>
      <div style={{ fontSize: 14, color: "#374151" }}>{children}</div>
    </div>
  );
}

function ListOrNone({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <span style={{ color: "#9ca3af" }}>None identified</span>;
  }
  return (
    <ul
      style={{
        margin: 0,
        paddingLeft: 18,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function categoryBadgeStyle(category: string): React.CSSProperties {
  return {
    display: "inline-block",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    color: category === "discovery" ? "#1d4ed8"
      : category === "positioning" ? "#7c3aed"
      : category === "authority" ? "#b45309"
      : "#0f766e",
    background: category === "discovery" ? "#dbeafe"
      : category === "positioning" ? "#ede9fe"
      : category === "authority" ? "#fef3c7"
      : "#ccfbf1",
    borderRadius: 999,
    padding: "2px 8px",
  };
}

function ScoreBreakdown({ components }: { components: ScoreComponents }) {
  const rows: Array<{ label: string; detail: string }> = [
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
    {
      label: "Weighted base",
      detail: String(components.base),
    },
    {
      label: "Effort multiplier",
      detail: `${components.effort.raw}/5 → × ${components.effort.multiplier}`,
    },
    {
      label: "Priority score",
      detail: `${components.priority_score} / 100`,
    },
  ];

  return (
    <div style={{ marginTop: 10 }}>
      <div style={labelStyles}>Score components</div>
      <div
        style={{
          border: "1px dashed #e5e7eb",
          borderRadius: 6,
          background: "#f9fafb",
          padding: "8px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {rows.map((row) => (
          <div
            key={row.label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              fontSize: 12,
              fontFamily: "ui-monospace, monospace",
              color: row.label === "Priority score" ? "#111827" : "#4b5563",
              fontWeight: row.label === "Priority score" ? 700 : 400,
            }}
          >
            <span>{row.label}</span>
            <span>{row.detail}</span>
          </div>
        ))}
        <div
          style={{
            fontSize: 10,
            color: "#9ca3af",
            marginTop: 4,
            lineHeight: 1.4,
            fontFamily: "ui-monospace, monospace",
          }}
        >
          {components.formula}
        </div>
      </div>
    </div>
  );
}

export default async function ProjectReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!/^\d+$/.test(id)) {
    notFound();
  }

  let report: Report | null = null;
  let loadError: string | null = null;
  let missingProject = false;
  let noCompletedRun = false;

  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/projects/${id}/report`, {
      cache: "no-store",
    });
    if (res.status === 404) {
      const detail = (await res.json().catch(() => ({}))) as { detail?: string };
      if ((detail.detail ?? "").includes("Project")) {
        missingProject = true;
      } else {
        noCompletedRun = true;
      }
    } else if (!res.ok) {
      throw new Error(`Backend responded with ${res.status}`);
    } else {
      report = (await res.json()) as Report;
    }
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Request failed";
  }

  if (missingProject) {
    notFound();
  }

  if (loadError) {
    return (
      <div style={pageStyles}>
        <p style={{ color: "#dc2626" }} role="alert">
          Failed to load report: {loadError}
        </p>
        <Link href={`/projects/${id}`} style={{ color: "#2563eb", fontSize: 14 }}>
          ← Back to project
        </Link>
      </div>
    );
  }

  if (noCompletedRun || !report) {
    return (
      <div style={pageStyles}>
        <Link href={`/projects/${id}`} style={{ color: "#2563eb", fontSize: 14 }}>
          ← Back to project
        </Link>
        <h1 style={{ fontSize: 26, color: "#111827", margin: "16px 0 12px" }}>
          Report
        </h1>
        <p style={{ fontSize: 15, color: "#6b7280" }}>
          No completed analysis yet — open the project and run{" "}
          <strong>Analyze</strong> to generate the report.
        </p>
      </div>
    );
  }

  const product = report.product?.result ?? null;
  const icp = report.icp?.result ?? null;
  const questions = report.buyer_questions?.result.questions ?? [];
  const gaps = report.distribution_gaps?.result.gaps ?? [];
  const opportunities = report.opportunities?.result.opportunities ?? [];
  const weeks = report.action_plan?.result.weeks ?? [];

  const appearing = report.visibility.filter((v) => v.appears).length;
  const topOpportunity = opportunities[0] ?? null;

  return (
    <div style={pageStyles}>
      <Link href={`/projects/${report.project.id}`} style={{ color: "#2563eb", fontSize: 14 }}>
        ← Back to project
      </Link>

      <h1 style={{ fontSize: 26, color: "#111827", margin: "16px 0 4px" }}>
        {report.project.name} — Report
      </h1>
      <p style={{ fontSize: 13, color: "#9ca3af", margin: "0 0 8px" }}>
        Analysis #{report.run.id}
        {report.run.completed_at ? ` · completed ${formatDate(report.run.completed_at)}` : ""}
      </p>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          margin: "0 0 4px",
        }}
      >
        <ReportExportButton report={report} />
      </div>

      {/* 1. Executive Summary */}
      <section style={sectionStyles} aria-label="Executive Summary">
        <SectionHeading number={1} title="Executive Summary" />
        <div style={{ ...cardStyles, display: "flex", flexDirection: "column", gap: 12 }}>
          {product ? (
            <Field label="What this product is">{product.product_summary}</Field>
          ) : (
            <p style={{ margin: 0, fontSize: 14, color: "#9ca3af" }}>
              Product analysis unavailable for this run.
            </p>
          )}

          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div>
              <div style={labelStyles}>Search visibility</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>
                {appearing} of {report.visibility.length}
              </div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                discovery queries surfaced the company
              </div>
            </div>
            <div>
              <div style={labelStyles}>Distribution gaps</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>
                {gaps.length}
              </div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>identified</div>
            </div>
            <div>
              <div style={labelStyles}>Opportunities</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>
                {opportunities.length}
              </div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>prioritized</div>
            </div>
          </div>

          {topOpportunity && (
            <Field label="Top priority opportunity">
              <span style={{ fontWeight: 600 }}>{topOpportunity.title}</span>{" "}
              <span style={{ color: "#6b7280" }}>
                (priority {topOpportunity.priority_score}/100)
              </span>
            </Field>
          )}

          {weeks.length > 0 && (
            <Field label="30-day plan">
              {weeks.reduce((total, w) => total + w.actions.length, 0)} actions
              across {weeks.length} weeks
            </Field>
          )}
        </div>
      </section>

      {/* 2. Product */}
      <section style={sectionStyles} aria-label="Product">
        <SectionHeading number={2} title="Product" />
        {product ? (
          <div style={{ ...cardStyles, display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Product summary">{product.product_summary}</Field>
            <Field label="Problem">{product.problem_solved}</Field>
            <Field label="Value proposition">{product.value_proposition}</Field>
            <Field label="Category">{product.product_category}</Field>
            <Field label="Capabilities">
              <ListOrNone items={product.key_capabilities} />
            </Field>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 11, color: "#9ca3af" }}>
                Generated by {report.product!.model}
              </span>
              <InsightFeedback
                projectId={report.project.id}
                entityType="product"
                entityRef="Product"
              />
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: "#9ca3af" }}>Not available.</p>
        )}
      </section>

      {/* 3. ICP */}
      <section style={sectionStyles} aria-label="ICP">
        <SectionHeading number={3} title="ICP" />
        {icp ? (
          <div style={{ ...cardStyles, display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Primary ICP">{icp.primary_icp}</Field>
            <Field label="Buyer">{icp.buyer_role}</Field>
            <Field label="Company characteristics">
              <ListOrNone items={icp.company_characteristics} />
            </Field>
            <Field label="Pain points">
              <ListOrNone items={icp.pain_points} />
            </Field>
            <Field label="Trigger events">
              <ListOrNone items={icp.trigger_events} />
            </Field>
            <Field label="Exclusions">
              <ListOrNone items={icp.exclusions} />
            </Field>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={labelStyles}>Confidence</div>
              <ConfidenceLabel value={icp.confidence} />
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 11, color: "#9ca3af" }}>
                Generated by {report.icp!.model}
              </span>
              <InsightFeedback
                projectId={report.project.id}
                entityType="icp"
                entityRef="ICP"
              />
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: "#9ca3af" }}>Not available.</p>
        )}
      </section>

      {/* 4. Competitors */}
      <section style={sectionStyles} aria-label="Competitors">
        <SectionHeading number={4} title="Competitors" />
        {report.competitors.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {report.competitors.map((c) => (
              <div key={c.name} style={cardStyles}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <strong style={{ fontSize: 15, color: "#111827" }}>{c.name}</strong>
                  <span
                    style={{
                      display: "inline-block",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#1d4ed8",
                      background: "#dbeafe",
                      borderRadius: 999,
                      padding: "2px 8px",
                    }}
                  >
                    {c.type}
                  </span>
                </div>
                <p style={{ margin: "8px 0 0", fontSize: 14, color: "#374151" }}>
                  {c.reason_relevant}
                </p>
                {c.url && (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 13, color: "#2563eb", wordBreak: "break-all" }}
                  >
                    {c.url}
                  </a>
                )}
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <InsightFeedback
                projectId={report.project.id}
                entityType="competitors"
                entityRef="Competitors"
              />
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: "#9ca3af" }}>None identified.</p>
        )}
      </section>

      {/* 5. Buyer Questions */}
      <section style={sectionStyles} aria-label="Buyer Questions">
        <SectionHeading number={5} title="Buyer Questions" />
        {questions.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {questions.map((q) => (
              <div key={q.question} style={cardStyles}>
                <strong style={{ fontSize: 15, color: "#111827" }}>
                  {q.question}
                </strong>
                <div style={{ marginTop: 8 }}>
                  <Field label="Intent">{q.intent}</Field>
                </div>
                <div style={{ marginTop: 8 }}>
                  <Field label="Audience">{q.audience}</Field>
                </div>
                <div style={{ marginTop: 8 }}>
                  <div style={labelStyles}>Evidence</div>
                  <EvidenceList evidence={q.evidence} />
                </div>
              </div>
            ))}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 11, color: "#9ca3af" }}>
                Generated by {report.buyer_questions!.model}
              </span>
              <InsightFeedback
                projectId={report.project.id}
                entityType="buyer_questions"
                entityRef="Buyer Questions"
              />
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: "#9ca3af" }}>Not available.</p>
        )}
      </section>

      {/* 6. Visibility */}
      <section style={sectionStyles} aria-label="Visibility">
        <SectionHeading number={6} title="Visibility" />
        {report.visibility.length > 0 ? (
          <div style={{ ...cardStyles, padding: "8px 0", overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                minWidth: 480,
                borderCollapse: "collapse",
                fontSize: 13,
                color: "#374151",
              }}
            >
              <thead>
                <tr>
                  {["Query", "Appears", "Position", "Competitors found"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: 0.3,
                        color: "#6b7280",
                        padding: "8px 12px",
                        borderBottom: "1px solid #e5e7eb",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.visibility.map((row) => (
                  <tr key={row.query} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "8px 12px", color: "#111827" }}>
                      {row.query}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          borderRadius: 999,
                          padding: "2px 8px",
                          background: row.appears ? "#dcfce7" : "#fee2e2",
                          color: row.appears ? "#166534" : "#b91c1c",
                        }}
                      >
                        {row.appears ? "Yes" : "No"}
                      </span>
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      {row.position !== null ? `#${row.position}` : "—"}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      {row.competitors_found.length > 0
                        ? row.competitors_found.join(", ")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: "#9ca3af" }}>No visibility results.</p>
        )}
      </section>

      {/* 7. Distribution Gaps */}
      <section style={sectionStyles} aria-label="Distribution Gaps">
        <SectionHeading number={7} title="Distribution Gaps" />
        {gaps.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {gaps.map((gap) => (
              <div key={gap.title} style={cardStyles}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  <span style={categoryBadgeStyle(gap.category)}>{gap.category}</span>
                  <ConfidenceLabel value={gap.confidence} showValue={false} />
                </div>
                <strong style={{ fontSize: 15, color: "#111827" }}>
                  {gap.title}
                </strong>
                <p style={{ margin: "8px 0 0", fontSize: 14, color: "#374151" }}>
                  {gap.description}
                </p>
                <div style={{ marginTop: 8 }}>
                  <div style={labelStyles}>Evidence</div>
                  <EvidenceList evidence={gap.evidence} />
                </div>
              </div>
            ))}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 11, color: "#9ca3af" }}>
                Generated by {report.distribution_gaps!.model}
              </span>
              <InsightFeedback
                projectId={report.project.id}
                entityType="distribution_gaps"
                entityRef="Distribution Gaps"
              />
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: "#9ca3af" }}>Not available.</p>
        )}
      </section>

      {/* 8. Opportunities */}
      <section style={sectionStyles} aria-label="Opportunities">
        <SectionHeading number={8} title="Opportunities" />
        {opportunities.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {opportunities.map((opp) => (
              <div key={opp.title} style={cardStyles}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  <strong style={{ fontSize: 15, color: "#111827" }}>
                    {opp.title}
                  </strong>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#1d4ed8",
                      background: "#dbeafe",
                      borderRadius: 999,
                      padding: "3px 10px",
                      whiteSpace: "nowrap",
                    }}
                    title="Priority score (0-100)"
                  >
                    Priority {opp.priority_score}/100
                  </span>
                </div>

                <Field label="Problem">{opp.problem}</Field>
                <div style={{ marginTop: 8 }}>
                  <Field label="Recommended action">{opp.recommended_action}</Field>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 16,
                    flexWrap: "wrap",
                    marginTop: 10,
                    alignItems: "center",
                  }}
                >
                  <div style={{ fontSize: 13, color: "#4b5563" }}>
                    <span style={{ ...labelStyles, display: "inline", marginRight: 4 }}>
                      Impact
                    </span>
                    {opp.impact}/5
                  </div>
                  <div style={{ fontSize: 13, color: "#4b5563" }}>
                    <span style={{ ...labelStyles, display: "inline", marginRight: 4 }}>
                      Effort
                    </span>
                    {opp.effort}/5
                  </div>
                  <div style={{ fontSize: 13, color: "#4b5563" }}>
                    <span style={{ ...labelStyles, display: "inline", marginRight: 4 }}>
                      Urgency
                    </span>
                    {opp.urgency}/5
                  </div>
                  <ConfidenceLabel value={opp.confidence} />
                </div>

                <ScoreBreakdown components={opp.score_components} />
                <OpportunityFeedback
                  projectId={report.project.id}
                  title={opp.title}
                />
              </div>
            ))}
            <div style={{ fontSize: 11, color: "#9ca3af" }}>
              Generated by {report.opportunities!.model}
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: "#9ca3af" }}>Not available.</p>
        )}
      </section>

      {/* 9. 30-Day Plan */}
      <section style={sectionStyles} aria-label="30-Day Plan">
        <SectionHeading number={9} title="30-Day Plan" />
        {weeks.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {weeks.map((week) => (
              <div key={week.week} style={cardStyles}>
                <strong style={{ fontSize: 15, color: "#111827" }}>
                  Week {week.week}
                </strong>
                {week.actions.length === 0 ? (
                  <p style={{ margin: "8px 0 0", fontSize: 14, color: "#9ca3af" }}>
                    No actions planned.
                  </p>
                ) : (
                  <div
                    style={{
                      marginTop: 8,
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    {week.actions.map((action) => (
                      <div
                        key={action.title}
                        style={{
                          border: "1px solid #f3f4f6",
                          borderRadius: 6,
                          padding: "10px 12px",
                          background: "#f9fafb",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 8,
                            alignItems: "center",
                          }}
                        >
                          <span style={{ fontWeight: 600, fontSize: 14, color: "#111827" }}>
                            {action.title}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: "#4b5563",
                              background: "#e5e7eb",
                              borderRadius: 999,
                              padding: "2px 8px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {action.effort}
                          </span>
                        </div>
                        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#4b5563" }}>
                          <span style={{ fontWeight: 600 }}>Why: </span>
                          {action.why}
                        </p>
                        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#4b5563" }}>
                          <span style={{ fontWeight: 600 }}>Expected outcome: </span>
                          {action.expected_outcome}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 11, color: "#9ca3af" }}>
                Generated by {report.action_plan!.model}
              </span>
              <InsightFeedback
                projectId={report.project.id}
                entityType="action_plan"
                entityRef="30-Day Plan"
              />
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: "#9ca3af" }}>Not available.</p>
        )}
      </section>
    </div>
  );
}
