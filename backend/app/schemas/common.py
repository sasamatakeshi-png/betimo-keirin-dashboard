"""共通スキーマ / ページング。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel

T = TypeVar("T")

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


class Page(BaseModel, Generic[T]):
    """一覧レスポンス共通形式: { items, total, limit, offset }。"""

    items: list[T]
    total: int
    limit: int
    offset: int


@dataclass
class Pagination:
    limit: int
    offset: int


def pagination(
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0),
) -> Pagination:
    return Pagination(limit=limit, offset=offset)
