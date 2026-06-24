"""取り込み REST エンドポイント。"""

from __future__ import annotations

import re
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import get_current_auth
from app.models import IngestionLog
from app.schemas.common import Page, Pagination, pagination
from app.schemas.ingestion import (
    ConcurrentUploadResult,
    DeletePreviewResult,
    DeleteResult,
    IngestionLogOut,
    MonthlyUploadResult,
    MonthlyVideoUploadResult,
    StudioCcuCommitResult,
    StudioCcuPreviewResult,
    TrafficSourceResult,
    UploadResult,
    XCsvResult,
)
from app.services.ccu_ingestion import ingest_ccu_xlsx
from app.services.studio_ccu_ingestion import commit_studio_ccu, preview_studio_ccu
from app.services.traffic_source_ingestion import ingest_traffic_source
from app.services.x_ingestion import ingest_x_csv
from app.services.ingestion import (
    INGEST_TYPES,
    SHORT_INGEST_TYPES,
    ingest_csv,
    ingest_short_csv,
)
from app.services.monthly_deletion import (
    DELETABLE_KINDS,
    MonthlyDeleteError,
    count_monthly_rows,
    delete_monthly_rows,
)
from app.services.monthly_ingestion import (
    MONTHLY_KINDS,
    SEGMENTS,
    MonthlyIngestError,
    ingest_monthly_demographics_csv,
    ingest_monthly_metrics_csv,
    ingest_monthly_video_csv,
)

router = APIRouter(prefix="/ingestion", tags=["ingestion"])

_ALL_INGEST_TYPES = INGEST_TYPES | SHORT_INGEST_TYPES

_YEAR_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


@router.post(
    "/upload",
    response_model=UploadResult,
    dependencies=[Depends(get_current_auth)],
)
async def upload_csv(
    file: UploadFile = File(...),
    type: str = Form(
        ...,
        description=(
            "zenkikan_csv | 90d_csv | live_views_csv | archive_views_csv "
            "| short_zenkikan_csv | short_90d_csv"
        ),
    ),
    db: Session = Depends(get_db),
) -> UploadResult:
    if type not in _ALL_INGEST_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"type must be one of {sorted(_ALL_INGEST_TYPES)}",
        )
    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="empty file"
        )
    if type in SHORT_INGEST_TYPES:
        result = ingest_short_csv(db, content, file.filename, type)
    else:
        result = ingest_csv(db, content, file.filename, type)
    return UploadResult(**result)


async def _upload_traffic(
    file: UploadFile, year_month: str, source_type: str, db: Session
) -> TrafficSourceResult:
    """流入経路系CSV 3種の共通処理（year_month 検証 → upsert）。"""
    if not _YEAR_MONTH_RE.match(year_month):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="year_month must be 'YYYY-MM'",
        )
    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="empty file")
    try:
        result = ingest_traffic_source(db, content, file.filename, year_month, source_type)
    except ValueError as exc:  # CSV内容・source_type の問題
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return TrafficSourceResult(**result)


@router.post(
    "/traffic-source",
    response_model=TrafficSourceResult,
    dependencies=[Depends(get_current_auth)],
)
async def upload_traffic_source(
    file: UploadFile = File(...),
    year_month: str = Form(..., description="対象月 'YYYY-MM'"),
    db: Session = Depends(get_db),
) -> TrafficSourceResult:
    """流入経路CSV（大カテゴリ）を channel_traffic_sources へ upsert する。"""
    return await _upload_traffic(file, year_month, "category", db)


@router.post(
    "/external-url",
    response_model=TrafficSourceResult,
    dependencies=[Depends(get_current_auth)],
)
async def upload_external_url(
    file: UploadFile = File(...),
    year_month: str = Form(..., description="対象月 'YYYY-MM'"),
    db: Session = Depends(get_db),
) -> TrafficSourceResult:
    """外部流入CSV（外部URL別）を channel_traffic_sources へ upsert する。"""
    return await _upload_traffic(file, year_month, "external_url", db)


