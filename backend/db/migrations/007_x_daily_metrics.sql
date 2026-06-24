-- =====================================================================
-- 007. X(旧Twitter)アカウントの日別メトリクス
--   X アナリティクスの日別エクスポート(1行=1日)を取り込む。自社1アカウント前提で
--   date 一意・再投入=置換(upsert)。net_follows は生成列(新規-解除)。
-- =====================================================================
-- 設計方針:
--   - grain は (date)。冪等upsert（ON CONFLICT(date) DO UPDATE）。
--   - 全指標 nullable（null≠0 の既存方針）。net_follows は GENERATED STORED。
--   - 既存テーブル・既存行には一切触れない。CREATE のみ。
--     set_updated_at() は 001 のものを再利用。IF NOT EXISTS で再実行安全(冪等)。
-- =====================================================================

CREATE TABLE IF NOT EXISTS x_daily_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date            DATE NOT NULL,
  imp             INTEGER,   -- インプレッション数
  likes           INTEGER,   -- いいね
  engagements     INTEGER,   -- エンゲージメント
  bookmarks       INTEGER,   -- ブックマーク
  shares          INTEGER,   -- 共有された回数
  follows_gained  INTEGER,   -- 新しいフォロー
  unfollows       INTEGER,   -- フォロー解除
  net_follows     INTEGER GENERATED ALWAYS AS (follows_gained - unfollows) STORED,
  replies         INTEGER,   -- 返信
  reposts         INTEGER,   -- リポスト
  profile_visits  INTEGER,   -- プロフィールへのアクセス数
  posts_created   INTEGER,   -- ポストを作成
  video_views     INTEGER,   -- 動画再生数
  media_views     INTEGER,   -- メディアの再生数
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (date)              -- 冪等upsertのキー（自社1アカウント前提）
);

DROP TRIGGER IF EXISTS trg_xdm_updated ON x_daily_metrics;
CREATE TRIGGER trg_xdm_updated BEFORE UPDATE ON x_daily_metrics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_xdm_date ON x_daily_metrics (date);
