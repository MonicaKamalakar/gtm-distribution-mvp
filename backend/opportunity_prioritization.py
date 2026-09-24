"""Opportunity prioritization.

Input:  opportunities from the Opportunity Generator
Output: the same opportunities, each augmented with urgency, a transparent
        priority score, and its score components; sorted by score descending.

The LLM supplies only `urgency` (1-5) per opportunity. The priority score is
computed deterministically in code so it is fully transparent and auditable:

    normalized = impact*20, urgency*20, confidence as-is     (all 0-100)
    base       = 0.40*impact + 0.35*urgency + 0.25*confidence
    multiplier = (6 - effort) / 5                            (effort 1 -> 1.0, 5 -> 0.2)
    priority   = round(base * multiplier)                    (0-100)

Every component (raw value, normalized value, weight, weighted contribution,
effort multiplier) is stored so the UI can show how the score was reached.
"""

from typing import Any

import json

from llm import chat_json, LLMError

PROMPT_VERSION = "prioritization-v1"

IMPACT_WEIGHT = 0.40
URGENCY_WEIGHT = 0.35
CONFIDENCE_WEIGHT = 0.25

SCALE_MIN = 1
SCALE_MAX = 5
DEFAULT_URGENCY = 3  # neutral fallback when the LLM omits an opportunity

SYSTEM_PROMPT = (
    "You are a B2B growth prioritization analyst. For each opportunity you are "
    "given, judge how urgently it needs to be acted on, given the distribution "
    "gaps it addresses. Respond with a single JSON object and nothing else."
)

USER_PROMPT_TEMPLATE = """Opportunities:
{opportunities_json}

Return a JSON object with EXACTLY this shape:

{{
  "urgencies": [
    {{"title": "<exact opportunity title>", "urgency": 0}}
  ]
}}

Rules:
- Return one entry per opportunity, using each title EXACTLY as given.
- "urgency" is an integer from {scale_min} to {scale_max}:
  {scale_max} = act now (market window closing / competitor pulling ahead),
  {scale_min} = can wait a quarter.
- Nothing besides these entries.

Return only the JSON object."""


class PrioritizationError(Exception):
    """Raised when urgency assignment or scoring cannot be completed."""


def _clean_urgency(value: Any) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return DEFAULT_URGENCY
    return max(SCALE_MIN, min(SCALE_MAX, round(number)))


def compute_priority(
    impact: int, urgency: int, confidence: int, effort: int
) -> tuple[int, dict]:
    """Deterministically score one opportunity; returns (score, components)."""
    impact = max(SCALE_MIN, min(SCALE_MAX, round(impact)))
    urgency = max(SCALE_MIN, min(SCALE_MAX, round(urgency)))
    effort = max(SCALE_MIN, min(SCALE_MIN + 4, round(effort)))
    confidence = max(0, min(100, round(confidence)))

    impact_normalized = impact * 20
    urgency_normalized = urgency * 20

    impact_weighted = round(impact_normalized * IMPACT_WEIGHT, 2)
    urgency_weighted = round(urgency_normalized * URGENCY_WEIGHT, 2)
    confidence_weighted = round(confidence * CONFIDENCE_WEIGHT, 2)

    base = round(impact_weighted + urgency_weighted + confidence_weighted, 2)
    multiplier = round((SCALE_MIN + 5 - effort) / 5, 2)  # (6 - effort) / 5
    score = max(0, min(100, round(base * multiplier)))

    components = {
        "formula": (
            "priority = (0.40 × impact + 0.35 × urgency + 0.25 × confidence) "
            "× effort_multiplier; impact/urgency normalized 1-5 → 20-100, "
            "effort_multiplier = (6 − effort) / 5"
        ),
        "impact": {
            "raw": impact,
            "normalized": impact_normalized,
            "weight": IMPACT_WEIGHT,
            "weighted": impact_weighted,
        },
        "urgency": {
            "raw": urgency,
            "normalized": urgency_normalized,
            "weight": URGENCY_WEIGHT,
            "weighted": urgency_weighted,
        },
        "confidence": {
            "raw": confidence,
            "normalized": confidence,
            "weight": CONFIDENCE_WEIGHT,
            "weighted": confidence_weighted,
        },
        "effort": {"raw": effort, "multiplier": multiplier},
        "base": base,
        "priority_score": score,
    }
    return score, components


def prioritize_opportunities(opportunities: list[dict]) -> list[dict]:
    """Assign urgency (LLM) and compute transparent priority scores (code).

    Returns a new list sorted by priority_score descending; each entry keeps
    its original fields plus `urgency`, `priority_score`, `score_components`.
    """
    if not isinstance(opportunities, list) or not opportunities:
        raise PrioritizationError("opportunities are required")

    prompt = USER_PROMPT_TEMPLATE.format(
        opportunities_json=json.dumps(
            [{"title": o.get("title", "")} for o in opportunities],
            ensure_ascii=False,
            indent=2,
        ),
        scale_min=SCALE_MIN,
        scale_max=SCALE_MAX,
    )
    try:
        raw = chat_json(SYSTEM_PROMPT, prompt, prompt_version=PROMPT_VERSION)
    except LLMError as exc:
        raise PrioritizationError(str(exc)) from exc

    raw_list = raw.get("urgencies")
    if not isinstance(raw_list, list):
        raise PrioritizationError("LLM reply did not contain an urgencies list")

    urgency_by_title: dict[str, int] = {}
    for item in raw_list:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip().lower()
        if title:
            urgency_by_title[title] = _clean_urgency(item.get("urgency"))

    prioritized: list[dict] = []
    for opportunity in opportunities:
        entry = dict(opportunity)
        title_key = str(entry.get("title", "")).strip().lower()
        urgency = urgency_by_title.get(title_key, DEFAULT_URGENCY)
        score, components = compute_priority(
            impact=entry.get("impact", SCALE_MIN),
            urgency=urgency,
            confidence=entry.get("confidence", 0),
            effort=entry.get("effort", SCALE_MAX),
        )
        entry["urgency"] = urgency
        entry["priority_score"] = score
        entry["score_components"] = components
        prioritized.append(entry)

    prioritized.sort(key=lambda o: o["priority_score"], reverse=True)
    return prioritized

