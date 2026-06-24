"""動画 REST エンドポイント（一覧・比較・詳細・編集）。"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import get_current_auth
from app.models import Event, LatestMetricValue, MetricTimeseries, Video
from app.schemas.common import Page, Pagination, pagination
from app.schemas.video import (
    CompareMetrics,
    CompareResponse,
    CompareVideo,
    EnrichResult,
    TimeseriesOverlay,
    TimeseriesOverlayPoint,
    VideoOut,
    VideoUpdate,
)
from app.services.video_enrich import enrich_videos

router = APIRouter(prefix="/videos", tags=["videos"])

_CONTENT_TYPES = {"regular", "short", "all"}
_COMPARE_MAX = 10
_COMPARE_METRIC_KEYS = [
    "imp",
    "view_count",
    "subscriber_gain",
    "unique_viewers",
    "live_views",
    "archive_views",
    "avg_concurrent_viewers",
    "max_concurrent_viewers",
    "avg_view_duration",
    "avg_view_percentage",
    "repeater_ratio",
]


@router.post(
    "/enrich",
    response_model=EnrichResult,
    dependencies=[Depends(get_current_auth)],
)
def enrich(db: Session = Depends(get_db)) -> EnrichResult:
    """cast空の自社動画を概要欄APIで補完する（出演者/番組種別/grade）。

    既存値があるフィールドは上書きしない。YOUTUBE_API_KEY 未設定は 400。
    """
    try:
        result = enrich_videos(db)
    except ValueError as exc:  # APIキー未設定 / API失敗
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return EnrichResult(**result)


def _day_start_utc(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=timezone.utc)


def attach_metrics(db: Session, videos: list[Video]) -> None:
    """videos に最新 metric 値（latest_metric_values）を {key: value} で付与。"""
    ids = [v.id for v in videos]
    bucket: dict[UUID, dict[str, float]] = defaultdict(dict)
    if ids:
        rows = db.scalars(
            select(LatestMetricValue).where(
                LatestMetricValue.entity_type == "videos",
                LatestMetricValue.entity_id.in_(ids),
            )
        ).all()
        for r in rows:
            bucket[r.entity_id][r.metric_key] = float(r.value)
    for v in videos:
        v.metrics = dict(bucket.get(v.id, {}))


@router.get("", response_model=Page[VideoOut])
def list_videos(
    q: str | None = Query(None, description="title 部分一致"),
    event_id: UUID | None = None,
    program_type: str | None = None,
    grade: str | None = None,
    cast: str | None = Query(None, description="出演者 部分一致"),
    content_type: str = Query("regular", description="regular(既定) / short / all"),
    is_competitor: bool | None = Query(None, description="既定 false 絞り。指定で上書き"),
    channel_id: UUID | None = None,
    date_from: date | None = Query(None, description="published_at(UTC) の下限"),
    date_to: date | None = Query(None, description="published_at(UTC) の上限(当日含む)"),
    include: str | None = Query(None, description="metrics を指定すると最新値を含める"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    page: Pagination = Depends(pagination),
    db: Session = Depends(get_db),
) -> Page[VideoOut]:
    if content_type not in _CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"content_type must be one of {sorted(_CONTENT_TYPES)}",
        )

    conds = []
    if q:
        conds.append(Video.title.ilike(f"%{q}%"))
    if event_id:
        conds.append(Video.event_id == event_id)
    if program_type:
        conds.append(Video.program_type == program_type)
    if grade:
        conds.append(Video.grade == grade)
    if cast:
        conds.append(func.array_to_string(Video.cast_members, ",").ilike(f"%{cast}%"))
    if channel_id:
        conds.append(Video.channel_id == channel_id)
    if content_type != "all":
        conds.append(Video.content_type == content_type)
    conds.append(Video.is_competitor == (is_competitor if is_competitor is not None else False))
    if date_from:
        conds.append(Video.published_at >= _day_start_utc(date_from))
    if date_to:
        conds.append(Video.published_at < _day_start_utc(date_to + timedelta(days=1)))

    base = select(Video).where(*conds)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0

    ordering = (
        Video.published_at.desc().nullslast()
        if order == "desc"
        else Video.published_at.asc().nullsfirst()
    )
    rows = db.scalars(
        base.order_by(ordering, Video.created_at.desc())
        .limit(page.limit)
        .offset(page.offset)
    ).all()

    if include == "metrics":
        attach_metrics(db, rows)
    else:
        for v in rows:
            v.metrics = None

    return Page[VideoOut](items=rows, total=total, limit=page.limit, offset=page.offset)


@router.get("/compare", response_model=CompareResponse)
def compare_videos(
    ids: str = Query(..., description="動画UUIDのカンマ区切り（2〜10件、上限10）"),
    db: Session = Depends(get_db),
) -> CompareResponse:
    raw = [s.strip() for s in ids.split(",") if s.strip()]
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="ids is required"
        )
    if len(raw) > _COMPARE_MAX:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"too many ids (max {_COMPARE_MAX})",
        )

    not_found: list[str] = []
    uuid_list: list[UUID] = []
    seen: set[str] = set()
    for s in raw:
        if s in seen:
            continue
        seen.add(s)
        try:
            uuid_list.append(UUID(s))
        except ValueError:
            not_found.append(s)  # UUID として不正 → 存在し得ない

    found: dict[UUID, Video] = {}
    if uuid_list:
        found = {
            v.id: v
            for v in db.scalars(select(Video).where(Video.id.in_(uuid_list))).all()
        }
    for u in uuid_list:
        if u not in found:
            not_found.append(str(u))

    found_ids = list(found.keys())
    metrics_map: dict[UUID, dict[str, float]] = defaultdict(dict)
    if found_ids:
        for r in db.scalars(
            select(LatestMetricValue).where(
                LatestMetricValue.entity_type == "videos",
                LatestMetricValue.entity_id.in_(found_ids),
            )
        ).all():
            metrics_map[r.entity_id][r.metric_key] = float(r.value)

    event_ids = {v.event_id for v in found.values() if v.event_id is not None}
    event_names: dict[UUID, str] = {}
    if event_ids:
        event_names = {
            e.id: e.name
            for e in db.scalars(select(Event).where(Event.id.in_(event_ids))).all()
        }

    videos_out: list[CompareVideo] = []
    overlay: list[TimeseriesOverlay] = []
    for u in uuid_list:
        v = found.get(u)
        if v is None:
            continue
        m = metrics_map.get(u, {})
        videos_out.append(
            CompareVideo(
                id=v.id,
                title=v.title,
                program_type=v.program_type,
                published_at=v.published_at,
                event_name=event_names.get(v.event_id) if v.event_id else None,
                metrics=CompareMetrics(**{k: m.get(k) for k in _COMPARE_METRIC_KEYS}),
            )
        )
        pts = db.execute(
            select(MetricTimeseries.elapsed_seconds, MetricTimeseries.value)
            .where(
                MetricTimeseries.entity_type == "videos",
                MetricTimeseries.entity_id == u,
                MetricTimeseries.metric_key == "concurrent_viewers",
            )
            .order_by(MetricTimeseries.elapsed_seconds.asc())
        ).all()
        overlay.append(
            TimeseriesOverlay(
                video_id=v.id,
                title=v.title,
                points=[
                    TimeseriesOverlayPoint(elapsed_seconds=p.elapsed_seconds, value=float(p.value))
                    for p in pts
                ],
            )
        )

    return CompareResponse(videos=videos_out, timeseries_overlay=overlay, not_found=not_found)


@router.get("/{video_id}", response_model=VideoOut)
def get_video(video_id: UUID, db: Session = Depends(get_db)) -> Video:
    video = db.get(Video, video_id)
    if video is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="video not found")
    attach_metrics(db, [video])
    return video


@router.patch(
    "/{video_id}",
    response_model=VideoOut,
    dependencies=[Depends(get_current_auth)],
)
def update_video(
    video_id: UUID,
    body: VideoUpdate,
    db: Session = Depends(get_db),
) -> Video:
    video = db.get(Video, video_id)
    if video is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="video not found")

    data = body.model_dump(exclude_unset=True)

    # NOT NULL 列は null での上書きを無視する
    if data.get("title") is None:
        data.pop("title", None)
    if data.get("cast_members") is None:
        data.pop("cast_members", None)

    # event_id を非 NULL に変更する場合は実在チェック（FK 違反を 400 で返す）
    if data.get("event_id") is not None and db.get(Event, data["event_id"]) is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="event_id not found",
        )

    for key, val in data.items():
        setattr(video, key, val)

    if data:
        db.commit()
        db.refresh(video)

    attach_metrics(db, [video])
    return video
