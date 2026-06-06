"""既存142件データ移行スクリプト。

「番組数字サマリ_同接マージ後.xlsx」(142行) を読み、Supabase の既存スキーマへ
channels / events / videos / metric_values を初期投入する。

ガード:
  - 既存テーブルを DROP/TRUNCATE しない。INSERT のみ。
  - 冪等（再実行で重複しない）:
      channels         : youtube_channel_id で存在チェック (ON CONFLICT DO NOTHING)
      events           : name で存在チェック（name に UNIQUE 制約が無いため SELECT 後 INSERT）
      videos           : youtube_video_id があれば UNIQUE で、無ければ (title, published_at) で存在チェック
      metric_values    : UNIQUE (entity_type, entity_id, metric_key, recorded_at, source) で ON CONFLICT DO NOTHING
  - recorded_at は壁時計 now() ではなく固定の基準時刻を使う（再実行で同一値→重複防止）。

使い方（backend/ ディレクトリで実行）:
  python scripts/migrate_excel.py --dry-run   # DB に触れず投入計画だけ表示
  python scripts/migrate_excel.py             # 実投入
"""

from __future__ import annotations

import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import openpyxl
import psycopg

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import settings  # noqa: E402

# ---------------------------------------------------------------------------
# 定数
# ---------------------------------------------------------------------------
EXCEL_PATH = BACKEND_DIR / "番組数字サマリ_同接マージ後.xlsx"
SOURCE_FILE = "番組数字サマリ_同接マージ後.xlsx"

CHANNEL = {
    "youtube_channel_id": "UCJhyVjSkuSwY9FzDbEEdW0A",
    "name": "Betimo KEIRIN",
}

# JST。Excel の「日時」は JST の壁時計（naive）として記録されている。
JST = timezone(timedelta(hours=9))

# metric_values.recorded_at は固定（バッチ共通・決定論的）。
# 壁時計 now() だと再実行で別値になり UNIQUE 制約をすり抜けて重複するため固定値を使う。
BATCH_RECORDED_AT = datetime(2026, 6, 6, 0, 0, 0, tzinfo=timezone.utc)

# トーク番組（レース紐づけ無し → event_id=NULL）
TALK_PROGRAM_TYPES = {"プレミアムトーク", "Bar"}

# レース名 正規化・統合マップ（spec のマップ + 豊橋の全角→半角統合を追加）
NORMALIZE_MAP = {
    "玉野＆": "玉野競輪 ＆ #西武園競輪ミッドナイト",
    "熊本G1": "第41回全日本選抜競輪 熊本G1",
    "静岡F1ナイター": "旨い！日本盛生原酒ボトル缶杯 静岡F1ナイター",
    "名古屋競輪": "名古屋競輪 ＆ #岸和田競輪ミッドナイト",
    "青森G3ミッドナイト": "オッズパーク杯 青森G3ミッドナイト",
    "防府G2": "第10回ウィナーズカップ 防府G2",
    "防府G2第10回ウィナーズカップ": "第10回ウィナーズカップ 防府G2",
    "豊橋G3": "豊橋G3開設76周年記念ちぎり賞争奪戦",
    # 追加: データ中の全角「７６」名を spec のマップ先（半角「76」）へ統合し、豊橋を1イベントに束ねる
    "豊橋G3開設７６周年記念ちぎり賞争奪戦": "豊橋G3開設76周年記念ちぎり賞争奪戦",
}

# 競輪場名（venue 抽出用）。最長一致を優先するため長い順に並べる。
VENUES = sorted(
    [
        "いわき平", "伊東温泉", "小松島", "西武園", "京王閣", "宇都宮", "和歌山",
        "名古屋", "岸和田", "小倉", "平塚", "熊本", "取手", "防府", "豊橋", "松戸",
        "広島", "武雄", "立川", "大宮", "玉野", "奈良", "静岡", "松山", "松阪",
        "函館", "青森",
    ],
    key=len,
    reverse=True,
)

GRADE_RE = re.compile(r"G[123]|F[12]")

# (Excel列名, metric_key, 変換関数)
def _num(x):
    return x


def time_to_seconds(v):
    """平均視聴時間を「秒(整数)」へ変換する。"""
    if v is None:
        return None
    if isinstance(v, time):
        return v.hour * 3600 + v.minute * 60 + v.second
    if isinstance(v, timedelta):
        return int(v.total_seconds())
    if isinstance(v, (int, float)):
        # Excel のシリアル値（1日=1.0）として解釈
        return int(round(float(v) * 86400))
    return None


