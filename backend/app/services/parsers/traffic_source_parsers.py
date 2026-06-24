"""流入経路系CSV(流入経路/外部流入/関連動画)のパーサ。

3種とも YouTube Studio の「トラフィックソース」エクスポートで、チャンネル全体集計
(動画ID列なし)。返り値は channel_traffic_sources へ投入する中間表現:
    [{ "source_type", "source_key", "source_name", "imp", "ctr",
       "view_count", "avg_watch_seconds", "total_watch_hours" }, ...]
空セル・非数は None（null≠0）。「合計」行はスキップ。
"""

from __future__ import annotations

from app.services.parsers.common import (
    decode_csv_bytes,
    find_col,
    is_skip_identifier,
    parse_count,
    parse_duration_seconds,
    parse_percent_ratio,
    read_rows,
)

# source_type → トラフィックソース列の接頭辞(剥がして source_key にする)
_PREFIX = {
    "external_url": "EXT_URL.",
    "related_video": "YT_RELATED.",
}


def _parse_float(raw: str | None) -> float | None:
    """総再生時間(時間) '95971.3489' → float。空・非数は None。"""
    if raw is None:
        return None
    s = str(raw).strip().replace(",", "").replace("，", "")
    if s == "" or s in ("-", "—"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse(content: bytes, source_type: str) -> list[dict]:
    text = decode_csv_bytes(content)
    rows = read_rows(text)
    if not rows:
        return []

    hl = [h.strip().lower() for h in rows[0]]
    i_src = find_col(hl, ["トラフィック"])  # 「トラフィック ソース」列
    if i_src is None:
        i_src = 0
    i_name = find_col(hl, ["ソースのタイトル"])
    i_imp = find_col(hl, ["インプレッション"], ("率", "クリック", "ctr"))
    i_ctr = find_col(hl, ["クリック率", "ctr"])
    i_vc = find_col(hl, ["視聴回数", "再生数"], ("率", "平均", "時間"))
    i_dur = find_col(hl, ["平均視聴時間"])
    i_hrs = find_col(hl, ["総再生時間"])

    prefix = _PREFIX.get(source_type)

    def cell(row: list[str], idx: int | None) -> str | None:
        if idx is None or idx >= len(row):
            return None
        return row[idx]

    records: list[dict] = []
    for row in rows[1:]:
        if not row or i_src >= len(row):
            continue
        raw_src = (row[i_src] or "").strip()
        if is_skip_identifier(raw_src):  # 合計/空をスキップ
            continue
        # 接頭辞を剥がして source_key にする（external_url / related_video のみ）
        if prefix and raw_src.startswith(prefix):
            key = raw_src[len(prefix):]
        else:
            key = raw_src
        name_raw = cell(row, i_name)
        records.append(
            {
                "source_type": source_type,
                "source_key": key,
                "source_name": name_raw.strip() if name_raw else None,
                "imp": parse_count(cell(row, i_imp)),
                "ctr": parse_percent_ratio(cell(row, i_ctr)),
                "view_count": parse_count(cell(row, i_vc)),
                "avg_watch_seconds": parse_duration_seconds(cell(row, i_dur)),
                "total_watch_hours": _parse_float(cell(row, i_hrs)),
            }
        )
    return records


def parse_traffic_source_csv(content: bytes, source_type: str = "category") -> list[dict]:
    """流入経路CSV(大カテゴリ)。source_key=カテゴリ名(接頭辞なし)。"""
    return _parse(content, source_type)


def parse_external_url_csv(content: bytes, source_type: str = "external_url") -> list[dict]:
    """外部流入CSV。source_key=外部URL(EXT_URL. 接頭辞を除去)、source_name=表示名。"""
    return _parse(content, source_type)


def parse_related_video_csv(content: bytes, source_type: str = "related_video") -> list[dict]:
    """関連動画CSV。source_key=関連動画ID(YT_RELATED. 接頭辞を除去)、source_name=タイトル。"""
    return _parse(content, source_type)
