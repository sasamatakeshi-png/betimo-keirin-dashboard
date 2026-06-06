"""動画 REST エンドポイント（一覧・詳細・編集）。"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import get_current_auth
from app.models import Event, LatestMetricValue, Video
from app.schemas.common import Page, Pagination, pagination
from app.schemas.video import VideoOut, VideoUpdate

router = APIRouter(prefix="/videos", tags=["videos"])

_CONTENT_TYPES = {"regular", "short", "all"}


def _day_start_utc(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=timezone.utc)


def _attach_metrics(db: Session, videos: list[Video]) -> None:
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
    # is_competitor は既定 false 絞り、指定があれば上書き
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
        _attach_metrics(db, rows)
    else:
        for v in rows:
            v.metrics = None

    return Page[VideoOut](items=rows, total=total, limit=page.limit, offset=page.offset)


@router.get("/{video_id}", response_model=VideoOut)
def get_video(video_id: UUID, db: Session = Depends(get_db)) -> Video:
    video = db.get(Video, video_id)
    if video is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="video not found")
    _attach_metrics(db, [video])
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

    _attach_metrics(db, [video])
    return video
