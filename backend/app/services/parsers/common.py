"""CSV パース共通ヘルパー（表記ゆれ吸収・値変換）。"""

from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta, timezone

# JST（YouTube Studio の公開時刻は JST 表記。UTC へ正規化して格納する）
_JST = timezone(timedelta(hours=9))

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


def parse_datetime_jst(raw: str | None) -> datetime | None:
    """公開時刻文字列 → UTC の aware datetime。空欄・解釈不能は None（行は弾かない）。

    - タイムゾーン付き ISO（末尾 Z / +09:00 等）はその情報を尊重して UTC へ変換。
    - タイムゾーン無しは JST とみなして UTC へ変換。
    - "YYYY/MM/DD HH:MM(:SS)" / "YYYY-MM-DD ..." / 日付のみ も許容。
    """
    if raw is None:
        return None
    s = str(raw).strip()
    if s == "" or s in ("-", "—"):
        return None

    # ISO 8601（fromisoformat は 3.11+ で末尾 Z・空白区切りを許容）
    try:
        iso = s[:-1] + "+00:00" if s.endswith("Z") else s
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=_JST)
        return dt.astimezone(timezone.utc)
    except ValueError:
        pass

    for fmt in (
        "%Y/%m/%d %H:%M:%S",
        "%Y/%m/%d %H:%M",
        "%Y/%m/%d",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=_JST).astimezone(timezone.utc)
        except ValueError:
            continue
    return None
