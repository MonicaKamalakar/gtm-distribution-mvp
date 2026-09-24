"""Search provider abstraction.

Interface:  search(query) -> [{"title": "", "url": "", "snippet": ""}, ...]

The provider is swappable: set SEARCH_PROVIDER in .env (default: duckduckgo).
Add a new SearchProvider subclass and register it in _PROVIDERS to replace it;
no other code needs to change.
"""

import os
from abc import ABC, abstractmethod
from typing import Optional
from urllib.parse import urlparse

from dotenv import load_dotenv

load_dotenv()

DEFAULT_RESULT_LIMIT = 10
USER_AGENT = "GTM-Distribution-MVP/0.1 (search)"


class SearchProviderError(Exception):
    """Raised when the search provider cannot return results."""


class SearchProvider(ABC):
    """Replaceable search backend. Implement `search` only."""

    @abstractmethod
    def search(self, query: str, limit: int = DEFAULT_RESULT_LIMIT) -> list[dict]:
        """Return [{"title": str, "url": str, "snippet": str}, ...] for `query`."""


class DuckDuckGoProvider(SearchProvider):
    """Keyless DuckDuckGo web search (via the `ddgs` package)."""

    def search(self, query: str, limit: int = DEFAULT_RESULT_LIMIT) -> list[dict]:
        if not query.strip():
            raise SearchProviderError("query is empty")
        try:
            from ddgs import DDGS

            raw_results = DDGS().text(query, max_results=limit)
        except Exception as exc:  # ddgs raises assorted backend errors
            raise SearchProviderError(f"DuckDuckGo search failed: {exc}") from exc

        results = []
        for item in raw_results or []:
            url = str(item.get("href") or item.get("url") or "").strip()
            title = str(item.get("title") or "").strip()
            snippet = str(item.get("body") or item.get("snippet") or "").strip()
            if not url or not urlparse(url).scheme.startswith("http"):
                continue
            results.append({"title": title, "url": url, "snippet": snippet})
        return results


_PROVIDERS: dict[str, type[SearchProvider]] = {
    "duckduckgo": DuckDuckGoProvider,
}


def get_search_provider(name: Optional[str] = None) -> SearchProvider:
    """Resolve the configured provider (SEARCH_PROVIDER env, default duckduckgo)."""
    provider_name = (name or os.environ.get("SEARCH_PROVIDER", "duckduckgo")).lower()
    try:
        return _PROVIDERS[provider_name]()
    except KeyError:
        raise SearchProviderError(
            f"Unknown search provider '{provider_name}'. "
            f"Available: {', '.join(sorted(_PROVIDERS))}"
        ) from None
