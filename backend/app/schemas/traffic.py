"""トラフィックソース（流入経路）集計の画面用スキーマ。P12 対応。

channel_traffic_sources（チャンネル全体・月単位）を読み取って返す。
source_type='category' を主集計、'related_video' を関連動画Topとして返す。
スキーマ変更なし（既存テーブルのみ参照）。
"""

from __future__ import annotations

from pydantic import BaseModel


class TrafficSourceItem(BaseModel):
    """流入ソース1件（source_type='category' の1カテゴリ）。"""

    source_key: str  # カテゴリ名（例: ブラウジング機能）
    source_name: str | None = None  # 表示名（category では通常 NULL）
    view_count: int | None = None  # 視聴回数
    view_share: float | None = None  # 視聴回数の構成比（0〜1。母数=カテゴリ合計）
    avg_watch_seconds: int | None = None  # 平均視聴時間（秒）
    total_watch_hours: float | None = None  # 総再生時間（時間）
    imp: int | None = None  # インプレッション
    ctr: float | None = None  # CTR（0〜1）


class RelatedVideoItem(BaseModel):
    """関連動画Top の1件（source_type='related_video'）。"""

    source_key: str  # 関連動画ID（接頭辞除去後）
    title: str | None = None  # 動画タイトル（source_name）
    view_count: int | None = None
    avg_watch_seconds: int | None = None
    total_watch_hours: float | None = None


class ExternalSiteItem(BaseModel):
    """外部サイトTop の1件（source_type='external_url'）。

    「外部」流入の内訳（外部サイト/URL × 視聴回数）。source_key は URL/識別子、
    name は表示名（無ければ source_key にフォールバックして使う想定）。
    """

    source_key: str  # 外部URL/識別子（接頭辞除去後）
    name: str | None = None  # 表示名（source_name）
    view_count: int | None = None
    avg_watch_seconds: int | None = None
    total_watch_hours: float | None = None


class SearchTermItem(BaseModel):
    """YouTube検索キーワードTop の1件（source_type='search_term'）。

    「YouTube検索」流入の内訳（検索語 × 視聴回数）。term は検索語（source_key）。
    imp/ctr はデータ無しのため持たない（視聴回数ベース）。
    """

    term: str  # 検索語（source_key）
    view_count: int | None = None
    avg_watch_seconds: int | None = None
    total_watch_hours: float | None = None


class TrafficSourcesResponse(BaseModel):
    """P12 トラフィックソース画面のレスポンス。"""

    year_month: str | None  # 対象月（データ無しなら None）
    available_months: list[str]  # 選択可能な月（昇順）
    total_view_count: int  # カテゴリ視聴回数の合計（構成比の母数）
    sources: list[TrafficSourceItem]  # 視聴回数の降順
    related_videos: list[RelatedVideoItem]  # 視聴回数の降順 上位10件
    external_sites: list[ExternalSiteItem]  # 「外部」内訳 視聴回数の降順 上位10件
    search_terms: list[SearchTermItem]  # 「YouTube検索」内訳 視聴回数の降順 上位10件
