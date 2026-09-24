import asyncio
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from action_planner import (
    ActionPlannerError,
    create_action_plan,
)
from action_planner import current_model_name as action_plan_current_model_name
from action_planner import PROMPT_VERSION as ACTION_PLAN_PROMPT_VERSION
from buyer_question_research import (
    PROMPT_VERSION as BUYER_QUESTIONS_PROMPT_VERSION,
)
from buyer_question_research import (
    BuyerQuestionResearchError,
    research_buyer_questions,
)
from buyer_question_research import (
    current_model_name as buyer_questions_current_model_name,
)
from cache import get_website_result, save_website_result, sha256_hex
from competitor_research import (
    CompetitorResearchError,
    research_competitors,
)
from database import SessionLocal
from distribution_gap_analyzer import (
    PROMPT_VERSION as DISTRIBUTION_GAPS_PROMPT_VERSION,
)
from distribution_gap_analyzer import (
    DistributionGapError,
    analyze_distribution_gaps,
)
from distribution_gap_analyzer import (
    current_model_name as distribution_gaps_current_model_name,
)
from discovery_queries import (
    DiscoveryQueryError,
    generate_discovery_queries,
)
from evidence_excerpt import attach_missing_excerpts
from fetcher import FetchError, fetch_website
from icp_analyzer import (
    PROMPT_VERSION as ICP_PROMPT_VERSION,
)
from icp_analyzer import (
    ICPAnalyzerError,
    analyze_icp,
)
from icp_analyzer import current_model_name as icp_current_model_name
from models import (
    ActionPlan,
    AnalysisRun,
    AnalysisStep,
    BuyerQuestion,
    Competitor,
    DistributionGap,
    DiscoveryQuery,
    Feedback,
    ICPAnalysis,
    Opportunity,
    ProductAnalysis,
    Project,
    Source,
)
from opportunity_generator import (
    PROMPT_VERSION as OPPORTUNITY_PROMPT_VERSION,
)
from opportunity_generator import (
    OpportunityGeneratorError,
    generate_opportunities,
)
from opportunity_generator import (
    current_model_name as opportunity_current_model_name,
)
from opportunity_prioritization import (
    PROMPT_VERSION as PRIORITIZATION_PROMPT_VERSION,
)
from opportunity_prioritization import (
    PrioritizationError,
    prioritize_opportunities,
)
from product_analyzer import (
    PROMPT_VERSION,
    ProductAnalyzerError,
    analyze_product,
    current_model_name,
)
from rank_tracking import company_domain, evaluate_results
from search_provider import SearchProviderError, get_search_provider
from usage import set_analysis_id

app = FastAPI(title="AI Distribution Engine API")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    website_url: str = Field(min_length=1, max_length=2000)
    description: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("name")
    @classmethod
    def name_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name is required")
        return value

    @field_validator("website_url")
    @classmethod
    def website_url_must_be_http(cls, value: str) -> str:
        parsed = urlparse(value.strip())
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("website_url must be a valid HTTP/HTTPS URL")
        return value.strip()


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    website_url: str
    description: Optional[str]
    user_id: Optional[int]


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    website_url: str
    description: Optional[str]
    created_at: datetime


def _save_project(payload: ProjectCreate) -> Project:
    db = SessionLocal()
    try:
        project = Project(
            name=payload.name,
            website_url=payload.website_url,
            description=payload.description,
        )
        db.add(project)
        db.commit()
        db.refresh(project)
        return project
    finally:
        db.close()


@app.post("/projects", status_code=201)
def create_project(payload: ProjectCreate) -> ProjectOut:
    return ProjectOut.model_validate(_save_project(payload))


@app.post("/api/v1/projects", status_code=201)
def create_project_v1(payload: ProjectCreate) -> dict[str, int]:
    project = _save_project(payload)
    return {"id": project.id}


@app.get("/api/v1/projects")
def list_projects_v1() -> list[ProjectRead]:
    # TODO(auth): filter by the authenticated user once auth exists.
    db = SessionLocal()
    try:
        projects = db.query(Project).order_by(Project.created_at.desc()).all()
        return [ProjectRead.model_validate(p) for p in projects]
    finally:
        db.close()


