"""Competitor Research service.

Input:  product summary (from the Product Analyzer) + ICP (from the ICP Analyzer)
Output: up to 5 relevant competitors/alternatives:

    [
        {"name": "", "url": "", "type": "", "reason_relevant": ""}
    ]

Uses the configured LLM provider (see llm.py). No comparison scoring.
"""

from typing import Any

from llm import chat_json, LLMError

PROMPT_VERSION = "competitor-research-v1"
MAX_COMPETITORS = 5

SYSTEM_PROMPT = (
    "You are a B2B competitor research analyst. Given a product summary and its "
    "ideal customer profile, you identify the most relevant competitors and "
    "alternatives that the same buyers would evaluate. Use your general market "
    "knowledge. Respond with a single JSON object and nothing else."
)

USER_PROMPT_TEMPLATE = """Product summary:
{product_summary}

Ideal customer profile (ICP):
{icp_json}

Return a JSON object with EXACTLY this shape:

{{
  "competitors": [
    {{
      "name": "Company/product name",
      "url": "https://their-website.example",
      "type": "short label: 'Direct competitor' | 'Alternative' | 'Indirect competitor'",
      "reason_relevant": "1-2 sentences: why this appears on the same shortlist"
    }}
  ]
}}

Rules:
- Return AT MOST {max_competitors} entries, most relevant first.
- Only include products that target this ICP.
- "url" must be a real public homepage URL, or an empty string if unsure.
- Return {{"competitors": []}} if nothing fits.

Return only the JSON object."""

STRING_FIELDS = ("name", "url", "type", "reason_relevant")
MAX_FIELD_LENGTH = 2000


class CompetitorResearchError(Exception):
    """Raised when the service cannot produce valid competitor results."""


def _clean_string(value: Any) -> str:
    if not isinstance(value, str):
        return str(value) if value is not None else ""
    return value.strip()[:MAX_FIELD_LENGTH]


def _normalize_url(value: str) -> str:
    if not value:
        return ""
    if value.startswith(("http://", "https://")):
        return value
    if "." in value and " " not in value:
        return f"https://{value.lstrip('/')}"
    return ""


def research_competitors(product_summary: str, icp: dict) -> list[dict]:
    """Run Competitor Research and return a validated list (0-5 entries)."""
    summary = (product_summary or "").strip()
    if not summary:
        raise CompetitorResearchError("product summary is required")
    if not isinstance(icp, dict) or not icp:
        raise CompetitorResearchError("ICP is required")

    import json

    try:
        icp_json = json.dumps(icp, ensure_ascii=False, indent=2)
    except (TypeError, ValueError) as exc:
        raise CompetitorResearchError("ICP is not serializable") from exc

    try:
        raw = chat_json(
            SYSTEM_PROMPT,
            USER_PROMPT_TEMPLATE.format(
                product_summary=summary[:6000],
                icp_json=icp_json,
                max_competitors=MAX_COMPETITORS,
            ),
            prompt_version=PROMPT_VERSION,
        )
    except LLMError as exc:
        raise CompetitorResearchError(str(exc)) from exc

    raw_list = raw.get("competitors")
    if isinstance(raw_list, dict):  # tolerate {"competitors": {...}} mistakes
        raw_list = [raw_list]
    if not isinstance(raw_list, list):
        raise CompetitorResearchError("LLM reply did not contain a competitors list")

    results: list[dict] = []
    seen_names: set[str] = set()
    for item in raw_list[:MAX_COMPETITORS]:
        if not isinstance(item, dict):
            continue
        cleaned = {field: _clean_string(item.get(field, "")) for field in STRING_FIELDS}
        cleaned["url"] = _normalize_url(cleaned["url"])
        if not cleaned["name"]:
            continue
        key = cleaned["name"].lower()
        if key in seen_names:
            continue
        seen_names.add(key)
        results.append(cleaned)

    return results
