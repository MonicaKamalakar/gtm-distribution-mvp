"""Discovery query generation.

Input:  ICP, buyer questions, product
Output: 5 high-intent discovery queries as structured objects only:

    {"queries": [{"query": ""}, ...]}

Uses the configured LLM provider (see llm.py).
"""

import json
from typing import Any

from llm import chat_json, LLMError

PROMPT_VERSION = "discovery-queries-v1"
TARGET_QUERY_COUNT = 5

SYSTEM_PROMPT = (
    "You are a demand-gen search strategist. You write the exact search queries "
    "a high-intent buyer would type when looking for a solution like this "
    "product. Respond with a single JSON object containing structured query "
    "objects and nothing else."
)

USER_PROMPT_TEMPLATE = """ICP:
{icp_json}

Buyer questions:
{questions_json}

Product analysis:
{product_json}

Return a JSON object with EXACTLY this shape:

{{
  "queries": [
    {{"query": "a high-intent search query"}}
  ]
}}

Rules:
- Return EXACTLY {count} query objects.
- Each object has only the "query" key: the query string itself.
- Queries must be things a ready-to-buy buyer would actually type.
- No explanations, no ranking, no extra keys.

Return only the JSON object."""

MAX_QUERY_LENGTH = 200


class DiscoveryQueryError(Exception):
    """Raised when the service cannot produce valid discovery queries."""


def _clean_query(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:MAX_QUERY_LENGTH]


def generate_discovery_queries(icp: dict, buyer_questions: list, product: dict) -> list[dict]:
    """Generate high-intent discovery queries; returns [{"query": str}, ...]."""
    if not isinstance(icp, dict) or not icp:
        raise DiscoveryQueryError("ICP is required")
    if not isinstance(buyer_questions, list):
        raise DiscoveryQueryError("buyer questions must be a list")
    if not isinstance(product, dict) or not product:
        raise DiscoveryQueryError("product analysis is required")

    try:
        prompt = USER_PROMPT_TEMPLATE.format(
            icp_json=json.dumps(icp, ensure_ascii=False, indent=2),
            questions_json=json.dumps(buyer_questions, ensure_ascii=False, indent=2),
            product_json=json.dumps(product, ensure_ascii=False, indent=2),
            count=TARGET_QUERY_COUNT,
        )
    except (TypeError, ValueError) as exc:
        raise DiscoveryQueryError("inputs are not serializable") from exc

    try:
        raw = chat_json(SYSTEM_PROMPT, prompt, prompt_version=PROMPT_VERSION)
    except LLMError as exc:
        raise DiscoveryQueryError(str(exc)) from exc

    raw_list = raw.get("queries")
    if not isinstance(raw_list, list):
        raise DiscoveryQueryError("LLM reply did not contain a queries list")

    queries: list[dict] = []
    seen: set[str] = set()
    for item in raw_list:
        if isinstance(item, dict):
            query = _clean_query(item.get("query"))
        else:
            query = _clean_query(item)
        if not query or query.lower() in seen:
            continue
        seen.add(query.lower())
        queries.append({"query": query})
        if len(queries) == TARGET_QUERY_COUNT:
            break

    if not queries:
        raise DiscoveryQueryError("LLM returned no usable queries")
    return queries

