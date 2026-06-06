"""Betimo KEIRIN Dashboard — FastAPI application entrypoint.

Phase 1 の最小構成。/health は step5 で DB 接続チェック込みに拡張する。
"""

from fastapi import FastAPI

from app.api.health import router as health_router

app = FastAPI(
    title="Betimo KEIRIN Dashboard API",
    version="0.1.0",
)

app.include_router(health_router)


@app.get("/")
def root() -> dict[str, str]:
    return {"app": "Betimo KEIRIN Dashboard API", "status": "ok"}
