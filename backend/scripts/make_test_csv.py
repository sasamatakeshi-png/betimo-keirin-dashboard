"""取り込み動作確認用の最小サンプルCSVを生成する。

実データCSVが無い場合に、既存 video の youtube_video_id を数件使って
全期間CSV / 90日CSV を backend/scripts/ に書き出す。
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import psycopg  # noqa: E402

from app.core.config import settings  # noqa: E402
from scripts.apply_migrations import to_psycopg_dsn  # noqa: E402

OUT_ZENKIKAN = BACKEND_DIR / "scripts" / "sample_zenkikan.csv"
OUT_90D = BACKEND_DIR / "scripts" / "sample_90d.csv"


def fetch_video_ids(n: int = 3) -> list[str]:
    with psycopg.connect(to_psycopg_dsn(settings.DATABASE_URL)) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT youtube_video_id FROM videos "
            "WHERE youtube_video_id IS NOT NULL ORDER BY published_at DESC LIMIT %s",
            (n,),
        )
        return [r[0] for r in cur.fetchall()]


def main() -> int:
    ids = fetch_video_ids(3)
    if len(ids) < 2:
        print("ERROR: テストに使える video が不足しています。")
        return 1

    # 全期間CSV（表記ゆれを含む日本語ヘッダ。平均視聴時間=h:mm:ss、平均再生率=%）
    with OUT_ZENKIKAN.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            ["コンテンツ", "インプレッション数", "視聴回数", "チャンネル登録者の増減", "平均視聴時間", "平均再生率 (%)"]
        )
        w.writerow(["合計", "9,999,999", "999,999", "999", "0:08:00", "20.0%"])
        samples = [
            ("1,234,567", "123,456", "111", "0:07:50", "21.9%"),
            ("987,654", "98,765", "77", "0:06:33", "19.4%"),
            ("555,000", "55,000", "33", "0:05:10", "15.0%"),
        ]
        for vid, row in zip(ids, samples):
            w.writerow([vid, *row])

    # 90日CSV（リピーター比率は最後の行だけ空 → repeat/unique で算出されることを確認）
    with OUT_90D.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["コンテンツ", "ユニーク視聴者数", "新しい視聴者数", "リピーター", "リピーター比率"])
        w.writerow(["合計", "999,999", "888,888", "111,111", "11.1%"])
        samples = [
            ("10,000", "7,000", "3,000", "30.0%"),
            ("8,000", "6,000", "2,000", "25.0%"),
            ("4,000", "3,000", "1,000", ""),  # 比率空 → 1000/4000=0.25 を算出
        ]
        for vid, row in zip(ids, samples):
            w.writerow([vid, *row])

    print(f"wrote: {OUT_ZENKIKAN.name} ({len(ids)} videos)")
    print(f"wrote: {OUT_90D.name} ({len(ids)} videos)")
    print("video ids used:", ids)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
