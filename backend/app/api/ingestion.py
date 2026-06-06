"""取り込み REST エンドポイント。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import IngestionLog
from app.schemas.common import Page, Pagination, pagination
from app.schemas.ingestion import IngestionLogOut, UploadResult
from app.services.ingestion import INGEST_TYPES, ingest_csv

router = APIRouter(prefix="/ingestion", tags=["ingestion"])


@router.post("/upload", response_model=UploadResult)
async def upload_csv(
    file: UploadFile = File(...),
    type: str = Form(..., description="zenkikan_csv | 90d_csv"),
    db: Session = Depends(get_db),
) -> UploadResult:
    if type not in INGEST_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"type must be one of {sorted(INGEST_TYPES)}",
        )
    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="empty file"
        )
    result = ingest_csv(db, content, file.filename, type)
    return UploadResult(**result)


@router.get("/logs", response_model=Page[IngestionLogOut])
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
