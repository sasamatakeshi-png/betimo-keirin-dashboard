"""集計（画面専用）エンドポイント。

集計の共通ルール:
  - 対象は content_type='regular' かつ is_competitor=false（番組系）に限定
  - 合計/代表値は latest_metric_values（最新値）を SUM / MAX
  - 欠損(null)は集計から除外（0扱いしない）。値が無ければ count=0
  - 期間フィルタ・日別集計は published_at の JST(Asia/Tokyo) 日付基準
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Date, and_, cast, func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import Event, IngestionLog, LatestMetricValue, Video
from app.schemas.dashboard import (
    HomeKpis,
    HomeResponse,
    IngestionStatus,
    Kpi,
    RecentEvent,
    ViewsTrendPoint,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# published_at(UTC, timestamptz) → JST の日付
_JST_DATE = cast(func.timezone("Asia/Tokyo", Video.published_at), Date)

# 集計対象（番組系）の基本条件
_PROGRAM_FILTER = (Video.content_type == "regular", Video.is_competitor == False)  # noqa: E712


@router.get("/home", response_model=HomeResponse)
def dashboard_home(
    date_from: date | None = Query(None, description="JST 日付の下限"),
    date_to: date | None = Query(None, description="JST 日付の上限（当日含む）"),
    db: Session = Depends(get_db),
) -> HomeResponse:
    date_conds = []
    if date_from:
        date_conds.append(_JST_DATE >= date_from)
    if date_to:
        date_conds.append(_JST_DATE <= date_to)

    # ---- KPIs（期間内の合計/代表値） ----
    kpi_stmt = (
        select(
            LatestMetricValue.metric_key.label("k"),
            func.sum(LatestMetricValue.value).label("s"),
            func.max(LatestMetricValue.value).label("m"),
            func.count().label("c"),
        )
        .select_from(LatestMetricValue)
        .join(Video, Video.id == LatestMetricValue.entity_id)
        .where(
            LatestMetricValue.entity_type == "videos",
            *_PROGRAM_FILTER,
            LatestMetricValue.metric_key.in_(
                ["imp", "view_count", "subscriber_gain", "max_concurrent_viewers"]
            ),
            *date_conds,
        )
        .group_by(LatestMetricValue.metric_key)
    )
    by_key = {row.k: row for row in db.execute(kpi_stmt).all()}

    def kpi_sum(key: str) -> Kpi:
        r = by_key.get(key)
        return Kpi(
            value=float(r.s) if r is not None and r.s is not None else None,
            count=int(r.c) if r is not None else 0,
        )

    def kpi_max(key: str) -> Kpi:
        r = by_key.get(key)
        return Kpi(
            value=float(r.m) if r is not None and r.m is not None else None,
            count=int(r.c) if r is not None else 0,
        )

    kpis = HomeKpis(
        total_impressions=kpi_sum("imp"),
        total_views=kpi_sum("view_count"),
        total_subscriber_gain=kpi_sum("subscriber_gain"),
        max_concurrent_viewers=kpi_max("max_concurrent_viewers"),
    )

    # ---- views_trend（JST 日別の再生数推移） ----
    trend_stmt = (
        select(
            _JST_DATE.label("d"),
            func.sum(LatestMetricValue.value).label("views"),
            func.count(func.distinct(Video.id)).label("vc"),
        )
        .select_from(Video)
        .join(
            LatestMetricValue,
            and_(
                LatestMetricValue.entity_id == Video.id,
                LatestMetricValue.entity_type == "videos",
                LatestMetricValue.metric_key == "view_count",
            ),
        )
        .where(*_PROGRAM_FILTER, Video.published_at.is_not(None), *date_conds)
        .group_by(_JST_DATE)
        .order_by(_JST_DATE)
    )
    views_trend = [
        ViewsTrendPoint(
            date=row.d.isoformat(),
            views=float(row.views) if row.views is not None else 0.0,
            video_count=int(row.vc),
        )
        for row in db.execute(trend_stmt).all()
    ]

    # ---- recent_events（直近イベント5件・start_date desc。期間に依らず最新） ----
    video_count_subq = (
        select(func.count())
        .select_from(Video)
        .where(Video.event_id == Event.id, *_PROGRAM_FILTER)
        .correlate(Event)
        .scalar_subquery()
    )
    recent_stmt = (
        select(Event, video_count_subq.label("vc"))
        .order_by(Event.start_date.desc().nullslast(), Event.created_at.desc())
        .limit(5)
    )
    recent_events = [
        RecentEvent(
            id=e.id,
            name=e.name,
            grade=e.grade,
            start_date=e.start_date,
            end_date=e.end_date,
            video_count=int(vc),
        )
        for (e, vc) in db.execute(recent_stmt).all()
    ]

    # ---- ingestion_status（ingestion_logs 最新5件） ----
    ing_stmt = (
        select(IngestionLog)
        .order_by(
            func.coalesce(IngestionLog.completed_at, IngestionLog.started_at)
            .desc()
            .nullslast()
        )
        .limit(5)
    )
    ingestion_status = [
        IngestionStatus(
            status=log.status,
            source_type=log.source_type,
            file_name=log.file_name,
            completed_at=log.completed_at,
        )
        for log in db.scalars(ing_stmt).all()
    ]

    return HomeResponse(
        date_from=date_from,
        date_to=date_to,
        kpis=kpis,
        views_trend=views_trend,
        recent_events=recent_events,
        ingestion_status=ingestion_status,
    )
