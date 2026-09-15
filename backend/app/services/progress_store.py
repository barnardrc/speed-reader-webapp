from __future__ import annotations

import json
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Dict

from ..config import PROGRESS_FILE


class ProgressStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._progress: Dict[str, Dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        if not PROGRESS_FILE.exists():
            self._progress = {}
            return

        try:
            self._progress = json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            self._progress = {}

    def _save(self) -> None:
        temp_file = PROGRESS_FILE.with_suffix(".tmp")
        temp_file.write_text(json.dumps(self._progress, indent=2), encoding="utf-8")
        temp_file.replace(PROGRESS_FILE)

    def set_progress(self, book_id: str, index: int, settings: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            payload = {
                "book_id": book_id,
                "index": index,
                "settings": settings,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            self._progress[book_id] = payload
            self._save()
            return payload

    def get_progress(self, book_id: str) -> Dict[str, Any] | None:
        return self._progress.get(book_id)