@app.get("/api/v1/projects/{project_id}")
def get_project_v1(project_id: int) -> ProjectRead:
    db = SessionLocal()
    try:
        project = db.get(Project, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return ProjectRead.model_validate(project)
    finally:
        db.close()


class AnalysisRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    status: str
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    error: Optional[str]


class ProductAnalysisRead(BaseModel):
    analysis_id: int
    result: dict
    model: str
    prompt_version: str
    created_at: datetime


class ICPAnalysisRead(BaseModel):
    analysis_id: int
    result: dict
    model: str
    prompt_version: str
    created_at: datetime


class CompetitorRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    url: Optional[str]
    type: str
    reason_relevant: str


class BuyerQuestionsRead(BaseModel):
    analysis_id: int
    result: dict
    model: str
    prompt_version: str
    created_at: datetime


class ReportSectionRead(BaseModel):
    """A stored LLM section inside the aggregate report response."""

    result: dict
    model: str


class VisibilityRowRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    query: str
    appears: bool
    position: Optional[int]
    competitors_found: list
    timestamp: datetime


class ReportRead(BaseModel):
    project: ProjectRead
    run: AnalysisRunRead
    product: Optional[ReportSectionRead] = None
    icp: Optional[ReportSectionRead] = None
    competitors: list[CompetitorRead]
    buyer_questions: Optional[ReportSectionRead] = None
    visibility: list[VisibilityRowRead]
    distribution_gaps: Optional[ReportSectionRead] = None
    opportunities: Optional[ReportSectionRead] = None
    action_plan: Optional[ReportSectionRead] = None


def _set_run_status(
    run_id: int,
    new_status: str,
    *,
    started_at: Optional[datetime] = None,
    completed_at: Optional[datetime] = None,
    error: Optional[str] = None,
) -> bool:
    """Advance a run unless it already finished. Returns False if it was terminal."""
    db = SessionLocal()
    try:
        run = db.get(AnalysisRun, run_id)
        if run is None or run.status in ("completed", "failed"):
            return False
        run.status = new_status
        if started_at is not None:
            run.started_at = started_at
        if completed_at is not None:
            run.completed_at = completed_at
        if error is not None:
            run.error = error
        db.commit()
        return True
    finally:
        db.close()


def _save_homepage_source(analysis_id: int, fetched: dict) -> None:
    db = SessionLocal()
    try:
        run = db.get(AnalysisRun, analysis_id)
        if run is None or run.status != "running":
            return
        # Guard against duplicates if the crawl step ever re-processes.
        db.query(Source).filter(
            Source.analysis_id == analysis_id,
            Source.source_type == "homepage",
        ).delete()
        db.add(
            Source(
                analysis_id=analysis_id,
                source_type="homepage",
                url=fetched["source_url"],
                title=fetched["title"] or None,
                retrieved_at=datetime.now(timezone.utc),
            )
        )
        db.commit()
    finally:
        db.close()


# --- Step-based analysis pipeline -----------------------------------------
#
# An analysis run executes nine persisted steps in order. Each step records
# its own status (pending -> running -> completed/failed). The first failure
# records the error on that step, preserves every completed step, and stops
# the run; the failed step can then be retried on its own without rerunning
# the rest of the analysis.

STEP_ORDER = (
    "crawl",
    "product",
    "icp",
    "competitors",
    "buyer_questions",
    "visibility",
    "gaps",
    "opportunities",
    "action_plan",
)


class StepError(Exception):
    """A pipeline step failed; the message is recorded on the step and run."""


def _init_steps(analysis_id: int) -> None:
    db = SessionLocal()
    try:
        for step in STEP_ORDER:
            db.add(AnalysisStep(analysis_id=analysis_id, step=step, status="pending"))
        db.commit()
    finally:
        db.close()


def _set_step_status(
    analysis_id: int, step: str, status: str, error: Optional[str] = None
) -> None:
    db = SessionLocal()
    try:
        row = (
            db.query(AnalysisStep)
            .filter(AnalysisStep.analysis_id == analysis_id, AnalysisStep.step == step)
            .first()
        )
        if row is None:
            return
        row.status = status
        row.error = error
        if status == "running":
            row.started_at = datetime.now(timezone.utc)
            row.completed_at = None
        elif status in ("completed", "failed"):
            row.completed_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()


def _reset_step_for_retry(analysis_id: int, step: str) -> bool:
    """Put a failed step back to pending so only it (and what follows) reruns."""
    db = SessionLocal()
    try:
        row = (
            db.query(AnalysisStep)
            .filter(AnalysisStep.analysis_id == analysis_id, AnalysisStep.step == step)
            .first()
        )
        if row is None or row.status != "failed":
            return False
        row.status = "pending"
        row.error = None
        row.started_at = None
        row.completed_at = None
        db.commit()
        return True
    finally:
        db.close()


def _reopen_run_for_retry(analysis_id: int) -> bool:
    """failed -> running so a single step can continue this run."""
    db = SessionLocal()
    try:
        run = db.get(AnalysisRun, analysis_id)
        if run is None or run.status != "failed":
            return False
        run.status = "running"
        run.error = None
        run.completed_at = None
        db.commit()
        return True
    finally:
        db.close()


def _fail_step(analysis_id: int, step: str, message: str) -> None:
    """Record the step failure and stop the run, preserving completed steps."""
    _set_step_status(analysis_id, step, "failed", message)
    _set_run_status(
        analysis_id,
        "failed",
        completed_at=datetime.now(timezone.utc),
        error=message,
    )


def _replace_single(analysis_id: int, model_cls, make_row) -> None:
    """Replace the run's row for a one-row-per-run result table."""
    db = SessionLocal()
    try:
        db.query(model_cls).filter(model_cls.analysis_id == analysis_id).delete()
        db.add(make_row())
        db.commit()
    finally:
        db.close()


def _replace_many(analysis_id: int, model_cls, rows: list) -> None:
    """Replace all of the run's rows for a multi-row result table."""
    db = SessionLocal()
    try:
        db.query(model_cls).filter(model_cls.analysis_id == analysis_id).delete()
        for row in rows:
            db.add(row)
        db.commit()
    finally:
        db.close()


def _hydrate(run_id: int, website_url: str) -> dict:
    """Reload completed-step outputs from storage so a retry can resume."""
    ctx: dict = {"website_url": website_url}
    db = SessionLocal()
    try:
        # Crawl output is only reused when the crawl step completed; a fresh
        # run must actually fetch the page to check its content hash.
        crawl_row = (
            db.query(AnalysisStep)
            .filter(
                AnalysisStep.analysis_id == run_id, AnalysisStep.step == "crawl"
            )
            .first()
        )
        if crawl_row is not None and crawl_row.status == "completed":
            cached = get_website_result(website_url)
            if cached is not None:
                ctx["fetched"] = {
                    "title": cached.get("title") or "",
                    "text": cached.get("text") or "",
                    "source_url": cached.get("final_url") or website_url,
                }
        row = (
            db.query(ProductAnalysis)
            .filter(ProductAnalysis.analysis_id == run_id)
            .first()
        )
        if row is not None:
            ctx["product"] = row.result_json
        row = db.query(ICPAnalysis).filter(ICPAnalysis.analysis_id == run_id).first()
        if row is not None:
            ctx["icp"] = row.result_json
        comp_rows = (
            db.query(Competitor)
            .filter(Competitor.analysis_id == run_id)
            .order_by(Competitor.id.asc())
            .all()
        )
        if comp_rows:
            ctx["competitors"] = [
                {
                    "name": c.name,
                    "url": c.url or "",
                    "type": c.type,
                    "reason_relevant": c.reason_relevant,
                }
                for c in comp_rows
            ]
        row = (
            db.query(BuyerQuestion)
            .filter(BuyerQuestion.analysis_id == run_id)
            .first()
        )
        if row is not None:
            ctx["questions"] = row.result_json.get("questions", [])
        dq_rows = (
            db.query(DiscoveryQuery)
            .filter(DiscoveryQuery.analysis_id == run_id)
            .order_by(DiscoveryQuery.id.asc())
            .all()
        )
        if dq_rows:
            ctx["tracking"] = [
                {
                    "query": d.query,
                    "appears": d.appears,
                    "position": d.position,
                    "competitors_found": d.competitors_found,
                }
                for d in dq_rows
            ]
        row = (
            db.query(DistributionGap)
            .filter(DistributionGap.analysis_id == run_id)
            .first()
        )
        if row is not None:
            ctx["gaps"] = row.result_json.get("gaps", [])
        row = (
            db.query(Opportunity)
            .filter(Opportunity.analysis_id == run_id)
            .first()
        )
        if row is not None:
            ctx["opportunities"] = row.result_json.get("opportunities", [])
    finally:
        db.close()
    return ctx


def _need(ctx: dict, key: str) -> Any:
    value = ctx.get(key)
    if value is None:
        raise StepError(
            f"Missing '{key}' output — an earlier step did not complete; "
            "retry that step first"
        )
    return value


async def _ensure_fetched(run_id: int, ctx: dict) -> dict:
    """Crawl output: fetch the page, reuse the cached result when unchanged."""
    if ctx.get("fetched") is not None:
        return ctx["fetched"]

    website_url = ctx["website_url"]
    try:
        fetched = await asyncio.to_thread(fetch_website, website_url)
    except (ValueError, FetchError) as exc:
        raise StepError(str(exc)) from exc

    content_hash = sha256_hex(fetched["text"])
    cached = get_website_result(website_url)
    if cached is not None and cached.get("content_hash") == content_hash:
        # Content unchanged — reuse the stored research result.
        fetched = {
            "title": cached.get("title") or fetched["title"],
            "text": cached.get("text") or fetched["text"],
            "source_url": cached.get("final_url") or fetched["source_url"],
        }
    else:
        try:
            save_website_result(
                website_url,
                content_hash,
                fetched["title"],
                fetched["text"],
                fetched["source_url"],
            )
        except Exception as exc:  # caching must never fail the step
            print(f"[cache] could not store website research: {exc}")

    ctx["fetched"] = fetched
    return fetched


async def _step_crawl(run_id: int, ctx: dict) -> None:
    fetched = await _ensure_fetched(run_id, ctx)
    _save_homepage_source(run_id, fetched)


async def _step_product(run_id: int, ctx: dict) -> None:
    fetched = await _ensure_fetched(run_id, ctx)
    try:
        result = await asyncio.to_thread(analyze_product, fetched["text"])
    except ProductAnalyzerError as exc:
        raise StepError(f"Product analysis failed: {exc}") from exc
    _replace_single(
        run_id,
        ProductAnalysis,
        lambda: ProductAnalysis(
            analysis_id=run_id,
            result_json=result,
            model=current_model_name(),
            prompt_version=PROMPT_VERSION,
        ),
    )
    ctx["product"] = result


async def _step_icp(run_id: int, ctx: dict) -> None:
    product = _need(ctx, "product")
    try:
        icp_result = await asyncio.to_thread(analyze_icp, product)
    except ICPAnalyzerError as exc:
        raise StepError(f"ICP analysis failed: {exc}") from exc
    _replace_single(
        run_id,
        ICPAnalysis,
        lambda: ICPAnalysis(
            analysis_id=run_id,
            result_json=icp_result,
            model=icp_current_model_name(),
            prompt_version=ICP_PROMPT_VERSION,
        ),
    )
    ctx["icp"] = icp_result


async def _step_competitors(run_id: int, ctx: dict) -> None:
    product = _need(ctx, "product")
    icp = _need(ctx, "icp")
    try:
        competitors = await asyncio.to_thread(
            research_competitors, product.get("product_summary", ""), icp
        )
    except CompetitorResearchError as exc:
        raise StepError(f"Competitor research failed: {exc}") from exc
    _replace_many(
        run_id,
        Competitor,
        [
            Competitor(
                analysis_id=run_id,
                name=comp["name"],
                url=comp["url"] or None,
                type=comp["type"] or "Alternative",
                reason_relevant=comp["reason_relevant"],
            )
            for comp in competitors
        ],
    )
    ctx["competitors"] = competitors


async def _step_buyer_questions(run_id: int, ctx: dict) -> None:
    product = _need(ctx, "product")
    icp = _need(ctx, "icp")
    competitors = _need(ctx, "competitors")
    try:
        questions = await asyncio.to_thread(
            research_buyer_questions, product, icp, competitors
        )
    except BuyerQuestionResearchError as exc:
        raise StepError(f"Buyer question research failed: {exc}") from exc
    # Capture a real supporting excerpt for any evidence lacking one —
    # from the retrieved source, or an explicit null when unavailable.
    await asyncio.to_thread(attach_missing_excerpts, questions)
    _replace_single(
        run_id,
        BuyerQuestion,
        lambda: BuyerQuestion(
            analysis_id=run_id,
            result_json={"questions": questions},
            model=buyer_questions_current_model_name(),
            prompt_version=BUYER_QUESTIONS_PROMPT_VERSION,
        ),
    )
    ctx["questions"] = questions


async def _step_visibility(run_id: int, ctx: dict) -> None:
    product = _need(ctx, "product")
    icp = _need(ctx, "icp")
    questions = _need(ctx, "questions")
    competitors = _need(ctx, "competitors")

    # Discovery queries from ICP + buyer questions + product.
    try:
        queries = await asyncio.to_thread(
            generate_discovery_queries, icp, questions, product
        )
    except DiscoveryQueryError as exc:
        raise StepError(f"Discovery query generation failed: {exc}") from exc

    db = SessionLocal()
    try:
        run = db.get(AnalysisRun, run_id)
        project = db.get(Project, run.project_id) if run else None
        submitted_domain = company_domain(project.website_url) if project else ""
    finally:
        db.close()

    # Search each query and track whether the submitted company appears.
    provider = get_search_provider()
    tracking_records: list[dict] = []
    for item in queries:
        try:
            search_results = await asyncio.to_thread(provider.search, item["query"])
        except SearchProviderError as exc:
            raise StepError(f"Search failed: {exc}") from exc
        tracking_records.append(
            evaluate_results(item["query"], search_results, submitted_domain, competitors)
        )

    _replace_many(
        run_id,
        DiscoveryQuery,
        [
            DiscoveryQuery(
                analysis_id=run_id,
                query=record["query"],
                appears=record["appears"],
                position=record["position"],
                competitors_found=record["competitors_found"],
            )
            for record in tracking_records
        ],
    )
    ctx["tracking"] = tracking_records


async def _step_gaps(run_id: int, ctx: dict) -> None:
    product = _need(ctx, "product")
    icp = _need(ctx, "icp")
    competitors = _need(ctx, "competitors")
    questions = _need(ctx, "questions")
    tracking = _need(ctx, "tracking")
    try:
        gaps = await asyncio.to_thread(
            analyze_distribution_gaps, product, icp, competitors, questions, tracking
        )
    except DistributionGapError as exc:
        raise StepError(f"Distribution gap analysis failed: {exc}") from exc
    # Same shared capture as Buyer Questions: excerpt from the retrieved
    # source when available, explicit null otherwise. Existing excerpts
    # (from this result) are left untouched.
    await asyncio.to_thread(attach_missing_excerpts, gaps)
    _replace_single(
        run_id,
        DistributionGap,
        lambda: DistributionGap(
            analysis_id=run_id,
            result_json={"gaps": gaps},
            model=distribution_gaps_current_model_name(),
            prompt_version=DISTRIBUTION_GAPS_PROMPT_VERSION,
        ),
    )
    ctx["gaps"] = gaps


async def _step_opportunities(run_id: int, ctx: dict) -> None:
    gaps = _need(ctx, "gaps")
    try:
        opportunities = await asyncio.to_thread(generate_opportunities, gaps)
    except OpportunityGeneratorError as exc:
        raise StepError(f"Opportunity generation failed: {exc}") from exc

    # Prioritization: LLM urgency + deterministic transparent priority score.
    try:
        prioritized = await asyncio.to_thread(
            prioritize_opportunities, opportunities
        )
    except PrioritizationError as exc:
        raise StepError(f"Opportunity prioritization failed: {exc}") from exc

    _replace_single(
        run_id,
        Opportunity,
        lambda: Opportunity(
            analysis_id=run_id,
            result_json={"opportunities": prioritized},
            model=opportunity_current_model_name(),
            prompt_version=(
                f"{OPPORTUNITY_PROMPT_VERSION}+{PRIORITIZATION_PROMPT_VERSION}"
            ),
        ),
    )
    ctx["opportunities"] = prioritized


async def _step_action_plan(run_id: int, ctx: dict) -> None:
    prioritized = _need(ctx, "opportunities")
    try:
        plan = await asyncio.to_thread(create_action_plan, prioritized)
    except ActionPlannerError as exc:
        raise StepError(f"Action planning failed: {exc}") from exc
    _replace_single(
        run_id,
        ActionPlan,
        lambda: ActionPlan(
            analysis_id=run_id,
            result_json=plan,
            model=action_plan_current_model_name(),
            prompt_version=ACTION_PLAN_PROMPT_VERSION,
        ),
    )
    ctx["plan"] = plan


STEP_HANDLERS = {
    "crawl": _step_crawl,
    "product": _step_product,
    "icp": _step_icp,
    "competitors": _step_competitors,
    "buyer_questions": _step_buyer_questions,
    "visibility": _step_visibility,
    "gaps": _step_gaps,
    "opportunities": _step_opportunities,
    "action_plan": _step_action_plan,
}


async def _run_pipeline(run_id: int, start_index: int = 0) -> None:
    """Run the analysis steps in order, starting at `start_index`.

    Fresh runs start at crawl. A retry starts at the failed step only:
    completed steps stay untouched, their outputs are rehydrated from the
    database, and the first new failure stops again with the error recorded.
    """
    if start_index == 0:
        await asyncio.sleep(1.5)
        if not _set_run_status(
            run_id, "running", started_at=datetime.now(timezone.utc)
        ):
            return

    # Attribute every model call in this run to its usage log and budget.
    set_analysis_id(run_id)

    db = SessionLocal()
    try:
        run = db.get(AnalysisRun, run_id)
        project = db.get(Project, run.project_id) if run else None
        website_url = project.website_url if project else None
    finally:
        db.close()

    if website_url is None:
        _set_run_status(
            run_id,
            "failed",
            completed_at=datetime.now(timezone.utc),
            error="Project or website URL not found",
        )
        return

    ctx = _hydrate(run_id, website_url)

    for index in range(start_index, len(STEP_ORDER)):
        step = STEP_ORDER[index]
        _set_step_status(run_id, step, "running")
        try:
            await STEP_HANDLERS[step](run_id, ctx)
        except StepError as exc:
            _fail_step(run_id, step, str(exc))
            return
        except Exception as exc:  # unexpected — still fail gracefully
            _fail_step(run_id, step, str(exc))
            return
        _set_step_status(run_id, step, "completed")

    await asyncio.sleep(1.5)
    _set_run_status(run_id, "completed", completed_at=datetime.now(timezone.utc))


@app.post("/api/v1/projects/{project_id}/analysis", status_code=201)
async def create_analysis_v1(project_id: int) -> dict[str, int]:
    """Queue an analysis run: nine persisted steps, executed in order."""
    db = SessionLocal()
    try:
        if db.get(Project, project_id) is None:
            raise HTTPException(status_code=404, detail="Project not found")
        run = AnalysisRun(project_id=project_id, status="queued")
        db.add(run)
        db.commit()
        db.refresh(run)
        run_id = run.id
    finally:
        db.close()

    _init_steps(run_id)
    asyncio.create_task(_run_pipeline(run_id))
    return {"id": run_id}


@app.get("/api/v1/projects/{project_id}/analysis")
def list_analysis_v1(project_id: int) -> list[AnalysisRunRead]:
    """Analysis runs for a project, newest first (latest run = first item)."""
    db = SessionLocal()
    try:
        if db.get(Project, project_id) is None:
            raise HTTPException(status_code=404, detail="Project not found")
        runs = (
            db.query(AnalysisRun)
            .filter(AnalysisRun.project_id == project_id)
            .order_by(AnalysisRun.id.desc())
            .all()
        )
        return [AnalysisRunRead.model_validate(r) for r in runs]
    finally:
        db.close()


@app.get("/api/v1/projects/{project_id}/analysis/{run_id}")
def get_analysis_v1(project_id: int, run_id: int) -> AnalysisRunRead:
    db = SessionLocal()
    try:
        run = db.get(AnalysisRun, run_id)
        if run is None or run.project_id != project_id:
            raise HTTPException(status_code=404, detail="Analysis run not found")
        return AnalysisRunRead.model_validate(run)
    finally:
        db.close()


class AnalysisStepRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    step: str
    status: str
    error: Optional[str]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]


