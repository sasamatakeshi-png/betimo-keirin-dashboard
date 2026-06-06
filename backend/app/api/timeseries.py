"""時系列 REST エンドポイント（metric_timeseries）。"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import MetricTimeseries
from app.schemas.common import Page, Pagination, pagination
from app.schemas.metric import TimeseriesPointOut

router = APIRouter(prefix="/timeseries", tags=["timeseries"])


@router.get("", response_model=Page[TimeseriesPointOut])
def get_timeseries(
    entity_id: UUID = Query(...),
    metric_key: str = Query(...),
    entity_type: str = Query("videos"),
    page: Pagination = Depends(pagination),
    db: Session = Depends(get_db),
) -> Page[TimeseriesPointOut]:
    conds = [
        MetricTimeseries.entity_id == entity_id,
        MetricTimeseries.metric_key == metric_key,
        MetricTimeseries.entity_type == entity_type,
    ]
    base = select(MetricTimeseries).where(*conds)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(
        base.order_by(MetricTimeseries.elapsed_seconds.asc())
        .limit(page.limit)
        .offset(page.offset)
    ).all()
    return Page[TimeseriesPointOut](
        items=rows, total=total, limit=page.limit, offset=page.offset
    )
