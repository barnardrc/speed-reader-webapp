from __future__ import annotations

import logging
from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..config import AI_CHAT_RATE_LIMIT, RATE_LIMIT_WINDOW_SECONDS
from ..db import get_db
from ..models.db_models import User
from ..models.schemas import (
    AIChatRequest,
    AIChatResponse,
    EntitiesRequest,
    EntitiesResponse,
    QuestionRequest,
    QuestionResponse,
)
from ..services.container import ai_service
from ..services.ai_service import AIServiceError
from ..services.rate_limit import enforce_rate_limit
from ..services.security import get_current_user

router = APIRouter(prefix="/ai", tags=["ai"])
logger = logging.getLogger(__name__)
AI_RATE_LIMIT_DETAIL = "Too many AI requests. Please slow down and retry shortly."


def _enforce_ai_rate_limit(scope: str, user_id: str) -> None:
    enforce_rate_limit(
        key=f"ai:{scope}:user:{user_id}",
        max_requests=AI_CHAT_RATE_LIMIT,
        window_seconds=RATE_LIMIT_WINDOW_SECONDS,
        detail=AI_RATE_LIMIT_DETAIL,
    )


def _raise_known_ai_error(exc: AIServiceError | ValueError) -> NoReturn:
    if isinstance(exc, AIServiceError):
        raise HTTPException(status_code=exc.status_code, detail=exc.user_message) from exc

    message = str(exc)
    if "insufficient credits" in message.lower():
        raise HTTPException(status_code=402, detail=message) from exc
    raise HTTPException(status_code=400, detail=message) from exc


@router.post("/question", response_model=QuestionResponse)
def generate_question(
    payload: QuestionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> QuestionResponse:
    _enforce_ai_rate_limit("question", current_user.id)

    try:
        question = ai_service.generate_question_with_provider(
            db=db,
            user=current_user,
            text_chunk=payload.text_chunk,
            provider=payload.provider,
            model=payload.model,
            mode=payload.mode,
        )
    except (AIServiceError, ValueError) as exc:
        _raise_known_ai_error(exc)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Question generation failed for user_id=%s", current_user.id)
        raise HTTPException(status_code=502, detail="Failed to generate comprehension question.") from exc
    return QuestionResponse(question=question)


@router.post("/entities", response_model=EntitiesResponse)
def extract_entities(
    payload: EntitiesRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EntitiesResponse:
    _enforce_ai_rate_limit("entities", current_user.id)

    try:
        entities = ai_service.extract_entities_with_provider(
            db=db,
            user=current_user,
            text_chunk=payload.text_chunk,
            provider=payload.provider,
            model=payload.model,
            mode=payload.mode,
        )
    except (AIServiceError, ValueError) as exc:
        _raise_known_ai_error(exc)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Entity extraction failed for user_id=%s", current_user.id)
        raise HTTPException(status_code=502, detail="Failed to extract entities from context.") from exc
    return EntitiesResponse(entities=entities)


@router.post("/chat", response_model=AIChatResponse)
def chat(
    payload: AIChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AIChatResponse:
    _enforce_ai_rate_limit("chat", current_user.id)

    try:
        result = ai_service.proxy_chat(
            db=db,
            user=current_user,
            prompt=payload.prompt,
            provider=payload.provider,
            model=payload.model,
            mode=payload.mode,
            temperature=payload.temperature,
            max_tokens=payload.max_tokens,
        )
    except (AIServiceError, ValueError) as exc:
        _raise_known_ai_error(exc)
    except Exception as exc:  # noqa: BLE001
        logger.exception("AI provider request failed for user_id=%s", current_user.id)
        raise HTTPException(status_code=502, detail="AI provider request failed. Please retry.") from exc

    return AIChatResponse(
        content=result["content"],
        provider=result["provider"],
        model=result["model"],
        mode_used=result["mode_used"],
        usage={
            "prompt_tokens": result["prompt_tokens"],
            "completion_tokens": result["completion_tokens"],
            "total_tokens": result["total_tokens"],
        },
        credits_deducted=result["credits_deducted"],
        credit_balance=result["credit_balance"],
    )
