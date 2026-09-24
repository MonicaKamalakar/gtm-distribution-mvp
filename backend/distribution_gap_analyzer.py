"""Distribution Gap Analyzer service.

Input:  product, ICP, competitors, buyer questions, visibility results
        (visibility results = the discovery-query rank tracking records)
Output: up to 5 distribution gaps:

    [
        {
            "category": "discovery" | "positioning" | "authority" | "sales_readiness",
            "title": "",
            "description": "",
            "evidence": [
                {"source": "", "source_url": "", "retrieved_at": "",
                 "excerpt": "", "confidence": 0}
            ],
            "confidence": 0
        }
    ]

`retrieved_at` is stamped server-side when the evidence is recorded.
Uses the configured LLM provider (see llm.py).
"""

import json
from datetime import datetime, timezone
from typing import Any

from llm import LLM_MODEL, chat_json, LLMError

PROMPT_VERSION = "distribution-gaps-v1"

GAP_CATEGORIES = ("discovery", "positioning", "authority", "sales_readiness")

MAX_GAPS = 5
MAX_EVIDENCE_PER_GAP = 3

SYSTEM_PROMPT = (
    "You are a B2B distribution strategist. You identify the gaps between a "
    "product's current market visibility and where it needs to be, using the "
    "product, ICP, competitors, buyer questions, and measured search visibility "
    "as evidence. Respond with a single JSON object and nothing else."
)

USER_PROMPT_TEMPLATE = """Product analysis:
{product_json}

ICP:
{icp_json}

Competitors:
{competitors_json}

Buyer questions:
{questions_json}

Visibility results (discovery queries actually run, whether the company appeared):
{visibility_json}

Return a JSON object with EXACTLY this shape:

{{
  "gaps": [
    {{
      "category": "one of: discovery | positioning | authority | sales_readiness",
      "title": "short gap title",
      "description": "what is missing and why it matters, 2-3 sentences",
      "evidence": [
        {{
          "source": "short source name",
          "source_url": "https://example.com/page",
          "excerpt": "a short supporting excerpt or observation, max 25 words",
          "confidence": 0
        }}
      ],
      "confidence": 0
    }}
  ]
}}

Category definitions:
- discovery: buyers cannot find you when searching for solutions
- positioning: your differentiation is unclear versus competitors
- authority: missing third-party proof, comparisons, and credibility signals
- sales_readiness: materials buyers need to evaluate and champion you internally

Rules:
- Return AT MOST {max_gaps} gaps, most impactful first.
- Every gap MUST have 1-{max_evidence} evidence objects.
- "confidence" is an integer 0-100 on every gap and every evidence object.
- Base gaps on the inputs above, especially the measured visibility results.
- Do NOT invent retrieved_at — it is added automatically.
- Return {{"gaps": []}} if nothing fits.

Return only the JSON object."""

STRING_FIELDS = ("title", "description")
EVIDENCE_FIELDS = ("source", "source_url", "excerpt")
MAX_FIELD_LENGTH = 2000
MAX_EXCERPT_LENGTH = 500


class DistributionGapError(Exception):
    """Raised when the service cannot produce valid distribution gaps."""


def _clean_string(value: Any, max_length: int = MAX_FIELD_LENGTH) -> str:
    if not isinstance(value, str):
        return str(value) if value is not None else ""
    return value.strip()[:max_length]


def _clean_score(value: Any) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    if 0 <= number <= 1:
        number *= 100
    return max(0, min(100, round(number)))


def _clean_evidence(value: Any) -> list[dict]:
    if not isinstance(value, list):
        return []
    now = datetime.now(timezone.utc).isoformat()
    cleaned = []
    for item in value[:MAX_EVIDENCE_PER_GAP]:
        if not isinstance(item, dict):
            continue
        entry = {
            "source": _clean_string(item.get("source", "")),
            "source_url": _clean_string(item.get("source_url", "")),
            "excerpt": _clean_string(
                item.get("excerpt", ""), MAX_EXCERPT_LENGTH
            ),
        }
        if not entry["source"]:
            continue
        entry["retrieved_at"] = now  # stamped server-side
        entry["confidence"] = _clean_score(item.get("confidence"))
        cleaned.append(entry)
    return cleaned


def analyze_distribution_gaps(
    product: dict,
    icp: dict,
    competitors: list,
    buyer_questions: list,
    visibility_results: list,
) -> list[dict]:
    """Run the Distribution Gap Analyzer; returns a validated list (0-5 gaps)."""
    if not isinstance(product, dict) or not product:
        raise DistributionGapError("product analysis is required")
    if not isinstance(icp, dict) or not icp:
        raise DistributionGapError("ICP is required")
    if not isinstance(competitors, list):
        raise DistributionGapError("competitors must be a list")
    if not isinstance(buyer_questions, list):
        raise DistributionGapError("buyer questions must be a list")
    if not isinstance(visibility_results, list):
        raise DistributionGapError("visibility results must be a list")

    try:
        prompt = USER_PROMPT_TEMPLATE.format(
            product_json=json.dumps(product, ensure_ascii=False, indent=2),
            icp_json=json.dumps(icp, ensure_ascii=False, indent=2),
            competitors_json=json.dumps(competitors, ensure_ascii=False, indent=2),
            questions_json=json.dumps(buyer_questions, ensure_ascii=False, indent=2),
            visibility_json=json.dumps(
                visibility_results, ensure_ascii=False, indent=2
            ),
            max_gaps=MAX_GAPS,
            max_evidence=MAX_EVIDENCE_PER_GAP,
        )
    except (TypeError, ValueError) as exc:
        raise DistributionGapError("inputs are not serializable") from exc

    try:
        raw = chat_json(
            SYSTEM_PROMPT, prompt, max_tokens=1800, prompt_version=PROMPT_VERSION
        )
    except LLMError as exc:
        raise DistributionGapError(str(exc)) from exc

    raw_list = raw.get("gaps")
    if not isinstance(raw_list, list):
        raise DistributionGapError("LLM reply did not contain a gaps list")

    results: list[dict] = []
    seen: set[str] = set()
    for item in raw_list[:MAX_GAPS]:
        if not isinstance(item, dict):
            continue
        title = _clean_string(item.get("title"))
        if not title or title.lower() in seen:
            continue
        category = _clean_string(item.get("category")).lower()
        if category not in GAP_CATEGORIES:
            continue
        seen.add(title.lower())
        results.append(
            {
                "category": category,
                "title": title,
                "description": _clean_string(item.get("description")),
                "evidence": _clean_evidence(item.get("evidence")),
                "confidence": _clean_score(item.get("confidence")),
            }
        )

    return results


def current_model_name() -> str:
    """The configured model that will be recorded with results."""
    return LLM_MODEL
