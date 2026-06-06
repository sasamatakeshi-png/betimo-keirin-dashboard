"""YouTube Studio 由来 CSV の2種パーサ。

返り値は共通の中間表現:
    [{ "identifier": <動画ID または タイトル>, "metrics": { metric_key: value, ... } }, ...]
空セル・非数は metrics に含めない（null≠0）。
"""

from __future__ import annotations

from app.services.parsers.common import (
    ID_KEYWORDS,
    decode_csv_bytes,
    find_col,
    is_skip_identifier,
    parse_count,
    parse_duration_seconds,
    parse_percent_ratio,
    read_rows,
)


def _parse(
    content: bytes,
    *,
    count_cols: dict[str, tuple[list[str], tuple[str, ...]]],
    duration_cols: dict[str, tuple[list[str], tuple[str, ...]]],
    percent_cols: dict[str, tuple[list[str], tuple[str, ...]]],
) -> list[dict]:
    text = decode_csv_bytes(content)
    rows = read_rows(text)
    if not rows:
        return []

    headers = [h.strip() for h in rows[0]]
    headers_lower = [h.lower() for h in headers]

    id_idx = find_col(headers_lower, ID_KEYWORDS)
    if id_idx is None:
        id_idx = 0  # 先頭列を識別子とみなす

    def resolve(spec: dict[str, tuple[list[str], tuple[str, ...]]]) -> dict[str, int]:
        out: dict[str, int] = {}
        for key, (inc, exc) in spec.items():
            idx = find_col(headers_lower, inc, exc)
            if idx is not None:
                out[key] = idx
        return out

    count_idx = resolve(count_cols)
    dur_idx = resolve(duration_cols)
    pct_idx = resolve(percent_cols)

    records: list[dict] = []
    for row in rows[1:]:
        if not row or id_idx >= len(row):
            continue
        identifier = (row[id_idx] or "").strip()
        if is_skip_identifier(identifier):
            continue

        metrics: dict[str, float | int] = {}
        for key, idx in count_idx.items():
            if idx < len(row):
                v = parse_count(row[idx])
                if v is not None:
                    metrics[key] = v
        for key, idx in dur_idx.items():
            if idx < len(row):
                v = parse_duration_seconds(row[idx])
                if v is not None:
                    metrics[key] = v
        for key, idx in pct_idx.items():
            if idx < len(row):
                v = parse_percent_ratio(row[idx])
                if v is not None:
                    metrics[key] = v

        records.append({"identifier": identifier, "metrics": metrics})
    return records


def parse_zenkikan_csv(content: bytes) -> list[dict]:
    """全期間CSV: imp / view_count / subscriber_gain / avg_view_duration / avg_view_percentage。"""
    return _parse(
        content,
        count_cols={
            "imp": (["インプレッション", "imp"], ()),
            "view_count": (["視聴回数", "再生数", "views", "view"], ("率",)),
            "subscriber_gain": (["登録"], ()),
        },
        duration_cols={
            "avg_view_duration": (["平均視聴時間", "視聴時間"], ()),
        },
        percent_cols={
            "avg_view_percentage": (["再生率", "視聴維持率", "維持率"], ()),
        },
    )


def parse_90d_csv(content: bytes) -> list[dict]:
    """90日CSV: unique_viewers / new_viewers / repeat_viewers / repeater_ratio。

    repeater_ratio は CSV に無ければ呼び出し側で repeat/unique から算出する。
    """
    return _parse(
        content,
        count_cols={
            "unique_viewers": (["ユニーク視聴者", "ユニーク", "unique"], ()),
            "new_viewers": (["新しい視聴者", "新規"], ()),
            "repeat_viewers": (["リピーター"], ("比率", "率", "ratio")),
        },
        duration_cols={},
        percent_cols={
            "repeater_ratio": (["リピーター比率", "リピート率", "リピーター率"], ()),
        },
    )
