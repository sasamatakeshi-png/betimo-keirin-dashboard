"""取り込み REST エンドポイント。"""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import get_current_auth
from app.models import IngestionLog
from app.schemas.common import Page, Pagination, pagination
from app.schemas.ingestion import IngestionLogOut, MonthlyUploadResult, UploadResult
from app.services.ingestion import (
    INGEST_TYPES,
    SHORT_INGEST_TYPES,
    ingest_csv,
    ingest_short_csv,
)
from app.services.monthly_ingestion import (
    MONTHLY_KINDS,
    SEGMENTS,
    MonthlyIngestError,
    ingest_monthly_demographics_csv,
    ingest_monthly_metrics_csv,
)

router = APIRouter(prefix="/ingestion", tags=["ingestion"])

_ALL_INGEST_TYPES = INGEST_TYPES | SHORT_INGEST_TYPES

_YEAR_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


@router.post(
    "/upload",
    response_model=UploadResult,
    dependencies=[Depends(get_current_auth)],
)
async def upload_csv(
    file: UploadFile = File(...),
    type: str = Form(
        ...,
        description="zenkikan_csv | 90d_csv | short_zenkikan_csv | short_90d_csv",
    ),
    db: Session = Depends(get_db),
) -> UploadResult:
    if type not in _ALL_INGEST_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"type must be one of {sorted(_ALL_INGEST_TYPES)}",
        )
    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="empty file"
        )
    if type in SHORT_INGEST_TYPES:
        result = ingest_short_csv(db, content, file.filename, type)
    else:
        result = ingest_csv(db, content, file.filename, type)
    return UploadResult(**result)


@router.post(
    "/monthly",
    response_model=MonthlyUploadResult,
    dependencies=[Depends(get_current_auth)],
)
async def upload_monthly_csv(
    file: UploadFile = File(...),
    year_month: str = Form(..., description="対象月 'YYYY-MM'（2025-11 以降）"),
    segment: str = Form(..., description="all | live | short"),
    kind: str = Form(..., description="metrics | demographics"),
    db: Session = Depends(get_db),
) -> MonthlyUploadResult:
    if not _YEAR_MONTH_RE.match(year_month):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="year_month must be 'YYYY-MM'",
        )
    if segment not in SEGMENTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"segment must be one of {sorted(SEGMENTS)}",
        )
    if kind not in MONTHLY_KINDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"kind must be one of {sorted(MONTHLY_KINDS)}",
        )
    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="empty file"
        )
    try:
        if kind == "metrics":
            result = ingest_monthly_metrics_csv(
                db, content, file.filename, year_month, segment
            )
        else:
            result = ingest_monthly_demographics_csv(
                db, content, file.filename, year_month, segment
            )
    except MonthlyIngestError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return MonthlyUploadResult(**result)


@router.get(
    "/logs",
    response_model=Page[IngestionLogOut],
    dependencies=[Depends(get_current_auth)],
)
def list_logs(
    page: Pagination = Depends(pagination),
    db: Session = Depends(get_db),
) -> Page[IngestionLogOut]:
    base = select(IngestionLog)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(
        base.order_by(
            func.coalesce(IngestionLog.completed_at, IngestionLog.started_at)
            .desc()
            .nullslast()
        )
        .limit(page.limit)
        .offset(page.offset)
    ).all()
    return Page[IngestionLogOut](
        items=rows, total=total, limit=page.limit, offset=page.offset
    )
