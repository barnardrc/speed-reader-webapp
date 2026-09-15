from __future__ import annotations

import argparse

from sqlalchemy import select

from app.config import DEFAULT_FREE_CREDITS
from app.db import SessionLocal, init_db
from app.models.db_models import User
from app.services.security import hash_password, normalize_email


def upsert_user(email: str, password: str, credits: int, plan_tier: str, billing_mode: str, force_password: bool) -> User:
    normalized_email = normalize_email(email)
    db = SessionLocal()
    try:
        existing = db.scalar(select(User).where(User.email == normalized_email))
        if existing:
            existing.plan_tier = plan_tier
            existing.billing_mode = billing_mode
            existing.credit_balance = credits
            existing.is_active = True
            if force_password:
                existing.password_hash = hash_password(password)
            db.add(existing)
            db.commit()
            db.refresh(existing)
            return existing

        created = User(
            email=normalized_email,
            password_hash=hash_password(password),
            plan_tier=plan_tier,
            billing_mode=billing_mode,
            credit_balance=credits,
            is_active=True,
        )
        db.add(created)
        db.commit()
        db.refresh(created)
        return created
    finally:
        db.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Create or update a local development user.")
    parser.add_argument("--email", default="demo@example.com", help="User email.")
    parser.add_argument("--password", default="DevPass1234", help="User password (used for create and optional reset).")
    parser.add_argument("--credits", type=int, default=DEFAULT_FREE_CREDITS, help="Credit balance to set.")
    parser.add_argument("--plan", default="free", help="Plan tier to set.")
    parser.add_argument("--billing-mode", default="managed", choices=["managed", "byok"], help="Billing mode to set.")
    parser.add_argument(
        "--force-password-reset",
        action="store_true",
        help="Reset password for existing users to --password value.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    init_db()
    user = upsert_user(
        email=args.email,
        password=args.password,
        credits=args.credits,
        plan_tier=args.plan,
        billing_mode=args.billing_mode,
        force_password=args.force_password_reset,
    )
    print("Dev user ready:")
    print(f"  email={user.email}")
    print(f"  plan_tier={user.plan_tier}")
    print(f"  billing_mode={user.billing_mode}")
    print(f"  credit_balance={user.credit_balance}")


if __name__ == "__main__":
    main()
