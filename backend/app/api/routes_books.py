from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from ..config import UPLOADS_DIR
from ..models.schemas import (
    BookContentResponse,
    ParseRequest,
    ParseResponse,
    UploadResponse,
)
from ..services.container import book_store, job_manager

router = APIRouter(prefix="/books", tags=["books"])

ALLOWED_EXTENSIONS = {".pdf", ".epub"}
UPLOAD_CHUNK_SIZE = 1024 * 1024


@router.post("/upload", response_model=UploadResponse)
async def upload_book(file: UploadFile = File(...)) -> UploadResponse:
    original_name = file.filename or "uploaded_book"
    suffix = Path(original_name).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only PDF and EPUB are supported.")

    stored_name = f"{uuid.uuid4()}{suffix}"
    stored_path = UPLOADS_DIR / stored_name

    try:
        with stored_path.open("wb") as output_file:
            while True:
                chunk = await file.read(UPLOAD_CHUNK_SIZE)
                if not chunk:
                    break
                output_file.write(chunk)
    except Exception:
        try:
            stored_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    finally:
        await file.close()

    book_id = book_store.create_upload_entry(filename=Path(original_name).name, stored_path=stored_path)
    return UploadResponse(book_id=book_id, filename=Path(original_name).name)


@router.post("/{book_id}/parse", response_model=ParseResponse)
def parse_book(book_id: str, payload: ParseRequest) -> ParseResponse:
    try:
        job_id = job_manager.submit_parse_job(book_id=book_id, force=payload.force)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown book_id")

    return ParseResponse(job_id=job_id, status="queued")


@router.get("/{book_id}/content", response_model=BookContentResponse)
def get_book_content(book_id: str) -> BookContentResponse:
    try:
        parsed = book_store.get_parsed_content(book_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown book_id")
    except FileNotFoundError:
        raise HTTPException(status_code=409, detail="Book is not parsed yet")

    words = parsed.get("words", [])
    chapters = parsed.get("chapters", [])
    page_map = parsed.get("page_map", {})
    footnotes = parsed.get("footnotes", {})

    # JSON can materialize dict keys as strings; normalize for API consistency.
    page_map = {str(k): int(v) for k, v in page_map.items()}
    footnotes = {str(k): str(v) for k, v in footnotes.items()}

    return BookContentResponse(
        book_id=book_id,
        words=words,
        chapters=chapters,
        page_map=page_map,
        footnotes=footnotes,
    )
