"""X(旧Twitter)アナリティクスの日別CSVパーサ。

1行=1日のアカウント全体集計。返り値は x_daily_metrics へ投入する中間表現:
    [{ "date": date, "imp", "likes", "engagements", "bookmarks", "shares",
       "follows_gained", "unfollows", "replies", "reposts", "profile_visits",
       "posts_created", "video_views", "media_views" }, ...]
空セル・非数は None（null≠0）。日付解釈不能な行はスキップ。net_follows は生成列のため含めない。
"""

from __future__ import annotations

import re
from datetime import date

from app.services.parsers.common import decode_csv_bytes, parse_count, read_rows

# 英語月名(先頭3文字)→月番号。strptime("%b") はロケール依存のため自前で持つ。
_EN_MONTHS = {
    m: i
    for i, m in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"],
        start=1,
    )
}
# 曜日接頭辞を除去後の "Jun 19, 2026" / "June 19, 2026"
_DATE_RE = re.compile(r"^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$")
# 先頭の曜日("Fri, " 等)を剥がす
_WEEKDAY_RE = re.compile(r"^[A-Za-z]+,\s*")

# x_daily_metrics 列 → CSVヘッダー(完全一致)。表記が固定のため exact マッチで誤判定を防ぐ。
_COLS = {
    "imp": "インプレッション数",
    "likes": "いいね",
    "engagements": "エンゲージメント",
    "bookmarks": "ブックマーク",
    "shares": "共有された回数",
    "follows_gained": "新しいフォロー",
    "unfollows": "フォロー解除",
    "replies": "返信",
    "reposts": "リポスト",
    "profile_visits": "プロフィールへのアクセス数",
    "posts_created": "ポストを作成",
    "video_views": "動画再生数",
    "media_views": "メディアの再生数",
}


def parse_x_date(raw: str | None) -> date | None:
    """'Fri, Jun 19, 2026' → date(2026,6,19)。曜日を除去して英語月名で解釈。

    タイムゾーン変換はしない（日付そのものを保持。JST/UTC のずれを起こさない）。
    解釈不能・空は None。
    """
    if raw is None:
        return None
    s = str(raw).strip().strip('"').strip()
    if not s:
        return None
    s = _WEEKDAY_RE.sub("", s)  # "Fri, " を除去
    m = _DATE_RE.match(s)
    if not m:
        return None
    mon = _EN_MONTHS.get(m.group(1)[:3].lower())
    if not mon:
        return None
    try:
        return date(int(m.group(3)), mon, int(m.group(2)))
    except ValueError:
        return None


def parse_x_csv(content: bytes) -> list[dict]:
    """X日別CSVをパースして日別レコードのリストを返す。日付不能な行はスキップ。"""
    text = decode_csv_bytes(content)
    rows = read_rows(text)
    if not rows:
        return []

    headers = [h.strip() for h in rows[0]]
    idx = {h: i for i, h in enumerate(headers)}
    date_idx = idx.get("Date", 0)
    col_idx = {field: idx.get(jp) for field, jp in _COLS.items()}

    def cell(row: list[str], i: int | None) -> str | None:
        if i is None or i >= len(row):
            return None
        return row[i]

    records: list[dict] = []
    for row in rows[1:]:
        if not row or date_idx >= len(row):
            continue
        d = parse_x_date(row[date_idx])
        if d is None:  # 合計行・空行・解釈不能はスキップ
            continue
        rec: dict = {"date": d}
        for field, i in col_idx.items():
            rec[field] = parse_count(cell(row, i))
        records.append(rec)
    return records
