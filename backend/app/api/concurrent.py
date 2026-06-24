"""同接（concurrent_viewers）レース一覧 REST エンドポイント。

metric_timeseries の concurrent_viewers(source=manual) を持つ動画を、計測日(JST)で
グループ化して「レース」として返す。/concurrent-analysis のレース一括選択に使う。

グループ化キーは JST 日付（調査で event_id は競合に皆無、published_at の日付＝計測日が
全件一致と確認済み）。レース名は自社(Betimo)動画の event 名 or タイトルから抽出する。
スキーマ変更なし（既存テーブルのみ参照）。
"""

from __future__ import annotations

import re
from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy import Date, cast, func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import Channel, Event, MetricTimeseries, Video
from app.schemas.concurrent import RaceGroup, RaceVideo

router = APIRouter(prefix="/concurrent", tags=["concurrent"])

# 計測日(JST) = min(recorded_at) を Asia/Tokyo に変換した日付
_JST_DATE = cast(
    func.timezone("Asia/Tokyo", func.min(MetricTimeseries.recorded_at)), Date
)

# レース名抽出: 先頭の【…】(例「【競輪ライブ6/21】」)を除去し、最初のハッシュタグ語を採用
_BRACKET_RE = re.compile(r"^【[^】]*】")
_HASHTAG_RE = re.compile(r"[#＃]\s*([^\s#＃【】]+)")


def _race_name_from_title(title: str | None) -> str | None:
    """自社タイトルからレース名を抽出（例「#高松宮記念杯競輪」→「高松宮記念杯競輪」）。"""
    if not title:
        return None
    body = _BRACKET_RE.sub("", title).strip()
    m = _HASHTAG_RE.search(body)
    if m:
        return m.group(1).strip() or None
    # ハッシュタグが無い自社タイトルは先頭を流用（event 名がある場合はそちらを優先するため稀）
    return body[:24] or None


@router.get("/races", response_model=list[RaceGroup])
def list_races(db: Session = Depends(get_db)) -> list[RaceGroup]:
    """同接データを持つレース一覧（競合が1社以上いる日のみ）を日付の新しい順で返す。

    各レース = 計測日(JST)でまとめた自社+競合の動画群。Betimo 単独（競合0）の日は除外。
    """
    rows = db.execute(
        select(
            Video.id.label("video_id"),
            Video.youtube_video_id.label("youtube_video_id"),
            Video.title.label("title"),
            Video.grade.label("grade"),
            Video.is_competitor.label("is_competitor"),
            Channel.is_own.label("is_own"),
            Channel.name.label("channel_name"),
            Event.name.label("event_name"),
            _JST_DATE.label("jst_date"),
        )
        .select_from(MetricTimeseries)
        .join(Video, Video.id == MetricTimeseries.entity_id)
        .join(Channel, Channel.id == Video.channel_id)
        .join(Event, Event.id == Video.event_id, isouter=True)
        .where(
            MetricTimeseries.entity_type == "videos",
            MetricTimeseries.metric_key == "concurrent_viewers",
            MetricTimeseries.source == "manual",
        )
        .group_by(
            Video.id,
            Video.youtube_video_id,
            Video.title,
            Video.grade,
            Video.is_competitor,
            Channel.is_own,
            Channel.name,
            Event.name,
        )
    ).all()

    # 日付(JST)でグループ化
    by_date: dict[str, list] = defaultdict(list)
    for r in rows:
        if r.jst_date is None:
            continue
        by_date[r.jst_date.isoformat()].append(r)

    groups: list[RaceGroup] = []
    for date_str, members in by_date.items():
        competitor_count = sum(1 for m in members if m.is_competitor)
        if competitor_count == 0:
            continue  # 競合0（Betimo単独）の日は一覧に含めない

        # レース名: 自社動画を代表に、event名→タイトル抽出の順。無ければ日付のみ。
        own = next((m for m in members if m.is_own), None)
        rep = own or members[0]
        race_name = rep.event_name or _race_name_from_title(rep.title)
        # グレードは自社(Betimo)動画の videos.grade を使用（NULL なら付けない）。
        grade = own.grade if own else None
        label_parts = [date_str]
        if race_name:
            label_parts.append(race_name)
        if grade:
            label_parts.append(grade)
        label = " ".join(label_parts)

        # 表示順: 自社を先頭、その後 競合をチャンネル名順
        members_sorted = sorted(members, key=lambda m: (m.is_competitor, m.channel_name))
        videos = [
            RaceVideo(
                video_id=m.video_id,
                youtube_video_id=m.youtube_video_id,
                channel_name=m.channel_name,
                is_competitor=m.is_competitor,
            )
            for m in members_sorted
        ]
        groups.append(
            RaceGroup(
                race_key=date_str,
                date=date_str,
                label=label,
                betimo_present=any(m.is_own for m in members),
                competitor_count=competitor_count,
                videos=videos,
            )
        )

    groups.sort(key=lambda g: g.date, reverse=True)
    return groups
