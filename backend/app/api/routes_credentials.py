from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import CREDENTIAL_WRITE_RATE_LIMIT, RATE_LIMIT_WINDOW_SECONDS
from ..db import get_db
from ..models.db_models import User, UserCredential
from ..models.schemas import CredentialListResponse, CredentialResponse, CredentialUpsertRequest
from ..services.container import crypto_service
from ..services.rate_limit import enforce_rate_limit
from ..services.security import get_current_user

router = APIRouter(prefix="/credentials", tags=["credentials"])


def _to_response(item: UserCredential) -> CredentialResponse:
    return CredentialResponse(
        id=item.id,
        provider=item.provider,
        label=item.label,
        key_last4=item.key_last4,
        is_active=item.is_active,
        verified_at=item.verified_at,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.get("", response_model=CredentialListResponse)
def list_credentials(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> CredentialListResponse:
    rows = db.scalars(
        select(UserCredential)
        .where(UserCredential.user_id == current_user.id, UserCredential.is_active.is_(True))
        .order_by(UserCredential.provider.asc())
    ).all()
    return CredentialListResponse(items=[_to_response(row) for row in rows])


@router.post("", response_model=CredentialResponse, status_code=status.HTTP_201_CREATED)
def upsert_credential(
    payload: CredentialUpsertRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CredentialResponse:
    enforce_rate_limit(
        key=f"credentials:write:user:{current_user.id}",
        max_requests=CREDENTIAL_WRITE_RATE_LIMIT,
        window_seconds=RATE_LIMIT_WINDOW_SECONDS,
        detail="Too many credential updates. Please retry shortly.",
    )

    provider = payload.provider
    encrypted = crypto_service.encrypt(payload.api_key)
    last4 = payload.api_key[-4:] if len(payload.api_key) >= 4 else "****"

    existing = db.scalar(
        select(UserCredential).where(
            UserCredential.user_id == current_user.id,
            UserCredential.provider == provider,
        )
    )
    if existing:
        existing.encrypted_api_key = encrypted
        existing.key_last4 = last4
        existing.label = payload.label
        existing.is_active = True
        existing.verified_at = datetime.now(timezone.utc)
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return _to_response(existing)

    created = UserCredential(
        user_id=current_user.id,
        provider=provider,
        encrypted_api_key=encrypted,
        key_last4=last4,
        label=payload.label,
        is_active=True,
        verified_at=datetime.now(timezone.utc),
    )
    db.add(created)
    db.commit()
    db.refresh(created)
    return _to_response(created)


@router.delete("/{provider}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_credential(provider: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    enforce_rate_limit(
        key=f"credentials:write:user:{current_user.id}",
        max_requests=CREDENTIAL_WRITE_RATE_LIMIT,
        window_seconds=RATE_LIMIT_WINDOW_SECONDS,
        detail="Too many credential updates. Please retry shortly.",
    )

    normalized = provider.strip().lower()
    existing = db.scalar(
        select(UserCredential).where(
            UserCredential.user_id == current_user.id,
            UserCredential.provider == normalized,
            UserCredential.is_active.is_(True),
        )
    )
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credential not found.")
    # Destroy credential material on removal instead of soft-disabling.
    db.delete(existing)
    db.commit()
