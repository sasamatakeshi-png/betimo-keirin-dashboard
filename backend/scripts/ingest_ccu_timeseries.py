"""同接時系列 Excel を metric_timeseries に投入する CLI。

使い方（backend/ から実行）:
    python scripts/ingest_ccu_timeseries.py data/xxx.xlsx --only Bfm5lfPFoM0
--only を省略すると、videos に登録済みの全動画分を投入する。
冪等（再実行しても重複しない）。データファイル自体はコミットしないこと。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.db import SessionLocal  # noqa: E402
from app.services.parsers.ccu_timeseries import parse_ccu_timeseries_xlsx  # noqa: E402
from app.services.timeseries_ingestion import ingest_ccu_points  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description="同接時系列 Excel の取込")
    ap.add_argument("xlsx", help="入力 Excel ファイルパス")
    ap.add_argument("--only", nargs="*", help="投入対象を YouTube 動画IDで限定")
    args = ap.parse_args()

    content = Path(args.xlsx).read_bytes()
    points = parse_ccu_timeseries_xlsx(content)
    print(f"parsed points: {len(points)}")

    only = set(args.only) if args.only else None
    db = SessionLocal()
    try:
        summary = ingest_ccu_points(db, points, only_youtube_ids=only)
    finally:
        db.close()

    print(f"inserted: {summary['inserted']} / duplicates(skip): {summary['duplicates']}")
    print(f"negative_elapsed(除外): {summary['negative_elapsed']}")
    for vid, s in summary["per_video"].items():
        print(f"  {vid}: attempted={s['attempted']} inserted={s['inserted']} negative={s['negative_elapsed']}")
    if summary["skipped_videos"]:
        print("skipped videos:")
        for s in summary["skipped_videos"]:
            print(f"  {s['youtube_video_id']} ({s['channel_name']}): {s['points']}点 — {s['reason']}")


if __name__ == "__main__":
    main()
