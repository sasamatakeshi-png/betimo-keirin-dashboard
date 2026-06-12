"""YouTube チャンネル統計（総登録者数・総再生数）取得サービス。

- 取得は channels.list?part=statistics（1リクエスト=1ユニット）を自社チャンネル
  (is_own=true) に対して1回呼ぶだけ。
- 保存は channel_stats_daily へ (channel_id, snapshot_date[JST]) で冪等 upsert。
  同じ日に複数回叩いても UNIQUE 制約で1行に集約（DO UPDATE）。
- ingestion_logs に source_type='youtube_api'（既存予約値）で1行記録する。
- キー未設定・API失敗・チャンネル未登録は YouTubeStatsError を送出し、
  呼び出し側（遅延更新エンドポイント）が握って表示を継続できるようにする。
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import requests
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Channel, ChannelStatsDaily, IngestionLog

# JST（取得日 snapshot_date の基準）。外部依存を増やさず固定オフセットで扱う。
_JST = timezone(timedelta(hours=9))
_API_URL = "https://www.googleapis.com/youtube/v3/channels"
# ホーム表示をブロックしすぎないよう短めのタイムアウト。
_TIMEOUT_SECONDS = 10


class YouTubeStatsError(RuntimeError):
    """統計取得の失敗（キー未設定・API エラー・チャンネル未登録など）。

    呼び出し側はこれを握って、既存スナップショット or CSV 値にフォールバックする。
    """


def _jst_today() -> date:
    return datetime.now(_JST).date()


def _to_int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def fetch_channel_statistics(youtube_channel_id: str) -> dict:
    """channels.list?part=statistics を呼び、累計の各カウントを返す。

    返り値: {"subscriber_count", "view_count", "video_count"}（取れない値は None）。
    キー未設定・通信失敗・チャンネル不在は YouTubeStatsError を送出。
    """
    api_key = settings.YOUTUBE_API_KEY
    if not api_key:
        raise YouTubeStatsError("YOUTUBE_API_KEY が未設定です。")

    params = {"part": "statistics", "id": youtube_channel_id, "key": api_key}
    try:
        resp = requests.get(_API_URL, params=params, timeout=_TIMEOUT_SECONDS)
    except requests.RequestException as exc:  # 接続不能・タイムアウト等
        raise YouTubeStatsError(f"YouTube API への接続に失敗しました: {exc}") from exc

    if resp.status_code != 200:
        raise YouTubeStatsError(f"YouTube API エラー: HTTP {resp.status_code}")

    items = resp.json().get("items", [])
    if not items:
        raise YouTubeStatsError(
            f"チャンネルが見つかりません（id={youtube_channel_id}）。"
        )

    stats = items[0].get("statistics", {})
    return {
        "subscriber_count": _to_int(stats.get("subscriberCount")),
        "view_count": _to_int(stats.get("viewCount")),
        "video_count": _to_int(stats.get("videoCount")),
    }


def _make_log(started_at: datetime, *, failed: bool, note: str) -> IngestionLog:
    return IngestionLog(
        source_type="youtube_api",
        file_name=None,
        records_processed=0 if failed else 1,
        records_failed=1 if failed else 0,
        status="failed" if failed else "success",
        started_at=started_at,
        completed_at=datetime.now(timezone.utc),
        error_log={"note": note},
    )


def refresh_channel_stats(db: Session) -> ChannelStatsDaily:
    """自社チャンネルの当日(JST)スナップショットを取得して upsert する。

    成功時は保存した ChannelStatsDaily を返す。
    失敗時は ingestion_logs に失敗ログを残したうえで YouTubeStatsError を送出する。
    """
    started_at = datetime.now(timezone.utc)

    channel = db.scalar(select(Channel).where(Channel.is_own.is_(True)))
    if channel is None:
        # チャンネル未登録は致命的設定不足。ログも残せないので即送出。
        raise YouTubeStatsError("自社チャンネル(is_own=true)が登録されていません。")

    snapshot_date = _jst_today()

    try:
        stats = fetch_channel_statistics(channel.youtube_channel_id)
    except YouTubeStatsError as exc:
        # 取得失敗：失敗ログだけ残してそのまま送出（DB への書き込みは無し）。
        db.add(_make_log(started_at, failed=True, note=str(exc)))
        db.commit()
        raise

    values = {
        "channel_id": channel.id,
        "snapshot_date": snapshot_date,
        "subscriber_count": stats["subscriber_count"],
        "view_count": stats["view_count"],
        "video_count": stats["video_count"],
        "fetched_at": datetime.now(timezone.utc),
        "source": "youtube_api",
    }
    stmt = (
        pg_insert(ChannelStatsDaily)
        .values(**values)
        .on_conflict_do_update(
            index_elements=["channel_id", "snapshot_date"],
            set_={
                "subscriber_count": values["subscriber_count"],
                "view_count": values["view_count"],
                "video_count": values["video_count"],
                "fetched_at": values["fetched_at"],
                "source": values["source"],
            },
        )
    )
    db.execute(stmt)
    db.add(
        _make_log(
            started_at,
            failed=False,
            note=(
                f"{snapshot_date} subscribers={stats['subscriber_count']} "
                f"views={stats['view_count']}"
            ),
        )
    )
    db.commit()

    return db.scalar(
        select(ChannelStatsDaily).where(
            ChannelStatsDaily.channel_id == channel.id,
            ChannelStatsDaily.snapshot_date == snapshot_date,
        )
    )
