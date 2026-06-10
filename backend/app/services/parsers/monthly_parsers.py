"""月次CSV(数値 / 性別年齢)パーサ。

- 数値CSV: 「動画ごとの行 + 先頭に合計行」。使うのは【合計行】のみ。
  → 合計行から固定10指標を抽出して 1 レコード分の dict を返す。
- 性別年齢CSV: 各行 = 年齢層 × 性別 × 視聴回数(%) × 総再生時間(%)。
  → 行ごとに {age_band, gender, views_pct, watch_time_pct} を返す。

% は生の百分率(例 45.2)のまま返す（/100 しない）。共通の parse_percent_ratio は
0〜1 へ丸めるため使わず、本モジュールの parse_percent_raw を使う。
共通ヘルパー(decode/read/find_col/parse_count/parse_duration_seconds)は読み取りのみ利用。
"""

from __future__ import annotations

import re

from app.services.parsers.common import (
    decode_csv_bytes,
    find_col,
    parse_count,
    parse_duration_seconds,
    read_rows,
)

# 合計行の識別子（先頭列がこれ、または空）。YouTube Studio は「合計」/「Total」/空。
_TOTAL_MARKERS = {"合計", "合計値", "total", "totals", "—", "-", ""}


def parse_percent_raw(raw: str | None) -> float | None:
    """百分率 → 生の % 値(float)。'%'やカンマは除去するが /100 しない。空・非数は None。"""
    if raw is None:
        return None
    s = str(raw).strip().replace("%", "").replace(",", "").replace("，", "").strip()
    if s == "" or s in ("-", "—"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_number(raw: str | None) -> float | None:
    """カンマ付き小数 → float。空・非数は None（総再生時間(時間)など小数を保持）。"""
    if raw is None:
        return None
    s = str(raw).strip().replace(",", "").replace("，", "")
    if s == "" or s in ("-", "—"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


# 数値CSV: DB列 → (ヘッダー includes, excludes)。
# find_col は「includes のいずれかを含み excludes を一切含まない最初の列」を返す。
_METRIC_COUNT_COLS: dict[str, tuple[list[str], tuple[str, ...]]] = {
    "unique_viewers": (["ユニーク視聴者", "ユニーク", "unique"], ()),
    "new_viewers": (["新しい視聴者", "新規"], ()),
    "repeat_viewers": (["リピーター"], ("比率", "率", "ratio")),
    "view_count": (["視聴回数", "再生数"], ("率", "平均", "維持")),
    "subscribers": (["チャンネル登録", "登録"], ()),
    "impressions": (["インプレッション"], ("クリック", "率", "ctr")),
}
_METRIC_DURATION_COLS: dict[str, tuple[list[str], tuple[str, ...]]] = {
    "avg_view_duration_seconds": (["平均視聴時間", "視聴時間"], ("総", "率", "合計")),
}
_METRIC_NUMBER_COLS: dict[str, tuple[list[str], tuple[str, ...]]] = {
    "total_watch_time_hours": (["総再生時間", "総視聴時間"], ("平均",)),
}
_METRIC_PERCENT_COLS: dict[str, tuple[list[str], tuple[str, ...]]] = {
    "avg_view_percentage": (["平均視聴率", "視聴維持率", "維持率", "再生率"], ("時間",)),
    "impressions_ctr": (["クリック率", "ctr"], ()),
}


def _resolve(headers_lower: list[str], spec: dict) -> dict[str, int]:
    out: dict[str, int] = {}
    for key, (inc, exc) in spec.items():
        idx = find_col(headers_lower, inc, exc)
        if idx is not None:
            out[key] = idx
    return out


def _is_total_identifier(value: str | None) -> bool:
    if value is None:
        return True
    return value.strip().lower() in _TOTAL_MARKERS


def parse_monthly_metrics_csv(content: bytes) -> dict[str, float | int]:
    """数値CSVの【合計行】から固定10指標を抽出して dict を返す。

    返り値: {DB列名: 値, ...}（値が空/非数の指標は含めない＝null≠0）。
    合計行が見つからない場合は空 dict。先頭列が「合計」/空 の行、無ければ
    先頭データ行を合計行とみなす（仕様: 合計行は先頭にある）。
    """
    text = decode_csv_bytes(content)
    rows = read_rows(text)
    if not rows or len(rows) < 2:
        return {}

    headers_lower = [h.strip().lower() for h in rows[0]]
    id_idx = find_col(headers_lower, ["動画", "コンテンツ", "content", "video", "タイトル"])
    if id_idx is None:
        id_idx = 0

    # 合計行を特定（先頭列が合計マーカー/空）。無ければ先頭データ行。
    total_row = None
    for row in rows[1:]:
        if not row:
            continue
        ident = row[id_idx] if id_idx < len(row) else ""
        if _is_total_identifier(ident):
            total_row = row
            break
    if total_row is None:
        total_row = rows[1]

    count_idx = _resolve(headers_lower, _METRIC_COUNT_COLS)
    dur_idx = _resolve(headers_lower, _METRIC_DURATION_COLS)
    num_idx = _resolve(headers_lower, _METRIC_NUMBER_COLS)
    pct_idx = _resolve(headers_lower, _METRIC_PERCENT_COLS)

    def cell(idx: int) -> str | None:
        return total_row[idx] if 0 <= idx < len(total_row) else None

    metrics: dict[str, float | int] = {}
    for key, idx in count_idx.items():
        v = parse_count(cell(idx))
        if v is not None:
            metrics[key] = v
    for key, idx in dur_idx.items():
        v = parse_duration_seconds(cell(idx))
        if v is not None:
            metrics[key] = v
    for key, idx in num_idx.items():
        v = parse_number(cell(idx))
        if v is not None:
            metrics[key] = v
    for key, idx in pct_idx.items():
        v = parse_percent_raw(cell(idx))
        if v is not None:
            metrics[key] = v
    return metrics


# ---- 年齢層・性別の日本語表記 → DB値マッピング ----

# 性別: 完全一致辞書 + フォールバック 'other'
_GENDER_MAP = {
    "男性": "male",
    "男": "male",
    "male": "male",
    "女性": "female",
    "女": "female",
    "female": "female",
    "ユーザーによる設定": "other",
    "ユーザー指定": "other",
    "ユーザー設定": "other",
    "指定なし": "other",
    "その他": "other",
    "user_specified": "other",
    "user-specified": "other",
    "other": "other",
    "unknown": "other",
}


def map_gender(raw: str | None) -> str:
    """性別表記を 'male'/'female'/'other' へ。未知は 'other'。"""
    if raw is None:
        return "other"
    s = str(raw).strip().lower()
    return _GENDER_MAP.get(s, "other")


def map_age_band(raw: str | None) -> str:
    """年齢層表記を 'a-b' / '65-' へ正規化。

    例: "13～17歳"/"13-17歳"/"AGE_13_17" → "13-17"
        "65 歳以上"/"65歳以上"/"AGE_65_" → "65-"
    数字が1つ＋(以上/+/over)、または数字1つのみ → "{n}-"（上限開放帯とみなす）。
    数字2つ以上 → "{先頭}-{2番目}"。数字が取れない場合は元文字列を維持。
    """
    if raw is None:
        return ""
    s = str(raw).strip()
    nums = re.findall(r"\d+", s)
    open_ended = any(k in s for k in ("以上", "over", "older")) or "+" in s
    if not nums:
        return s
    if open_ended or len(nums) == 1:
        return f"{nums[0]}-"
    return f"{nums[0]}-{nums[1]}"


# 性別年齢CSV: 列ヘッダー検出
_AGE_KEYWORDS = ["年齢", "age"]
_GENDER_KEYWORDS = ["性別", "gender"]
_VIEWS_PCT_KEYWORDS = ["視聴回数", "views"]
_WATCH_PCT_KEYWORDS = ["総再生時間", "再生時間", "視聴時間", "watch"]


def parse_monthly_demographics_csv(content: bytes) -> list[dict]:
    """性別年齢CSVをパースして行ごとの dict リストを返す。

    返り値: [{age_band, gender, views_pct, watch_time_pct}, ...]
    年齢/性別が空の行はスキップ。% は生の % 値。空セルは None。
    """
    text = decode_csv_bytes(content)
    rows = read_rows(text)
    if not rows or len(rows) < 2:
        return []

    headers_lower = [h.strip().lower() for h in rows[0]]
    age_idx = find_col(headers_lower, _AGE_KEYWORDS)
    gender_idx = find_col(headers_lower, _GENDER_KEYWORDS)
    views_idx = find_col(headers_lower, _VIEWS_PCT_KEYWORDS, ("総", "時間"))
    watch_idx = find_col(headers_lower, _WATCH_PCT_KEYWORDS, ("回数",))

    if age_idx is None or gender_idx is None:
        return []

    def cell(row: list[str], idx: int | None) -> str | None:
        if idx is None or idx >= len(row):
            return None
        return row[idx]

    out: list[dict] = []
    for row in rows[1:]:
        if not row:
            continue
        age_raw = cell(row, age_idx)
        gender_raw = cell(row, gender_idx)
        if not age_raw or not str(age_raw).strip():
            continue
        if not gender_raw or not str(gender_raw).strip():
            continue
        # 合計行（性別/年齢が「合計」等）はスキップ
        if str(age_raw).strip().lower() in _TOTAL_MARKERS:
            continue
        out.append(
            {
                "age_band": map_age_band(age_raw),
                "gender": map_gender(gender_raw),
                "views_pct": parse_percent_raw(cell(row, views_idx)),
                "watch_time_pct": parse_percent_raw(cell(row, watch_idx)),
            }
        )
    return out
