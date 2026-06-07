"""同接時系列の metric_timeseries への投入。

冪等性は DB の UNIQUE (entity_type, entity_id, metric_key, elapsed_seconds)
に対する ON CONFLICT DO NOTHING で担保する。
source は CHECK 制約（api/csv/pdf/manual）の範囲内で 'manual'（手動取込）を使う。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import MetricTimeseries, Video

METRIC_KEY = "concurrent_viewers"
SOURCE = "manual"  # metric_timeseries_source_check の許容値のうち手動取込を表すもの


def ingest_ccu_points(
    db: Session,
    points: list[dict],
    *,
    only_youtube_ids: set[str] | None = None,
) -> dict:
    """パーサ出力（parse_ccu_timeseries_xlsx の返り値）を投入する。

    - 起点時刻はその動画の published_at。videos に無い動画はスキップ。
    - elapsed_seconds が負になる点（published_at より前）は除外。
    - 返り値: 件数サマリ（inserted / duplicates / negative_elapsed / skipped_videos）。
    """
    # 動画IDごとにグループ化
    by_video: dict[str, list[dict]] = {}
    for p in points:
        vid = p["youtube_video_id"]
        if only_youtube_ids is not None and vid not in only_youtube_ids:
            continue
        by_video.setdefault(vid, []).append(p)

    # videos テーブルから published_at を引く
    videos = db.execute(
        select(Video.id, Video.youtube_video_id, Video.published_at).where(
            Video.youtube_video_id.in_(by_video.keys())
        )
    ).all()
    known = {v.youtube_video_id: v for v in videos}

    summary: dict = {
        "inserted": 0,
        "duplicates": 0,
        "negative_elapsed": 0,
        "skipped_videos": [],  # [{youtube_video_id, channel_name, points}]
        "per_video": {},
    }

    for vid, pts in by_video.items():
        video = known.get(vid)
        if video is None or video.published_at is None:
            summary["skipped_videos"].append(
                {
                    "youtube_video_id": vid,
                    "channel_name": pts[0]["channel_name"],
                    "points": len(pts),
                    "reason": "videos に未登録" if video is None else "published_at なし",
                }
            )
            continue

        rows = []
        negative = 0
        for p in pts:
            # 双方 aware（JST / UTC）なので差分は TZ ずれなく秒で出る
            elapsed = int((p["recorded_at"] - video.published_at).total_seconds())
            if elapsed < 0:
                negative += 1
                continue
            rows.append(
                {
                    "entity_type": "videos",
                    "entity_id": video.id,
                    "metric_key": METRIC_KEY,
                    "elapsed_seconds": elapsed,
                    "value": p["value"],
                    "recorded_at": p["recorded_at"],
                    "source": SOURCE,
                }
            )
        summary["negative_elapsed"] += negative

        inserted = 0
        if rows:
            # ON CONFLICT DO NOTHING + RETURNING: 実際に挿入された行だけ返る
            # （psycopg3 では rowcount が当てにならないため件数は RETURNING で数える）
            stmt = (
                pg_insert(MetricTimeseries)
                .values(rows)
                .on_conflict_do_nothing(
                    index_elements=["entity_type", "entity_id", "metric_key", "elapsed_seconds"]
                )
                .returning(MetricTimeseries.id)
            )
            inserted = len(db.execute(stmt).fetchall())
        summary["inserted"] += inserted
        summary["duplicates"] += len(rows) - inserted
        summary["per_video"][vid] = {
            "attempted": len(rows),
            "inserted": inserted,
            "negative_elapsed": negative,
        }

    db.commit()
    return summary
