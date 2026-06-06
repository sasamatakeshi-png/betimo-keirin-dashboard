# Betimo KEIRIN Dashboard

YouTube を中心とした競輪関連チャンネルの数値を集約・可視化するダッシュボード。

## 技術スタック

| レイヤ | 技術 |
| --- | --- |
| Frontend | Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui + Recharts |
| Backend  | FastAPI + SQLAlchemy + Pydantic (Python) |
| DB       | PostgreSQL 15+ |

## リポジトリ構成（monorepo）

```
betimo-keirin-dashboard/
├ backend/                FastAPI アプリケーション
│  ├ app/
│  │  ├ main.py           エントリポイント
│  │  ├ core/             設定 (config) / DB セッション (db)
│  │  ├ models/           SQLAlchemy モデル
│  │  ├ schemas/          Pydantic スキーマ
│  │  ├ api/              ルーター / エンドポイント
│  │  └ services/         ビジネスロジック
│  ├ db/migrations/       SQL マイグレーション（番号順）
│  └ scripts/             運用スクリプト（マイグレーション適用など）
├ frontend/               Next.js アプリケーション
└ README.md
```

## セットアップ

### Backend

```bash
cd backend
py -m venv .venv
.venv\Scripts\activate          # Windows (PowerShell: .venv\Scripts\Activate.ps1)
pip install -r requirements.txt
cp .env.example .env            # 値を埋める（DATABASE_URL など）
```

#### マイグレーション適用

```bash
python scripts/apply_migrations.py
```

#### 起動

```bash
uvicorn app.main:app --reload
# ヘルスチェック: GET http://127.0.0.1:8000/health
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## 環境変数

`backend/.env.example` を参照。`DATABASE_URL` / `APP_PASSWORD` / `ANTHROPIC_API_KEY` を設定する。
**実際の `.env` はコミットしない**（`.gitignore` 済み）。

## Phase

Phase 1（土台）: リポジトリ初期化・スキーマ適用・ヘルスチェック・最小フロント表示。
