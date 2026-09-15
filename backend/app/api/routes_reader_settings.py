from __future__ import annotations

import json

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.db_models import User, UserReaderSettings
from ..models.schemas import ReaderSettingsPayload, ReaderSettingsResponse
from ..services.security import get_current_user

router = APIRouter(prefix="/reader-settings", tags=["reader-settings"])


def _decode_settings(raw: str) -> dict:
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    if isinstance(value, dict):
        return value
    return {}


@router.post("", response_model=ReaderSettingsResponse)
def save_reader_settings(
    payload: ReaderSettingsPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReaderSettingsResponse:
    settings = payload.settings if isinstance(payload.settings, dict) else {}
    settings_json = json.dumps(settings, separators=(",", ":"), ensure_ascii=True)

    existing = db.scalar(select(UserReaderSettings).where(UserReaderSettings.user_id == current_user.id))
    if existing:
        existing.settings_json = settings_json
        db.add(existing)
        db.commit()
        return ReaderSettingsResponse(settings=settings)

    created = UserReaderSettings(
        user_id=current_user.id,
        settings_json=settings_json,
    )
    db.add(created)
    db.commit()
    return ReaderSettingsResponse(settings=settings)


@router.get("", response_model=ReaderSettingsResponse)
def get_reader_settings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReaderSettingsResponse:
    existing = db.scalar(select(UserReaderSettings).where(UserReaderSettings.user_id == current_user.id))
    if not existing:
        return ReaderSettingsResponse(settings={})
    return ReaderSettingsResponse(settings=_decode_settings(existing.settings_json))
