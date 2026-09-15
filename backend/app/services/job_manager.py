from __future__ import annotations

import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from typing import Any, Dict

from .book_parser import parse_book
from .book_store import BookStore


class JobManager:
    def __init__(self, book_store: BookStore, max_workers: int = 2) -> None:
        self._book_store = book_store
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._lock = Lock()
        self._jobs: Dict[str, Dict[str, Any]] = {}

    def submit_parse_job(self, book_id: str, force: bool = False) -> str:
        if self._book_store.has_parsed_content(book_id) and not force:
            job_id = self._create_job("PARSE", {"book_id": book_id})
            self._update_job(
                job_id,
                status="succeeded",
                progress=100,
                result={"book_id": book_id, "cached": True},
            )
            return job_id

        upload_path = self._book_store.get_upload_path(book_id)
        job_id = self._create_job("PARSE", {"book_id": book_id, "path": str(upload_path)})
        self._executor.submit(self._run_parse_job, job_id, book_id, str(upload_path))
        return job_id

    def _create_job(self, job_type: str, payload: Dict[str, Any]) -> str:
        with self._lock:
            job_id = str(uuid.uuid4())
            self._jobs[job_id] = {
                "job_id": job_id,
                "type": job_type,
                "status": "queued",
                "progress": 0,
                "error": None,
                "result": payload,
            }
            return job_id

    def _update_job(self, job_id: str, **updates: Any) -> None:
        with self._lock:
            if job_id not in self._jobs:
                return
            self._jobs[job_id].update(updates)

    def _run_parse_job(self, job_id: str, book_id: str, file_path: str) -> None:
        self._update_job(job_id, status="running", progress=0)

        def on_progress(value: int) -> None:
            self._update_job(job_id, progress=max(0, min(100, int(value))))

        try:
            parsed = parse_book(file_path, progress_callback=on_progress)
            self._book_store.save_parsed_content(book_id, parsed)

            words = parsed.get("words", [])
            chapters = parsed.get("chapters", [])

            self._update_job(
                job_id,
                status="succeeded",
                progress=100,
                result={
                    "book_id": book_id,
                    "word_count": len(words),
                    "chapter_count": len(chapters),
                },
            )
        except Exception as exc:
            self._update_job(
                job_id,
                status="failed",
                error=f"{type(exc).__name__}: {exc}",
                result={"traceback": traceback.format_exc()},
            )

    def get_job(self, job_id: str) -> Dict[str, Any]:
        with self._lock:
            if job_id not in self._jobs:
                raise KeyError(f"Unknown job_id: {job_id}")
            return dict(self._jobs[job_id])
