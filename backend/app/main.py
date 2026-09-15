from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .api import ai_router, auth_router, books_router, credentials_router, jobs_router, progress_router, reader_settings_router
from .config import (
    CORS_ALLOW_ORIGIN_REGEX,
    CORS_ORIGINS,
    ENABLE_HSTS,
    ENABLE_SECURITY_HEADERS,
    HSTS_MAX_AGE_SECONDS,
    PERMISSIONS_POLICY_CAMERA,
)
from .db import init_db
from .services.runtime_guard import validate_runtime_config

app = FastAPI(title="Speed Reader API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ALLOW_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    validate_runtime_config()
    init_db()


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    if not ENABLE_SECURITY_HEADERS:
        return response

    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    camera_policy = "camera=(self)" if PERMISSIONS_POLICY_CAMERA == "self" else "camera=()"
    response.headers.setdefault("Permissions-Policy", f"{camera_policy}, microphone=(), geolocation=()")
    response.headers.setdefault("Cache-Control", "no-store")

    if ENABLE_HSTS and request.url.scheme == "https":
        response.headers.setdefault("Strict-Transport-Security", f"max-age={HSTS_MAX_AGE_SECONDS}; includeSubDomains")

    return response


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


app.include_router(auth_router)
app.include_router(credentials_router)
app.include_router(books_router)
app.include_router(jobs_router)
app.include_router(progress_router)
app.include_router(reader_settings_router)
app.include_router(ai_router)
