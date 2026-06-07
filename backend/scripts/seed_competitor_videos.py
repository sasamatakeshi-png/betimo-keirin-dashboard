"""競合チャンネル・競合動画のシード（同接xlsxから・冪等）。

使い方（backend/ から実行）:
    python scripts/seed_competitor_videos.py data/xxx.xlsx
- COMPETITOR_CHANNELS にあるチャンネルの動画だけを対象にする（「その他」は投入しない）。
- channels は UNIQUE(youtube_channel_id)、videos は UNIQUE(youtube_video_id) への
  ON CONFLICT DO NOTHING で冪等（既存行は一切更新しない）。
- published_at は「設定」シートの計測開始日時（JST）をフォールバック起点として使う。
- event_id は紐付けない（自社イベント集計を汚さないため）。
"""

from __future__ import annotations

import argparse
import io
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import openpyxl  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.dialects.postgresql import insert as pg_insert  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.models import Channel, Video  # noqa: E402
from app.services.parsers.ccu_timeseries import JST, parse_ccu_timeseries_xlsx  # noqa: E402

# xlsx のチャンネル表示名 → チャンネルマスタ（競合主要3社）
# youtube_channel_id / handle は公開ページ（oEmbed / watchページ）から取得した実値。
COMPETITOR_CHANNELS: dict[str, dict] = {
    'チャリロト公式競輪番組 加藤慎平の「ぺーちゃんねる」': {
        "name": 'チャリロト公式競輪番組 加藤慎平の「ぺーちゃんねる」',
        "youtube_channel_id": "UCr4eIfuNdlZWSDMjFwDTabA",
        "handle": "@加藤慎平のぺーちゃんねる",
    },
    "【公式】オッズパーク競輪": {
        "name": "【公式】オッズパーク競輪",
        "youtube_channel_id": "UCReK-VzvKi2sIb8Bkw9Zs8g",
        "handle": "@oddsparkcorp",
    },
    "本気の競輪TV / RakutenKdreams【公式】": {
        "name": "本気の競輪TV / RakutenKdreams【公式】",
        "youtube_channel_id": "UCwwT3gwzeHKHDAarQ3z5zhw",
        "handle": "@rakutenkdreams",
    },
}


def read_measurement_start(content: bytes) -> datetime:
    """「設定」シートから計測開始日時（JST aware）を読む。"""
    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True, read_only=True)
    try:
        ws = wb["設定"]
        for row in ws.iter_rows(values_only=True):
            cells = list(row)
            for i, c in enumerate(cells):
                if isinstance(c, str) and "計測開始日時" in c:
                    for v in cells[i + 1 :]:
                        if isinstance(v, datetime):
                            return v.replace(tzinfo=JST)
        raise ValueError("「計測開始日時」が設定シートに見つかりません")
    finally:
        wb.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="競合チャンネル・動画のシード")
    ap.add_argument("xlsx", help="同接時系列 Excel のパス")
    args = ap.parse_args()

    content = Path(args.xlsx).read_bytes()
    started_at = read_measurement_start(content)
    print(f"計測開始日時(=published_at フォールバック): {started_at}")

    points = parse_ccu_timeseries_xlsx(content)
    # 動画ID → (チャンネル表示名, 番組タイトル) ※最初の出現行を採用
    videos_in_file: dict[str, tuple[str, str]] = {}
    for p in points:
        videos_in_file.setdefault(p["youtube_video_id"], (p["channel_name"], p["title"]))

    db = SessionLocal()
    try:
        # 1) channels UPSERT（競合3社）
        for ch in COMPETITOR_CHANNELS.values():
            stmt = (
                pg_insert(Channel)
                .values(
                    youtube_channel_id=ch["youtube_channel_id"],
                    name=ch["name"],
                    handle=ch["handle"],
                    is_own=False,
                    is_default_competitor=True,
                    is_enabled=True,
                )
                .on_conflict_do_nothing(index_elements=["youtube_channel_id"])
                .returning(Channel.id)
            )
            inserted = db.execute(stmt).fetchall()
            print(f"channel {ch['name']}: {'inserted' if inserted else 'already exists'}")

        # youtube_channel_id → channels.id
        ch_ids = dict(
            db.execute(
                select(Channel.youtube_channel_id, Channel.id).where(
                    Channel.youtube_channel_id.in_(
                        [c["youtube_channel_id"] for c in COMPETITOR_CHANNELS.values()]
                    )
                )
            ).all()
        )

        # 2) videos UPSERT（マスタに載っているチャンネルの動画のみ）
        for vid, (channel_name, title) in videos_in_file.items():
            ch = COMPETITOR_CHANNELS.get(channel_name)
            if ch is None:
                continue  # 自社・「その他」は対象外
            stmt = (
                pg_insert(Video)
                .values(
                    youtube_video_id=vid,
                    channel_id=ch_ids[ch["youtube_channel_id"]],
                    title=title,
                    published_at=started_at,
                    is_competitor=True,
                    content_type="regular",
                    cast_members=[],
                )
                .on_conflict_do_nothing(index_elements=["youtube_video_id"])
                .returning(Video.id)
            )
            inserted = db.execute(stmt).fetchall()
            print(f"video {vid} ({channel_name}): {'inserted' if inserted else 'already exists'}")

        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    main()
