"""イベント REST エンドポイント。"""

from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import Event
from app.schemas.common import Page, Pagination, pagination
from app.schemas.event import EventOut

router = APIRouter(prefix="/events", tags=["events"])


@router.get("", response_model=Page[EventOut])
def list_events(
    q: str | None = Query(None, description="name 部分一致"),
    grade: str | None = None,
    date_from: date | None = Query(None, description="start_date の下限"),
    date_to: date | None = Query(None, description="start_date の上限"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    page: Pagination = Depends(pagination),
    db: Session = Depends(get_db),
) -> Page[EventOut]:
    conds = []
    if q:
        conds.append(Event.name.ilike(f"%{q}%"))
    if grade:
        conds.append(Event.grade == grade)
    if date_from:
        conds.append(Event.start_date >= date_from)
    if date_to:
        conds.append(Event.start_date <= date_to)

    base = select(Event).where(*conds)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0

    ordering = (
        Event.start_date.desc().nullslast()
        if order == "desc"
        else Event.start_date.asc().nullsfirst()
    )
    rows = db.scalars(
        base.order_by(ordering, Event.created_at.desc())
        .limit(page.limit)
        .offset(page.offset)
    ).all()
    return Page[EventOut](items=rows, total=total, limit=page.limit, offset=page.offset)


@router.get("/{event_id}", response_model=EventOut)
def get_event(event_id: UUID, db: Session = Depends(get_db)) -> Event:
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="event not found")
    return event
