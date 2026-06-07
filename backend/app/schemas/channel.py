"""チャンネルスキーマ。"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ChannelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    youtube_channel_id: str
    name: str
    handle: str | None
    is_own: bool
    is_default_competitor: bool
    is_enabled: bool
