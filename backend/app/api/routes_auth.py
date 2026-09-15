from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from ..config import AUTH_LOGIN_RATE_LIMIT, AUTH_SIGNUP_RATE_LIMIT, DEFAULT_FREE_CREDITS, RATE_LIMIT_WINDOW_SECONDS
from ..db import get_db
from ..models.db_models import UsageEvent, User, UserBookProgress, UserCredential, UserReaderSettings
from ..models.schemas import AuthResponse, DeleteAccountRequest, LoginRequest, SignupRequest, UserResponse
from ..services.rate_limit import enforce_rate_limit, get_client_ip
from ..services.security import create_access_token, get_current_user, hash_password, normalize_email, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])
DELETE_ACCOUNT_CONFIRMATION_TEXT = "DELETE MY ACCOUNT"


def _to_user_response(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        plan_tier=user.plan_tier,
        billing_mode=user.billing_mode,
        credit_balance=user.credit_balance,
        is_active=user.is_active,
        created_at=user.created_at,
    )


def _validate_email(email: str) -> None:
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid email address.")


def _validate_password(password: str) -> None:
    if len(password) < 10:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 10 characters.")
    if not any(ch.islower() for ch in password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must include a lowercase letter.")
    if not any(ch.isupper() for ch in password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must include an uppercase letter.")
    if not any(ch.isdigit() for ch in password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must include a number.")
    if any(ch.isspace() for ch in password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password cannot contain whitespace.")


def _validate_account_delete_request(payload: DeleteAccountRequest, user: User) -> None:
    normalized_email = normalize_email(payload.email)
    if normalized_email != user.email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Confirmation email does not match signed-in account.")
    if payload.confirmation.strip().upper() != DELETE_ACCOUNT_CONFIRMATION_TEXT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Type '{DELETE_ACCOUNT_CONFIRMATION_TEXT}' to confirm account deletion.",
        )
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect.")


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def signup(payload: SignupRequest, request: Request, db: Session = Depends(get_db)) -> AuthResponse:
    client_ip = get_client_ip(request)
    enforce_rate_limit(
        key=f"auth:signup:ip:{client_ip}",
        max_requests=AUTH_SIGNUP_RATE_LIMIT,
        window_seconds=RATE_LIMIT_WINDOW_SECONDS,
        detail="Too many signup attempts. Please wait before trying again.",
    )

    email = normalize_email(payload.email)
    _validate_email(email)
    _validate_password(payload.password)
    enforce_rate_limit(
        key=f"auth:signup:email:{email}",
        max_requests=AUTH_SIGNUP_RATE_LIMIT,
        window_seconds=RATE_LIMIT_WINDOW_SECONDS,
        detail="Too many signup attempts for this email. Please wait before trying again.",
    )

    existing = db.scalar(select(User).where(User.email == email))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Unable to create account with these credentials.")

    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        plan_tier="free",
        billing_mode="managed",
        credit_balance=DEFAULT_FREE_CREDITS,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id)
    return AuthResponse(access_token=token, user=_to_user_response(user))


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> AuthResponse:
    client_ip = get_client_ip(request)
    enforce_rate_limit(
        key=f"auth:login:ip:{client_ip}",
        max_requests=AUTH_LOGIN_RATE_LIMIT,
        window_seconds=RATE_LIMIT_WINDOW_SECONDS,
        detail="Too many login attempts. Please wait before trying again.",
    )

    email = normalize_email(payload.email)
    _validate_email(email)
    enforce_rate_limit(
        key=f"auth:login:email:{email}",
        max_requests=AUTH_LOGIN_RATE_LIMIT,
        window_seconds=RATE_LIMIT_WINDOW_SECONDS,
        detail="Too many login attempts for this email. Please wait before trying again.",
    )

    user = db.scalar(select(User).where(User.email == email))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled.")

    token = create_access_token(user.id)
    return AuthResponse(access_token=token, user=_to_user_response(user))


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return _to_user_response(current_user)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(payload: DeleteAccountRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    _validate_account_delete_request(payload, current_user)
    # Remove account-linked records explicitly so deletion behavior is immediate and
    # consistent even in environments where FK cascade rules are not enforced.
    db.execute(
        update(UsageEvent)
        .where(UsageEvent.user_id == current_user.id)
        .values(user_id=None)
    )
    db.execute(delete(UserCredential).where(UserCredential.user_id == current_user.id))
    db.execute(delete(UserBookProgress).where(UserBookProgress.user_id == current_user.id))
    db.execute(delete(UserReaderSettings).where(UserReaderSettings.user_id == current_user.id))
    db.delete(current_user)
    db.commit()
