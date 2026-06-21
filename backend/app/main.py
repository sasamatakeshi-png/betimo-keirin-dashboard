"""Betimo KEIRIN Dashboard — FastAPI application entrypoint.

Phase 1 の最小構成。/health は step5 で DB 接続チェック込みに拡張する。
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.analysis import router as analysis_router
from app.api.auth import router as auth_router
from app.core.config import settings
from app.api.channels import router as channels_router
from app.api.concurrent import router as concurrent_router
from app.api.dashboard import router as dashboard_router
from app.api.events import router as events_router
from app.api.health import router as health_router
from app.api.ingestion import router as ingestion_router
from app.api.metrics import router as metrics_router
from app.api.program_comparison import router as program_comparison_router
from app.api.timeseries import router as timeseries_router
from app.api.videos import router as videos_router

app = FastAPI(
    title="Betimo KEIRIN Dashboard API",
    version="0.1.0",
)

# CORS: フロント(既定 http://localhost:3000)からのアクセスを許可
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# /health はルート直下のまま
app.include_router(health_router)

# 業務 API は /api 配下
app.include_router(auth_router, prefix="/api")
app.include_router(channels_router, prefix="/api")
app.include_router(concurrent_router, prefix="/api")
app.include_router(dashboard_router, prefix="/api")
app.include_router(events_router, prefix="/api")
app.include_router(videos_router, prefix="/api")
app.include_router(metrics_router, prefix="/api")
app.include_router(program_comparison_router, prefix="/api")
app.include_router(timeseries_router, prefix="/api")
app.include_router(ingestion_router, prefix="/api")
app.include_router(analysis_router, prefix="/api")


@app.get("/")
def root() -> dict[str, str]:
    return {"app": "Betimo KEIRIN Dashboard API", "status": "ok"}
