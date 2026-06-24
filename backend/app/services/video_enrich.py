"""番組情報エンリッチサービス。

cast_members が空/NULL の自社動画について、YouTube Data API で概要欄を取得し、
- 出演者(cast_members) を概要欄から抽出
- program_type を実タイトルから判定(NULLのみ)
- grade を実タイトルの #タグから判定(NULLのみ)
して補完する。既存値があるフィールドは上書きしない。
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

import requests
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import IngestionLog, Video
from app.services.parsers import parse_performers
from app.services.program_type import detect_program_type

_API_URL = "https://www.googleapis.com/youtube/v3/videos"
_BATCH = 50
_TIMEOUT = 20

# grade: ハッシュタグ形のみ(対談等の誤爆防止)。GP/KEIRINグランプリ→G1。
_NORM = {"Ｇ": "G", "Ｐ": "P", "Ｆ": "F", "１": "1", "２": "2", "３": "3", "Ⅰ": "1", "Ⅱ": "2", "Ⅲ": "3"}


def _grade_from_title(title: str | None) -> str | None:
    if not title:
        return None
    t = title
    for a, b in _NORM.items():
        t = t.replace(a, b)
    if re.search(r"[#＃]\s*GP", t, re.I) or re.search(r"[#＃]\s*KEIRINグランプリ", t, re.I):
        return "G1"
    for tag in ("G1", "G2", "G3", "F1", "F2"):
        if re.search(r"[#＃]\s*" + tag, t, re.I):
            return tag
    return None


def _chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def enrich_videos(db: Session) -> dict:
    """cast空の自社動画を概要欄APIで補完する。

    YOUTUBE_API_KEY 未設定で対象がある場合は ValueError(呼び出し側で400)。
    """
    started_at = datetime.now(timezone.utc)

    targets = db.execute(
        select(Video).where(
            Video.is_competitor == False,  # noqa: E712
            Video.youtube_video_id.is_not(None),
            or_(Video.cast_members == None, func.cardinality(Video.cast_members) == 0),  # noqa: E711
        )
    ).scalars().all()

    if not targets:
        return _result(0, 0, 0, 0, 0, 0, 0, 0, db, started_at)

    api_key = settings.YOUTUBE_API_KEY
    if not api_key:
        raise ValueError("YOUTUBE_API_KEY が未設定です（サーバ環境変数を確認してください）")

    ids = [v.youtube_video_id for v in targets]
    desc_map: dict[str, str] = {}
    api_calls = 0
    for batch in _chunks(ids, _BATCH):
        resp = requests.get(
            _API_URL,
            params={"part": "snippet", "id": ",".join(batch), "key": api_key},
            timeout=_TIMEOUT,
        )
        api_calls += 1
        if resp.status_code != 200:
            raise ValueError(f"YouTube API エラー: {resp.status_code} {resp.text[:200]}")
        for it in resp.json().get("items", []):
            sn = it.get("snippet", {}) or {}
            desc_map[it["id"]] = sn.get("description", "") or ""

    cast_updated = pt_updated = grade_updated = 0
    cast_skipped = 0  # 概要欄はあるが出演者抽出不可
    unmatched = 0  # API応答に動画が無い(削除/非公開)
    now = datetime.now(timezone.utc)
    for v in targets:
        desc = desc_map.get(v.youtube_video_id)
        if desc is None:
            unmatched += 1
            continue
        touched = False
        # a) 出演者(空のときのみ)
        if not v.cast_members:
            names = parse_performers(desc)
            if names:
                v.cast_members = names
                cast_updated += 1
                touched = True
            else:
                cast_skipped += 1
        # b) program_type(NULLのときのみ)
        if v.program_type is None:
            pt = detect_program_type(
                v.title,
                is_competitor=False,
                content_type=v.content_type,
            )
            if pt:
                v.program_type = pt
                pt_updated += 1
                touched = True
        # c) grade(NULLのときのみ)
        if v.grade is None:
            g = _grade_from_title(v.title)
            if g:
                v.grade = g
                grade_updated += 1
                touched = True
        if touched:
            v.updated_at = now

    return _result(
        len(targets), api_calls, len(desc_map), cast_updated, pt_updated,
        grade_updated, cast_skipped, unmatched, db, started_at,
    )


def _result(targets, api_calls, fetched, cast_updated, pt_updated, grade_updated,
            cast_skipped, unmatched, db: Session, started_at) -> dict:
    log = IngestionLog(
        source_type="youtube_api",
        file_name=None,
        records_processed=targets,
        records_failed=unmatched,
        status="success",
        started_at=started_at,
        completed_at=datetime.now(timezone.utc),
        error_log={
            "kind": "video_enrich",
            "cast_updated": cast_updated,
            "program_type_updated": pt_updated,
            "grade_updated": grade_updated,
        },
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return {
        "targets": targets,
        "api_calls": api_calls,
        "fetched": fetched,
        "cast_updated": cast_updated,
        "program_type_updated": pt_updated,
        "grade_updated": grade_updated,
        "cast_skipped": cast_skipped,
        "unmatched": unmatched,
        "log_id": log.id,
    }
