"""番組種別(program_type)をタイトルから機械判定する。

実タイトル(YouTube 実タイトル, 取得できなければ videos.title)を入力に、
videos.program_type と表記が完全一致する種別文字列を返す純粋関数。
取り込み口が整ったら呼び出す想定で、現時点ではどこからも呼ばれない。

判定根拠(142本の既知データで検証済み):
- 弁別子の優先順位は誤判定を避ける順に固定する。特に「ミッドナイト/ナイター」は
  ライブ配信の下位区分で「Betimo KEIRIN Live」タグを併記するため、BKL より先に判定する。
- 「ナイター」は完全語で判定する(「ナイト」部分一致は "ブルーウイングナイトレース"
  等のレース名に誤爆するため使わない)。
- トーク系は「本音」単独では判定しない("本音で斬る" の誤爆回避)。"本音トーク" は
  「トーク」に含まれるので拾える。
"""

from __future__ import annotations

import re

# 戻り値は videos.program_type の既存表記と完全一致させる。
ASUKACHI = "あす勝ち"
BKL = "BKL"
MIDNIGHT = "ミッドナイト"
NIGHTER = "ナイター"
PREMIUM_TALK = "プレミアムトーク"
BAR = "Bar"
OTHER = "その他"

# トーク系: 「トーク」/「バー」/単語境界の "bar"(大小無視)
_TALK_RE = re.compile(r"トーク|バー|\bbar\b", re.IGNORECASE)
# プレミアムトークかどうかの細分化
_PREMIUM_TALK_RE = re.compile(r"プレミアムトーク", re.IGNORECASE)
_ASUKACHI_RE = re.compile(r"あす勝ち")
_MIDNIGHT_RE = re.compile(r"ミッドナイト")
# ナイターは完全語(「ナイト」部分一致は使わない)
_NIGHTER_RE = re.compile(r"ナイター")
# BKL ブランドタグ。表記ゆれ(空白)を吸収、大小無視
_BKL_RE = re.compile(r"Betimo\s*KEIRIN\s*Live", re.IGNORECASE)


def detect_program_type(
    title: str,
    *,
    is_competitor: bool = False,
    content_type: str | None = None,
    is_ad: bool = False,
) -> str | None:
    """タイトルから番組種別を判定して返す。

    戻り値: 'あす勝ち' / 'BKL' / 'ミッドナイト' / 'ナイター' / 'プレミアムトーク'
            / 'Bar' / 'その他'、または判定対象外/判定不能なら None。

    判定対象外(None):
        - is_ad=True(WebCM 広告)
        - content_type='short'(ショート)
        - is_competitor=True(他社チャンネル)
        - title が None/空(判定元タイトル無し)
    """
    # 0. 事前除外(種別判定の対象外)
    if is_ad or is_competitor or content_type == "short":
        return None
    if not title or not title.strip():
        return None

    # 1. トーク系(プレミアムトーク / Bar)
    if _TALK_RE.search(title):
        if _PREMIUM_TALK_RE.search(title):
            return PREMIUM_TALK
        return BAR
    # 2. あす勝ち
    if _ASUKACHI_RE.search(title):
        return ASUKACHI
    # 3. ミッドナイト(BKL タグ併記より先)
    if _MIDNIGHT_RE.search(title):
        return MIDNIGHT
    # 4. ナイター(完全語、BKL タグ併記より先)
    if _NIGHTER_RE.search(title):
        return NIGHTER
    # 5. BKL(全ライブ共通のブランドタグ。包括ルールとして最後)
    if _BKL_RE.search(title):
        return BKL
    # 6. その他(どの弁別子にも当たらない)
    return OTHER