@app.get("/api/v1/projects/{project_id}/analysis/{run_id}/steps")
def get_analysis_steps_v1(
    project_id: int, run_id: int
) -> list[AnalysisStepRead]:
    """Persisted per-step status for one run, in pipeline order."""
    db = SessionLocal()
    try:
        run = db.get(AnalysisRun, run_id)
        if run is None or run.project_id != project_id:
            raise HTTPException(status_code=404, detail="Analysis run not found")
        rows = (
            db.query(AnalysisStep)
            .filter(AnalysisStep.analysis_id == run_id)
            .all()
        )
        by_step = {row.step: row for row in rows}
        ordered = [by_step[s] for s in STEP_ORDER if s in by_step]
        return [AnalysisStepRead.model_validate(row) for row in ordered]
    finally:
        db.close()


@app.post("/api/v1/projects/{project_id}/analysis/{run_id}/steps/{step}/retry")
async def retry_analysis_step_v1(
    project_id: int, run_id: int, step: str
) -> dict[str, str]:
    """Retry only the failed step; completed steps are preserved untouched."""
    if step not in STEP_ORDER:
        raise HTTPException(status_code=404, detail=f"Unknown step '{step}'")

    db = SessionLocal()
    try:
        run = db.get(AnalysisRun, run_id)
        if run is None or run.project_id != project_id:
            raise HTTPException(status_code=404, detail="Analysis run not found")
        step_row = (
            db.query(AnalysisStep)
            .filter(AnalysisStep.analysis_id == run_id, AnalysisStep.step == step)
            .first()
        )
        if step_row is None:
            raise HTTPException(
                status_code=404, detail="Step not found for this analysis run"
            )
        if step_row.status != "failed":
            raise HTTPException(
                status_code=400,
                detail=f"Only a failed step can be retried — '{step}' is "
                f"{step_row.status}",
            )
        if run.status in ("queued", "running"):
            raise HTTPException(
                status_code=400, detail="This analysis is already running"
            )
    finally:
        db.close()

    if not _reset_step_for_retry(run_id, step) or not _reopen_run_for_retry(run_id):
        raise HTTPException(
            status_code=400, detail="This analysis is not in a retryable state"
        )

    asyncio.create_task(_run_pipeline(run_id, STEP_ORDER.index(step)))
    return {"step": step, "status": "running"}


