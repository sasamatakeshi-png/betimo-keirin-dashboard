"""B-3 検証で記録されたテスト用CSVの ingestion_logs のみを削除する（保守用・再現/冪等）。

安全策:
  - 削除対象は file_name がテストサンプル名 かつ source_type='csv' の行に限定。
  - 他の取り込みログには一切触れない。
  - 他テーブルには触れない。

使い方（backend/ ディレクトリで）:
    python scripts/cleanup_csv_test_logs.py
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import psycopg  # noqa: E402

from app.core.config import settings  # noqa: E402
from scripts.apply_migrations import to_psycopg_dsn  # noqa: E402

TEST_LOG_FILES = ("sample_zenkikan.csv", "sample_90d.csv")


def main() -> int:
    dsn = to_psycopg_dsn(settings.DATABASE_URL)
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM ingestion_logs "
            "WHERE file_name = ANY(%s) AND source_type='csv'",
            (list(TEST_LOG_FILES),),
        )
        target = cur.fetchone()[0]
        print(f"削除対象（テストログ）: {target} 件")

        if target == 0:
            print("削除対象はありません（既にクリーン）。")
            return 0

        cur.execute(
            "DELETE FROM ingestion_logs "
            "WHERE file_name = ANY(%s) AND source_type='csv'",
            (list(TEST_LOG_FILES),),
        )
        deleted = cur.rowcount
        conn.commit()
        print(f"削除しました: {deleted} 件")

        cur.execute("SELECT count(*) FROM ingestion_logs")
        print(f"削除後 ingestion_logs 総数: {cur.fetchone()[0]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
