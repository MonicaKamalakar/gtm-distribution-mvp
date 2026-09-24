"""ICP Analyzer service.

Input:  the Product Analyzer output (structured dict)
Output: ideal-customer-profile JSON:

    {
        "primary_icp": "",
        "buyer_role": "",
        "company_characteristics": [],
        "pain_points": [],
        "trigger_events": [],
        "exclusions": [],
        "confidence": 0          # integer 0-100
    }

Uses the configured LLM provider (see llm.py).
"""

import json
from typing import Any

from llm import LLM_MODEL, chat_json, LLMError

PROMPT_VERSION = "icp-v1"

SYSTEM_PROMPT = (
    "You are a B2B ideal-customer-profile (ICP) analyst. Given a product "
    "understanding, you identify who should buy it. Base your answer ONLY on the "
    "provided product analysis — do not invent segments the product does not "
    "serve. Respond with a single JSON object and nothing else."
)

USER_PROMPT_TEMPLATE = """Based on this product analysis:

{product_json}

Return a JSON object with EXACTLY these keys:

{{
  "primary_icp": "1-2 sentences describing the single best-fit customer profile",
  "buyer_role": "the job title/role most likely to buy, e.g. 'Head of Marketing'",
  "company_characteristics": ["4-6 short traits: size, industry, stage, stack, etc."],
  "pain_points": ["4-6 short pains this product removes"],
  "trigger_events": ["3-5 events that make this buyer look for a solution like this"],
  "exclusions": ["2-4 clearly bad-fit segments to avoid"],
  "confidence": 0
}}

Rules:
- "confidence" is an integer from 0 to 100: how confident you are in this ICP
  given only the product analysis (lower if the analysis is thin).
- Arrays must contain short strings.
- If nothing supports a field, use an empty array (or "Not stated" for strings).

Return only the JSON object."""

STRING_FIELDS = ("primary_icp", "buyer_role")
ARRAY_FIELDS = (
    "company_characteristics",
    "pain_points",
    "trigger_events",
    "exclusions",
)

MAX_FIELD_LENGTH = 2000
MAX_ARRAY_ITEMS = 10
DEFAULT_NOT_STATED = "Not stated in the product analysis"


class ICPAnalyzerError(Exception):
    """Raised when the analyzer cannot produce a valid structured result."""


def _clean_string(value: Any) -> str:
    if not isinstance(value, str):
        return str(value) if value is not None else ""
    return value.strip()[:MAX_FIELD_LENGTH]


def _clean_array(value: Any) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    items = [_clean_string(v) for v in value]
    return [i for i in items if i][:MAX_ARRAY_ITEMS]


def _clean_confidence(value: Any) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    if 0 <= number <= 1:  # tolerate 0-1 floats
        number *= 100
    return max(0, min(100, round(number)))


def analyze_icp(product_output: dict) -> dict:
    """Run the ICP Analyzer on Product Analyzer output and return validated JSON."""
    if not isinstance(product_output, dict) or not product_output:
        raise ICPAnalyzerError("product analyzer output is required")

    try:
        product_json = json.dumps(product_output, ensure_ascii=False, indent=2)
    except (TypeError, ValueError) as exc:
        raise ICPAnalyzerError("product analyzer output is not serializable") from exc

    try:
        raw = chat_json(
            SYSTEM_PROMPT,
            USER_PROMPT_TEMPLATE.format(product_json=product_json),
            prompt_version=PROMPT_VERSION,
        )
    except LLMError as exc:
        raise ICPAnalyzerError(str(exc)) from exc

    result: dict[str, Any] = {}
    for field in STRING_FIELDS:
        result[field] = _clean_string(raw.get(field, "")) or DEFAULT_NOT_STATED
    for field in ARRAY_FIELDS:
        result[field] = _clean_array(raw.get(field))
    result["confidence"] = _clean_confidence(raw.get("confidence"))

    if result["primary_icp"] == DEFAULT_NOT_STATED and not result["pain_points"]:
        raise ICPAnalyzerError("LLM returned no usable ICP information")

    return result


def current_model_name() -> str:
    """The configured model that will be recorded with results."""
    return LLM_MODEL
