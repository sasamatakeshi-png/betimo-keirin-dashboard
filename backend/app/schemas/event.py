"""イベントスキーマ。"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    venue: str | None
    grade: str | None
    start_date: date | None
    end_date: date | None
    created_at: datetime
    updated_at: datetime
