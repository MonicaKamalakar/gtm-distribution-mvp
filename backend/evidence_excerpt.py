"""Supporting-excerpt capture for evidence records (shared by all sections).

Evidence flow: source retrieval -> evidence object -> database -> API -> UI.

Every evidence item carries: source/title, source_url, retrieved_at,
excerpt (the supporting excerpt), confidence. The excerpt must be REAL
text taken from the retrieved source — never invented. When the source
cannot be retrieved, or its content has no usable text, the excerpt is
set to null and the UI shows its honest "Not recorded" fallback.

Retrieval reuses the pipeline's existing website cache (cache.py) and the
safety-gated fetcher (fetcher.py), so each source URL is fetched at most
once and a failed retrieval never breaks the analysis step.
"""

from typing import Any, Optional

from cache import get_website_result, save_website_result, sha256_hex
from fetcher import FetchError, fetch_website

MIN_EXCERPT_LENGTH = 40
MAX_EXCERPT_LENGTH = 300

# Keys that identify an evidence object inside a section result.
_EVIDENCE_KEYS = ("source_url", "retrieved_at", "confidence")


def extract_concise_excerpt(text: Any) -> Optional[str]:
    """A concise excerpt of `text`, or None when the text is unusable.

    Returns real text only: a sentence fitting the limit when one exists,
    otherwise a whole-word prefix — no characters are ever invented.
    """
    if not isinstance(text, str):
        return None
    cleaned = " ".join(text.split())
    if len(cleaned) < MIN_EXCERPT_LENGTH:
        return None
    if len(cleaned) <= MAX_EXCERPT_LENGTH:
        return cleaned
    window = cleaned[:MAX_EXCERPT_LENGTH]
    for terminator in (".", "!", "?"):
        position = window.rfind(terminator)
        if position + 1 >= MIN_EXCERPT_LENGTH:
            return window[: position + 1].strip()
    return window.rsplit(" ", 1)[0].strip()


def capture_excerpt(source_url: str) -> Optional[str]:
    """A real supporting excerpt from the retrieved source, else None.

    Uses the cached retrieval when available, otherwise retrieves the
    source once and persists it to the website cache. Any retrieval
    failure (blocked URL, network error, unusable content) yields None —
    nothing is fabricated.
    """
    url = (source_url or "").strip()
    if not url:
        return None

    page = get_website_result(url)
    if page is None:
        try:
            fetched = fetch_website(url)
        except Exception:  # noqa: BLE001 - any retrieval failure -> no excerpt
            return None
        # Persist the retrieval (best effort) so later consumers reuse it.
        try:
            save_website_result(
                url,
                sha256_hex(fetched["text"]),
                fetched["title"],
                fetched["text"],
                fetched["source_url"],
            )
        except Exception:  # noqa: BLE001 - cache write failure is not fatal
            pass
        page = {"text": fetched["text"]}

    return extract_concise_excerpt(page.get("text"))


def attach_missing_excerpts(result: Any, memo: Optional[dict] = None) -> bool:
    """Fill every evidence item's excerpt that is missing or empty, in place.

    Evidence that already carries an excerpt is never touched (existing
    persisted values are preserved). Missing excerpts are captured from
    the retrieved source; when none is available the field is set to an
    explicit null. Returns True when anything changed.

    `memo` deduplicates retrieval per source URL within one walk, so a
    URL shared by many evidence items is fetched at most once.
    """
    if memo is None:
        memo = {}
    changed = False

    if isinstance(result, list):
        for item in result:
            if attach_missing_excerpts(item, memo):
                changed = True
    elif isinstance(result, dict):
        if all(key in result for key in _EVIDENCE_KEYS):
            if not result.get("excerpt"):
                url = (result.get("source_url") or "").strip()
                if url not in memo:
                    memo[url] = capture_excerpt(url)
                result["excerpt"] = memo[url]
                changed = True
        else:
            for value in result.values():
                if attach_missing_excerpts(value, memo):
                    changed = True

    return changed
