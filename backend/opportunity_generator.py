"""Opportunity Generator service.

Input:  distribution gaps
Output: up to 5 opportunities:

    [
        {
            "title": "",
            "problem": "",
            "recommended_action": "",
            "impact": 1-5,
            "effort": 1-5,
            "confidence": 0-100
        }
    ]

Uses the configured LLM provider (see llm.py). Prioritization (urgency,
priority score) is applied separately — see opportunity_prioritization.py.
"""

import json
from typing import Any

from llm import LLM_MODEL, chat_json, LLMError

PROMPT_VERSION = "opportunities-v1"

MAX_OPPORTUNITIES = 5
SCALE_MIN = 1
SCALE_MAX = 5

SYSTEM_PROMPT = (
    "You are a B2B growth strategist. Given a set of distribution gaps, you "
    "propose concrete opportunities to close them. Respond with a single JSON "
    "object containing structured opportunities and nothing else."
)

USER_PROMPT_TEMPLATE = """Distribution gaps:
{gaps_json}

Return a JSON object with EXACTLY this shape:

{{
  "opportunities": [
    {{
      "title": "short opportunity title",
      "problem": "the problem this opportunity addresses, 1-2 sentences",
      "recommended_action": "the concrete action to take, 1-2 sentences",
      "impact": 0,
      "effort": 0,
      "confidence": 0
    }}
  ]
}}

Rules:
- Return AT MOST {max_opportunities} opportunities, strongest first.
- "impact" and "effort" are integers from {scale_min} to {scale_max}.
  impact: expected business effect if done well ({scale_min}=minor, {scale_max}=major).
  effort: how much work it takes ({scale_min}=small, {scale_max}=large).
- "confidence" is an integer 0-100: how sure you are this closes a real gap.
- Every opportunity must directly address at least one input gap.
- Return {{"opportunities": []}} if nothing fits.

Return only the JSON object."""

MAX_FIELD_LENGTH = 2000


class OpportunityGeneratorError(Exception):
    """Raised when the service cannot produce valid opportunities."""


def _clean_string(value: Any) -> str:
    if not isinstance(value, str):
        return str(value) if value is not None else ""
    return value.strip()[:MAX_FIELD_LENGTH]


def _clean_scale(value: Any) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return SCALE_MIN
    return max(SCALE_MIN, min(SCALE_MAX, round(number)))


def _clean_confidence(value: Any) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    if 0 <= number <= 1:
        number *= 100
    return max(0, min(100, round(number)))


def generate_opportunities(gaps: list) -> list[dict]:
    """Generate opportunities from distribution gaps (0-5 entries)."""
    if not isinstance(gaps, list) or not gaps:
        raise OpportunityGeneratorError("distribution gaps are required")

    try:
        prompt = USER_PROMPT_TEMPLATE.format(
            gaps_json=json.dumps(gaps, ensure_ascii=False, indent=2),
            max_opportunities=MAX_OPPORTUNITIES,
            scale_min=SCALE_MIN,
            scale_max=SCALE_MAX,
        )
    except (TypeError, ValueError) as exc:
        raise OpportunityGeneratorError("inputs are not serializable") from exc

    try:
        raw = chat_json(SYSTEM_PROMPT, prompt, prompt_version=PROMPT_VERSION)
    except LLMError as exc:
        raise OpportunityGeneratorError(str(exc)) from exc

    raw_list = raw.get("opportunities")
    if not isinstance(raw_list, list):
        raise OpportunityGeneratorError("LLM reply did not contain an opportunities list")

    results: list[dict] = []
    seen: set[str] = set()
    for item in raw_list[:MAX_OPPORTUNITIES]:
        if not isinstance(item, dict):
            continue
        title = _clean_string(item.get("title"))
        if not title or title.lower() in seen:
            continue
        seen.add(title.lower())
        results.append(
            {
                "title": title,
                "problem": _clean_string(item.get("problem")),
                "recommended_action": _clean_string(item.get("recommended_action")),
                "impact": _clean_scale(item.get("impact")),
                "effort": _clean_scale(item.get("effort")),
                "confidence": _clean_confidence(item.get("confidence")),
            }
        )

    if not results:
        raise OpportunityGeneratorError("LLM returned no usable opportunities")
    return results


def current_model_name() -> str:
    """The configured model that will be recorded with results."""
    return LLM_MODEL
