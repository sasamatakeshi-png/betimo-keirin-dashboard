"""同時接続数 時系列 Excel（YouTube監視ツール出力）のパーサ。

シート「データ」を読む。1行目ヘッダ:
    取得日時 / チャンネル名 / 番組タイトル / 同時接続数 / 登録者数 / URL / 種別
取得日時は JST のナイーブ datetime。URL の v= パラメータが動画ID。

返り値は時系列点のフラットなリスト:
    [{ "youtube_video_id": str, "channel_name": str, "title": str,
       "recorded_at": datetime(JST aware), "value": int }, ...]
同接が空・非数の行（取得エラー等）は含めない。
"""

from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import openpyxl

JST = timezone(timedelta(hours=9))

_DATA_SHEET = "データ"

# ヘッダ名 → 必須かどうか
_COLUMNS = {
    "recorded_at": ("取得日時", True),
    "channel_name": ("チャンネル名", True),
    "title": ("番組タイトル", False),
    "value": ("同時接続数", True),
    "url": ("url", True),
}


def extract_video_id(url: str | None) -> str | None:
    """YouTube URL から動画IDを抽出（watch?v= / youtu.be/ の2形式に対応）。"""
    if not url:
        return None
    try:
        parsed = urlparse(str(url).strip())
    except ValueError:
        return None
    if parsed.netloc.endswith("youtu.be"):
        vid = parsed.path.lstrip("/").split("/")[0]
        return vid or None
    qs = parse_qs(parsed.query)
    vid = (qs.get("v") or [None])[0]
    return vid or None


def parse_ccu_timeseries_xlsx(content: bytes) -> list[dict]:
    """「データ」シートから同接時系列点を取り出す。"""
    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True, read_only=True)
    if _DATA_SHEET not in wb.sheetnames:
        raise ValueError(f"シート「{_DATA_SHEET}」が見つかりません: {wb.sheetnames}")
    ws = wb[_DATA_SHEET]

    rows = ws.iter_rows(values_only=True)
    headers = [str(h).strip().lower() if h is not None else "" for h in next(rows, [])]

    idx: dict[str, int] = {}
    for field, (name, required) in _COLUMNS.items():
        found = next((i for i, h in enumerate(headers) if name in h), None)
        if found is None and required:
            raise ValueError(f"ヘッダ「{name}」が見つかりません: {headers}")
        if found is not None:
            idx[field] = found

    def cell(row: tuple, field: str) -> object | None:
        i = idx.get(field)
        return row[i] if i is not None and i < len(row) else None

    points: list[dict] = []
    for row in rows:
        recorded = cell(row, "recorded_at")
        value = cell(row, "value")
        video_id = extract_video_id(cell(row, "url"))  # type: ignore[arg-type]
        if not isinstance(recorded, datetime) or video_id is None:
            continue
        if not isinstance(value, (int, float)):  # 取得エラー行などは同接が空
            continue
        points.append(
            {
                "youtube_video_id": video_id,
                "channel_name": str(cell(row, "channel_name") or "").strip(),
                "title": str(cell(row, "title") or "").strip(),
                # 取得日時はJSTのナイーブ datetime → JST aware に変換
                "recorded_at": recorded.replace(tzinfo=JST),
                "value": int(round(float(value))),
            }
        )
    wb.close()
    return points
