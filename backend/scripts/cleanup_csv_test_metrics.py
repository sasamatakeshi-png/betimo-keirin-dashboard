"""B-3 パーサ検証で投入したテスト用サンプルCSV由来データのみを削除する（保守用・再現可能）。

安全策:
  - 削除対象は metric_values の source='csv' かつ source_file がテストサンプル名のものに限定。
  - source='manual'（移行142件・1,551行）には一切触れない。
  - 他テーブルには触れない。
  - 冪等（再実行で 0 件削除）。

使い方（backend/ ディレクトリで）:
    python scripts/cleanup_csv_test_metrics.py
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import psycopg  # noqa: E402

from app.core.config import settings  # noqa: E402
from scripts.apply_migrations import to_psycopg_dsn  # noqa: E402

# B-3 検証で生成・取り込んだテスト用サンプルファイル
TEST_SOURCE_FILES = ("sample_zenkikan.csv", "sample_90d.csv")


def main() -> int:
    dsn = to_psycopg_dsn(settings.DATABASE_URL)
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT source_file, count(*) FROM metric_values "
            "WHERE source='csv' AND source_file = ANY(%s) "
            "GROUP BY source_file ORDER BY source_file",
            (list(TEST_SOURCE_FILES),),
        )
        breakdown = cur.fetchall()
        total = sum(c for _, c in breakdown)
        print("削除対象（source='csv' かつ テストサンプル）:")
        for fn, cnt in breakdown:
            print(f"  {fn}: {cnt}")
        print(f"  合計: {total}")

        if total == 0:
            print("削除対象はありません（既にクリーン）。")
            return 0

        cur.execute(
            "DELETE FROM metric_values "
            "WHERE source='csv' AND source_file = ANY(%s)",
            (list(TEST_SOURCE_FILES),),
        )
        deleted = cur.rowcount
        conn.commit()
        print(f"削除しました: {deleted} 行")

        cur.execute("SELECT source, count(*) FROM metric_values GROUP BY source ORDER BY source")
        print("削除後 source別:", cur.fetchall())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
