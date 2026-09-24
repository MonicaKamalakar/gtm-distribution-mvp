"""Fetch a single web page and extract a title and clean text.

No AI is involved: this is plain HTTP + HTML parsing.
Only the submitted website is fetched — links are never followed.
"""

import asyncio
import ipaddress
import re
import socket
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup, Comment

FETCH_TIMEOUT_SECONDS = 15.0
CONNECT_TIMEOUT_SECONDS = 5.0
MAX_HTML_BYTES = 2_000_000  # guard against enormous pages
MAX_REDIRECTS = 5
USER_AGENT = "GTM-Distribution-MVP/0.1 (website fetcher)"

ALLOWED_SCHEMES = ("http", "https")

# Hostnames that always point at this machine.
_BLOCKED_HOSTNAMES = frozenset(
    {
        "localhost",
        "localhost.localdomain",
        "ip6-localhost",
        "ip6-loopback",
    }
)

# Elements whose contents are not human-readable page text.
_UNWANTED_TAGS = ("script", "style", "noscript", "template", "svg", "iframe")

_REDIRECT_STATUSES = (301, 302, 303, 307, 308)


class FetchError(Exception):
    """Raised when the website cannot be fetched or parsed."""


# Extra internal ranges not covered by ipaddress properties on older Pythons.
_EXTRA_BLOCKED_NETWORKS = (
    ipaddress.ip_network("100.64.0.0/10"),  # CGNAT / shared address space
    ipaddress.ip_network("192.0.0.0/24"),  # IETF protocol assignments
    ipaddress.ip_network("198.18.0.0/15"),  # benchmarking
)


def _is_blocked_ip(ip: "ipaddress._BaseAddress") -> bool:
    """True for loopback, private, link-local, reserved, multicast, unspecified."""
    if bool(
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    ):
        return True
    if ip.version == 4:
        return any(ip in net for net in _EXTRA_BLOCKED_NETWORKS)
    return False


def validate_url_safety(url: str) -> None:
    """Raise ValueError unless `url` is a public http/https address.

    Blocks: non-http(s) schemes (file://, ftp://, ...), localhost,
    private/reserved IP literals, and hostnames that resolve to internal
    addresses.
    """
    parsed = urlparse(url)

    if parsed.scheme not in ALLOWED_SCHEMES:
        raise ValueError("Only http and https URLs are allowed")

    host = parsed.hostname
    if not host:
        raise ValueError("URL has no hostname")

    host = host.rstrip(".").lower()

    # Numeric IPv6 addresses come back bare; strip any zone id.
    host_for_ip = host.split("%")[0]

    if host in _BLOCKED_HOSTNAMES or host.endswith(".localhost"):
        raise ValueError(f"Blocked host: {host}")

    try:
        ip = ipaddress.ip_address(host_for_ip)
    except ValueError:
        ip = None

    if ip is not None:
        # IP literal in the URL — check it directly.
        if _is_blocked_ip(ip):
            raise ValueError(f"Blocked internal address: {host}")
        return

    # Hostname: resolve first and reject internal targets (incl. DNS rebinding
    # style names that point at private ranges).
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise FetchError(f"Could not resolve host: {host}") from exc

    for info in infos:
        raw_ip = str(info[4][0]).split("%")[0]
        try:
            resolved = ipaddress.ip_address(raw_ip)
        except ValueError:
            continue
        if _is_blocked_ip(resolved):
            raise ValueError(
                f"Blocked: {host} resolves to internal address {resolved}"
            )


def _check_redirect_target(location: str, current_url: str) -> str:
    """Resolve and validate the next hop of a redirect."""
    next_url = urljoin(current_url, location)
    validate_url_safety(next_url)  # re-validated on every hop
    return next_url


def fetch_website(website_url: str) -> dict:
    """Fetch `website_url` once and return title, clean text, and source URL.

    Returns:
        {
            "title": str,       # <title> content ("" if the page has none)
            "text": str,        # visible text, whitespace collapsed
            "source_url": str,  # final URL after any redirects
        }

    Raises:
        ValueError: the URL is not a valid HTTP/HTTPS URL.
        FetchError: the request or response could not be processed.
    """
    parsed = urlparse(website_url.strip())

    # Scheme / localhost / private-IP / DNS safety gate.
    validate_url_safety(parsed.geturl())

    timeout = httpx.Timeout(FETCH_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS)
    try:
        with httpx.Client(
            follow_redirects=False,  # redirects are validated hop-by-hop
            timeout=timeout,
            headers={"User-Agent": USER_AGENT},
        ) as client:
            current_url = parsed.geturl()
            for _ in range(MAX_REDIRECTS + 1):
                validate_url_safety(current_url)
                response = client.get(current_url)
                if response.status_code in _REDIRECT_STATUSES and (
                    location := response.headers.get("location")
                ):
                    current_url = _check_redirect_target(location, current_url)
                    continue
                break
            else:
                raise FetchError("Too many redirects")
    except httpx.HTTPError as exc:
        raise FetchError(f"Could not fetch the website: {exc}") from exc

    if response.status_code >= 400:
        raise FetchError(f"Website returned HTTP {response.status_code}")

    content_type = response.headers.get("content-type", "")
    if "html" not in content_type:
        raise FetchError(f"Website did not return HTML (content-type: {content_type})")

    html = response.text[:MAX_HTML_BYTES]

    soup = BeautifulSoup(html, "html.parser")

    title = ""
    if soup.title is not None:
        title = soup.title.get_text(separator=" ", strip=True)

    for tag in soup.find_all(_UNWANTED_TAGS):
        tag.decompose()
    for comment in soup.find_all(string=lambda s: isinstance(s, Comment)):
        comment.extract()

    raw_text = soup.get_text(separator=" ", strip=True)
    text = re.sub(r"\s+", " ", raw_text).strip()

    return {
        "title": title,
        "text": text,
        "source_url": str(current_url),
    }
