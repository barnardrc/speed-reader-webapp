from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = BACKEND_DIR.parent


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.lower().startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue

        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


# Ensure local `.env` values are consistently available in development and LAN runs.
for env_file in (BACKEND_DIR / ".env", ROOT_DIR / ".env"):
    _load_env_file(env_file)

DATA_DIR = ROOT_DIR / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
BOOKS_DIR = DATA_DIR / "books"
BOOK_INDEX_FILE = DATA_DIR / "books_index.json"
DB_FILE = DATA_DIR / "app.db"

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DB_FILE.as_posix()}")
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-only-change-this-secret")
JWT_ALGORITHM = "HS256"
JWT_ACCESS_TOKEN_EXPIRES_MINUTES = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRES_MINUTES", "60"))
MASTER_ENCRYPTION_KEY = os.getenv("MASTER_ENCRYPTION_KEY", "").strip()
master_fallbacks_raw = os.getenv("MASTER_ENCRYPTION_KEY_FALLBACKS", "").strip()
MASTER_ENCRYPTION_KEY_FALLBACKS = [item.strip() for item in master_fallbacks_raw.split(",") if item.strip()]

# Managed provider keys for server-paid usage.
ENTERPRISE_OPENAI_API_KEY = os.getenv("ENTERPRISE_OPENAI_API_KEY", "").strip()
ENTERPRISE_ANTHROPIC_API_KEY = os.getenv("ENTERPRISE_ANTHROPIC_API_KEY", "").strip()
ENTERPRISE_GEMINI_API_KEY = os.getenv("ENTERPRISE_GEMINI_API_KEY", "").strip()
ENTERPRISE_OLLAMA_API_KEY = os.getenv("ENTERPRISE_OLLAMA_API_KEY", "").strip()

AI_DEFAULT_OPENAI_MODEL = os.getenv("AI_DEFAULT_OPENAI_MODEL", "openai/gpt-4o-mini").strip()
AI_DEFAULT_ANTHROPIC_MODEL = os.getenv("AI_DEFAULT_ANTHROPIC_MODEL", "anthropic/claude-3-5-haiku-latest").strip()
AI_DEFAULT_GEMINI_MODEL = os.getenv("AI_DEFAULT_GEMINI_MODEL", "gemini/gemini-2.0-flash").strip()
AI_DEFAULT_OLLAMA_MODEL = os.getenv("AI_DEFAULT_OLLAMA_MODEL", "ollama/llama3.1").strip()

DEFAULT_CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
cors_origins_raw = os.getenv("CORS_ORIGINS", DEFAULT_CORS_ORIGINS)
CORS_ORIGINS = [origin.strip() for origin in cors_origins_raw.split(",") if origin.strip()]

DEFAULT_FREE_CREDITS = int(os.getenv("DEFAULT_FREE_CREDITS", "50000"))
APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
default_enforce = "0" if APP_ENV in {"development", "dev", "local"} else "1"
ENFORCE_STARTUP_VALIDATION = os.getenv("ENFORCE_STARTUP_VALIDATION", default_enforce) == "1"
ENABLE_SECURITY_HEADERS = os.getenv("ENABLE_SECURITY_HEADERS", "1") == "1"
ENABLE_HSTS = os.getenv("ENABLE_HSTS", "0") == "1"
HSTS_MAX_AGE_SECONDS = int(os.getenv("HSTS_MAX_AGE_SECONDS", "31536000"))

default_allow_lan_origins = "1" if APP_ENV in {"development", "dev", "local"} else "0"
ALLOW_LAN_ORIGINS = os.getenv("ALLOW_LAN_ORIGINS", default_allow_lan_origins) == "1"
default_lan_origin_regex = (
    r"^https?://("
    r"localhost|127\.0\.0\.1|"
    r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
    r"192\.168\.\d{1,3}\.\d{1,3}|"
    r"172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|"
    r"[A-Za-z0-9-]+(?:\.local)?"
    r")(?::\d+)?$"
)
cors_origin_regex_raw = os.getenv("CORS_ALLOW_ORIGIN_REGEX", "").strip()
CORS_ALLOW_ORIGIN_REGEX = (
    cors_origin_regex_raw
    if cors_origin_regex_raw
    else (default_lan_origin_regex if ALLOW_LAN_ORIGINS else None)
)

default_camera_policy = "self" if APP_ENV in {"development", "dev", "local"} else "none"
permissions_camera_raw = os.getenv("PERMISSIONS_POLICY_CAMERA", default_camera_policy).strip().lower()
PERMISSIONS_POLICY_CAMERA = permissions_camera_raw if permissions_camera_raw in {"none", "self"} else "none"

TRUST_PROXY_IP_HEADERS = os.getenv("TRUST_PROXY_IP_HEADERS", "0") == "1"
RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))
AUTH_LOGIN_RATE_LIMIT = int(os.getenv("AUTH_LOGIN_RATE_LIMIT", "12"))
AUTH_SIGNUP_RATE_LIMIT = int(os.getenv("AUTH_SIGNUP_RATE_LIMIT", "6"))
AI_CHAT_RATE_LIMIT = int(os.getenv("AI_CHAT_RATE_LIMIT", "40"))
CREDENTIAL_WRITE_RATE_LIMIT = int(os.getenv("CREDENTIAL_WRITE_RATE_LIMIT", "20"))

for directory in (DATA_DIR, UPLOADS_DIR, BOOKS_DIR):
    directory.mkdir(parents=True, exist_ok=True)
