from .routes_ai import router as ai_router
from .routes_auth import router as auth_router
from .routes_books import router as books_router
from .routes_credentials import router as credentials_router
from .routes_jobs import router as jobs_router
from .routes_progress import router as progress_router
from .routes_reader_settings import router as reader_settings_router

__all__ = [
    "ai_router",
    "auth_router",
    "books_router",
    "credentials_router",
    "jobs_router",
    "progress_router",
    "reader_settings_router",
]