@router.post(
    "/related-video",
    response_model=TrafficSourceResult,
    dependencies=[Depends(get_current_auth)],
)
async def upload_related_video(
    file: UploadFile = File(...),
    year_month: str = Form(..., description="対象月 'YYYY-MM'"),
    db: Session = Depends(get_db),
) -> TrafficSourceResult:
    """関連動画CSV（関連動画別）を channel_traffic_sources へ upsert する。"""
    return await _upload_traffic(file, year_month, "related_video", db)


@router.post(
    "/x-csv",
    response_model=XCsvResult,
    dependencies=[Depends(get_current_auth)],
)
async def upload_x_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> XCsvResult:
    """X(旧Twitter)日別CSVを x_daily_metrics へ upsert する（date 一意・置換）。"""
    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="empty file")
    result = ingest_x_csv(db, content, file.filename)
    return XCsvResult(**result)


@router.post(
    "/concurrent",
    response_model=ConcurrentUploadResult,
    dependencies=[Depends(get_current_auth)],
)
async def upload_concurrent_xlsx(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> ConcurrentUploadResult:
    """同時接続数xlsx（1ファイル=1レース1日）を取り込む。

    「設定」シートの計測開始日時と「データ」シートの時系列を読み、Betimo+競合3社の
    同接を metric_timeseries（時系列）と metric_values（最大/平均）へ投入する。
    対象外チャンネルの行はスキップ。複数ファイルはフロントから順次POSTする。
    """
    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="empty file"
        )
    try:
        result = ingest_ccu_xlsx(db, content, file.filename)
    except ValueError as exc:  # シート欠落・ヘッダ不正など（ファイル内容の問題）
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"ファイルの内容を解釈できません: {exc}",
        ) from exc
    except Exception as exc:  # noqa: BLE001 - 想定外でも素っ気ない500を避け原因を返す
        # 個々の動画の不備は service 内 SAVEPOINT でスキップ済み。ここに来るのは
        # commit 失敗など全体的な障害のみ。失敗トランザクションは明示的に巻き戻す。
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"同接取り込みに失敗しました: {type(exc).__name__}: {exc}",
        ) from exc
    return ConcurrentUploadResult(**result)


@router.post(
    "/studio-ccu/preview",
    response_model=StudioCcuPreviewResult,
    dependencies=[Depends(get_current_auth)],
)
async def studio_ccu_preview(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> StudioCcuPreviewResult:
    """Studio自社同接CSVを計算し、ファイル名から動画候補を推測して返す（保存しない）。

    最大=「ライブ同時視聴者数」列の最大、平均=「平均同時視聴者数」列の平均。
    ファイル名の日付・レース名で自社動画(is_competitor=false)の候補を提示する。
    実際の保存は確認後に /studio-ccu/commit で行う（人の確認を必ず挟む）。
    """
    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="empty file")
    try:
        result = preview_studio_ccu(db, content, file.filename)
    except ValueError as exc:  # CSV内容の問題（ヘッダ不正・有効行なし等）
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"CSVを解釈できません: {exc}",
        ) from exc
    return StudioCcuPreviewResult(**result)


@router.post(
    "/studio-ccu/commit",
    response_model=StudioCcuCommitResult,
    dependencies=[Depends(get_current_auth)],
)
async def studio_ccu_commit(
    file: UploadFile = File(...),
    video_id: UUID = Form(..., description="確定した自社動画のUUID"),
    db: Session = Depends(get_db),
) -> StudioCcuCommitResult:
    """確定した自社動画に Studio計算値（最大/平均同接）を常に上書き保存する（冪等）。

    サーバ側でCSVを再計算（クライアント値は信用しない）。該当 video の
    max/avg_concurrent_viewers（source='manual'）を削除→再挿入で置換する。
    時系列・競合データには触れない。
    """
    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="empty file")
    try:
        result = commit_studio_ccu(db, content, file.filename, video_id)
    except ValueError as exc:  # CSV内容 or 動画選択の問題
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    except Exception as exc:  # noqa: BLE001 - 素っ気ない500を避け原因を返す
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"保存に失敗しました: {type(exc).__name__}: {exc}",
        ) from exc
    return StudioCcuCommitResult(**result)


