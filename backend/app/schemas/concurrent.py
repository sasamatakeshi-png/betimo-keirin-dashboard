"""同接レース選択（/concurrent-analysis のレース一括選択）用スキーマ。"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class RaceVideo(BaseModel):
    """レースに属する1動画（自社 or 競合）。"""

    video_id: UUID
    youtube_video_id: str | None
    channel_name: str
    is_competitor: bool


class RaceGroup(BaseModel):
    """同接データを「レース（日付＋レース名）」でまとめた1グループ。"""

    race_key: str  # 現状は JST 日付 'YYYY-MM-DD'。将来 '日付|レース名' の複合も許容。
    date: str  # JST 日付 'YYYY-MM-DD'
    label: str  # 表示名（例: '2026-06-21 高松宮記念杯競輪'）
    betimo_present: bool  # 自社（Betimo）動画があるか
    competitor_count: int  # 競合動画の本数（>=1 のグループのみ返す）
    videos: list[RaceVideo]
