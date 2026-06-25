"""X（旧Twitter）日別アナリティクスの画面用スキーマ。P14 対応。

x_daily_metrics（日別・自社1アカウント）を読み取って返す。
期間計・前期間（同じ日数だけ前にずらした期間）計・主要指標の前期間比%を付与。
スキーマ変更なし（既存テーブルのみ参照）。
"""

from __future__ import annotations

from pydantic import BaseModel

# 集計対象の指標キー（x_daily_metrics の数値列。期間計・前期間比で共通利用）。
X_METRIC_KEYS = [
    "posts_created",
    "imp",
    "likes",
    "engagements",
    "follows_gained",
    "unfollows",
    "net_follows",
    "replies",
    "reposts",
    "profile_visits",
    "bookmarks",
    "shares",
    "video_views",
    "media_views",
]


class XDailyPoint(BaseModel):
    """日別の1点（1日=1行）。null≠0（欠損はそのまま null）。"""

    date: str  # 'YYYY-MM-DD'
    posts_created: int | None = None
    imp: int | None = None
    likes: int | None = None
    engagements: int | None = None
    follows_gained: int | None = None
    unfollows: int | None = None
    net_follows: int | None = None
    replies: int | None = None
    reposts: int | None = None
    profile_visits: int | None = None
    bookmarks: int | None = None
    shares: int | None = None
    video_views: int | None = None
    media_views: int | None = None


class XAnalyticsDailyResponse(BaseModel):
    """P14 Xアナリティクス画面のレスポンス。"""

    date_from: str | None  # 対象期間の開始 'YYYY-MM-DD'
    date_to: str | None  # 対象期間の終了 'YYYY-MM-DD'
    prev_date_from: str | None  # 前期間（同日数だけ前にずらし）の開始
    prev_date_to: str | None  # 前期間の終了
    available_from: str | None  # テーブルの最小日付（セレクタ下限）
    available_to: str | None  # テーブルの最大日付（セレクタ上限）
    items: list[XDailyPoint]  # date 昇順
    period_totals: dict[str, int]  # 指標→期間計（合計。null は除外して合算）
    prev_period_totals: dict[str, int]  # 指標→前期間計
    change_ratios: dict[str, float | None]  # 指標→前期間比（(cur-prev)/prev。不能は null）
