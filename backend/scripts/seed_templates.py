"""標準 AI 分析テンプレ2件を analysis_templates へ投入する（冪等）。

name で存在チェック（analysis_templates に UNIQUE 制約は無いため）。
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import select  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.models import AnalysisTemplate  # noqa: E402

TEMPLATES = [
    {
        "name": "イベント成長分析",
        "screen_type": "event_detail",
        "prompt": (
            "あなたは競輪ライブ配信の番組アナリストです。"
            "渡されたイベントの period_kpis と programs_by_max_ccu を読み、"
            "{length} の分量・{tone} のトーンで、番組成長の観点から事実ベースに解説してください。"
            "数値の大小・番組間の差・最大同接の推移に触れ、改善余地にも言及してください。"
        ),
        "reference_data_keys": ["period_kpis", "programs_by_max_ccu"],
        "tone": "分析重視",
        "length": "medium",
    },
    {
        "name": "番組パフォーマンス分析",
        "screen_type": "video_detail",
        "prompt": (
            "あなたは競輪ライブ配信の番組アナリストです。"
            "渡された1番組の主要指標（11指標）を読み、"
            "{length} の分量・{tone} のトーンで、事実ベースにパフォーマンスを解説してください。"
            "到達（imp/再生数）、エンゲージメント（同接・視聴維持）、ロイヤルティ（リピーター比率）の観点で整理してください。"
        ),
        "reference_data_keys": ["metrics"],
        "tone": "分析重視",
        "length": "medium",
    },
]


def main() -> int:
    now = datetime.now(timezone.utc)
    created = 0
    skipped = 0
    with SessionLocal() as db:
        for t in TEMPLATES:
            exists = db.scalar(
                select(AnalysisTemplate.id).where(AnalysisTemplate.name == t["name"])
            )
            if exists:
                skipped += 1
                print(f"skip (exists): {t['name']}")
                continue
            db.add(
                AnalysisTemplate(
                    name=t["name"],
                    screen_type=t["screen_type"],
                    prompt=t["prompt"],
                    reference_data_keys=t["reference_data_keys"],
                    tone=t["tone"],
                    length=t["length"],
                    is_default=True,
                    is_enabled=True,
                    created_at=now,
                    updated_at=now,
                )
            )
            created += 1
            print(f"created: {t['name']}")
        db.commit()
    print(f"\ncreated={created} skipped={skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
