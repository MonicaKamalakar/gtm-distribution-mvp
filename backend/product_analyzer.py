"""Product Analyzer service.

Input:  website text (clean text extracted by the fetcher)
Output: structured product understanding as a JSON dict:

    {
        "product_summary": "",
        "problem_solved": "",
        "value_proposition": "",
        "product_category": "",
        "key_capabilities": []
    }

Uses the configured LLM provider (see llm.py). No other analysis types.
"""

from typing import Any

from llm import LLM_MODEL, chat_json, LLMError

PROMPT_VERSION = "product-understanding-v1"

SYSTEM_PROMPT = (
    "You are a product analyst. You extract a factual, concise understanding of "
    "a product from the text of its homepage. Respond with a single JSON object "
    "and nothing else."
)

USER_PROMPT_TEMPLATE = """Analyze the following website text and return a JSON object with EXACTLY these keys:

{{
  "product_summary": "2-3 sentence neutral summary of what the product is",
  "problem_solved": "1-2 sentences: the core problem or need it addresses",
  "value_proposition": "1-2 sentences: why a customer should choose it",
  "product_category": "short category label, e.g. 'Project Management SaaS'",
  "key_capabilities": ["5-8 short capability phrases"]
}}

Rules:
- Base everything ONLY on the text below; do not invent features.
- If a field cannot be determined, write "Not stated on the page".
- "key_capabilities" must be an array of strings.

Website text:
---
{website_text}
---

Return only the JSON object."""

REQUIRED_STRING_FIELDS = (
    "product_summary",
    "problem_solved",
    "value_proposition",
    "product_category",
)

MAX_FIELD_LENGTH = 2000
MAX_CAPABILITIES = 8


class ProductAnalyzerError(Exception):
    """Raised when the analyzer cannot produce a valid structured result."""


def _clean_string(value: Any) -> str:
    if not isinstance(value, str):
        return str(value) if value is not None else ""
    return value.strip()[:MAX_FIELD_LENGTH]


def _clean_capabilities(value: Any) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    caps = [_clean_string(item) for item in value]
    caps = [c for c in caps if c]
    return caps[:MAX_CAPABILITIES]


def analyze_product(website_text: str) -> dict:
    """Run the Product Analyzer on `website_text` and return the validated JSON."""
    text = website_text.strip()
    if not text:
        raise ProductAnalyzerError("website text is empty")
    if len(text) > 60_000:
        text = text[:60_000]

    try:
        raw = chat_json(
            SYSTEM_PROMPT,
            USER_PROMPT_TEMPLATE.format(website_text=text),
            prompt_version=PROMPT_VERSION,
        )
    except LLMError as exc:
        raise ProductAnalyzerError(str(exc)) from exc

    result: dict[str, Any] = {}
    for field in REQUIRED_STRING_FIELDS:
        result[field] = _clean_string(raw.get(field, "")) or "Not stated on the page"
    result["key_capabilities"] = _clean_capabilities(raw.get("key_capabilities"))

    if not any(result[f] != "Not stated on the page" for f in REQUIRED_STRING_FIELDS):
        raise ProductAnalyzerError("LLM returned no usable product information")

    return result


def current_model_name() -> str:
    """The configured model that will be recorded with results."""
    return LLM_MODEL
