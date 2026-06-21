"""YouTube Studio 自社同接CSV（1ファイル=自社1番組）のパーサ。

列（順序は環境で前後しうるためヘッダ名で解決。無ければ位置でフォールバック）:
  ライブ配信の位置（秒）, ライブ同時視聴者数, チャット メッセージ数,
  平均同時視聴者数, ライブ エンゲージメントの数, リアクション
1行=60秒。末尾に空行がありうる。1列目(位置秒)が整数の行のみ採用。

計算（検証で公式アナリティクス値を再現確認済み）:
  - 最大同接 = 「ライブ同時視聴者数」列の最大値
  - 平均同接 = 「平均同時視聴者数」列の全行平均（四捨五入）
    ※「ライブ同時視聴者数」の平均ではない（それだと公式値から約27ズレる）
"""

from __future__ import annotations

from app.services.parsers.common import decode_csv_bytes, find_col, read_rows

# ヘッダ解決用キーワード（小文字・部分一致）
_POS_KEYS = ["位置"]  # ライブ配信の位置（秒）
_LIVE_KEYS = ["ライブ同時視聴者数"]  # 瞬間同接（最大用）
_AVG_KEYS = ["平均同時視聴者数"]  # 平均同接（平均用）

# ヘッダで見つからない場合の位置フォールバック（仕様の列順）
_POS_IDX, _LIVE_IDX, _AVG_IDX = 0, 1, 3


def _to_number(raw: str | None) -> float | None:
    if raw is None:
        return None
    s = str(raw).strip().replace(",", "")
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_studio_ccu_csv(content: bytes) -> dict:
    """Studio自社同接CSVから最大/平均同接を計算して返す。

    返り値: {
      "row_count": 有効データ行数,
      "max_concurrent": int,          # ライブ同時視聴者数の最大
      "avg_concurrent": int,          # 平均同時視聴者数の平均（四捨五入）
      "blank_or_invalid": スキップ行数,
      "duration_seconds": 位置秒の最大（配信長の目安）,
    }
    有効行が無ければ ValueError。
    """
    rows = read_rows(decode_csv_bytes(content))
    if not rows:
        raise ValueError("CSV が空です")

    headers_lower = [(h or "").strip().lower() for h in rows[0]]
    pos_i = find_col(headers_lower, [k.lower() for k in _POS_KEYS])
    live_i = find_col(headers_lower, [k.lower() for k in _LIVE_KEYS])
    avg_i = find_col(headers_lower, [k.lower() for k in _AVG_KEYS])
    pos_i = _POS_IDX if pos_i is None else pos_i
    live_i = _LIVE_IDX if live_i is None else live_i
    avg_i = _AVG_IDX if avg_i is None else avg_i

    live_vals: list[float] = []
    avg_vals: list[float] = []
    blank_or_invalid = 0
    max_pos = 0

    for row in rows[1:]:
        # 1列目(位置秒)が整数の行のみ採用（ヘッダ・空行・非数行を弾く）
        if not row or pos_i >= len(row):
            blank_or_invalid += 1
            continue
        pos_raw = (row[pos_i] or "").strip()
        if pos_raw == "" or not pos_raw.lstrip("-").isdigit():
            blank_or_invalid += 1
            continue
        live = _to_number(row[live_i]) if live_i < len(row) else None
        avg = _to_number(row[avg_i]) if avg_i < len(row) else None
        if live is None and avg is None:
            blank_or_invalid += 1
            continue
        if live is not None:
            live_vals.append(live)
        if avg is not None:
            avg_vals.append(avg)
        max_pos = max(max_pos, int(pos_raw))

    if not live_vals:
        raise ValueError(
            "有効なデータ行がありません（『ライブ同時視聴者数』列を確認してください）"
        )

    max_concurrent = int(max(live_vals))
    # 平均は「平均同時視聴者数」列の平均。万一その列が空なら live で代替。
    base = avg_vals or live_vals
    avg_concurrent = int(round(sum(base) / len(base)))

    return {
        "row_count": len(live_vals),
        "max_concurrent": max_concurrent,
        "avg_concurrent": avg_concurrent,
        "blank_or_invalid": blank_or_invalid,
        "duration_seconds": max_pos,
    }
