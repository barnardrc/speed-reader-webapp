from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

ProviderName = Literal["openai", "anthropic", "gemini", "ollama"]
AIRequestMode = Literal["auto", "byok", "managed"]


class UploadResponse(BaseModel):
    book_id: str
    filename: str


class ParseRequest(BaseModel):
    force: bool = False


class ParseResponse(BaseModel):
    job_id: str
    status: str


class JobStatusResponse(BaseModel):
    job_id: str
    type: str
    status: str
    error: Optional[str] = None
    result: Dict[str, Any] = Field(default_factory=dict)


class BookContentResponse(BaseModel):
    book_id: str
    words: List[str]
    chapters: List[List[Any]]
    page_map: Dict[str, int]
    footnotes: Dict[str, str]


class ProgressPayload(BaseModel):
    book_title: str = Field(min_length=1, max_length=512)
    index: int = Field(ge=0)


class ProgressResponse(BaseModel):
    book_title: str
    index: int


class ReaderSettingsPayload(BaseModel):
    settings: Dict[str, Any] = Field(default_factory=dict)


class ReaderSettingsResponse(BaseModel):
    settings: Dict[str, Any]


class QuestionRequest(BaseModel):
    text_chunk: str
    provider: ProviderName = "openai"
    model: Optional[str] = None
    mode: AIRequestMode = "byok"


class QuestionResponse(BaseModel):
    question: str


class EntitiesRequest(BaseModel):
    text_chunk: str
    provider: ProviderName = "openai"
    model: Optional[str] = None
    mode: AIRequestMode = "byok"


class EntitiesResponse(BaseModel):
    entities: str


class SignupRequest(BaseModel):
    email: str
    password: str = Field(min_length=10, max_length=128)


class LoginRequest(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)


class DeleteAccountRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=128)
    confirmation: str = Field(min_length=1, max_length=64)


class UserResponse(BaseModel):
    id: str
    email: str
    plan_tier: str
    billing_mode: str
    credit_balance: int
    is_active: bool
    created_at: datetime


class AuthResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    user: UserResponse


class CredentialUpsertRequest(BaseModel):
    provider: ProviderName
    api_key: str = Field(min_length=10, max_length=512)
    label: Optional[str] = Field(default=None, max_length=128)

    @field_validator("api_key")
    @classmethod
    def validate_api_key_characters(cls, value: str) -> str:
        key = value.strip()
        if key != value:
            raise ValueError("API key cannot include leading or trailing whitespace.")
        # Visible ASCII only, so control characters and whitespace are rejected.
        if not re.fullmatch(r"[!-~]{10,512}", key):
            raise ValueError("API key must use visible non-whitespace characters only.")
        return key

    @field_validator("label")
    @classmethod
    def normalize_label(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @model_validator(mode="after")
    def validate_provider_key_format(self) -> "CredentialUpsertRequest":
        if self.provider == "openai" and not self.api_key.startswith("sk-"):
            raise ValueError("OpenAI API keys must start with 'sk-'.")
        if self.provider == "anthropic" and not self.api_key.startswith("sk-ant-"):
            raise ValueError("Anthropic API keys must start with 'sk-ant-'.")
        if self.provider == "gemini" and not self.api_key.startswith("AIza"):
            raise ValueError("Gemini API keys must start with 'AIza'.")
        return self


class CredentialResponse(BaseModel):
    id: str
    provider: str
    label: Optional[str] = None
    key_last4: str
    is_active: bool
    verified_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class CredentialListResponse(BaseModel):
    items: List[CredentialResponse] = Field(default_factory=list)


class AIChatRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=24000)
    provider: ProviderName = "openai"
    model: Optional[str] = None
    mode: AIRequestMode = "auto"
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    max_tokens: Optional[int] = Field(default=None, ge=1, le=4096)


class AIChatResponse(BaseModel):
    content: str
    provider: str
    model: str
    mode_used: str
    usage: Dict[str, Optional[int]] = Field(default_factory=dict)
    credits_deducted: int
    credit_balance: int
