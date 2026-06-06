"""動画スキーマ。"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class VideoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    youtube_video_id: str | None
    channel_id: UUID
    event_id: UUID | None
    title: str
    published_at: datetime | None
    duration_seconds: int | None
    venue: str | None
    grade: str | None
    title_tag: str | None
    program_type: str | None
    cast_members: list[str]
    thumbnail_url: str | None
    is_competitor: bool
    content_type: str
    created_at: datetime
    updated_at: datetime
    # ?include=metrics 指定時、または詳細取得時のみ {metric_key: value} が入る。
    metrics: dict[str, float] | None = None


class VideoUpdate(BaseModel):
    """PATCH /videos/{id} の編集対象（全データ一覧のインライン編集用）。

    未指定フィールドは変更しない（exclude_unset で判定）。
    """

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    program_type: str | None = None
    event_id: UUID | None = None
    cast_members: list[str] | None = None
    venue: str | None = None
    grade: str | None = None
    title_tag: str | None = None


# ----- ③ 番組比較 -----


class CompareMetrics(BaseModel):
    """主要指標表。存在しない指標は null。"""

    imp: float | None = None
    view_count: float | None = None
    subscriber_gain: float | None = None
    unique_viewers: float | None = None
    live_views: float | None = None
    archive_views: float | None = None
    avg_concurrent_viewers: float | None = None
    max_concurrent_viewers: float | None = None
    avg_view_duration: float | None = None
    avg_view_percentage: float | None = None
    repeater_ratio: float | None = None


class CompareVideo(BaseModel):
    id: UUID
    title: str
    program_type: str | None
    published_at: datetime | None
    event_name: str | None
    metrics: CompareMetrics


class TimeseriesOverlayPoint(BaseModel):
    elapsed_seconds: int
    value: float


class TimeseriesOverlay(BaseModel):
    video_id: UUID
    title: str
    points: list[TimeseriesOverlayPoint]


class CompareResponse(BaseModel):
    videos: list[CompareVideo]
    timeseries_overlay: list[TimeseriesOverlay]
    not_found: list[str]
