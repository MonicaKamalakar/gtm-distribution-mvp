"""Caches used by the analysis pipeline.

Website research: cached by URL and validated by content hash — when the
page content is unchanged the stored result is reused instead of being
re-processed; a changed hash replaces it.

AI results: cached by (input hash, prompt version, model) — identical
inputs reuse a valid stored result. Changing the prompt version changes the
key, which invalidates old results automatically.
"""

import hashlib
from typing import Optional

from database import SessionLocal
from models import AiCache, WebsiteCache

MAX_TITLE_LENGTH = 1000


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def get_ai_result(
    input_hash: str, prompt_version: str, model: str
) -> Optional[dict]:
    """Cached AI result for this exact input/prompt/model, if still valid."""
    db = SessionLocal()
    try:
        row = (
            db.query(AiCache)
            .filter(
                AiCache.input_hash == input_hash,
                AiCache.prompt_version == prompt_version,
                AiCache.model == model,
            )
            .first()
        )
        if row is None or not isinstance(row.result_json, dict):
            return None
        return row.result_json
    finally:
        db.close()


def save_ai_result(
    input_hash: str, prompt_version: str, model: str, result: dict
) -> None:
    """Store (or refresh) the AI result for this input/prompt/model key."""
    db = SessionLocal()
    try:
        row = (
            db.query(AiCache)
            .filter(
                AiCache.input_hash == input_hash,
                AiCache.prompt_version == prompt_version,
                AiCache.model == model,
            )
            .first()
        )
        if row is None:
            db.add(
                AiCache(
                    input_hash=input_hash,
                    prompt_version=prompt_version,
                    model=model,
                    result_json=result,
                )
            )
        else:
            row.result_json = result
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def get_website_result(url: str) -> Optional[dict]:
    """Cached website research for this URL, if any."""
    db = SessionLocal()
    try:
        row = (
            db.query(WebsiteCache)
            .filter(WebsiteCache.url_hash == sha256_hex(url))
            .first()
        )
        if row is None:
            return None
        return {
            "content_hash": row.content_hash,
            "title": row.title,
            "final_url": row.final_url,
            "text": row.text,
        }
    finally:
        db.close()


def save_website_result(
    url: str, content_hash: str, title: str, text: str, final_url: str
) -> None:
    """Store the website research result, replacing any previous one for this URL."""
    db = SessionLocal()
    try:
        url_hash = sha256_hex(url)
        row = (
            db.query(WebsiteCache)
            .filter(WebsiteCache.url_hash == url_hash)
            .first()
        )
        if row is None:
            db.add(
                WebsiteCache(
                    url=url,
                    url_hash=url_hash,
                    content_hash=content_hash,
                    title=(title or "")[:MAX_TITLE_LENGTH] or None,
                    final_url=final_url,
                    text=text,
                )
            )
        else:
            row.content_hash = content_hash
            row.title = (title or "")[:MAX_TITLE_LENGTH] or None
            row.final_url = final_url
            row.text = text
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
