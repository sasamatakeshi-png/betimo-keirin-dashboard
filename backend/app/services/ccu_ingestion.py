"""同時接続数 xlsx（1ファイル=1レース1日）の取り込みオーケストレーション。

フロー:
  1. parse_ccu_xlsx で計測開始日時 + 時系列点を取得。
  2. チャンネル名キーワードで Betimo + 競合3社に分類（該当なしはスキップ）。
  3. URL の動画IDで videos を解決。無ければ competitor 動画を作成。
  4. published_at を解決（videos → xlsx計測開始 → YouTube API → ファイル内最小recorded_at）。
  5. metric_timeseries に concurrent_viewers を投入（elapsed_seconds, ON CONFLICT DO NOTHING）。
  6. 動画ごとの最大/平均同接を metric_values に保存（同 video×指標×source は置換）。
  7. ingestion_logs に記録（source_type は既存許容値 'csv' を流用＝CHECK違反回避）。

スキーマ変更なし。既存の metric_timeseries / metric_values / videos / channels のみ使用。
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import Channel, IngestionLog, MetricTimeseries, MetricValue, Video
from app.services.parsers.ccu_timeseries import parse_ccu_xlsx
from app.services.youtube_video import fetch_video_published_at

TS_METRIC_KEY = "concurrent_viewers"
MAX_KEY = "max_concurrent_viewers"
AVG_KEY = "avg_concurrent_viewers"
SOURCE = "manual"  # metric_*_source_check の許容値（手動取込）
LOG_SOURCE_TYPE = "csv"  # ingestion_logs.source_type の既存許容値を流用

# チャンネル分類バケット: (キー, マッチ用キーワード[小文字])。
# xlsx の「チャンネル名」と、登録済 channels.name の双方に同じ判定を当て、
# バケット経由で DB チャンネルへ解決する。該当なしは取り込み対象外。
_CHANNEL_BUCKETS: list[tuple[str, list[str]]] = [
    ("betimo", ["betimo"]),
    ("peachannel", ["ぺーちゃんねる", "加藤慎平", "チャリロト"]),
    ("oddspark", ["オッズパーク"]),
    ("rakuten", ["kドリームス", "kdreams", "rakutenkdreams", "楽天", "本気の競輪"]),
]


def _bucket_of(name: str | None) -> str | None:
    """チャンネル名をバケットキーに分類。該当なしは None。大小無視・部分一致。"""
    if not name:
        return None
    low = name.lower()
    for key, keywords in _CHANNEL_BUCKETS:
        if any(kw.lower() in low for kw in keywords):
            return key
    return None


def _thumbnail_url(video_id: str) -> str:
    """動画IDから YouTube サムネURLを組み立てる（画像は取得せずURLのみ保存）。"""
    return f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg"


def _build_bucket_channel_map(db: Session) -> dict[str, Channel]:
    """登録済 channels をバケットキー → Channel に対応付ける。

    Betimo（is_own）も name から 'betimo' バケットに入る。同バケットに複数あれば
    is_own を優先（自社を確実に拾う）。
    """
    channels = db.scalars(select(Channel)).all()
    out: dict[str, Channel] = {}
    for ch in channels:
        bucket = _bucket_of(ch.name)
        if bucket is None:
            continue
        if bucket not in out or (ch.is_own and not out[bucket].is_own):
            out[bucket] = ch
    return out


def _resolve_or_create_video(
    db: Session, *, video_id: str, channel: Channel, title: str
) -> tuple[Video, bool]:
    """youtube_video_id で videos を解決。無ければ作成。(video, created) を返す。"""
    video = db.scalar(select(Video).where(Video.youtube_video_id == video_id))
    created = False
    if video is None:
        video = Video(
            youtube_video_id=video_id,
            channel_id=channel.id,
            title=(title or video_id),
            is_competitor=(not channel.is_own),
            content_type="regular",
            cast_members=[],
            thumbnail_url=_thumbnail_url(video_id),
        )
        db.add(video)
        db.flush()  # video.id を確定
        created = True
    elif not video.thumbnail_url:
        # 既存動画でもサムネ未設定なら補完（画像はDLせずURLのみ）
        video.thumbnail_url = _thumbnail_url(video_id)
    return video, created


def _resolve_published_at(
    db: Session,
    video: Video,
    *,
    xlsx_start: datetime | None,
    recorded_min: datetime,
    allow_api: bool,
) -> tuple[datetime, bool]:
    """published_at を解決。(起点時刻, APIを使ったか) を返す。

    優先順:
      1) videos.published_at（既存。API不要）
      2) xlsx の計測開始日時（videos.published_at に保存）
      3) YouTube API actualStartTime（videos.published_at に保存）
      4) ファイル内最小 recorded_at（近似。保存はしない）
    """
    if video.published_at is not None:
        return video.published_at, False
    if xlsx_start is not None:
        video.published_at = xlsx_start
        return xlsx_start, False
    if allow_api:
        fetched = fetch_video_published_at(video.youtube_video_id or "")
        if fetched is not None:
            video.published_at = fetched
            return fetched, True
    # 最終フォールバック: ファイル内最小recorded_at（保存せず elapsed 算出のみに使用）
    return recorded_min, False


def _insert_timeseries(
    db: Session, *, video: Video, points: list[dict], origin: datetime
) -> tuple[int, int]:
    """concurrent_viewers を metric_timeseries に投入。(inserted, duplicates)。"""
    rows = []
    for p in points:
        elapsed = int((p["recorded_at"] - origin).total_seconds())
        if elapsed < 0:
            continue  # 起点より前の点は除外
        rows.append(
            {
                "entity_type": "videos",
                "entity_id": video.id,
                "metric_key": TS_METRIC_KEY,
                "elapsed_seconds": elapsed,
                "value": p["value"],
                "recorded_at": p["recorded_at"],
                "source": SOURCE,
            }
        )
    if not rows:
        return 0, 0
    stmt = (
        pg_insert(MetricTimeseries)
        .values(rows)
        .on_conflict_do_nothing(
            index_elements=["entity_type", "entity_id", "metric_key", "elapsed_seconds"]
        )
        .returning(MetricTimeseries.id)
    )
    inserted = len(db.execute(stmt).fetchall())
    return inserted, len(rows) - inserted


def _upsert_scalar(
    db: Session,
    *,
    video: Video,
    metric_key: str,
    new_value: float,
    recorded_at: datetime,
    source_file: str | None,
    keep_larger: bool,
) -> int:
    """1指標（max or avg）のスカラーを保存。書き込んだら1、温存したら0を返す。

    keep_larger=True（自社）: 既存（source='manual'）の最大値より新値が大きいときだけ
        置換し、新値が既存以下なら何もしない（既存を温存）。既存が無ければ挿入。
    keep_larger=False（競合）: 常に削除→再挿入（最新で上書き）。

    どちらも source='manual' の該当 video×指標のみを対象にし、他には触れない。冪等。
    """
    existing = db.scalars(
        select(MetricValue.value).where(
            MetricValue.entity_type == "videos",
            MetricValue.entity_id == video.id,
            MetricValue.metric_key == metric_key,
            MetricValue.source == SOURCE,
        )
    ).all()

    # 自社で既存値があり、新値がその最大値以下なら温存（ピークを下げない）。
    if keep_larger and existing and new_value <= max(existing):
        return 0

    # 置換パス: 既存（manual）を消してから新値を入れる（重複防止・冪等）。
    db.execute(
        delete(MetricValue).where(
            MetricValue.entity_type == "videos",
            MetricValue.entity_id == video.id,
            MetricValue.metric_key == metric_key,
            MetricValue.source == SOURCE,
        )
    )
    # Core insert で投入（既存 ingest_csv と同様）。id / created_at は DB 既定値
    # (gen_random_uuid() / now()) に任せる。ORM モデルに server_default 未宣言のため
    # ORM オブジェクト add だと PK/created_at が NULL になる点を回避する。
    db.execute(
        pg_insert(MetricValue).values(
            entity_type="videos",
            entity_id=video.id,
            metric_key=metric_key,
            value=new_value,
            recorded_at=recorded_at,
            source=SOURCE,
            source_file=source_file,
        )
    )
    return 1


def _write_scalars(
    db: Session,
    *,
    video: Video,
    points: list[dict],
    recorded_at: datetime,
    source_file: str | None,
) -> int:
    """動画の最大/平均同接を metric_values に保存。書き込んだ行数を返す。

    自社（is_competitor=false）は「大きい方を残す」（既存のExcelサマリ由来の正確な
    ピークを、サンプリングの粗い値で下げない）。競合は従来どおり最新で上書き。
    max / avg をそれぞれ独立に判定する。
    """
    values = [p["value"] for p in points]
    if not values:
        return 0
    max_v = max(values)
    avg_v = round(sum(values) / len(values), 2)
    keep_larger = not video.is_competitor  # 自社のみピーク温存

    written = 0
    written += _upsert_scalar(
        db,
        video=video,
        metric_key=MAX_KEY,
        new_value=max_v,
        recorded_at=recorded_at,
        source_file=source_file,
        keep_larger=keep_larger,
    )
    written += _upsert_scalar(
        db,
        video=video,
        metric_key=AVG_KEY,
        new_value=avg_v,
        recorded_at=recorded_at,
        source_file=source_file,
        keep_larger=keep_larger,
    )
    return written


def ingest_ccu_xlsx(
    db: Session,
    content: bytes,
    filename: str | None,
    *,
    allow_api: bool = True,
) -> dict:
    """同接xlsx 1ファイルを取り込む。

    allow_api=False のときは YouTube API を一切呼ばない（テスト用）。
    返り値は ConcurrentUploadResult に対応する dict。
    """
    started_at = datetime.now(timezone.utc)
    parsed = parse_ccu_xlsx(content)
    start_time: datetime | None = parsed["start_time"]
    points: list[dict] = parsed["points"]

    # 動画IDごとにグループ化（channel_name / title は先頭点を代表に使う）
    by_video: dict[str, list[dict]] = {}
    for p in points:
        by_video.setdefault(p["youtube_video_id"], []).append(p)

    bucket_channel = _build_bucket_channel_map(db)

    inserted_points = 0
    duplicate_points = 0
    videos_total = 0
    videos_created = 0
    scalars_written = 0
    skipped_rows = 0
    used_api = False
    skipped_channels: dict[str, int] = {}

    for video_id, pts in by_video.items():
        channel_name = pts[0]["channel_name"]
        bucket = _bucket_of(channel_name)
        channel = bucket_channel.get(bucket) if bucket else None
        if channel is None:
            # 対象3社+Betimo 以外、または未登録バケット → 取り込まない
            skipped_rows += len(pts)
            skipped_channels[channel_name] = skipped_channels.get(channel_name, 0) + len(pts)
            continue

        video, created = _resolve_or_create_video(
            db, video_id=video_id, channel=channel, title=pts[0]["title"]
        )
        videos_total += 1
        if created:
            videos_created += 1

        recorded_min = min(p["recorded_at"] for p in pts)
        recorded_max = max(p["recorded_at"] for p in pts)
        origin, api_used = _resolve_published_at(
            db,
            video,
            xlsx_start=start_time,
            recorded_min=recorded_min,
            allow_api=allow_api,
        )
        used_api = used_api or api_used

        ins, dup = _insert_timeseries(db, video=video, points=pts, origin=origin)
        inserted_points += ins
        duplicate_points += dup
        scalars_written += _write_scalars(
            db,
            video=video,
            points=pts,
            recorded_at=recorded_max,
            source_file=filename,
        )

    status = "success" if videos_total > 0 else ("partial" if skipped_rows else "failed")
    log = IngestionLog(
        source_type=LOG_SOURCE_TYPE,
        file_name=filename,
        records_processed=inserted_points,
        records_failed=0,
        status=status,
        started_at=started_at,
        completed_at=datetime.now(timezone.utc),
        error_log={
            "kind": "concurrent_xlsx",
            "videos_total": videos_total,
            "videos_created": videos_created,
            "skipped_channels": skipped_channels or None,
            "used_youtube_api": used_api,
        },
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    return {
        "inserted_points": inserted_points,
        "duplicate_points": duplicate_points,
        "videos_total": videos_total,
        "videos_created": videos_created,
        "scalars_written": scalars_written,
        "skipped_rows": skipped_rows,
        "start_time": start_time,
        "used_youtube_api": used_api,
        "log_id": log.id,
    }
