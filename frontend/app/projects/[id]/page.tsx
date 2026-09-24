import Link from "next/link";
import { notFound } from "next/navigation";
import AnalyzeButton, { type RunInfo, type StepInfo } from "../../AnalyzeButton";
import BuyerQuestionsSection from "../../BuyerQuestionsSection";
import CompetitorsSection, { type Competitor } from "../../CompetitorsSection";
import ICPSection, { type ICPInfo } from "../../ICPSection";
import ProductUnderstanding, { type ProductInfo } from "../../ProductUnderstanding";
import { labelStyles } from "../../ui";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

type Project = {
  id: number;
  name: string;
  website_url: string;
  description: string | null;
  created_at: string;
};

const pageStyles: React.CSSProperties = {
  maxWidth: 560,
  margin: "40px auto 0",
  textAlign: "left",
  width: "100%",
  padding: "0 16px",
  boxSizing: "border-box",
};

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!/^\d+$/.test(id)) {
    notFound();
  }

  let project: Project | null = null;
  let loadError: string | null = null;
  let missing = false;

  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/projects/${id}`, {
      cache: "no-store",
    });
    if (res.status === 404) {
      missing = true;
    } else if (!res.ok) {
      throw new Error(`Backend responded with ${res.status}`);
    } else {
      project = (await res.json()) as Project;
    }
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Request failed";
  }

  if (missing) {
    notFound();
  }

  if (loadError || !project) {
    return (
      <div style={pageStyles}>
        <p style={{ color: "#dc2626" }} role="alert">
          Failed to load project: {loadError ?? "Project data unavailable"}
        </p>
        <Link href="/" style={{ color: "#2563eb", fontSize: 14 }}>
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  // Preload the Product Analyzer result for server-rendered report content.
  // undefined = fetch failed/unknown, null = confirmed no analysis, object = data.
  let productInitial: { result: ProductInfo; model: string } | null | undefined =
    undefined;
  try {
    const productRes = await fetch(
      `${BACKEND_URL}/api/v1/projects/${id}/product-analysis`,
      { cache: "no-store" },
    );
    if (productRes.ok) {
      const data = await productRes.json();
      productInitial = { result: data.result, model: data.model };
    } else if (productRes.status === 404) {
      productInitial = null;
    }
  } catch {
    // Leave undefined — the section falls back to its client-side fetch.
  }

  // Preload the ICP Analyzer result likewise.
  let icpInitial: { result: ICPInfo; model: string } | null | undefined = undefined;
  try {
    const icpRes = await fetch(
      `${BACKEND_URL}/api/v1/projects/${id}/icp-analysis`,
      { cache: "no-store" },
    );
    if (icpRes.ok) {
      const data = await icpRes.json();
      icpInitial = { result: data.result, model: data.model };
    } else if (icpRes.status === 404) {
      icpInitial = null;
    }
  } catch {
    // Leave undefined — the section falls back to its client-side fetch.
  }

  // Preload buyer questions likewise.
  let buyerQuestionsInitial:
    | { questions: unknown[]; model: string }
    | null
    | undefined = undefined;
  try {
    const bqRes = await fetch(
      `${BACKEND_URL}/api/v1/projects/${id}/buyer-questions`,
      { cache: "no-store" },
    );
    if (bqRes.ok) {
      const data = await bqRes.json();
      const questions = data.result?.questions ?? [];
      buyerQuestionsInitial =
        Array.isArray(questions) && questions.length > 0
          ? { questions, model: data.model }
          : null;
    } else if (bqRes.status === 404) {
      buyerQuestionsInitial = null;
    }
  } catch {
    // Leave undefined — the section falls back to its client-side fetch.
  }
  let competitorsInitial: Competitor[] | null | undefined = undefined;
  try {
    const compRes = await fetch(
      `${BACKEND_URL}/api/v1/projects/${id}/competitors`,
      { cache: "no-store" },
    );
    if (compRes.ok) {
      const data = await compRes.json();
      competitorsInitial = Array.isArray(data) && data.length > 0 ? data : null;
    }
  } catch {
    // Leave undefined — the section falls back to its client-side fetch.
  }

  // Preload the latest analysis run and its step progress so the Analyze
  // panel renders immediately with persisted step status.
  let runInitial: RunInfo | null = null;
  let stepsInitial: StepInfo[] | null = null;
  try {
    const runsRes = await fetch(`${BACKEND_URL}/api/v1/projects/${id}/analysis`, {
      cache: "no-store",
    });
    if (runsRes.ok) {
      const runs = (await runsRes.json()) as RunInfo[];
      if (Array.isArray(runs) && runs.length > 0) {
        const latest = runs[0];
        runInitial = { id: latest.id, status: latest.status, error: latest.error };
        const stepsRes = await fetch(
          `${BACKEND_URL}/api/v1/projects/${id}/analysis/${latest.id}/steps`,
          { cache: "no-store" },
        );
        if (stepsRes.ok) {
          const stepRows = (await stepsRes.json()) as StepInfo[];
          if (Array.isArray(stepRows)) stepsInitial = stepRows;
        }
      }
    }
  } catch {
    // Leave null — the panel starts fresh.
  }

  const p = project;
  const createdDate = new Date(p.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div style={pageStyles}>
      <Link href="/" style={{ color: "#2563eb", fontSize: 14 }}>
        ← Back to dashboard
      </Link>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
          margin: "16px 0 24px",
        }}
      >
        <h1 style={{ fontSize: 26, color: "#111827", margin: 0 }}>{p.name}</h1>
        <Link
          href={`/projects/${p.id}/report`}
          style={{ color: "#2563eb", fontSize: 14, whiteSpace: "nowrap" }}
        >
          View full report →
        </Link>
      </div>

      <dl style={{ display: "flex", flexDirection: "column", gap: 16, margin: 0 }}>
        <div>
          <dt style={labelStyles}>Website</dt>
          <dd style={{ margin: 0 }}>
            <a
              href={p.website_url}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#2563eb", fontSize: 15, wordBreak: "break-all" }}
            >
              {p.website_url}
            </a>
          </dd>
        </div>

        <div>
          <dt style={labelStyles}>Description</dt>
          <dd style={{ margin: 0, fontSize: 15, color: "#374151" }}>
            {p.description || <span style={{ color: "#9ca3af" }}>No description</span>}
          </dd>
        </div>

        <div>
          <dt style={labelStyles}>Created</dt>
          <dd style={{ margin: 0, fontSize: 15, color: "#374151" }}>
            {createdDate}
          </dd>
        </div>
      </dl>

      <ProductUnderstanding projectId={p.id} initial={productInitial} />

      <ICPSection projectId={p.id} initial={icpInitial} />

      <CompetitorsSection projectId={p.id} initial={competitorsInitial} />

      <BuyerQuestionsSection
        projectId={p.id}
        initial={
          buyerQuestionsInitial as
            | { questions: never[]; model: string }
            | null
            | undefined
        }
      />

      <AnalyzeButton
        projectId={p.id}
        initialRun={runInitial}
        initialSteps={stepsInitial}
      />
      {/* Analysis: nine persisted steps (crawl → action_plan) per run. */}
    </div>
  );
}