METRIC_COLS = [
    ("imp", "imp", _num),
    ("再生数", "view_count", _num),
    ("登録数", "subscriber_gain", _num),
    ("UU数", "unique_viewers", _num),
    ("ライブ視聴", "live_views", _num),
    ("アーカイブ視聴", "archive_views", _num),
    ("平均同接", "avg_concurrent_viewers", _num),
    ("最大同接", "max_concurrent_viewers", _num),
    ("平均視聴時間", "avg_view_duration", time_to_seconds),
    ("平均再生率", "avg_view_percentage", _num),
    ("リピーター比率", "repeater_ratio", _num),
]
METRIC_KEYS = [k for _, k, _ in METRIC_COLS]


# ---------------------------------------------------------------------------
# パース
# ---------------------------------------------------------------------------
def normalize_name(raw: str) -> str:
    s = (raw or "").strip()
    return NORMALIZE_MAP.get(s, s)


def parse_venue_grade_tag(name: str) -> tuple[str | None, str | None, str | None]:
    """name から best-effort で (venue, grade, title_tag) を抽出。取れなければ NULL。"""
    # venue: 最も早く出現する競輪場名
    venue = None
    venue_pos = len(name) + 1
    for v in VENUES:
        idx = name.find(v)
        if idx != -1 and idx < venue_pos:
            venue, venue_pos = v, idx

    # grade
    gm = GRADE_RE.search(name)
    grade = gm.group(0) if gm else None

    # title_tag: venue より前（冠スポンサー名）優先、無ければ grade より後ろ
    strip_chars = " 　＆#・"
    pre = name[:venue_pos].strip(strip_chars) if venue is not None and venue_pos > 0 else ""
    post = name[gm.end():].strip(strip_chars) if gm else ""
    title_tag = pre or post or None

    return venue, grade, title_tag


def cell_empty(v) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "")


def load_records() -> list[dict]:
    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    header = list(rows[0])
    H = {name: i for i, name in enumerate(header)}
    records: list[dict] = []
    for r in rows[1:]:
        if not any(c is not None and str(c).strip() != "" for c in r):
            continue  # 完全空行スキップ
        raw_name = r[H["レース名"]]
        norm = normalize_name(raw_name)
        program_type = r[H["番組種別"]]
        is_talk = program_type in TALK_PROGRAM_TYPES

        dt = r[H["日時"]]
        if not isinstance(dt, datetime):
            raise ValueError(f"日時が datetime ではありません: {dt!r}")
        pub_dt = dt.replace(tzinfo=JST)  # JST aware → 保存時 UTC へ
        jst_date: date = dt.date()

        cast_raw = r[H["出演"]]
        cast = (
            [c for c in str(cast_raw).split("・") if c.strip()]
            if not cell_empty(cast_raw)
            else []
        )

        yid_raw = r[H["動画ID"]]
        yid = None if cell_empty(yid_raw) else str(yid_raw).strip()

        venue, grade, title_tag = parse_venue_grade_tag(norm)

        metrics: dict[str, object] = {}
        for col, key, conv in METRIC_COLS:
            raw = r[H[col]]
            metrics[key] = None if cell_empty(raw) else conv(raw)

        records.append(
            {
                "raw_name": raw_name,
                "norm_name": norm,
                "program_type": program_type,
                "is_talk": is_talk,
                "pub_dt": pub_dt,
                "jst_date": jst_date,
                "cast": cast,
                "yid": yid,
                "venue": venue,
                "grade": grade,
                "title_tag": title_tag,
                "metrics": metrics,
            }
        )
    return records


def compute_event_plan(records: list[dict]) -> dict[str, dict]:
    """非トーク行を正規化後 name でグルーピングし、start/end とパース結果を返す。"""
    groups: dict[str, list[dict]] = defaultdict(list)
    for rec in records:
        if rec["is_talk"]:
            continue
        groups[rec["norm_name"]].append(rec)

    plan: dict[str, dict] = {}
    for name, recs in groups.items():
        dates = [rc["jst_date"] for rc in recs]
        venue, grade, _tag = parse_venue_grade_tag(name)
        plan[name] = {
            "name": name,
            "venue": venue,
            "grade": grade,
            "start_date": min(dates),
            "end_date": max(dates),
            "row_count": len(recs),
        }
    return plan


