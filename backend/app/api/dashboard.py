"""集計（画面専用）エンドポイント。

集計の共通ルール:
  - 対象は content_type='regular' かつ is_competitor=false（番組系）に限定
  - 合計/代表値は latest_metric_values（最新値）を SUM / MAX
  - 欠損(null)は集計から除外（0扱いしない）。値が無ければ count=0
  - 期間フィルタ・日別集計は published_at の JST(Asia/Tokyo) 日付基準
"""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Date, and_, cast, func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import Event, IngestionLog, LatestMetricValue, Video
from app.schemas.dashboard import (
    EventMarker,
    HomeKpis,
    HomeResponse,
    IngestionStatus,
    Kpi,
    RecentEvent,
    ViewsTrendPoint,
)

_KPI_KEYS = ["imp", "view_count", "subscriber_gain", "max_concurrent_viewers"]

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# published_at(UTC, timestamptz) → JST の日付
_JST_DATE = cast(func.timezone("Asia/Tokyo", Video.published_at), Date)

# 集計対象（番組系）の基本条件
_PROGRAM_FILTER = (Video.content_type == "regular", Video.is_competitor == False)  # noqa: E712


def _kpi_rows(db: Session, conds: list) -> dict:
    """指定期間条件で KPI を metric_key 別に集計し {key: Row(s/m/c)} を返す。"""
    stmt = (
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
            LatestMetricValue.metric_key.in_(_KPI_KEYS),
            *conds,
        )
        .group_by(LatestMetricValue.metric_key)
    )
    return {row.k: row for row in db.execute(stmt).all()}


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

    # ---- KPIs（期間内の合計/代表値 + 前期比） ----
    cur_by = _kpi_rows(db, date_conds)

    # 期間指定時のみ、同じ期間長だけ前にずらした「前期間」を算出
    prev_by: dict = {}
    if date_from and date_to:
        length_days = (date_to - date_from).days + 1
        prev_to = date_from - timedelta(days=1)
        prev_from = date_from - timedelta(days=length_days)
        prev_by = _kpi_rows(db, [_JST_DATE >= prev_from, _JST_DATE <= prev_to])

    def build_kpi(key: str, agg: str) -> Kpi:
        cur = cur_by.get(key)
        prev = prev_by.get(key)
        value = float(getattr(cur, agg)) if cur is not None and getattr(cur, agg) is not None else None
        count = int(cur.c) if cur is not None else 0
        prev_value = (
            float(getattr(prev, agg)) if prev is not None and getattr(prev, agg) is not None else None
        )
        change_ratio = None
        if value is not None and prev_value is not None and prev_value != 0:
            change_ratio = (value - prev_value) / prev_value
        return Kpi(value=value, count=count, prev_value=prev_value, change_ratio=change_ratio)

    kpis = HomeKpis(
        total_impressions=build_kpi("imp", "s"),
        total_views=build_kpi("view_count", "s"),
        total_subscriber_gain=build_kpi("subscriber_gain", "s"),
        max_concurrent_viewers=build_kpi("max_concurrent_viewers", "m"),
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

    # ---- events_markers（期間内のイベント開始日マーカー） ----
    marker_conds = []
    if date_from:
        marker_conds.append(Event.start_date >= date_from)
    if date_to:
        marker_conds.append(Event.start_date <= date_to)
    marker_rows = db.execute(
        select(Event.start_date, Event.name, Event.grade)
        .where(Event.start_date.is_not(None), *marker_conds)
        .order_by(Event.start_date)
    ).all()
    events_markers = [
        EventMarker(date=sd.isoformat(), name=name, grade=grade)
        for (sd, name, grade) in marker_rows
    ]

    return HomeResponse(
        date_from=date_from,
        date_to=date_to,
        kpis=kpis,
        views_trend=views_trend,
        recent_events=recent_events,
        ingestion_status=ingestion_status,
        events_markers=events_markers,
    )
