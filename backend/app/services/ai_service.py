from __future__ import annotations

import logging
import os
import re
from typing import Any

import requests
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import (
    AI_DEFAULT_ANTHROPIC_MODEL,
    AI_DEFAULT_GEMINI_MODEL,
    AI_DEFAULT_OLLAMA_MODEL,
    AI_DEFAULT_OPENAI_MODEL,
    ENTERPRISE_ANTHROPIC_API_KEY,
    ENTERPRISE_GEMINI_API_KEY,
    ENTERPRISE_OLLAMA_API_KEY,
    ENTERPRISE_OPENAI_API_KEY,
)
from ..models.db_models import UsageEvent, User, UserCredential
from .crypto import CryptoService

PROVIDER_DEFAULT_MODELS = {
    "openai": AI_DEFAULT_OPENAI_MODEL,
    "anthropic": AI_DEFAULT_ANTHROPIC_MODEL,
    "gemini": AI_DEFAULT_GEMINI_MODEL,
    "ollama": AI_DEFAULT_OLLAMA_MODEL,
}

MANAGED_PROVIDER_KEYS = {
    "openai": ENTERPRISE_OPENAI_API_KEY,
    "anthropic": ENTERPRISE_ANTHROPIC_API_KEY,
    "gemini": ENTERPRISE_GEMINI_API_KEY,
    "ollama": ENTERPRISE_OLLAMA_API_KEY,
}

logger = logging.getLogger(__name__)
VALID_AI_MODES = frozenset({"auto", "byok", "managed"})


class AIServiceError(RuntimeError):
    def __init__(self, user_message: str, *, status_code: int = 503) -> None:
        super().__init__(user_message)
        self.user_message = user_message
        self.status_code = status_code


