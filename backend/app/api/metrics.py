"""指標 REST エンドポイント（定義一覧 / 最新値）。"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import LatestMetricValue, MetricDefinition
from app.schemas.common import Page, Pagination, pagination
from app.schemas.metric import MetricDefinitionOut, MetricValueOut

router = APIRouter(prefix="/metrics", tags=["metrics"])

_ENTITY_TYPES = {"videos", "channels", "x_accounts"}


@router.get("/definitions", response_model=Page[MetricDefinitionOut])
def list_definitions(
    entity_type: str | None = None,
    page: Pagination = Depends(pagination),
    db: Session = Depends(get_db),
) -> Page[MetricDefinitionOut]:
    conds = []
    if entity_type:
        conds.append(MetricDefinition.entity_type == entity_type)

    base = select(MetricDefinition).where(*conds)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(
        base.order_by(MetricDefinition.display_order.asc(), MetricDefinition.key.asc())
        .limit(page.limit)
        .offset(page.offset)
    ).all()
    return Page[MetricDefinitionOut](
        items=rows, total=total, limit=page.limit, offset=page.offset
    )


@router.get("", response_model=Page[MetricValueOut])
def get_latest_metrics(
    entity_type: str = Query(..., description="videos / channels / x_accounts"),
    entity_id: UUID = Query(...),
    keys: str | None = Query(None, description="metric_key のカンマ区切り絞り込み"),
    page: Pagination = Depends(pagination),
    db: Session = Depends(get_db),
) -> Page[MetricValueOut]:
    if entity_type not in _ENTITY_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"entity_type must be one of {sorted(_ENTITY_TYPES)}",
        )

    conds = [
        LatestMetricValue.entity_type == entity_type,
        LatestMetricValue.entity_id == entity_id,
    ]
    if keys:
        key_list = [k.strip() for k in keys.split(",") if k.strip()]
        if key_list:
            conds.append(LatestMetricValue.metric_key.in_(key_list))

    base = select(LatestMetricValue).where(*conds)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(
        base.order_by(LatestMetricValue.metric_key.asc())
        .limit(page.limit)
        .offset(page.offset)
    ).all()
    return Page[MetricValueOut](
        items=rows, total=total, limit=page.limit, offset=page.offset
    )