@app.get("/api/v1/projects/{project_id}/product-analysis")
def get_product_analysis_v1(project_id: int) -> ProductAnalysisRead:
    """Latest Product Analyzer result for a project (for the report section)."""
    db = SessionLocal()
    try:
        if db.get(Project, project_id) is None:
            raise HTTPException(status_code=404, detail="Project not found")
        row = (
            db.query(ProductAnalysis)
            .join(AnalysisRun, ProductAnalysis.analysis_id == AnalysisRun.id)
            .filter(AnalysisRun.project_id == project_id)
            .order_by(ProductAnalysis.created_at.desc())
            .first()
        )
        if row is None:
            raise HTTPException(
                status_code=404, detail="No product analysis for this project"
            )
        return ProductAnalysisRead(
            analysis_id=row.analysis_id,
            result=row.result_json,
            model=row.model,
            prompt_version=row.prompt_version,
            created_at=row.created_at,
        )
    finally:
        db.close()


@app.get("/api/v1/projects/{project_id}/icp-analysis")
def get_icp_analysis_v1(project_id: int) -> ICPAnalysisRead:
    """Latest ICP Analyzer result for a project (for the report section)."""
    db = SessionLocal()
    try:
        if db.get(Project, project_id) is None:
            raise HTTPException(status_code=404, detail="Project not found")
        row = (
            db.query(ICPAnalysis)
            .join(AnalysisRun, ICPAnalysis.analysis_id == AnalysisRun.id)
            .filter(AnalysisRun.project_id == project_id)
            .order_by(ICPAnalysis.created_at.desc())
            .first()
        )
        if row is None:
            raise HTTPException(
                status_code=404, detail="No ICP analysis for this project"
            )
        return ICPAnalysisRead(
            analysis_id=row.analysis_id,
            result=row.result_json,
            model=row.model,
            prompt_version=row.prompt_version,
            created_at=row.created_at,
        )
    finally:
        db.close()


