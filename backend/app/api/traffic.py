"""トラフィックソース（流入経路）集計エンドポイント。P12 対応。

channel_traffic_sources（チャンネル全体・月単位）を読み取り、
  - source_type='category' を「流入ソース別集計」（視聴回数降順＋構成比%）
  - source_type='related_video' を「関連動画Top」（視聴回数降順 上位10件）
  - source_type='external_url' を「外部サイトTop」（視聴回数降順 上位10件）
として返す。スキーマ変更なし（既存テーブルのみ参照）。

備考: 「ライブ配信の関連動画Top」に厳密に相当する「ライブ由来かどうか」の区別は
テーブルに存在しないため、チャンネル全体の関連動画Topとして返す。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import ChannelTrafficSource
from app.schemas.traffic import (
    ExternalSiteItem,
    RelatedVideoItem,
    TrafficSourceItem,
    TrafficSourcesResponse,
)

router = APIRouter(prefix="/traffic-sources", tags=["traffic-sources"])

_RELATED_TOP_N = 10
_EXTERNAL_TOP_N = 10


@router.get("", response_model=TrafficSourcesResponse)
def traffic_sources(
    year_month: str | None = Query(
        None, description="対象月 'YYYY-MM'。省略時は最新の利用可能な月"
    ),
    db: Session = Depends(get_db),
) -> TrafficSourcesResponse:
    # 選択可能な月（昇順）。これが空ならデータ無し。
    available_months = list(
        db.scalars(
            select(ChannelTrafficSource.year_month)
            .distinct()
            .order_by(ChannelTrafficSource.year_month)
        ).all()
    )
    if not available_months:
        return TrafficSourcesResponse(
            year_month=None,
            available_months=[],
            total_view_count=0,
            sources=[],
            related_videos=[],
            external_sites=[],
        )

    # 対象月の決定（未指定・不正値は最新月にフォールバック）。
    target_ym = year_month if year_month in available_months else available_months[-1]

    # ---- 流入ソース別（category）: 視聴回数降順 ----
    cat_rows = db.scalars(
        select(ChannelTrafficSource)
        .where(
            ChannelTrafficSource.year_month == target_ym,
            ChannelTrafficSource.source_type == "category",
        )
        .order_by(ChannelTrafficSource.view_count.desc().nullslast())
    ).all()

    # 構成比の母数 = カテゴリ視聴回数の合計（null は 0 扱いで合算）。
    total_view_count = sum((r.view_count or 0) for r in cat_rows)

    sources = [
        TrafficSourceItem(
            source_key=r.source_key,
            source_name=r.source_name,
            view_count=r.view_count,
            view_share=(r.view_count / total_view_count)
            if r.view_count is not None and total_view_count > 0
            else None,
            avg_watch_seconds=r.avg_watch_seconds,
            total_watch_hours=float(r.total_watch_hours)
            if r.total_watch_hours is not None
            else None,
            imp=int(r.imp) if r.imp is not None else None,
            ctr=float(r.ctr) if r.ctr is not None else None,
        )
        for r in cat_rows
    ]

    # ---- 関連動画Top（related_video）: 視聴回数降順 上位N件 ----
    rel_rows = db.scalars(
        select(ChannelTrafficSource)
        .where(
            ChannelTrafficSource.year_month == target_ym,
            ChannelTrafficSource.source_type == "related_video",
        )
        .order_by(ChannelTrafficSource.view_count.desc().nullslast())
        .limit(_RELATED_TOP_N)
    ).all()

    related_videos = [
        RelatedVideoItem(
            source_key=r.source_key,
            title=r.source_name,
            view_count=r.view_count,
            avg_watch_seconds=r.avg_watch_seconds,
            total_watch_hours=float(r.total_watch_hours)
            if r.total_watch_hours is not None
            else None,
        )
        for r in rel_rows
    ]

    # ---- 外部サイトTop（external_url）: 視聴回数降順 上位N件 ----
    # 「外部」流入の内訳（外部サイト/URL × 視聴回数）。関連動画Topと同じ集計方法。
    ext_rows = db.scalars(
        select(ChannelTrafficSource)
        .where(
            ChannelTrafficSource.year_month == target_ym,
            ChannelTrafficSource.source_type == "external_url",
        )
        .order_by(ChannelTrafficSource.view_count.desc().nullslast())
        .limit(_EXTERNAL_TOP_N)
    ).all()

    external_sites = [
        ExternalSiteItem(
            source_key=r.source_key,
            name=r.source_name,
            view_count=r.view_count,
            avg_watch_seconds=r.avg_watch_seconds,
            total_watch_hours=float(r.total_watch_hours)
            if r.total_watch_hours is not None
            else None,
        )
        for r in ext_rows
    ]

    return TrafficSourcesResponse(
        year_month=target_ym,
        available_months=available_months,
        total_view_count=int(total_view_count),
        sources=sources,
        related_videos=related_videos,
        external_sites=external_sites,
    )
