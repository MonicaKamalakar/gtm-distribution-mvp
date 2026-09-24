"""30-day Action Planner service.

Input:  prioritized opportunities (with priority scores)
Output: a weekly plan for the next 30 days:

    {"weeks": [
        {"week": 1, "actions": [
            {"title": "", "why": "", "effort": "", "expected_outcome": ""}
        ]},
        ... Week 1 through Week 4 ...
    ]}

`effort` is a rough time estimate (e.g. "~3 hours").
Uses the configured LLM provider (see llm.py).
"""

import json
from typing import Any

from llm import LLM_MODEL, chat_json, LLMError

PROMPT_VERSION = "action-plan-v1"

WEEK_COUNT = 4
MAX_ACTIONS_PER_WEEK = 3

SYSTEM_PROMPT = (
    "You are a fractional head of growth. You turn a prioritized list of "
    "opportunities into a realistic 30-day execution plan: concrete weekly "
    "actions the team can complete in sequence. Respond with a single JSON "
    "object and nothing else."
)

USER_PROMPT_TEMPLATE = """Prioritized opportunities (highest priority first):
{opportunities_json}

Return a JSON object with EXACTLY this shape:

{{
  "weeks": [
    {{
      "week": 1,
      "actions": [
        {{
          "title": "short action title",
          "why": "why this matters now, one sentence",
          "effort": "rough time estimate, e.g. '~3 hours'",
          "expected_outcome": "the tangible result of doing this, one sentence"
        }}
      ]
    }}
  ]
}}

Rules:
- Return exactly {week_count} weeks: 1, 2, 3 and 4 — no more, no fewer.
- Each week has 1-{max_actions} actions; do not exceed {max_actions} per week.
- Week 1 must start with the highest-priority opportunity's first step.
- Each action must name or clearly reference the opportunity it serves.
- Every action needs all four fields: title, why, effort, expected_outcome.

Return only the JSON object."""

MAX_FIELD_LENGTH = 1000


class ActionPlannerError(Exception):
    """Raised when the service cannot produce a valid 30-day plan."""


def _clean_string(value: Any) -> str:
    if not isinstance(value, str):
        return str(value) if value is not None else ""
    return value.strip()[:MAX_FIELD_LENGTH]


def _clean_actions(value: Any) -> list[dict]:
    if not isinstance(value, list):
        return []
    actions = []
    seen: set[str] = set()
    for item in value[:MAX_ACTIONS_PER_WEEK]:
        if not isinstance(item, dict):
            continue
        title = _clean_string(item.get("title"))
        if not title or title.lower() in seen:
            continue
        seen.add(title.lower())
        actions.append(
            {
                "title": title,
                "why": _clean_string(item.get("why")),
                "effort": _clean_string(item.get("effort")),
                "expected_outcome": _clean_string(item.get("expected_outcome")),
            }
        )
    return actions


def create_action_plan(prioritized_opportunities: list) -> dict:
    """Create the 30-day plan; returns {"weeks": [...4 weeks...]}."""
    if not isinstance(prioritized_opportunities, list) or not prioritized_opportunities:
        raise ActionPlannerError("prioritized opportunities are required")

    try:
        prompt = USER_PROMPT_TEMPLATE.format(
            opportunities_json=json.dumps(
                prioritized_opportunities, ensure_ascii=False, indent=2
            ),
            week_count=WEEK_COUNT,
            max_actions=MAX_ACTIONS_PER_WEEK,
        )
    except (TypeError, ValueError) as exc:
        raise ActionPlannerError("inputs are not serializable") from exc

    try:
        raw = chat_json(
            SYSTEM_PROMPT, prompt, max_tokens=1800, prompt_version=PROMPT_VERSION
        )
    except LLMError as exc:
        raise ActionPlannerError(str(exc)) from exc

    raw_weeks = raw.get("weeks")
    if not isinstance(raw_weeks, list):
        raise ActionPlannerError("LLM reply did not contain a weeks list")

    by_number: dict[int, list[dict]] = {}
    for item in raw_weeks:
        if not isinstance(item, dict):
            continue
        try:
            number = int(item.get("week"))
        except (TypeError, ValueError):
            continue
        if 1 <= number <= WEEK_COUNT and number not in by_number:
            by_number[number] = _clean_actions(item.get("actions"))

    # Always return exactly Weeks 1-4, even if the LLM omitted one.
    weeks = [
        {"week": number, "actions": by_number.get(number, [])}
        for number in range(1, WEEK_COUNT + 1)
    ]
    if all(not week["actions"] for week in weeks):
        raise ActionPlannerError("LLM returned no usable actions")
    return {"weeks": weeks}


def current_model_name() -> str:
    """The configured model that will be recorded with results."""
    return LLM_MODEL