@app.get("/api/v1/projects/{project_id}/competitors")
def get_competitors_v1(project_id: int) -> list[CompetitorRead]:
    """Competitors from the project's latest analysis run (report section)."""
    db = SessionLocal()
    try:
        if db.get(Project, project_id) is None:
            raise HTTPException(status_code=404, detail="Project not found")
        latest_run = (
            db.query(AnalysisRun)
            .filter(AnalysisRun.project_id == project_id)
            .order_by(AnalysisRun.id.desc())
            .first()
        )
        if latest_run is None:
            return []
        rows = (
            db.query(Competitor)
            .filter(Competitor.analysis_id == latest_run.id)
            .order_by(Competitor.id.asc())
            .all()
        )
        return [CompetitorRead.model_validate(r) for r in rows]
    finally:
        db.close()


@app.get("/api/v1/projects/{project_id}/buyer-questions")
def get_buyer_questions_v1(project_id: int) -> BuyerQuestionsRead:
    """Latest Buyer Question Research result for a project (report section)."""
    db = SessionLocal()
    try:
        if db.get(Project, project_id) is None:
            raise HTTPException(status_code=404, detail="Project not found")
        row = (
            db.query(BuyerQuestion)
            .join(AnalysisRun, BuyerQuestion.analysis_id == AnalysisRun.id)
            .filter(AnalysisRun.project_id == project_id)
            .order_by(BuyerQuestion.created_at.desc())
            .first()
        )
        if row is None:
            raise HTTPException(
                status_code=404, detail="No buyer questions for this project"
            )
        return BuyerQuestionsRead(
            analysis_id=row.analysis_id,
            result=row.result_json,
            model=row.model,
            prompt_version=row.prompt_version,
            created_at=row.created_at,
        )
    finally:
        db.close()