@router.post(
    "/monthly",
    response_model=MonthlyUploadResult,
    dependencies=[Depends(get_current_auth)],
)
async def upload_monthly_csv(
    file: UploadFile = File(...),
    year_month: str = Form(..., description="対象月 'YYYY-MM'（2025-11 以降）"),
    segment: str = Form(..., description="all | live | short"),
    kind: str = Form(..., description="metrics | demographics"),
    db: Session = Depends(get_db),
) -> MonthlyUploadResult:
    if not _YEAR_MONTH_RE.match(year_month):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="year_month must be 'YYYY-MM'",
        )
    if segment not in SEGMENTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"segment must be one of {sorted(SEGMENTS)}",
        )
    if kind not in MONTHLY_KINDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"kind must be one of {sorted(MONTHLY_KINDS)}",
        )
    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="empty file"
        )
    try:
        if kind == "metrics":
            result = ingest_monthly_metrics_csv(
                db, content, file.filename, year_month, segment
            )
        else:
            result = ingest_monthly_demographics_csv(
                db, content, file.filename, year_month, segment
            )
    except MonthlyIngestError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return MonthlyUploadResult(**result)


@router.post(
    "/monthly-video",
    response_model=MonthlyVideoUploadResult,
    dependencies=[Depends(get_current_auth)],
)
async def upload_monthly_video_csv(
    file: UploadFile = File(...),
    year_month: str = Form(..., description="対象月 'YYYY-MM'"),
    db: Session = Depends(get_db),
) -> MonthlyVideoUploadResult:
    """動画別CSV（コンテンツ別エクスポート）を「月 × 動画」で取り込む。

    is_ad は title に "WebCM" を含むかで判定。合計行・ID空行はスキップ。
    """
    if not _YEAR_MONTH_RE.match(year_month):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="year_month must be 'YYYY-MM'",
        )
    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="empty file"
        )
    try:
        result = ingest_monthly_video_csv(db, content, file.filename, year_month)
    except MonthlyIngestError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return MonthlyVideoUploadResult(**result)


# ---------------------------------------------------------------------------
# 削除（取り込みミスの修正）。月次系3テーブルのみ。範囲を厳密に限定する。
#   - プレビュー(GET): 件数のみ返す（実際には削除しない）
#   - 削除(DELETE): 認証必須。指定した月[+segment]のみを削除し監査ログを残す
# ---------------------------------------------------------------------------


@router.get(
    "/delete-preview",
    response_model=DeletePreviewResult,
    dependencies=[Depends(get_current_auth)],
)
def delete_preview(
    kind: str = Query(..., description=f"削除種別 {sorted(DELETABLE_KINDS)}"),
    year_month: str = Query(..., description="対象月 'YYYY-MM'"),
    segment: str | None = Query(
        None, description="all|live|short（monthly_video では不要）"
    ),
    db: Session = Depends(get_db),
) -> DeletePreviewResult:
    """削除対象の件数を返す（読み取り専用。実際には消さない）。"""
    try:
        result = count_monthly_rows(db, kind, year_month, segment)
    except MonthlyDeleteError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return DeletePreviewResult(**result)


@router.delete(
    "/monthly",
    response_model=DeleteResult,
    dependencies=[Depends(get_current_auth)],
)
def delete_monthly(
    kind: str = Query(..., description=f"削除種別 {sorted(DELETABLE_KINDS)}"),
    year_month: str = Query(..., description="対象月 'YYYY-MM'"),
    segment: str | None = Query(
        None, description="all|live|short（monthly_video では不要）"
    ),
    db: Session = Depends(get_db),
) -> DeleteResult:
    """指定した月[+segment]のデータのみを削除する（認証必須・監査ログ記録）。"""
    try:
        result = delete_monthly_rows(db, kind, year_month, segment)
    except MonthlyDeleteError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return DeleteResult(**result)


@router.get(
    "/logs",
    response_model=Page[IngestionLogOut],
    dependencies=[Depends(get_current_auth)],
)
def list_logs(
    page: Pagination = Depends(pagination),
    db: Session = Depends(get_db),
) -> Page[IngestionLogOut]:
    base = select(IngestionLog)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(
        base.order_by(
            func.coalesce(IngestionLog.completed_at, IngestionLog.started_at)
            .desc()
            .nullslast()
        )
        .limit(page.limit)
        .offset(page.offset)
    ).all()
    return Page[IngestionLogOut](
        items=rows, total=total, limit=page.limit, offset=page.offset
    )
