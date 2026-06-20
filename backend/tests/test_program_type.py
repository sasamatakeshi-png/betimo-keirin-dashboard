"""detect_program_type の確定ルール検証。

pytest が入っていれば `pytest backend/tests/test_program_type.py` で実行可能。
未導入でも `python -m tests.test_program_type`(backend/ 直下)で単体実行できるよう、
末尾に標準ライブラリのみのランナーを持たせる。
"""

from __future__ import annotations

import os
import sys

# backend/ をパスに追加(standalone 実行時に app パッケージを解決するため)
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from app.services.program_type import detect_program_type  # noqa: E402


# --- 各種別の代表ケース(実データのタイトルを基にする) -------------------------

def test_bkl_without_asukachi():
    title = (
        "【競輪ライブ3/19】#第10回ウィナーズカップ｜平原康多×三宅伸が導く展開解説！ "
        "#G2 #防府競輪場｜Betimo公式競輪番組「Betimo KEIRIN Live」"
    )
    assert detect_program_type(title) == "BKL"


def test_asukachi():
    title = (
        "【競輪予想 3/11】#第1回ワールドサイクリスト支援競輪 #取手競輪場 "
        "「あす勝ち！」Betimo公式競輪展望番組"
    )
    assert detect_program_type(title) == "あす勝ち"


def test_midnight_before_bkl():
    # ミッドナイトは BKL タグを併記するが、BKL より先に判定されること
    title = (
        "【競輪ライブ5/20】#青森競輪場 #ミッドナイト＃G3 #オッズパーク杯"
        "「Betimo KEIRIN Live」Betimo公式競輪番組"
    )
    assert detect_program_type(title) == "ミッドナイト"


def test_nighter_before_bkl():
    # ナイターも BKL タグ併記。BKL より先に判定されること
    title = (
        "【競輪ライブ3/24】旨い！日本盛生原酒ボトル缶杯  #F1 #ナイター #静岡競輪場 "
        "「Betimo KEIRIN Live」Betimo公式競輪番組"
    )
    assert detect_program_type(title) == "ナイター"


def test_premium_talk():
    title = "【Betimo独占】#2 平原康多×脇本雄太  プレミアムトーク"
    assert detect_program_type(title) == "プレミアムトーク"


def test_bar_honne_talk():
    title = "【Betimo独占】#1 平原康多×眞杉匠 バーで語る本音トーク"
    assert detect_program_type(title) == "Bar"


# --- 誤爆回避 -----------------------------------------------------------------

def test_nightrace_not_nighter():
    # "ブルーウイングナイトレース"(レース名)で ナイター にならないこと。
    # BKL タグを持つので最終的に BKL になる。
    title = (
        "【競輪ライブ3/14】#第1回ワールドサイクリスト支援競輪 #取手競輪場 "
        "#ブルーウイングナイトレース #西武園競輪場  ＃G3 "
        "「Betimo KEIRIN Live」Betimo公式競輪番組"
    )
    result = detect_program_type(title)
    assert result != "ナイター"
    assert result == "BKL"


def test_honne_de_kiru_not_bar():
    # "本音で斬る" で Bar にならず、あす勝ち が勝つこと(本音単独では判定しない)
    title = (
        "【競輪予想 2/22】第41回全日本選抜競輪｜三宅伸が本音で斬る！的中への道"
        "「あす勝ち！」#熊本競輪場 #G1 Betimo公式競輪展望番組"
    )
    assert detect_program_type(title) == "あす勝ち"


# --- 事前除外 -----------------------------------------------------------------

def test_excluded_when_ad():
    title = "WebCM 何かの広告「Betimo KEIRIN Live」"
    assert detect_program_type(title, is_ad=True) is None


def test_excluded_when_short():
    title = "あす勝ち ショート"
    assert detect_program_type(title, content_type="short") is None


def test_excluded_when_competitor():
    title = "【競輪ライブ 5/6】#平塚競輪 第80回日本選手権競輪 [ＧⅠ]"
    assert detect_program_type(title, is_competitor=True) is None


# --- タイトル無し -------------------------------------------------------------

def test_none_title():
    assert detect_program_type(None) is None


def test_empty_title():
    assert detect_program_type("") is None
    assert detect_program_type("   ") is None


# --- どれにも当たらない -------------------------------------------------------

def test_other():
    title = "平塚GPKEIRINグランプリ2025"
    assert detect_program_type(title) == "その他"


# --- standalone ランナー(pytest 未導入でも実行可) ----------------------------

def _run_all() -> int:
    tests = [
        (name, obj)
        for name, obj in sorted(globals().items())
        if name.startswith("test_") and callable(obj)
    ]
    failures = 0
    for name, fn in tests:
        try:
            fn()
            print(f"PASS  {name}")
        except AssertionError as exc:  # noqa: PERF203
            failures += 1
            print(f"FAIL  {name}  -> {exc!r}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"ERROR {name}  -> {exc!r}")
    print(f"\n{len(tests)} tests, {len(tests) - failures} passed, {failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(_run_all())
