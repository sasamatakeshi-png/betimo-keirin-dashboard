"""AI 分析スキーマ。"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AnalysisTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    screen_type: str | None
    prompt: str
    reference_data_keys: list[str]
    comparison_target: str | None
    tone: str | None
    length: str | None
    is_default: bool
    is_enabled: bool


class AnalysisRunRequest(BaseModel):
    entity_type: str
    entity_id: UUID
    template_id: UUID | None = None
    prompt: str | None = None  # template_id 無指定時の ad-hoc プロンプト
    tone: str | None = None
    length: str | None = None


class AnalysisRunResult(BaseModel):
    id: UUID
    generated_text: str


class AnalysisResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    template_id: UUID | None
    entity_type: str | None
    entity_id: UUID | None
    generated_text: str
    input_data_snapshot: dict[str, Any] | None
    user_edits: str | None
    generated_at: datetime


class AnalysisResultUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_edits: str
