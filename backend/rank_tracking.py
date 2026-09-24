"""Rank tracking for discovery queries.

For each discovery query, determine whether the submitted company appears in
the search results, at what position, and which known competitors appear.

Produces the stored record:
    query, appears, position (if available), competitors_found, timestamp
(timestamp is applied by the model's server default).
"""

from urllib.parse import urlparse


def company_domain(website_url: str) -> str:
    """Registrable-ish hostname of the submitted website, without www."""
    host = (urlparse(website_url.strip()).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def _result_host(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def _host_matches(host: str, target: str) -> bool:
    if not host or not target:
        return False
    return host == target or host.endswith("." + target)


def evaluate_results(
    query: str,
    results: list[dict],
    submitted_domain: str,
    competitors: list[dict],
) -> dict:
    """Build the tracking record for one discovery query.

    Returns:
        {
            "query": str,
            "appears": bool,
            "position": int | None,       # 1-based first appearance
            "competitors_found": [str],   # competitor names seen in results
        }
    """
    appears = False
    position: int | None = None

    for index, result in enumerate(results, start=1):
        if _host_matches(_result_host(result.get("url", "")), submitted_domain):
            appears = True
            position = index
            break

    competitors_found: list[str] = []
    for competitor in competitors:
        name = (competitor.get("name") or "").strip()
        if not name:
            continue
        comp_domain = company_domain(competitor.get("url") or "")
        found = False
        for result in results:
            host = _result_host(result.get("url", ""))
            title = (result.get("title") or "").lower()
            if comp_domain and _host_matches(host, comp_domain):
                found = True
                break
            if name.lower() in title:
                found = True
                break
        if found:
            competitors_found.append(name)

    return {
        "query": query,
        "appears": appears,
        "position": position,
        "competitors_found": competitors_found,
    }
