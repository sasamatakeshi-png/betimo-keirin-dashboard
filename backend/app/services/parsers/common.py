"""CSV パース共通ヘルパー（表記ゆれ吸収・値変換）。"""

from __future__ import annotations

import csv
import io

# 動画識別子列（共通）
ID_KEYWORDS = ["動画id", "コンテンツ", "動画", "content", "video"]

# 集計対象外の行（合計行など）
_SKIP_IDENTIFIERS = {"", "合計", "total", "合計値", "—", "-"}


def decode_csv_bytes(content: bytes) -> str:
    """UTF-8(BOM可) → CP932 の順でデコードを試みる。"""
    for enc in ("utf-8-sig", "utf-8", "cp932"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    # 最後の手段: 置換デコード
    return content.decode("utf-8", errors="replace")


def read_rows(text: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(text)))


def find_col(headers_lower: list[str], includes: list[str], excludes: tuple[str, ...] = ()) -> int | None:
    """ヘッダー(小文字化済み)から includes のいずれかを含み excludes を含まない最初の列 index。"""
    for i, h in enumerate(headers_lower):
        if any(k in h for k in includes) and not any(x in h for x in excludes):
            return i
    return None


def is_skip_identifier(value: str | None) -> bool:
    if value is None:
        return True
    return value.strip().lower() in _SKIP_IDENTIFIERS or value.strip() == ""


def parse_count(raw: str | None) -> int | None:
    """カンマ付き整数 → int。空・非数は None。"""
    if raw is None:
        return None
    s = str(raw).strip().replace(",", "").replace("，", "")
    if s == "" or s in ("-", "—"):
        return None
    try:
        return int(round(float(s)))
    except ValueError:
        return None


def parse_duration_seconds(raw: str | None) -> int | None:
    """h:mm:ss / mm:ss / 秒数 → 秒(int)。"""
    if raw is None:
        return None
    s = str(raw).strip()
    if s == "" or s in ("-", "—"):
        return None
    if ":" in s:
        try:
            parts = [int(p) for p in s.split(":")]
        except ValueError:
            return None
        sec = 0
        for p in parts:
            sec = sec * 60 + p
        return sec
    try:
        return int(round(float(s)))
    except ValueError:
        return None


def parse_percent_ratio(raw: str | None) -> float | None:
    """百分率(%) → 0〜1 小数。既に 0〜1 ならそのまま。"""
    if raw is None:
        return None
    s = str(raw).strip()
    if s == "" or s in ("-", "—"):
        return None
    had_percent = "%" in s
    s = s.replace("%", "").replace(",", "").strip()
    try:
        v = float(s)
    except ValueError:
        return None
    if had_percent or v > 1:
        v = v / 100.0
    return v
