"""番組比較（レポートP4「番組ごと詳細数値」）スキーマ。

母集団は自社・regular・program_type ありの 142 番組（歴史データ）。
candidates = 比較対象に選べる番組一覧、detail = 選択番組の詳細指標。
既存 /videos/compare とは独立した新規追加（既存に手は入れない）。
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class ProgramCandidate(BaseModel):
    """選択候補1番組の見出し情報。"""

    video_id: UUID
    youtube_video_id: str | None
    title: str
    program_type: str | None
    published_at: datetime | None
    event_name: str | None
    cast_members: list[str]


class ProgramCandidatesResponse(BaseModel):
    """candidates レスポンス。

    items は絞り込み後の候補。program_types / year_months は母集団(142本)
    全体から算出した「安定したフィルタ選択肢」（絞り込みで縮まない）。
    """

    items: list[ProgramCandidate]
    total: int
    program_types: list[str]
    year_months: list[str]


class ProgramDetailMetrics(BaseModel):
    """番組詳細の指標。欠損は null。比率(%)は 0〜1 の小数で返す。"""

    view_count: float | None = None
    imp: float | None = None
    subscriber_gain: float | None = None
    max_concurrent_viewers: float | None = None
    avg_concurrent_viewers: float | None = None
    live_views: float | None = None
    archive_views: float | None = None
    # 計算指標: archive_views / view_count（0〜1。view_count 欠損/0 や archive 欠損は null）
    archive_ratio: float | None = None
    avg_view_duration: float | None = None  # 秒
    avg_view_percentage: float | None = None  # 0〜1
    unique_viewers: float | None = None
    repeater_ratio: float | None = None  # 0〜1


class ProgramDetail(BaseModel):
    """番組1本の詳細（見出し + 指標）。"""

    video_id: UUID
    youtube_video_id: str | None
    title: str
    program_type: str | None
    published_at: datetime | None
    event_name: str | None
    cast_members: list[str]
    metrics: ProgramDetailMetrics


class ProgramDetailResponse(BaseModel):
    """detail レスポンス。items は要求順を保持。母集団外/不正IDは not_found。"""

    items: list[ProgramDetail]
    not_found: list[str]
