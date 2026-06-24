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
    parse_datetime_jst,
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


def parse_live_views_csv(content: bytes) -> list[dict]:
    """ライブ視聴CSV: 「視聴回数」列の値を live_views として取り込む。

    アーカイブ視聴CSVと同一列構成のため、ファイル種別で metric_key を振り分ける。
    除外語(率/平均/維持/時間)で 平均視聴率・平均視聴時間・総再生時間 の誤マッチを避ける。
    """
    return _parse(
        content,
        count_cols={"live_views": (["視聴回数", "再生数", "views"], ("率", "平均", "維持", "時間"))},
        duration_cols={},
        percent_cols={},
    )


def parse_archive_views_csv(content: bytes) -> list[dict]:
    """アーカイブ視聴CSV: 「視聴回数」列の値を archive_views として取り込む。"""
    return _parse(
        content,
        count_cols={"archive_views": (["視聴回数", "再生数", "views"], ("率", "平均", "維持", "時間"))},
        duration_cols={},
        percent_cols={},
    )


# ショート用 CSV（全期間 / 90日とも同一列構成）の列→指標マッピング。
# 通常CSVと違い、video の新規作成に使う title / 公開時刻 / 長さ も抽出する。
_SHORT_COUNT_COLS: dict[str, tuple[list[str], tuple[str, ...]]] = {
    "view_count": (["視聴回数", "再生数", "views"], ("率", "維持", "平均")),
    "subscriber_gain": (["チャンネル登録", "登録"], ()),
    "imp": (["インプレッション", "imp"], ()),
    "unique_viewers": (["ユニーク視聴者", "ユニーク", "unique"], ()),
    "new_viewers": (["新しい視聴者", "新規"], ()),
    "repeat_viewers": (["リピーター"], ("比率", "率", "ratio")),
}
_SHORT_DURATION_COLS: dict[str, tuple[list[str], tuple[str, ...]]] = {
    "avg_view_duration": (["平均視聴時間", "視聴時間"], ("率",)),
}
_SHORT_PERCENT_COLS: dict[str, tuple[list[str], tuple[str, ...]]] = {
    "avg_view_percentage": (["平均視聴率", "視聴維持率", "維持率", "再生率"], ()),
}


def parse_short_csv(content: bytes) -> list[dict]:
    """ショートCSV（全期間/90日 共通列）をパースする。

    返り値（通常パーサより情報が多い）:
        [{ "identifier": <youtube_video_id>, "title": str|None,
           "published_at": datetime|None, "duration_seconds": int|None,
           "metrics": { metric_key: value, ... } }, ...]
    - 合計行・空 identifier はスキップ。公開時刻が空の行は弾かず published_at=None。
    - 全期間CSVは new_viewers/repeat_viewers が空欄 → 当該 metric は付与されない（null≠0）。
    """
    text = decode_csv_bytes(content)
    rows = read_rows(text)
    if not rows:
        return []

    headers_lower = [h.strip().lower() for h in rows[0]]

    id_idx = find_col(headers_lower, ID_KEYWORDS)
    if id_idx is None:
        id_idx = 0
    title_idx = find_col(headers_lower, ["動画のタイトル", "タイトル", "title"])
    # 日本語「動画公開時刻/公開日」・英語「Video publish time」両対応（publish で拾う）
    published_idx = find_col(headers_lower, ["公開", "publish"])
    # 動画の長さ。「平均視聴時間」と区別するため平均/視聴を除外
    length_idx = find_col(headers_lower, ["長さ", "duration"], ("平均", "視聴"))

    def resolve(spec: dict[str, tuple[list[str], tuple[str, ...]]]) -> dict[str, int]:
        out: dict[str, int] = {}
        for key, (inc, exc) in spec.items():
            idx = find_col(headers_lower, inc, exc)
            if idx is not None:
                out[key] = idx
        return out

    count_idx = resolve(_SHORT_COUNT_COLS)
    dur_idx = resolve(_SHORT_DURATION_COLS)
    pct_idx = resolve(_SHORT_PERCENT_COLS)

    def cell(row: list[str], idx: int | None) -> str | None:
        if idx is None or idx >= len(row):
            return None
        return row[idx]

    records: list[dict] = []
    for row in rows[1:]:
        if not row or id_idx >= len(row):
            continue
        identifier = (row[id_idx] or "").strip()
        if is_skip_identifier(identifier):
            continue

        metrics: dict[str, float | int] = {}
        for key, idx in count_idx.items():
            v = parse_count(cell(row, idx))
            if v is not None:
                metrics[key] = v
        for key, idx in dur_idx.items():
            v = parse_duration_seconds(cell(row, idx))
            if v is not None:
                metrics[key] = v
        for key, idx in pct_idx.items():
            v = parse_percent_ratio(cell(row, idx))
            if v is not None:
                metrics[key] = v

        title_raw = cell(row, title_idx)
        records.append(
            {
                "identifier": identifier,
                "title": title_raw.strip() if title_raw else None,
                "published_at": parse_datetime_jst(cell(row, published_idx)),
                "duration_seconds": parse_duration_seconds(cell(row, length_idx)),
                "metrics": metrics,
            }
        )
    return records
