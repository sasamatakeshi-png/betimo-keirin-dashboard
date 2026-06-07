"""チャンネル REST エンドポイント（読み出しのみ）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import Channel
from app.schemas.channel import ChannelOut
from app.schemas.common import Page, Pagination, pagination

router = APIRouter(prefix="/channels", tags=["channels"])


@router.get("", response_model=Page[ChannelOut])
def list_channels(
    page: Pagination = Depends(pagination),
    db: Session = Depends(get_db),
) -> Page[ChannelOut]:
    base = select(Channel)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(
        base.order_by(Channel.is_own.desc(), Channel.name.asc())
        .limit(page.limit)
        .offset(page.offset)
    ).all()
    return Page[ChannelOut](items=rows, total=total, limit=page.limit, offset=page.offset)
