from __future__ import annotations

import logging

from cryptography.fernet import Fernet

from ..config import (
    APP_ENV,
    CORS_ORIGINS,
    ENFORCE_STARTUP_VALIDATION,
    JWT_SECRET_KEY,
    MASTER_ENCRYPTION_KEY,
    MASTER_ENCRYPTION_KEY_FALLBACKS,
)

logger = logging.getLogger(__name__)

DEFAULT_JWT_PLACEHOLDER = "dev-only-change-this-secret"


def _validate_jwt_secret() -> None:
    if JWT_SECRET_KEY == DEFAULT_JWT_PLACEHOLDER:
        raise RuntimeError("JWT_SECRET_KEY must be set to a non-default value.")
    if len(JWT_SECRET_KEY) < 32:
        raise RuntimeError("JWT_SECRET_KEY must be at least 32 characters long.")


def _validate_master_encryption_key() -> None:
    if not MASTER_ENCRYPTION_KEY:
        raise RuntimeError("MASTER_ENCRYPTION_KEY is required for credential encryption.")

    try:
        Fernet(MASTER_ENCRYPTION_KEY.encode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("MASTER_ENCRYPTION_KEY must be a valid Fernet key.") from exc

    for index, key in enumerate(MASTER_ENCRYPTION_KEY_FALLBACKS, start=1):
        try:
            Fernet(key.encode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"MASTER_ENCRYPTION_KEY_FALLBACKS entry #{index} must be a valid Fernet key.") from exc


def _validate_cors() -> None:
    if not CORS_ORIGINS:
        raise RuntimeError("CORS_ORIGINS must include at least one explicit origin.")

    if "*" in CORS_ORIGINS:
        raise RuntimeError("Wildcard CORS origins are not allowed for demo hardening.")


def validate_runtime_config() -> None:
    if not ENFORCE_STARTUP_VALIDATION:
        logger.warning("Startup validation is disabled for APP_ENV=%s. This is acceptable for local feature development.", APP_ENV)
        return

    _validate_jwt_secret()
    _validate_master_encryption_key()
    _validate_cors()

    if APP_ENV in {"production", "staging"}:
        logger.info("Startup validation passed for %s environment.", APP_ENV)
