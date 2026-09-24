"""AI usage logging, configurable model pricing, and the analysis cost budget.

Every model call is recorded with: model, prompt_tokens, output_tokens,
total_tokens, duration (seconds), timestamp — plus input_cost, output_cost
and total_cost computed from configurable per-model pricing.

Pricing is USD per 1,000,000 tokens. Defaults cover the configured model;
override or extend with the LLM_PRICING_JSON env var, e.g.:

    LLM_PRICING_JSON='{"openai/gpt-4o-mini": {"input": 0.15, "output": 0.60}}'

Before each AI call the remaining per-analysis budget is checked
(ANALYSIS_BUDGET_USD env, default 1.0). When it is exhausted the call is
refused with BudgetExceededError so the analysis stops gracefully — nothing
ever retries a budget failure.
"""

import json
import os
from contextvars import ContextVar
from typing import Optional

from sqlalchemy import func

from database import SessionLocal
from models import AiUsage

DEFAULT_BUDGET_USD = 1.0

# USD per 1M tokens for known models (extended/overridden by LLM_PRICING_JSON).
DEFAULT_PRICING = {
    "openai/gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
}

# The analysis run the current task belongs to (None for direct calls).
_analysis_id: ContextVar[Optional[int]] = ContextVar("analysis_id", default=None)


class BudgetExceededError(Exception):
    """Raised before an AI call when the analysis budget is exhausted."""


def set_analysis_id(value: Optional[int]) -> None:
    """Attribute subsequent model calls (and their cost) to this analysis run."""
    _analysis_id.set(value)


def get_analysis_id() -> Optional[int]:
    return _analysis_id.get()


def analysis_budget_usd() -> float:
    """Configured per-analysis budget in USD (ANALYSIS_BUDGET_USD env)."""
    raw = os.environ.get("ANALYSIS_BUDGET_USD", "")
    if not raw.strip():
        return DEFAULT_BUDGET_USD
    try:
        return max(0.0, float(raw))
    except ValueError:
        return DEFAULT_BUDGET_USD


def model_pricing(model: str) -> dict:
    """Per-model input/output prices (USD per 1M tokens), configurable at runtime."""
    pricing = dict(DEFAULT_PRICING)
    raw = os.environ.get("LLM_PRICING_JSON", "")
    if raw.strip():
        try:
            loaded = json.loads(raw)
        except ValueError:
            loaded = None
        if isinstance(loaded, dict):
            for name, prices in loaded.items():
                if isinstance(prices, dict):
                    try:
                        pricing[str(name)] = {
                            "input": float(prices.get("input", 0.0)),
                            "output": float(prices.get("output", 0.0)),
                        }
                    except (TypeError, ValueError):
                        continue
    prices = pricing.get(model)
    if not isinstance(prices, dict):
        return {"input": 0.0, "output": 0.0}
    return prices


def compute_costs(
    model: str, prompt_tokens: int, output_tokens: int
) -> tuple:
    """(input_cost, output_cost, total_cost) in USD for one model call."""
    prices = model_pricing(model)
    input_cost = prompt_tokens / 1_000_000 * float(prices.get("input", 0.0))
    output_cost = output_tokens / 1_000_000 * float(prices.get("output", 0.0))
    return input_cost, output_cost, input_cost + output_cost


def analysis_spend(analysis_id: int) -> float:
    """Total cost (USD) recorded so far for one analysis run."""
    db = SessionLocal()
    try:
        total = (
            db.query(func.coalesce(func.sum(AiUsage.total_cost), 0.0))
            .filter(AiUsage.analysis_id == analysis_id)
            .scalar()
        )
        return float(total or 0.0)
    finally:
        db.close()


def check_budget() -> None:
    """Refuse the next AI call if this analysis has used up its budget.

    Calls outside an analysis run (no analysis id set) are never blocked.
    """
    analysis_id = get_analysis_id()
    if analysis_id is None:
        return
    budget = analysis_budget_usd()
    spend = analysis_spend(analysis_id)
    if spend >= budget:
        raise BudgetExceededError(
            f"Analysis budget exceeded: ${spend:.4f} of ${budget:.4f} used — "
            "stopping this analysis (no more AI calls will be made)"
        )


def log_usage(
    model: str,
    prompt_tokens: int,
    output_tokens: int,
    total_tokens: int,
    duration: float,
) -> None:
    """Record one model call with its tokens, duration, timestamp, and cost."""
    input_cost, output_cost, total_cost = compute_costs(
        model, prompt_tokens, output_tokens
    )
    db = SessionLocal()
    try:
        db.add(
            AiUsage(
                analysis_id=get_analysis_id(),
                model=model,
                prompt_tokens=prompt_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                duration=duration,
                input_cost=input_cost,
                output_cost=output_cost,
                total_cost=total_cost,
            )
        )
        db.commit()
    finally:
        db.close()
