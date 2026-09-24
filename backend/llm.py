"""Thin client for the configured LLM provider (OpenAI-compatible chat completions).

Configuration is read from backend/.env (gitignored):
    LLM_API_KEY   - required
    LLM_BASE_URL  - defaults to https://api.openai.com/v1
    LLM_MODEL     - defaults to gpt-4o-mini

Every completed model call is recorded (see usage.py: tokens, duration,
timestamp, cost). When `prompt_version` is given, identical inputs reuse a
cached result (see cache.py) and the analysis cost budget is checked before
calling the provider — an exhausted budget raises LLMError instead of
calling the model, so analyses stop gracefully without endless retries.
"""

import json
import os
import time
from typing import Optional

import httpx
from dotenv import load_dotenv

from cache import get_ai_result, save_ai_result, sha256_hex
from usage import BudgetExceededError, check_budget, log_usage

load_dotenv()

LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
LLM_MODEL = os.environ.get("LLM_MODEL", "gpt-4o-mini")

LLM_TIMEOUT_SECONDS = 60.0
MAX_TOKENS = 1000


class LLMError(Exception):
    """Raised when the configured LLM provider cannot produce a usable result."""


def chat_json(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = MAX_TOKENS,
    prompt_version: Optional[str] = None,
) -> dict:
    """Send a chat completion request and return the parsed JSON object reply.

    With `prompt_version` set, a cached result for the same inputs/model is
    returned without spending budget or calling the provider.
    """
    if not LLM_API_KEY:
        raise LLMError("LLM_API_KEY is not configured (see backend/.env)")

    input_hash = None
    if prompt_version:
        input_hash = sha256_hex(system_prompt + "\n" + user_prompt)
        cached = get_ai_result(input_hash, prompt_version, LLM_MODEL)
        if cached is not None:
            return cached

    # Budget gate: refuse the call (graceful stop) when it would exceed it.
    try:
        check_budget()
    except BudgetExceededError as exc:
        raise LLMError(str(exc)) from exc

    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }

    started = time.monotonic()
    try:
        response = httpx.post(
            f"{LLM_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {LLM_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=LLM_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        raise LLMError(f"Could not reach the LLM provider: {exc}") from exc

    if response.status_code >= 400:
        # Retry without response_format for providers/models that reject it.
        if "response_format" in payload and response.status_code == 400:
            payload.pop("response_format")
            try:
                response = httpx.post(
                    f"{LLM_BASE_URL}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {LLM_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=LLM_TIMEOUT_SECONDS,
                )
            except httpx.HTTPError as exc:
                raise LLMError(f"Could not reach the LLM provider: {exc}") from exc
        if response.status_code >= 400:
            raise LLMError(
                f"LLM provider returned HTTP {response.status_code}: "
                f"{response.text[:300]}"
            )

    # The model call completed: record tokens, duration, timestamp, and cost.
    duration = time.monotonic() - started
    try:
        usage_data = response.json().get("usage") or {}
    except ValueError:
        usage_data = {}
    prompt_tokens = int(usage_data.get("prompt_tokens") or 0)
    output_tokens = int(usage_data.get("completion_tokens") or 0)
    total_tokens = int(usage_data.get("total_tokens") or 0) or (
        prompt_tokens + output_tokens
    )
    try:
        log_usage(
            LLM_MODEL,
            prompt_tokens,
            output_tokens,
            total_tokens,
            round(duration, 3),
        )
    except Exception as exc:  # logging must never fail a completed call
        print(f"[usage] could not record AI usage: {exc}")

    try:
        content: Optional[str] = response.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, ValueError) as exc:
        raise LLMError("LLM provider returned an unexpected response shape") from exc

    if not content:
        raise LLMError("LLM provider returned an empty completion")

    text = content.strip()
    if text.startswith("```"):  # tolerate markdown fences
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise LLMError(f"LLM reply was not valid JSON: {text[:200]}") from exc

    if not isinstance(parsed, dict):
        raise LLMError("LLM reply was not a JSON object")

    if prompt_version and input_hash is not None:
        try:
            save_ai_result(input_hash, prompt_version, LLM_MODEL, parsed)
        except Exception as exc:  # caching must not fail a good result
            print(f"[cache] could not store AI result: {exc}")

    return parsed