@app.get("/api/v1/projects/{project_id}/report")
def get_report_v1(project_id: int) -> ReportRead:
    """Latest completed analysis for a project, assembled for the report page."""
    db = SessionLocal()
    try:
        project = db.get(Project, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        run = (
            db.query(AnalysisRun)
            .filter(
                AnalysisRun.project_id == project_id,
                AnalysisRun.status == "completed",
            )
            .order_by(AnalysisRun.id.desc())
            .first()
        )
        if run is None:
            raise HTTPException(
                status_code=404, detail="No completed analysis for this project"
            )

        def section(model_cls) -> Optional[ReportSectionRead]:
            row = (
                db.query(model_cls)
                .filter(model_cls.analysis_id == run.id)
                .first()
            )
            if row is None:
                return None
            return ReportSectionRead(result=row.result_json, model=row.model)

        competitors = (
            db.query(Competitor)
            .filter(Competitor.analysis_id == run.id)
            .order_by(Competitor.id.asc())
            .all()
        )
        visibility = (
            db.query(DiscoveryQuery)
            .filter(DiscoveryQuery.analysis_id == run.id)
            .order_by(DiscoveryQuery.id.asc())
            .all()
        )

        return ReportRead(
            project=ProjectRead.model_validate(project),
            run=AnalysisRunRead.model_validate(run),
            product=section(ProductAnalysis),
            icp=section(ICPAnalysis),
            competitors=[CompetitorRead.model_validate(c) for c in competitors],
            buyer_questions=section(BuyerQuestion),
            visibility=[
                VisibilityRowRead(
                    query=v.query,
                    appears=v.appears,
                    position=v.position,
                    competitors_found=v.competitors_found,
                    timestamp=v.created_at,
                )
                for v in visibility
            ],
            distribution_gaps=section(DistributionGap),
            opportunities=section(Opportunity),
            action_plan=section(ActionPlan),
        )
    finally:
        db.close()


class FeedbackCreate(BaseModel):
    project_id: int
    entity_type: str = Field(min_length=1, max_length=50)
    entity_ref: str = Field(min_length=1, max_length=500)
    value: str = Field(min_length=1, max_length=50)

    @field_validator("entity_type")
    @classmethod
    def entity_type_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("entity_type is required")
        return value

    @field_validator("entity_ref")
    @classmethod
    def entity_ref_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("entity_ref is required")
        return value

    @field_validator("value")
    @classmethod
    def value_must_be_known(cls, value: str) -> str:
        value = value.strip()
        if value not in ("useful", "not_useful", "incorrect"):
            raise ValueError("value must be one of: useful, not_useful, incorrect")
        return value


@app.post("/api/v1/feedback", status_code=201)
def create_feedback_v1(payload: FeedbackCreate) -> dict[str, int]:
    """Save feedback: useful/not_useful on opportunities, incorrect on insights."""
    db = SessionLocal()
    try:
        if db.get(Project, payload.project_id) is None:
            raise HTTPException(status_code=404, detail="Project not found")
        row = Feedback(
            project_id=payload.project_id,
            entity_type=payload.entity_type,
            entity_ref=payload.entity_ref,
            value=payload.value,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return {"id": row.id}
    finally:
        db.close()
