"""X（旧Twitter）日別アナリティクスのエンドポイント。P14 対応。

x_daily_metrics（日別・自社1アカウント）を読み取り、日別データ＋期間計＋
前期間（同じ日数だけ前にずらした期間）計＋主要指標の前期間比% を返す。
スキーマ変更なし（既存テーブルのみ参照）。
"""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import XDailyMetric
from app.schemas.x_analytics import (
    X_METRIC_KEYS,
    XAnalyticsDailyResponse,
    XDailyPoint,
)

router = APIRouter(prefix="/x-analytics", tags=["x-analytics"])

# 期間未指定時の既定の窓幅（日数）。直近 DEFAULT_WINDOW_DAYS 日を表示する。
DEFAULT_WINDOW_DAYS = 28


def _period_totals(db: Session, d_from: date, d_to: date) -> dict[str, int]:
    """指定期間 [d_from, d_to] の各指標の合計（null は除外して合算、結果は 0 補完）。"""
    cols = [
        func.coalesce(func.sum(getattr(XDailyMetric, k)), 0).label(k)
        for k in X_METRIC_KEYS
    ]
    row = db.execute(
        select(*cols).where(XDailyMetric.date >= d_from, XDailyMetric.date <= d_to)
    ).one()
    return {k: int(getattr(row, k)) for k in X_METRIC_KEYS}


@router.get("/daily", response_model=XAnalyticsDailyResponse)
def x_analytics_daily(
    date_from: date | None = Query(None, description="期間の開始日（含む）"),
    date_to: date | None = Query(None, description="期間の終了日（含む）"),
    db: Session = Depends(get_db),
) -> XAnalyticsDailyResponse:
    # テーブルの利用可能範囲（セレクタ境界・既定期間の算出に使う）。
    bounds = db.execute(
        select(func.min(XDailyMetric.date), func.max(XDailyMetric.date))
    ).one()
    available_from, available_to = bounds[0], bounds[1]

    if available_to is None:  # データ無し
        empty = {k: 0 for k in X_METRIC_KEYS}
        return XAnalyticsDailyResponse(
            date_from=None,
            date_to=None,
            prev_date_from=None,
            prev_date_to=None,
            available_from=None,
            available_to=None,
            items=[],
            period_totals=empty,
            prev_period_totals=empty,
            change_ratios={k: None for k in X_METRIC_KEYS},
        )

    # 期間の決定（未指定なら直近の利用可能な範囲＝末尾から DEFAULT_WINDOW_DAYS 日）。
    d_to = date_to or available_to
    d_from = date_from or (d_to - timedelta(days=DEFAULT_WINDOW_DAYS - 1))
    if d_from > d_to:
        d_from = d_to

    # 前期間 = 同じ日数だけ前にずらした、直前の等長期間。
    span_days = (d_to - d_from).days + 1
    prev_to = d_from - timedelta(days=1)
    prev_from = prev_to - timedelta(days=span_days - 1)

    # 日別（date 昇順）。
    rows = db.scalars(
        select(XDailyMetric)
        .where(XDailyMetric.date >= d_from, XDailyMetric.date <= d_to)
        .order_by(XDailyMetric.date)
    ).all()
    items = [
        XDailyPoint(
            date=r.date.isoformat(),
            posts_created=r.posts_created,
            imp=r.imp,
            likes=r.likes,
            engagements=r.engagements,
            follows_gained=r.follows_gained,
            unfollows=r.unfollows,
            net_follows=r.net_follows,
            replies=r.replies,
            reposts=r.reposts,
            profile_visits=r.profile_visits,
            bookmarks=r.bookmarks,
            shares=r.shares,
            video_views=r.video_views,
            media_views=r.media_views,
        )
        for r in rows
    ]

    period_totals = _period_totals(db, d_from, d_to)
    prev_period_totals = _period_totals(db, prev_from, prev_to)

    change_ratios: dict[str, float | None] = {}
    for k in X_METRIC_KEYS:
        prev = prev_period_totals[k]
        cur = period_totals[k]
        change_ratios[k] = (cur - prev) / prev if prev != 0 else None

    return XAnalyticsDailyResponse(
        date_from=d_from.isoformat(),
        date_to=d_to.isoformat(),
        prev_date_from=prev_from.isoformat(),
        prev_date_to=prev_to.isoformat(),
        available_from=available_from.isoformat(),
        available_to=available_to.isoformat(),
        items=items,
        period_totals=period_totals,
        prev_period_totals=prev_period_totals,
        change_ratios=change_ratios,
    )
