from __future__ import annotations

from .ai_service import AIService
from .book_store import BookStore
from .crypto import CryptoService
from .job_manager import JobManager

book_store = BookStore()
job_manager = JobManager(book_store=book_store)
crypto_service = CryptoService()
ai_service = AIService(crypto_service=crypto_service)
