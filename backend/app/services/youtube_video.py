"""YouTube Data API: 動画の配信開始時刻（published_at）取得。

videos.list?part=liveStreamingDetails,snippet を1動画につき1回呼ぶ（1ユニット）。
ライブ配信は liveStreamingDetails.actualStartTime を優先し、無ければ
snippet.publishedAt にフォールバックして UTC aware datetime を返す。

注意:
- この関数は「videos.published_at も xlsx の計測開始日時も無い」ときの最終手段。
  通常の取り込み（既存動画 or 設定シートに計測開始日時あり）では呼ばれない。
- キー未設定・通信失敗・動画不在は None を返す（呼び出し側でフォールバック）。
"""

from __future__ import annotations

from datetime import datetime, timezone

import requests

from app.core.config import settings

_API_URL = "https://www.googleapis.com/youtube/v3/videos"
_TIMEOUT_SECONDS = 10


def _parse_iso8601_utc(value: str | None) -> datetime | None:
    """'2026-05-06T00:55:25Z' 等の ISO8601 を UTC aware datetime に変換。"""
    if not value or not isinstance(value, str):
        return None
    try:
        # 'Z' を +00:00 に正規化して fromisoformat に渡す
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def fetch_video_published_at(youtube_video_id: str) -> datetime | None:
    """動画の配信開始時刻（actualStartTime 優先, publishedAt フォールバック）を返す。

    取得できない場合（キー未設定・API失敗・動画不在・時刻欠落）は None。
    """
    api_key = settings.YOUTUBE_API_KEY
    if not api_key or not youtube_video_id:
        return None

    params = {
        "part": "liveStreamingDetails,snippet",
        "id": youtube_video_id,
        "key": api_key,
    }
    try:
        resp = requests.get(_API_URL, params=params, timeout=_TIMEOUT_SECONDS)
    except requests.RequestException:
        return None
    if resp.status_code != 200:
        return None

    items = resp.json().get("items", [])
    if not items:
        return None
    item = items[0]
    live = item.get("liveStreamingDetails", {}) or {}
    snippet = item.get("snippet", {}) or {}
    return _parse_iso8601_utc(live.get("actualStartTime")) or _parse_iso8601_utc(
        snippet.get("publishedAt")
    )
