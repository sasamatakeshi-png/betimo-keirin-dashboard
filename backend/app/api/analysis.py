"""AI 分析 REST エンドポイント。"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import get_current_auth
from app.models import AnalysisResult, AnalysisTemplate
from app.schemas.analysis import (
    AnalysisResultOut,
    AnalysisResultUpdate,
    AnalysisRunRequest,
    AnalysisRunResult,
    AnalysisTemplateOut,
)
from app.schemas.common import Page, Pagination, pagination
from app.services.ai_analysis import (
    AnalysisUnavailable,
    EntityNotFound,
    run_analysis,
)

router = APIRouter(prefix="/analysis", tags=["analysis"])


@router.get("/templates", response_model=Page[AnalysisTemplateOut])
def list_templates(
    screen_type: str | None = None,
    page: Pagination = Depends(pagination),
    db: Session = Depends(get_db),
) -> Page[AnalysisTemplateOut]:
    conds = []
    if screen_type:
        conds.append(AnalysisTemplate.screen_type == screen_type)
    base = select(AnalysisTemplate).where(*conds)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(
        base.order_by(AnalysisTemplate.created_at.asc())
        .limit(page.limit)
        .offset(page.offset)
    ).all()
    return Page[AnalysisTemplateOut](
        items=rows, total=total, limit=page.limit, offset=page.offset
    )


@router.post(
    "/run",
    response_model=AnalysisRunResult,
    dependencies=[Depends(get_current_auth)],
)
def run(body: AnalysisRunRequest, db: Session = Depends(get_db)) -> AnalysisRunResult:
    try:
        result = run_analysis(
            db,
            entity_type=body.entity_type,
            entity_id=body.entity_id,
            template_id=body.template_id,
            adhoc_prompt=body.prompt,
            tone=body.tone,
            length=body.length,
        )
    except AnalysisUnavailable as exc:
        # API キー未設定など。落とさず 503 + 明確なメッセージ。
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except EntityNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return AnalysisRunResult(id=result.id, generated_text=result.generated_text)


@router.get("/results", response_model=Page[AnalysisResultOut])
def list_results(
    entity_type: str = Query(...),
    entity_id: UUID = Query(...),
    page: Pagination = Depends(pagination),
    db: Session = Depends(get_db),
) -> Page[AnalysisResultOut]:
    base = select(AnalysisResult).where(
        AnalysisResult.entity_type == entity_type,
        AnalysisResult.entity_id == entity_id,
    )
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(
        base.order_by(AnalysisResult.generated_at.desc())
        .limit(page.limit)
        .offset(page.offset)
    ).all()
    return Page[AnalysisResultOut](
        items=rows, total=total, limit=page.limit, offset=page.offset
    )


@router.patch(
    "/results/{result_id}",
    response_model=AnalysisResultOut,
    dependencies=[Depends(get_current_auth)],
)
def update_result(
    result_id: UUID,
    body: AnalysisResultUpdate,
    db: Session = Depends(get_db),
) -> AnalysisResult:
    result = db.get(AnalysisResult, result_id)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="result not found"
        )
    result.user_edits = body.user_edits
    db.commit()
    db.refresh(result)
    return result
