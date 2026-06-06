"""イベント REST エンドポイント。"""

from __future__ import annotations

from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Date, and_, cast, func, select
from sqlalchemy.orm import Session

from app.api.videos import attach_metrics
from app.core.db import get_db
from app.models import Event, LatestMetricValue, Video
from app.schemas.common import Page, Pagination, pagination
from app.schemas.dashboard import (
    DailyPerformance,
    EventKpis,
    EventSummaryResponse,
    Kpi,
    ProgramRanking,
)
from app.schemas.event import EventOut
from app.schemas.video import VideoOut

router = APIRouter(prefix="/events", tags=["events"])

# published_at(UTC) → JST 日付
_JST_DATE = cast(func.timezone("Asia/Tokyo", Video.published_at), Date)
# 集計対象（番組系）の基本条件
_PROGRAM_FILTER = (Video.content_type == "regular", Video.is_competitor == False)  # noqa: E712


@router.get("", response_model=Page[EventOut])
def list_events(
    q: str | None = Query(None, description="name 部分一致"),
    grade: str | None = None,
    date_from: date | None = Query(None, description="start_date の下限"),
    date_to: date | None = Query(None, description="start_date の上限"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    page: Pagination = Depends(pagination),
    db: Session = Depends(get_db),
) -> Page[EventOut]:
    conds = []
    if q:
        conds.append(Event.name.ilike(f"%{q}%"))
    if grade:
        conds.append(Event.grade == grade)
    if date_from:
        conds.append(Event.start_date >= date_from)
    if date_to:
        conds.append(Event.start_date <= date_to)

    base = select(Event).where(*conds)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0

    ordering = (
        Event.start_date.desc().nullslast()
        if order == "desc"
        else Event.start_date.asc().nullsfirst()
    )
    rows = db.scalars(
        base.order_by(ordering, Event.created_at.desc())
        .limit(page.limit)
        .offset(page.offset)
    ).all()
    return Page[EventOut](items=rows, total=total, limit=page.limit, offset=page.offset)


@router.get("/{event_id}/summary", response_model=EventSummaryResponse)
def event_summary(event_id: UUID, db: Session = Depends(get_db)) -> EventSummaryResponse:
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="event not found")

    event_filter = (
        LatestMetricValue.entity_type == "videos",
        Video.event_id == event_id,
        *_PROGRAM_FILTER,
    )

    # ---- period_kpis ----
    kpi_stmt = (
        select(
            LatestMetricValue.metric_key.label("k"),
            func.sum(LatestMetricValue.value).label("s"),
            func.avg(LatestMetricValue.value).label("a"),
            func.max(LatestMetricValue.value).label("m"),
            func.count().label("c"),
        )
        .select_from(LatestMetricValue)
        .join(Video, Video.id == LatestMetricValue.entity_id)
        .where(
            *event_filter,
            LatestMetricValue.metric_key.in_(
                [
                    "imp",
                    "view_count",
                    "subscriber_gain",
                    "avg_view_percentage",
                    "max_concurrent_viewers",
                ]
            ),
        )
        .group_by(LatestMetricValue.metric_key)
    )
    by_key = {row.k: row for row in db.execute(kpi_stmt).all()}

    def _kpi(key: str, attr: str) -> Kpi:
        r = by_key.get(key)
        val = getattr(r, attr) if r is not None else None
        return Kpi(
            value=float(val) if val is not None else None,
            count=int(r.c) if r is not None else 0,
        )

    period_kpis = EventKpis(
        total_impressions=_kpi("imp", "s"),
        total_views=_kpi("view_count", "s"),
        total_subscriber_gain=_kpi("subscriber_gain", "s"),
        avg_view_percentage=_kpi("avg_view_percentage", "a"),
        max_concurrent_viewers=_kpi("max_concurrent_viewers", "m"),
    )

    # ---- 対象動画（regular）を取得 ----
    vids = db.scalars(
        select(Video).where(Video.event_id == event_id, *_PROGRAM_FILTER)
    ).all()
    ids = [v.id for v in vids]

    # ---- programs_by_max_ccu ----
    rank_metrics: dict[UUID, dict[str, float]] = {}
    if ids:
        for r in db.scalars(
            select(LatestMetricValue).where(
                LatestMetricValue.entity_type == "videos",
                LatestMetricValue.entity_id.in_(ids),
                LatestMetricValue.metric_key.in_(
                    ["max_concurrent_viewers", "avg_concurrent_viewers", "view_count"]
                ),
            )
        ).all():
            rank_metrics.setdefault(r.entity_id, {})[r.metric_key] = float(r.value)

    programs = [
        ProgramRanking(
            video_id=v.id,
            title=v.title,
            program_type=v.program_type,
            published_at=v.published_at,
            max_concurrent_viewers=rank_metrics.get(v.id, {}).get("max_concurrent_viewers"),
            avg_concurrent_viewers=rank_metrics.get(v.id, {}).get("avg_concurrent_viewers"),
            view_count=rank_metrics.get(v.id, {}).get("view_count"),
        )
        for v in vids
    ]
    # max_concurrent_viewers 降順、null は最後
    programs.sort(
        key=lambda p: (
            p.max_concurrent_viewers is None,
            -(p.max_concurrent_viewers or 0),
        )
    )

    # ---- daily_performance（JST 日別） ----
    daily_stmt = (
        select(
            _JST_DATE.label("d"),
            func.count(func.distinct(Video.id)).label("vc"),
            func.sum(LatestMetricValue.value)
            .filter(LatestMetricValue.metric_key == "view_count")
            .label("views"),
            func.sum(LatestMetricValue.value)
            .filter(LatestMetricValue.metric_key == "imp")
            .label("imp"),
            func.max(LatestMetricValue.value)
            .filter(LatestMetricValue.metric_key == "max_concurrent_viewers")
            .label("mcv"),
        )
        .select_from(Video)
        .join(
            LatestMetricValue,
            and_(
                LatestMetricValue.entity_id == Video.id,
                LatestMetricValue.entity_type == "videos",
                LatestMetricValue.metric_key.in_(
                    ["view_count", "imp", "max_concurrent_viewers"]
                ),
            ),
        )
        .where(Video.event_id == event_id, *_PROGRAM_FILTER, Video.published_at.is_not(None))
        .group_by(_JST_DATE)
        .order_by(_JST_DATE)
    )
    daily_performance = [
        DailyPerformance(
            date=row.d.isoformat(),
            video_count=int(row.vc),
            total_views=float(row.views) if row.views is not None else None,
            total_impressions=float(row.imp) if row.imp is not None else None,
            max_concurrent_viewers=float(row.mcv) if row.mcv is not None else None,
        )
        for row in db.execute(daily_stmt).all()
    ]

    # ---- videos（B-1 表現・最新metric値同梱） ----
    attach_metrics(db, vids)
    epoch = datetime.min.replace(tzinfo=timezone.utc)
    videos_out = [
        VideoOut.model_validate(v)
        for v in sorted(vids, key=lambda v: v.published_at or epoch, reverse=True)
    ]

    return EventSummaryResponse(
        event=EventOut.model_validate(event),
        period_kpis=period_kpis,
        programs_by_max_ccu=programs,
        daily_performance=daily_performance,
        videos=videos_out,
    )


@router.get("/{event_id}", response_model=EventOut)
def get_event(event_id: UUID, db: Session = Depends(get_db)) -> Event:
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="event not found")
    return event
