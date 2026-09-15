from __future__ import annotations

import re
import unicodedata

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.db_models import User, UserBookProgress
from ..models.schemas import ProgressPayload, ProgressResponse
from ..services.security import get_current_user

router = APIRouter(prefix="/progress", tags=["progress"])

_BOOK_EXT_RE = re.compile(r"\.(pdf|epub)$", flags=re.IGNORECASE)
_SPACE_RE = re.compile(r"\s+")


def _normalize_book_title(book_title: str) -> tuple[str, str]:
    canonical = unicodedata.normalize("NFKC", book_title).strip()
    canonical = _SPACE_RE.sub(" ", canonical)
    if not canonical:
        raise HTTPException(status_code=400, detail="book_title is required.")

    without_ext = _BOOK_EXT_RE.sub("", canonical).strip()
    if without_ext:
        canonical = without_ext

    if len(canonical) > 512:
        canonical = canonical[:512].rstrip()

    key = _SPACE_RE.sub(" ", canonical.casefold())
    if not key:
        raise HTTPException(status_code=400, detail="book_title is required.")
    if len(key) > 512:
        key = key[:512].rstrip()

    return canonical, key


@router.post("", response_model=ProgressResponse)
def save_progress(
    payload: ProgressPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProgressResponse:
    canonical_title, book_key = _normalize_book_title(payload.book_title)

    existing = db.scalar(
        select(UserBookProgress).where(
            UserBookProgress.user_id == current_user.id,
            UserBookProgress.book_key == book_key,
        )
    )
    if existing:
        existing.book_title = canonical_title
        existing.index = max(0, payload.index)
        db.add(existing)
        db.commit()
        return ProgressResponse(
            book_title=existing.book_title,
            index=existing.index,
        )

    created = UserBookProgress(
        user_id=current_user.id,
        book_title=canonical_title,
        book_key=book_key,
        index=max(0, payload.index),
        settings_json="{}",
    )
    db.add(created)
    db.commit()
    return ProgressResponse(
        book_title=created.book_title,
        index=created.index,
    )


@router.get("", response_model=ProgressResponse)
def get_progress(
    book_title: str = Query(..., min_length=1, max_length=512),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProgressResponse:
    canonical_title, book_key = _normalize_book_title(book_title)

    found = db.scalar(
        select(UserBookProgress).where(
            UserBookProgress.user_id == current_user.id,
            UserBookProgress.book_key == book_key,
        )
    )
    if not found:
        return ProgressResponse(
            book_title=canonical_title,
            index=0,
        )

    return ProgressResponse(
        book_title=found.book_title,
        index=max(0, found.index),
    )
