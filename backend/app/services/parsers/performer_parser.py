"""概要欄(description)から出演者を抽出する。

移植元: fetch_youtube_metadata.py の parse_performers。
2026年以降の番組概要欄にある【(日付)出演者】ブロックを対象に、
「#氏名 さん(任意URL)」形式の氏名を順序保持で抽出する。
"""

from __future__ import annotations

import re

# 「出演者」見出し〜次の区切り(＝＝＝ / ━ / --- / 【 / 末尾)までのブロックを掴む
_SECTION_RE = re.compile(
    r"出演者[】\s::]*\n?(.*?)(?=\n*(?:＝{3,}|━{3,}|-{3,}|【|$))",
    re.DOTALL,
)
# 各行から #氏名 (直後が「さん」/空白/括弧/行末) を抽出
_NAME_RE = re.compile(r"#([^\s#（()【】「」、,。\n]+?)(?=\s*さん|\s*$|\s|\()")


def parse_performers(description: str | None) -> list[str]:
    """概要欄から出演者リストを返す。抽出できなければ空リスト。

    例: '【6/21(日)出演者】\\n#平原康多 さん(https://x.com/..)\\n#高橋大作 さん'
        → ['平原康多', '高橋大作']
    """
    if not description:
        return []
    m = _SECTION_RE.search(description)
    if not m:
        return []
    names: list[str] = []
    for line in m.group(1).splitlines():
        for nm in _NAME_RE.findall(line):
            nm = nm.strip()
            if nm and nm not in names:
                names.append(nm)
    return names
