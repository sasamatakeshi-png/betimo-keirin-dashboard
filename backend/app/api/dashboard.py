"""集計（画面専用）エンドポイント。

集計の共通ルール:
  - 対象は content_type='regular' かつ is_competitor=false（番組系）に限定
  - 合計/代表値は latest_metric_values（最新値）を SUM / MAX
  - 欠損(null)は集計から除外（0扱いしない）。値が無ければ count=0
  - 期間フィルタ・日別集計は published_at の JST(Asia/Tokyo) 日付基準
"""

from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Date, and_, cast, func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import (
    Channel,
    ChannelStatsDaily,
    Event,
    IngestionLog,
    LatestMetricValue,
    MonthlyChannelMetric,
    MonthlyDemographic,
    Video,
)
from app.schemas.dashboard import (
    ChannelStatsResponse,
    DemographicItem,
    EventMarker,
    HomeKpis,
    HomeResponse,
    IngestionStatus,
    Kpi,
    MonthlyDemographicsResponse,
    MonthlyMetricPoint,
    MonthlyMetricsResponse,
    MonthlyVideoCountPoint,
    MonthlyVideoCountsResponse,
    RecentEvent,
    ViewsTrendPoint,
)
from app.services.youtube_stats import YouTubeStatsError, refresh_channel_stats

# 遅延更新のしきい値。最新取得がこれより古ければ再取得を試みる。
_STATS_STALE_AFTER = timedelta(hours=24)

_SEGMENTS = ("all", "live", "short")

# 本数集計の種別カテゴリ。常に全キーを返す（0件でも0）。
# regular は program_type で分類、未知/NULL は「その他」、short は content_type 優先で別枠。
_PROGRAM_CATEGORIES = ["BKL", "あす勝ち", "ナイター", "ミッドナイト", "プレミアムトーク", "Bar", "その他"]
_VIDEO_COUNT_CATEGORIES = _PROGRAM_CATEGORIES + ["short"]

_KPI_KEYS = ["imp", "view_count", "subscriber_gain", "max_concurrent_viewers"]

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# published_at(UTC, timestamptz) → JST の日付
_JST_DATE = cast(func.timezone("Asia/Tokyo", Video.published_at), Date)

# 集計対象（番組系）の基本条件
_PROGRAM_FILTER = (Video.content_type == "regular", Video.is_competitor == False)  # noqa: E712


def _is_full_calendar_month(d_from: date, d_to: date) -> bool:
    """date_from〜date_to が「ある暦月の初日〜末日」（暦月まるごと）か。"""
    if d_from.day != 1:
        return False
    if d_from.year != d_to.year or d_from.month != d_to.month:
        return False
    last = calendar.monthrange(d_from.year, d_from.month)[1]
    return d_to.day == last


def _previous_calendar_month(d_from: date) -> tuple[date, date]:
    """暦月の初日 d_from に対し、1つ前の暦月の初日・末日を返す。"""
    y, m = (d_from.year - 1, 12) if d_from.month == 1 else (d_from.year, d_from.month - 1)
    last = calendar.monthrange(y, m)[1]
    return date(y, m, 1), date(y, m, last)


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

    # 暦月まるごと指定のときのみ、1つ前の暦月まるごとと比較（月途中の暴れを防ぐ）。
    # 暦月でない任意期間・全期間は比較相手なし（prev=null）。
    prev_by: dict = {}
    if date_from and date_to and _is_full_calendar_month(date_from, date_to):
        prev_from, prev_to = _previous_calendar_month(date_from)
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


# =====================================================================
# 月次（ホーム刷新用・読み出し専用）
#   monthly_channel_metrics / monthly_demographics を直接読む。
#   既存 /dashboard/home には手を入れず追加のみ。対象は自社チャンネル(is_own)。
# =====================================================================


def _own_channel_id(db: Session):
    return db.scalar(select(Channel.id).where(Channel.is_own.is_(True)))


def _norm_segment(segment: str) -> str:
    return segment if segment in _SEGMENTS else "all"


@router.get("/monthly-metrics", response_model=MonthlyMetricsResponse)
def monthly_metrics(
    segment: str = Query("all", description="all | live | short"),
    date_from: str | None = Query(None, description="対象月の下限 'YYYY-MM'"),
    date_to: str | None = Query(None, description="対象月の上限 'YYYY-MM'"),
    db: Session = Depends(get_db),
) -> MonthlyMetricsResponse:
    segment = _norm_segment(segment)
    channel_id = _own_channel_id(db)
    if channel_id is None:
        return MonthlyMetricsResponse(segment=segment, items=[])

    conds = [
        MonthlyChannelMetric.channel_id == channel_id,
        MonthlyChannelMetric.segment == segment,
    ]
    # year_month は 'YYYY-MM' 文字列。辞書順 = 時系列順のため範囲比較が成立。
    if date_from:
        conds.append(MonthlyChannelMetric.year_month >= date_from)
    if date_to:
        conds.append(MonthlyChannelMetric.year_month <= date_to)

    rows = db.scalars(
        select(MonthlyChannelMetric)
        .where(*conds)
        .order_by(MonthlyChannelMetric.year_month)
    ).all()

    items = [
        MonthlyMetricPoint(
            year_month=r.year_month,
            segment=r.segment,
            avg_view_duration_seconds=r.avg_view_duration_seconds,
            avg_view_percentage=float(r.avg_view_percentage)
            if r.avg_view_percentage is not None
            else None,
            unique_viewers=r.unique_viewers,
            new_viewers=r.new_viewers,
            repeat_viewers=r.repeat_viewers,
            view_count=int(r.view_count) if r.view_count is not None else None,
            total_watch_time_hours=float(r.total_watch_time_hours)
            if r.total_watch_time_hours is not None
            else None,
            subscribers=r.subscribers,
            impressions=int(r.impressions) if r.impressions is not None else None,
            impressions_ctr=float(r.impressions_ctr)
            if r.impressions_ctr is not None
            else None,
        )
        for r in rows
    ]
    return MonthlyMetricsResponse(segment=segment, items=items)


