"""集計（画面専用）スキーマ。"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel

from app.schemas.event import EventOut
from app.schemas.video import VideoOut


class Kpi(BaseModel):
    """合計/代表値と、その算出に使った件数。値が無ければ value=None, count=0。

    期間指定時は前期間との比較も付与（未指定/比較不能なら None）。
    """

    value: float | None
    count: int
    prev_value: float | None = None
    change_ratio: float | None = None


class HomeKpis(BaseModel):
    total_impressions: Kpi
    total_views: Kpi
    total_subscriber_gain: Kpi
    max_concurrent_viewers: Kpi


class ViewsTrendPoint(BaseModel):
    date: str  # 'YYYY-MM-DD'（JST）
    views: float
    video_count: int


class RecentEvent(BaseModel):
    id: UUID
    name: str
    grade: str | None
    start_date: date | None
    end_date: date | None
    video_count: int


class IngestionStatus(BaseModel):
    status: str
    source_type: str
    file_name: str | None
    completed_at: datetime | None


class EventMarker(BaseModel):
    date: str  # イベント開始日(JST) 'YYYY-MM-DD'
    name: str
    grade: str | None


class HomeResponse(BaseModel):
    date_from: date | None
    date_to: date | None
    kpis: HomeKpis
    views_trend: list[ViewsTrendPoint]
    recent_events: list[RecentEvent]
    ingestion_status: list[IngestionStatus]
    events_markers: list[EventMarker]


# ----- ② イベント詳細 summary -----


class EventKpis(BaseModel):
    total_impressions: Kpi
    total_views: Kpi
    total_subscriber_gain: Kpi
    avg_view_percentage: Kpi  # 平均値
    max_concurrent_viewers: Kpi


class ProgramRanking(BaseModel):
    video_id: UUID
    title: str
    program_type: str | None
    published_at: datetime | None
    max_concurrent_viewers: float | None
    avg_concurrent_viewers: float | None
    view_count: float | None


class DailyPerformance(BaseModel):
    date: str  # 'YYYY-MM-DD'（JST）
    video_count: int
    total_views: float | None
    total_impressions: float | None
    max_concurrent_viewers: float | None


class EventSummaryResponse(BaseModel):
    event: EventOut
    period_kpis: EventKpis
    programs_by_max_ccu: list[ProgramRanking]
    daily_performance: list[DailyPerformance]
    videos: list[VideoOut]
