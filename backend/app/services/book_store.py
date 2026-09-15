from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Dict

from ..config import BOOK_INDEX_FILE, BOOKS_DIR


class BookStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._index: Dict[str, Dict[str, Any]] = {}
        self._load_index()

    def _load_index(self) -> None:
        if not BOOK_INDEX_FILE.exists():
            self._index = {}
            return

        try:
            self._index = json.loads(BOOK_INDEX_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            self._index = {}

    def _save_index(self) -> None:
        temp_file = BOOK_INDEX_FILE.with_suffix(".tmp")
        temp_file.write_text(json.dumps(self._index, indent=2), encoding="utf-8")
        temp_file.replace(BOOK_INDEX_FILE)

    def create_upload_entry(self, filename: str, stored_path: Path) -> str:
        with self._lock:
            book_id = str(uuid.uuid4())
            self._index[book_id] = {
                "book_id": book_id,
                "filename": filename,
                "uploaded_path": str(stored_path),
                "parsed": False,
                "parsed_path": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            self._save_index()
            return book_id

    def get_upload_path(self, book_id: str) -> Path:
        with self._lock:
            entry = self._index.get(book_id)
            if not entry:
                raise KeyError(f"Unknown book_id: {book_id}")
            uploaded_path = entry.get("uploaded_path")
        return Path(uploaded_path)

    def save_parsed_content(self, book_id: str, content: Dict[str, Any]) -> None:
        with self._lock:
            entry = self._index.get(book_id)
            if not entry:
                raise KeyError(f"Unknown book_id: {book_id}")

            output_path = BOOKS_DIR / f"{book_id}.json"
            output_path.write_text(json.dumps(content), encoding="utf-8")

            entry["parsed"] = True
            entry["parsed_path"] = str(output_path)
            entry["updated_at"] = datetime.now(timezone.utc).isoformat()
            self._save_index()

    def has_parsed_content(self, book_id: str) -> bool:
        with self._lock:
            entry = self._index.get(book_id)
            return bool(entry and entry.get("parsed") and entry.get("parsed_path"))

    def get_parsed_content(self, book_id: str) -> Dict[str, Any]:
        with self._lock:
            entry = self._index.get(book_id)
            if not entry:
                raise KeyError(f"Unknown book_id: {book_id}")
            parsed_path_value = entry.get("parsed_path")
            if not entry.get("parsed") or not parsed_path_value:
                raise FileNotFoundError(f"Book not parsed yet: {book_id}")

        parsed_path = Path(parsed_path_value)
        if not parsed_path.exists():
            raise FileNotFoundError(f"Missing parsed payload: {book_id}")

        return json.loads(parsed_path.read_text(encoding="utf-8"))

    def get_entry(self, book_id: str) -> Dict[str, Any]:
        with self._lock:
            entry = self._index.get(book_id)
            if not entry:
                raise KeyError(f"Unknown book_id: {book_id}")
            return dict(entry)