@router.get("/monthly-demographics", response_model=MonthlyDemographicsResponse)
def monthly_demographics(
    segment: str = Query("all", description="all | live | short"),
    year_month: str | None = Query(
        None, description="対象月 'YYYY-MM'。省略時は最新月"
    ),
    db: Session = Depends(get_db),
) -> MonthlyDemographicsResponse:
    segment = _norm_segment(segment)
    channel_id = _own_channel_id(db)
    if channel_id is None:
        return MonthlyDemographicsResponse(
            year_month=year_month, segment=segment, items=[]
        )

    base_conds = [
        MonthlyDemographic.channel_id == channel_id,
        MonthlyDemographic.segment == segment,
    ]

    # 対象月の決定（未指定なら最新月）。
    target_ym = year_month
    if target_ym is None:
        target_ym = db.scalar(
            select(func.max(MonthlyDemographic.year_month)).where(*base_conds)
        )
    if target_ym is None:
        return MonthlyDemographicsResponse(
            year_month=None, segment=segment, items=[]
        )

    rows = db.scalars(
        select(MonthlyDemographic)
        .where(*base_conds, MonthlyDemographic.year_month == target_ym)
        .order_by(MonthlyDemographic.age_band, MonthlyDemographic.gender)
    ).all()

    items = [
        DemographicItem(
            age_band=r.age_band,
            gender=r.gender,
            views_pct=float(r.views_pct) if r.views_pct is not None else None,
            watch_time_pct=float(r.watch_time_pct)
            if r.watch_time_pct is not None
            else None,
        )
        for r in rows
    ]
    return MonthlyDemographicsResponse(
        year_month=target_ym, segment=segment, items=items
    )


def _latest_channel_stats(db: Session, channel_id) -> ChannelStatsDaily | None:
    return db.scalar(
        select(ChannelStatsDaily)
        .where(ChannelStatsDaily.channel_id == channel_id)
        .order_by(ChannelStatsDaily.snapshot_date.desc())
        .limit(1)
    )


@router.get("/channel-stats", response_model=ChannelStatsResponse)
def channel_stats(db: Session = Depends(get_db)) -> ChannelStatsResponse:
    """チャンネル全体の最新スナップショット（総登録者数・総再生数）を返す。

    遅延更新（主軸）:
      - 最新 fetched_at が24時間以上前 or レコード無し なら YouTube API で再取得を試みる。
      - 同時アクセスの二重取得は upsert の ON CONFLICT で実害なし（最後の値で1行）。
      - 取得失敗・キー未設定でも例外を投げず、既存の最新スナップショットを返す。
        それも無ければ全フィールド None（フロントは CSV 合算値にフォールバック）。
    """
    channel_id = _own_channel_id(db)
    if channel_id is None:
        return ChannelStatsResponse()

    latest = _latest_channel_stats(db, channel_id)
    is_stale = (
        latest is None
        or latest.fetched_at is None
        or (datetime.now(timezone.utc) - latest.fetched_at) > _STATS_STALE_AFTER
    )

    if is_stale:
        try:
            refreshed = refresh_channel_stats(db)
            if refreshed is not None:
                latest = refreshed
        except YouTubeStatsError:
            # 取得失敗（キー未設定・API エラー等）。失敗ログは service 側で記録済み。
            # 既存スナップショットを返すため、念のため最新を読み直す。
            latest = _latest_channel_stats(db, channel_id)

    if latest is None:
        return ChannelStatsResponse(channel_id=channel_id)

    return ChannelStatsResponse(
        channel_id=latest.channel_id,
        snapshot_date=latest.snapshot_date,
        subscriber_count=latest.subscriber_count,
        view_count=latest.view_count,
        fetched_at=latest.fetched_at,
    )


@router.get("/monthly-video-counts", response_model=MonthlyVideoCountsResponse)
def monthly_video_counts(db: Session = Depends(get_db)) -> MonthlyVideoCountsResponse:
    """自社動画(is_competitor=false)を「月 × 種別」で本数集計する。

    - 月: published_at の JST(Asia/Tokyo) を 'YYYY-MM' 化。NULL は集計対象外。
    - 種別: content_type='short' は 'short'（program_type より優先）。
            regular は program_type で分類し、既知6種以外/NULL は「その他」。
    """
    ym = func.to_char(func.timezone("Asia/Tokyo", Video.published_at), "YYYY-MM")
    rows = db.execute(
        select(
            ym.label("ym"),
            Video.content_type,
            Video.program_type,
            func.count().label("n"),
        )
        .where(Video.is_competitor == False, Video.published_at.is_not(None))  # noqa: E712
        .group_by(ym, Video.content_type, Video.program_type)
    ).all()

    known = set(_PROGRAM_CATEGORIES) - {"その他"}
    buckets: dict[str, dict[str, int]] = {}
    for r in rows:
        if r.content_type == "short":
            category = "short"
        elif r.program_type in known:
            category = r.program_type
        else:
            category = "その他"
        month = buckets.setdefault(r.ym, {c: 0 for c in _VIDEO_COUNT_CATEGORIES})
        month[category] += int(r.n)

    items = [
        MonthlyVideoCountPoint(
            year_month=ymk,
            counts=buckets[ymk],
            total=sum(buckets[ymk].values()),
        )
        for ymk in sorted(buckets)
    ]
    return MonthlyVideoCountsResponse(items=items)