class AIService:
    def __init__(self, crypto_service: CryptoService) -> None:
        self.crypto_service = crypto_service
        self.ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434")
        self.model = os.getenv("OLLAMA_MODEL", "llama3")
        self.timeout = int(os.getenv("OLLAMA_TIMEOUT", "30"))
        self.allow_fallback = os.getenv("AI_FALLBACK", "0") == "1"

    def _generate(self, prompt: str) -> str:
        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": {"num_ctx": 4096},
        }
        try:
            response = requests.post(
                f"{self.ollama_url}/api/generate",
                json=payload,
                timeout=self.timeout,
            )
        except requests.Timeout as exc:
            raise AIServiceError(
                f"AI request timed out after {self.timeout}s. Verify model health or increase OLLAMA_TIMEOUT.",
                status_code=504,
            ) from exc
        except requests.ConnectionError as exc:
            raise AIServiceError(
                f"AI backend is unreachable at {self.ollama_url}. Ensure Ollama is running and reachable.",
                status_code=503,
            ) from exc
        except requests.RequestException as exc:
            raise AIServiceError(
                f"AI request failed before reaching the backend ({exc.__class__.__name__}).",
                status_code=502,
            ) from exc

        status = response.status_code
        if status >= 400:
            if status == 404:
                raise AIServiceError(f"AI model '{self.model}' was not found on the backend.", status_code=502)
            if status == 429:
                raise AIServiceError("AI backend is rate-limiting requests. Retry shortly.", status_code=503)
            if status >= 500:
                raise AIServiceError("AI backend is currently unavailable. Retry shortly.", status_code=503)
            raise AIServiceError(f"AI backend rejected the request (HTTP {status}).", status_code=502)

        try:
            data = response.json()
        except ValueError as exc:
            raise AIServiceError("AI backend returned an unreadable response.", status_code=502) from exc

        text = data.get("response")
        if not isinstance(text, str) or not text.strip():
            raise AIServiceError("AI backend returned an empty response.", status_code=502)
        return text.strip()

    @staticmethod
    def _build_question_prompt(text_chunk: str) -> str:
        return (
            f"Text Chunk:\n\"{text_chunk}\"\n\n"
            "Task: Generate one complete reading comprehension question based on the text above.\n\n"
            "Requirements:\n"
            "1. Priority: Test the reader's understanding of the central idea, cause-and-effect, or the logic behind the passage.\n"
            "2. Fallback: If the text is purely informational, ask about a significant factual detail.\n"
            "3. Constraint: Avoid asking for direct quotes or trivial formatting details. The question should require the reader to have actually processed the meaning of the text.\n"
            "4. Format: Provide only the question. Do not provide the answer.\n"
            "5. Output exactly one sentence under 35 words.\n"
            "6. End the sentence with a question mark.\n"
            "7. Ensure the question is complete and not truncated."
        )

    @staticmethod
    def _build_entities_prompt(text_chunk: str) -> str:
        return (
            "Analyze the text below. Extract ONLY:\n"
            "1. Important People (specific named characters)\n"
            "2. Important dates or years\n\n"
            "For each, provide a brief summary of their significance in this specific text. Use ONLY information from the context.\n"
            "Format: Name/Date - Significance\n"
            "Constraints:\n"
            "- Exclude section headers, chapter titles, locations, and generic nouns.\n"
            "- If the entity is mentioned but has no significance here, ignore it.\n"
            "- Return all matching entities from the text chunk; do not truncate the list.\n"
            "- If no people or dates are found, output exactly: None.\n\n"
            f"Text:\n{text_chunk}"
        )

    def generate_question(self, text_chunk: str) -> str:
        prompt = self._build_question_prompt(text_chunk)
        return self._safe_generate(prompt, fallback=self._fallback_question(text_chunk))

    def extract_entities(self, text_chunk: str) -> str:
        prompt = self._build_entities_prompt(text_chunk)
        return self._safe_generate(prompt, fallback="None")

    def _safe_generate(self, prompt: str, fallback: str) -> str:
        try:
            output = self._generate(prompt)
            if output:
                return output
        except AIServiceError as exc:
            if not self.allow_fallback:
                raise
            logger.warning("AI generation failed; using fallback. reason=%s", exc.user_message)
        except Exception:
            if not self.allow_fallback:
                raise AIServiceError("AI generation failed due to an unexpected error.", status_code=502)
            logger.exception("Unexpected AI generation failure; using fallback.")
        return fallback

    @staticmethod
    def _fallback_question(text_chunk: str) -> str:
        words = [w for w in text_chunk.split() if w]
        if not words:
            return "What is the key point of this passage?"

        sample = " ".join(words[:20])
        if len(words) > 20:
            sample += " ..."
        return f"What is the main idea conveyed in this passage: {sample}?"

    @staticmethod
    def _normalize_question_output(raw: str) -> str:
        cleaned = raw.strip()
        if not cleaned:
            return ""

        cleaned = re.sub(r"^```[a-z]*\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.IGNORECASE).strip()
        cleaned = re.sub(r"^\s*question\s*:\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        if not cleaned:
            return ""

        match = re.search(r"(.+?\?)", cleaned)
        if match:
            return match.group(1).strip()
        return ""

    @staticmethod
    def _normalize_provider(provider: str) -> str:
        normalized = provider.strip().lower()
        if normalized not in PROVIDER_DEFAULT_MODELS:
            raise ValueError("Unsupported provider. Use openai, anthropic, gemini, or ollama.")
        return normalized

    @staticmethod
    def _normalize_mode(mode: str) -> str:
        normalized = mode.strip().lower()
        if normalized not in VALID_AI_MODES:
            raise ValueError("Invalid mode. Use auto, byok, or managed.")
        return normalized

    @staticmethod
    def _normalize_model(provider: str, model: str | None) -> str:
        if not model:
            return PROVIDER_DEFAULT_MODELS[provider]

        normalized = model.strip()
        if "/" in normalized:
            return normalized
        return f"{provider}/{normalized}"

    @staticmethod
    def _extract_message_text(result: Any) -> str:
        if isinstance(result, dict):
            choices = result.get("choices") or []
        else:
            choices = getattr(result, "choices", [])

        if not choices:
            return ""

        first = choices[0]
        message = first.get("message") if isinstance(first, dict) else getattr(first, "message", None)
        if isinstance(message, dict):
            content = message.get("content", "")
        else:
            content = getattr(message, "content", "")

        if isinstance(content, list):
            parts: list[str] = []
            for chunk in content:
                if isinstance(chunk, dict) and chunk.get("type") == "text":
                    parts.append(str(chunk.get("text", "")))
            return "".join(parts).strip()

        return str(content).strip()

    @staticmethod
    def _extract_usage(result: Any) -> tuple[int | None, int | None, int | None]:
        usage = result.get("usage") if isinstance(result, dict) else getattr(result, "usage", None)
        if usage is None:
            return None, None, None

        if isinstance(usage, dict):
            prompt_tokens = usage.get("prompt_tokens")
            completion_tokens = usage.get("completion_tokens")
            total_tokens = usage.get("total_tokens")
        else:
            prompt_tokens = getattr(usage, "prompt_tokens", None)
            completion_tokens = getattr(usage, "completion_tokens", None)
            total_tokens = getattr(usage, "total_tokens", None)

        prompt = int(prompt_tokens) if isinstance(prompt_tokens, (int, float)) else None
        completion_count = int(completion_tokens) if isinstance(completion_tokens, (int, float)) else None
        total = int(total_tokens) if isinstance(total_tokens, (int, float)) else None
        return prompt, completion_count, total

    @staticmethod
    def _estimate_total_tokens(prompt: str, response: str) -> int:
        prompt_estimate = max(1, len(prompt.split()))
        response_estimate = max(1, len(response.split()))
        return prompt_estimate + response_estimate

    @staticmethod
    def _sanitize_error_message(error: Exception) -> str:
        message = str(error).replace("\n", " ").strip()
        if not message:
            return "provider_error"
        return message[:500]

    @staticmethod
    def _map_provider_exception(error: Exception) -> AIServiceError:
        message = str(error).strip()
        lowered = message.lower()
        name = error.__class__.__name__.lower()

        status_match = re.search(r'(?:\"code\"|status(?:_code)?|http)\s*[:=]?\s*(\d{3})', lowered)
        if status_match:
            status_code = int(status_match.group(1))
            if status_code in {400, 404}:
                return AIServiceError("AI request is invalid for the selected model. Verify provider/model settings.", status_code=400)
            if status_code == 401:
                return AIServiceError(
                    "AI provider rejected authentication. Verify the selected provider key.",
                    status_code=401,
                )
            if status_code == 402:
                return AIServiceError("AI provider account has insufficient quota or billing is required.", status_code=402)
            if status_code == 403:
                return AIServiceError("AI provider denied access to this model or key.", status_code=403)
            if status_code == 408:
                return AIServiceError("AI provider request timed out. Please retry.", status_code=504)
            if status_code == 429:
                return AIServiceError("AI provider is rate-limiting requests. Please retry shortly.", status_code=429)
            if status_code >= 500:
                return AIServiceError("AI provider is currently unavailable. Please retry shortly.", status_code=503)

        if "timeout" in lowered or "timed out" in lowered or "timeout" in name:
            return AIServiceError("AI provider request timed out. Please retry.", status_code=504)

        if (
            "connection" in lowered
            or "network" in lowered
            or "unreachable" in lowered
            or "dns" in lowered
            or "connection" in name
        ):
            return AIServiceError("AI provider is temporarily unreachable. Please retry.", status_code=503)

        if (
            "rate limit" in lowered
            or "too many requests" in lowered
            or "429" in lowered
            or "ratelimit" in name
        ):
            return AIServiceError("AI provider is rate-limiting requests. Please retry shortly.", status_code=429)

        if (
            "insufficient_quota" in lowered
            or "insufficient quota" in lowered
            or "quota" in lowered
            or "billing" in lowered
            or "credit" in lowered
            or "402" in lowered
        ):
            return AIServiceError("AI provider account has insufficient quota or billing is required.", status_code=402)

        if (
            "api key" in lowered
            or "authentication" in lowered
            or "unauthorized" in lowered
            or "forbidden" in lowered
            or "401" in lowered
            or "403" in lowered
            or "auth" in name
        ):
            return AIServiceError(
                "AI provider rejected authentication. Verify the selected provider key.",
                status_code=401,
            )

        if (
            "context length" in lowered
            or "prompt is too long" in lowered
            or "max tokens" in lowered
            or "invalid_request" in lowered
            or "model not found" in lowered
            or "unknown model" in lowered
            or "not found for api version" in lowered
            or "is not supported for generatecontent" in lowered
            or "not_found" in lowered
            or "400" in lowered
            or "badrequest" in name
        ):
            return AIServiceError("AI request is invalid for the selected model. Reduce prompt or max tokens.", status_code=400)

        if message:
            return AIServiceError(f"AI provider error: {message[:220]}", status_code=502)
        return AIServiceError("AI provider request failed unexpectedly.", status_code=502)

    def _get_active_credential(self, db: Session, user: User, provider: str) -> UserCredential | None:
        return db.scalar(
            select(UserCredential).where(
                UserCredential.user_id == user.id,
                UserCredential.provider == provider,
                UserCredential.is_active.is_(True),
            )
        )

    def _resolve_api_key(self, db: Session, user: User, provider: str, mode: str) -> tuple[str, str]:
        normalized_mode = self._normalize_mode(mode)
        credential = self._get_active_credential(db, user, provider)
        cached_decrypted_credential: str | None = None
        credential_loaded = False

        def _decrypted_credential() -> str | None:
            nonlocal cached_decrypted_credential, credential_loaded
            if credential_loaded:
                return cached_decrypted_credential
            credential_loaded = True
            if not credential:
                return None
            cached_decrypted_credential = self.crypto_service.decrypt(credential.encrypted_api_key)
            return cached_decrypted_credential

        credential_key: str | None = None
        if normalized_mode in {"auto", "byok"}:
            credential_key = _decrypted_credential()
            if credential_key:
                return credential_key, "byok"

        if normalized_mode == "byok":
            raise ValueError(f"No active {provider} credential found for BYOK mode.")

        managed_key = MANAGED_PROVIDER_KEYS.get(provider, "")
        if managed_key:
            if user.credit_balance <= 0:
                raise ValueError("Insufficient credits for managed mode.")
            return managed_key, "managed"

        if credential_key is None:
            credential_key = _decrypted_credential()
        if credential_key:
            return credential_key, "byok"

        raise ValueError(f"No key configured for provider '{provider}'. Add a BYOK key or set enterprise credentials.")

    def generate_question_with_provider(
        self,
        db: Session,
        user: User,
        *,
        text_chunk: str,
        provider: str,
        model: str | None,
        mode: str,
    ) -> str:
        result = self.proxy_chat(
            db=db,
            user=user,
            prompt=self._build_question_prompt(text_chunk),
            provider=provider,
            model=model,
            mode=mode,
            temperature=0.2,
            max_tokens=700,
        )
        content = self._normalize_question_output(result["content"])
        if not content:
            fallback = self._normalize_question_output(self._fallback_question(text_chunk))
            if fallback:
                return fallback
            raise AIServiceError("AI provider returned an empty or incomplete question.", status_code=502)
        return content

    def extract_entities_with_provider(
        self,
        db: Session,
        user: User,
        *,
        text_chunk: str,
        provider: str,
        model: str | None,
        mode: str,
    ) -> str:
        result = self.proxy_chat(
            db=db,
            user=user,
            prompt=self._build_entities_prompt(text_chunk),
            provider=provider,
            model=model,
            mode=mode,
            temperature=0.1,
            max_tokens=900,
        )
        content = result["content"].strip()
        return content or "None"

    def proxy_chat(
        self,
        db: Session,
        user: User,
        *,
        prompt: str,
        provider: str,
        model: str | None,
        mode: str,
        temperature: float,
        max_tokens: int | None,
    ) -> dict[str, Any]:
        normalized_provider = self._normalize_provider(provider)
        normalized_model = self._normalize_model(normalized_provider, model)
        api_key, mode_used = self._resolve_api_key(db, user, normalized_provider, mode)

        status = "succeeded"
        error_message: str | None = None
        prompt_tokens: int | None = None
        completion_tokens: int | None = None
        total_tokens: int | None = None
        credits_deducted = 0
        content = ""

        try:
            from litellm import completion

            completion_kwargs: dict[str, Any] = {
                "model": normalized_model,
                "api_key": api_key,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
            if normalized_provider == "ollama":
                completion_kwargs["api_base"] = self.ollama_url

            result = completion(
                **completion_kwargs,
            )
            content = self._extract_message_text(result)
            prompt_tokens, completion_tokens, total_tokens = self._extract_usage(result)

            if total_tokens is None:
                total_tokens = self._estimate_total_tokens(prompt, content)

            if mode_used == "managed":
                credits_deducted = max(1, total_tokens)
                if user.credit_balance < credits_deducted:
                    raise ValueError("Insufficient credits for this request.")
                user.credit_balance -= credits_deducted

        except Exception as exc:
            status = "failed"
            error_message = self._sanitize_error_message(exc)
            raise self._map_provider_exception(exc) from exc
        finally:
            event = UsageEvent(
                user_id=user.id,
                provider=normalized_provider,
                model=normalized_model,
                mode_used=mode_used,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                credits_deducted=credits_deducted,
                status=status,
                error=error_message,
            )
            db.add(event)
            db.add(user)
            db.commit()

        return {
            "content": content,
            "provider": normalized_provider,
            "model": normalized_model,
            "mode_used": mode_used,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "credits_deducted": credits_deducted,
            "credit_balance": user.credit_balance,
        }
