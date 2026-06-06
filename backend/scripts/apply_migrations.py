"""簡易マイグレーションランナー。

db/migrations 配下の *.sql を、ファイル名先頭の番号順に PostgreSQL へ適用する。
適用済みファイルは schema_migrations テーブルで管理し、再実行時はスキップする。

使い方（backend/ ディレクトリで実行）:
    python scripts/apply_migrations.py          # 未適用のみ適用
    python scripts/apply_migrations.py --dry-run # 適用順の確認のみ

DATABASE_URL は .env（app.core.config 経由）または環境変数から読み込む。
形式: postgresql+psycopg://<user>:<password>@<host>:<port>/<dbname>
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import psycopg

# backend/ をパスに追加して app.core.config を import 可能にする
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import settings  # noqa: E402

MIGRATIONS_DIR = BACKEND_DIR / "db" / "migrations"

# ファイル名先頭の数値（例: 001_init.sql -> 1）でソートするための正規表現
_NUM_RE = re.compile(r"^(\d+)")


def _sort_key(path: Path) -> tuple[int, str]:
    m = _NUM_RE.match(path.name)
    num = int(m.group(1)) if m else 1_000_000  # 番号無しは末尾へ
    return (num, path.name)


def discover_migrations() -> list[Path]:
    if not MIGRATIONS_DIR.is_dir():
        return []
    files = [p for p in MIGRATIONS_DIR.iterdir() if p.suffix == ".sql"]
    return sorted(files, key=_sort_key)


def to_psycopg_dsn(database_url: str) -> str:
    """SQLAlchemy 形式の URL を psycopg 用 DSN に正規化する。"""
    return database_url.replace("postgresql+psycopg://", "postgresql://").replace(
        "postgres+psycopg://", "postgresql://"
    )


def ensure_tracking_table(conn: psycopg.Connection) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
              filename   TEXT PRIMARY KEY,
              applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        cur.execute("SELECT filename FROM schema_migrations")
        applied = {row[0] for row in cur.fetchall()}
    conn.commit()
    return applied


def apply_migration(conn: psycopg.Connection, path: Path) -> None:
    sql = path.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)  # 複数ステートメント（関数定義の $$ 含む）を一括実行
        cur.execute(
            "INSERT INTO schema_migrations (filename) VALUES (%s)",
            (path.name,),
        )
    conn.commit()


def main() -> int:
    dry_run = "--dry-run" in sys.argv

    migrations = discover_migrations()
    if not migrations:
        print(f"マイグレーションが見つかりません: {MIGRATIONS_DIR}")
        return 0

    print("適用順:")
    for p in migrations:
        print(f"  - {p.name}")

    if dry_run:
        print("\n--dry-run のため適用しません。")
        return 0

    if not settings.DATABASE_URL:
        print(
            "\nERROR: DATABASE_URL が未設定です。"
            "\nbackend/.env に DATABASE_URL を設定してから再実行してください。"
            "\n  例: DATABASE_URL=postgresql+psycopg://user:pass@host:5432/dbname"
        )
        return 1

    dsn = to_psycopg_dsn(settings.DATABASE_URL)

    try:
        with psycopg.connect(dsn) as conn:
            applied = ensure_tracking_table(conn)
            pending = [p for p in migrations if p.name not in applied]

            if not pending:
                print("\nすべて適用済みです。新規はありません。")
                return 0

            for path in pending:
                print(f"\n適用中: {path.name} ...")
                apply_migration(conn, path)
                print(f"  OK: {path.name}")

        print("\n完了: マイグレーションを適用しました。")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"\nERROR: マイグレーション適用に失敗しました: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
