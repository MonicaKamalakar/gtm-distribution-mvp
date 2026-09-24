"""Buyer Question Research service.

Input:  product (Product Analyzer output), ICP (ICP Analyzer output),
        competitors (Competitor Research output)
Output: up to 10 likely buyer questions:

    [
        {
            "question": "",
            "intent": "",
            "audience": "",
            "evidence": [
                {"source": "", "source_url": "", "excerpt": "",
                 "retrieved_at": "", "confidence": 0}
            ]
        }
    ]

`retrieved_at` is stamped server-side when the evidence is recorded.
Uses the configured LLM provider (see llm.py).
"""

import json
from datetime import datetime, timezone
from typing import Any

from llm import LLM_MODEL, chat_json, LLMError

# v2: the evidence shape now requests a supporting excerpt (was missing from
# the reply entirely), so the prompt template changed and the cache version
# must roll with it.
PROMPT_VERSION = "buyer-questions-v2"
MAX_QUESTIONS = 10
MAX_EVIDENCE_PER_QUESTION = 3
# This is the largest structured payload in the pipeline (up to 10 questions
# x 4 JSON objects each). The 1000-token default truncated the reply mid-JSON,
# which surfaced as "LLM reply was not valid JSON".
MAX_OUTPUT_TOKENS = 3000

# One bounded recovery attempt if a reply is still unparseable: ask for a
# compact answer that cannot run past the token limit again. Never retried
# beyond this single attempt.
COMPACT_RETRY_INSTRUCTION = (
    "\n\nYour previous reply could not be parsed because it was too long. "
    "Reply again with at most 5 questions and at most 2 evidence objects "
    "each, keeping every field short — still returning only one complete "
    "JSON object with the exact shape requested."
)

SYSTEM_PROMPT = (
    "You are a B2B buyer-research analyst. Given a product, its ICP, and its "
    "competitors, you anticipate the questions real buyers ask while evaluating "
    "such a product. Respond with a single JSON object and nothing else."
)

USER_PROMPT_TEMPLATE = """Product analysis:
{product_json}

ICP:
{icp_json}

Competitors:
{competitors_json}

Return a JSON object with EXACTLY this shape:

{{
  "questions": [
    {{
      "question": "a question a buyer would ask",
      "intent": "what the buyer is really trying to find out",
      "audience": "who asks this, e.g. 'Head of Ops', 'Procurement'",
      "evidence": [
        {{
          "source": "short source name, e.g. the product homepage or a well-known comparison reference",
          "source_url": "https://example.com/page",
          "excerpt": "a short supporting excerpt or observation, max 25 words",
          "confidence": 0
        }}
      ]
    }}
  ]
}}

Rules:
- Return AT MOST {max_questions} questions, most likely/high-intent first.
- Every question MUST have 1-{max_evidence} evidence objects.
- "confidence" is an integer 0-100: how well the source supports this question.
- Do NOT invent retrieved_at — it is added automatically.
- Return {{"questions": []}} if nothing fits.

Return only the JSON object."""

STRING_FIELDS = ("question", "intent", "audience")
EVIDENCE_FIELDS = ("source", "source_url", "excerpt")
MAX_FIELD_LENGTH = 2000
MAX_EXCERPT_LENGTH = 500


class BuyerQuestionResearchError(Exception):
    """Raised when the service cannot produce valid buyer questions."""


def _clean_string(value: Any, max_length: int = MAX_FIELD_LENGTH) -> str:
    if not isinstance(value, str):
        return str(value) if value is not None else ""
    return value.strip()[:max_length]


def _clean_confidence(value: Any) -> int:
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
    for item in value[:MAX_EVIDENCE_PER_QUESTION]:
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
        entry["confidence"] = _clean_confidence(item.get("confidence"))
        cleaned.append(entry)
    return cleaned


def research_buyer_questions(product: dict, icp: dict, competitors: list) -> list[dict]:
    """Run Buyer Question Research and return a validated list (0-10 entries)."""
    if not isinstance(product, dict) or not product:
        raise BuyerQuestionResearchError("product analysis is required")
    if not isinstance(icp, dict) or not icp:
        raise BuyerQuestionResearchError("ICP is required")
    if not isinstance(competitors, list):
        raise BuyerQuestionResearchError("competitors must be a list")

    try:
        prompt = USER_PROMPT_TEMPLATE.format(
            product_json=json.dumps(product, ensure_ascii=False, indent=2),
            icp_json=json.dumps(icp, ensure_ascii=False, indent=2),
            competitors_json=json.dumps(competitors, ensure_ascii=False, indent=2),
            max_questions=MAX_QUESTIONS,
            max_evidence=MAX_EVIDENCE_PER_QUESTION,
        )
    except (TypeError, ValueError) as exc:
        raise BuyerQuestionResearchError("inputs are not serializable") from exc

    try:
        raw = chat_json(
            SYSTEM_PROMPT,
            prompt,
            max_tokens=MAX_OUTPUT_TOKENS,
            prompt_version=PROMPT_VERSION,
        )
    except LLMError as exc:
        if "not valid JSON" not in str(exc):
            raise BuyerQuestionResearchError(str(exc)) from exc
        # Single bounded recovery: only for unparseable replies (never for
        # budget or network failures), and only once.
        try:
            raw = chat_json(
                SYSTEM_PROMPT,
                prompt + COMPACT_RETRY_INSTRUCTION,
                max_tokens=MAX_OUTPUT_TOKENS,
                prompt_version=PROMPT_VERSION,
            )
        except LLMError as retry_exc:
            raise BuyerQuestionResearchError(str(retry_exc)) from retry_exc

    raw_list = raw.get("questions")
    if not isinstance(raw_list, list):
        raise BuyerQuestionResearchError("LLM reply did not contain a questions list")

    results: list[dict] = []
    seen: set[str] = set()
    for item in raw_list[:MAX_QUESTIONS]:
        if not isinstance(item, dict):
            continue
        question = _clean_string(item.get("question"))
        if not question or question.lower() in seen:
            continue
        seen.add(question.lower())
        results.append(
            {
                "question": question,
                "intent": _clean_string(item.get("intent")) or "Not stated",
                "audience": _clean_string(item.get("audience")) or "Not stated",
                "evidence": _clean_evidence(item.get("evidence")),
            }
        )

    return results


def current_model_name() -> str:
    """The configured model that will be recorded with results."""
    return LLM_MODEL
