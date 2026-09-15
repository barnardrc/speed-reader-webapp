from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..models.schemas import JobStatusResponse
from ..services.container import job_manager

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("/{job_id}", response_model=JobStatusResponse)
def get_job_status(job_id: str) -> JobStatusResponse:
    try:
        job = job_manager.get_job(job_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown job_id")

    return JobStatusResponse(
        job_id=job["job_id"],
        type=job["type"],
        status=job["status"],
        error=job.get("error"),
        result={**job.get("result", {}), "progress": job.get("progress", 0)},
    )