# ---------------------------------------------------------------------------
# DB
# ---------------------------------------------------------------------------
def to_psycopg_dsn(database_url: str) -> str:
    return database_url.replace("postgresql+psycopg://", "postgresql://").replace(
        "postgres+psycopg://", "postgresql://"
    )


def run_migration(records: list[dict], event_plan: dict[str, dict]) -> None:
    dsn = to_psycopg_dsn(settings.DATABASE_URL)
    stats = {
        "channel_created": 0,
        "events_created": 0,
        "videos_created": 0,
        "metric_created": Counter(),
    }

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            # 1) channel ----------------------------------------------------
            cur.execute(
                """
                INSERT INTO channels (youtube_channel_id, name, is_own, is_enabled)
                VALUES (%s, %s, TRUE, TRUE)
                ON CONFLICT (youtube_channel_id) DO NOTHING
                """,
                (CHANNEL["youtube_channel_id"], CHANNEL["name"]),
            )
            stats["channel_created"] = cur.rowcount
            cur.execute(
                "SELECT id FROM channels WHERE youtube_channel_id = %s",
                (CHANNEL["youtube_channel_id"],),
            )
            channel_id = cur.fetchone()[0]

            # 4) events -----------------------------------------------------
            event_id_by_name: dict[str, object] = {}
            for name, ev in event_plan.items():
                cur.execute("SELECT id FROM events WHERE name = %s", (name,))
                row = cur.fetchone()
                if row:
                    event_id_by_name[name] = row[0]
                    continue
                cur.execute(
                    """
                    INSERT INTO events (name, venue, grade, start_date, end_date)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (name, ev["venue"], ev["grade"], ev["start_date"], ev["end_date"]),
                )
                event_id_by_name[name] = cur.fetchone()[0]
                stats["events_created"] += 1

            # 5) videos + 6) metric_values ----------------------------------
            for rec in records:
                event_id = None if rec["is_talk"] else event_id_by_name[rec["norm_name"]]
                title = rec["norm_name"]
                vparams = (
                    channel_id,
                    event_id,
                    title,
                    rec["pub_dt"],
                    rec["program_type"],
                    rec["cast"],
                    rec["venue"],
                    rec["grade"],
                    rec["title_tag"],
                )

                if rec["yid"] is not None:
                    cur.execute(
                        """
                        INSERT INTO videos
                          (youtube_video_id, channel_id, event_id, title, published_at,
                           program_type, cast_members, venue, grade, title_tag,
                           content_type, is_competitor)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'regular', FALSE)
                        ON CONFLICT (youtube_video_id) DO NOTHING
                        """,
                        (rec["yid"], *vparams),
                    )
                    stats["videos_created"] += cur.rowcount
                    cur.execute(
                        "SELECT id FROM videos WHERE youtube_video_id = %s",
                        (rec["yid"],),
                    )
                    video_id = cur.fetchone()[0]
                else:
                    cur.execute(
                        """
                        SELECT id FROM videos
                        WHERE youtube_video_id IS NULL AND title = %s AND published_at = %s
                        """,
                        (title, rec["pub_dt"]),
                    )
                    row = cur.fetchone()
                    if row:
                        video_id = row[0]
                    else:
                        cur.execute(
                            """
                            INSERT INTO videos
                              (channel_id, event_id, title, published_at,
                               program_type, cast_members, venue, grade, title_tag,
                               content_type, is_competitor)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'regular', FALSE)
                            RETURNING id
                            """,
                            vparams,
                        )
                        video_id = cur.fetchone()[0]
                        stats["videos_created"] += 1

                # metric_values（値のある列だけ・空セルは挿入しない）
                for key in METRIC_KEYS:
                    val = rec["metrics"][key]
                    if val is None:
                        continue
                    cur.execute(
                        """
                        INSERT INTO metric_values
                          (entity_type, entity_id, metric_key, value, recorded_at, source, source_file)
                        VALUES ('videos', %s, %s, %s, %s, 'manual', %s)
                        ON CONFLICT (entity_type, entity_id, metric_key, recorded_at, source)
                        DO NOTHING
                        """,
                        (video_id, key, val, BATCH_RECORDED_AT, SOURCE_FILE),
                    )
                    if cur.rowcount == 1:
                        stats["metric_created"][key] += 1

            # --- 検証用集計（同一トランザクション内で参照） -----------------
            cur.execute(
                "SELECT count(*) FROM videos WHERE channel_id = %s", (channel_id,)
            )
            total_videos = cur.fetchone()[0]
            cur.execute(
                "SELECT count(*) FROM videos WHERE channel_id = %s AND event_id IS NULL",
                (channel_id,),
            )
            null_event = cur.fetchone()[0]
            cur.execute(
                "SELECT count(*) FROM videos WHERE channel_id = %s AND youtube_video_id IS NULL",
                (channel_id,),
            )
            null_vid = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM events")
            total_events = cur.fetchone()[0]
            cur.execute(
                "SELECT metric_key, count(*) FROM metric_values WHERE source_file = %s GROUP BY metric_key",
                (SOURCE_FILE,),
            )
            mv_by_key = dict(cur.fetchall())
        # with conn: 正常終了で commit

    # ---- レポート ----------------------------------------------------------
    print("=" * 60)
    print("移行結果（今回の作成件数）")
    print("=" * 60)
    print(f"  channels       : +{stats['channel_created']}")
    print(f"  events         : +{stats['events_created']}")
    print(f"  videos         : +{stats['videos_created']}")
    print(f"  metric_values  : +{sum(stats['metric_created'].values())}")
    print("\n指標別 作成件数（今回 INSERT 分）:")
    for key in METRIC_KEYS:
        print(f"  {key:24s}: +{stats['metric_created'].get(key, 0)}")

    print("\n" + "=" * 60)
    print("DB 全体集計（source_file / 自社チャンネル基準）")
    print("=" * 60)
    print(f"  videos(自社)            : {total_videos}  (期待値 142)")
    print(f"  videos event_id=NULL    : {null_event}  (期待値 4 = トーク番組)")
    print(f"  videos 動画ID=NULL      : {null_vid}  (期待値 1)")
    print(f"  events(全体)            : {total_events}")
    print(f"  metric_values(本ファイル): {sum(mv_by_key.values())}")
    print("\n指標別 DB 件数（source_file 一致）:")
    for key in METRIC_KEYS:
        print(f"  {key:24s}: {mv_by_key.get(key, 0)}")


def print_plan(records: list[dict], event_plan: dict[str, dict]) -> None:
    talk = [r for r in records if r["is_talk"]]
    null_id = [r for r in records if r["yid"] is None]
    print("=" * 60)
    print("投入計画（--dry-run / DB 未接続）")
    print("=" * 60)
    print(f"  対象行            : {len(records)}  (期待 142)")
    print(f"  events(正規化後)  : {len(event_plan)}  (期待 32)")
    print(f"  videos            : {len(records)}")
    print(f"  トーク行(event_id=NULL): {len(talk)}  (期待 4)")
    print(f"  動画ID=NULL 行    : {len(null_id)}  (期待 1)")

    print("\n指標別 投入予定件数 / 未充足(欠損)件数:")
    for key in METRIC_KEYS:
        filled = sum(1 for r in records if r["metrics"][key] is not None)
        missing = len(records) - filled
        print(f"  {key:24s}: 投入 {filled:3d} / 欠損 {missing:3d}")

    total_planned = sum(
        1 for r in records for k in METRIC_KEYS if r["metrics"][k] is not None
    )
    print(f"\n  metric_values 投入予定 合計: {total_planned}")

    print("\n統合確認（複数 raw 名 → 1 event）:")
    merged = ["第10回ウィナーズカップ 防府G2", "豊橋G3開設76周年記念ちぎり賞争奪戦"]
    for name in merged:
        srcs = sorted({r["raw_name"] for r in records if r["norm_name"] == name})
        rc = event_plan.get(name, {}).get("row_count")
        print(f"  {name}  rows={rc}  ← {srcs}")


def main() -> int:
    dry_run = "--dry-run" in sys.argv

    if not EXCEL_PATH.exists():
        print(f"ERROR: Excel が見つかりません: {EXCEL_PATH}")
        return 1

    records = load_records()
    event_plan = compute_event_plan(records)

    if dry_run:
        print_plan(records, event_plan)
        print("\n--dry-run のため DB へは書き込みません。")
        return 0

    if not settings.DATABASE_URL:
        print("ERROR: DATABASE_URL が未設定です。backend/.env を確認してください。")
        return 1

    print_plan(records, event_plan)
    print("\n--- DB へ投入します ---\n")
    run_migration(records, event_plan)
    print("\n完了。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
