"""ヘルスチェックエンドポイント（DB 接続チェック込み）。"""

from fastapi import APIRouter
from sqlalchemy import text

from app.core.db import engine

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, object]:
    """アプリと DB の稼働状態を返す。

    DB に SELECT 1 を投げ、接続可否を確認する。
    DB がダウンしていても 200 を返し、db フィールドで状態を示す。
    """
    db_ok = False
    db_error: str | None = None
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception as exc:  # noqa: BLE001
        db_error = str(exc)

    return {
        "status": "ok" if db_ok else "degraded",
        "app": "Betimo KEIRIN Dashboard API",
        "db": {"connected": db_ok, "error": db_error},
    }
