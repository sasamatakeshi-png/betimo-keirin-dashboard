-- =====================================================================
-- Betimo KEIRIN Dashboard  DDL v1  (PostgreSQL 15+)
-- マルチエンティティ EAV モデル
--
-- 設計方針:
--   - マスタ層 / 定義層 / 値層 / AI層 / ログ層 の5レイヤ構成
--   - 値層は polymorphic EAV (entity_type, entity_id, metric_key)
--   - 指標は metric_definitions で動的に追加できる（コード変更不要）
--   - Phase 1 / Phase 2 をコメントで明示（schema は一括構築でも分割でも可）
--
-- 命名規則: snake_case / 単数形 type 値 / UTC(TIMESTAMPTZ)
-- 前提拡張: pgcrypto (gen_random_uuid)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 共通: updated_at 自動更新トリガ関数
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- =====================================================================
-- 0. 認証 (Phase 1: 最小構成)
--    Phase 1 は環境変数パスワード認証のため users は実質1行でも可。
--    将来のチーム展開(5-10名)と created_by FK のために最初から用意する。
-- =====================================================================
CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  email        TEXT UNIQUE,
  role         TEXT NOT NULL DEFAULT 'member',  -- admin / member
  is_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- 1. マスタ層
-- =====================================================================

-- 1-1. channels --------------------------------------------------------
CREATE TABLE channels (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  youtube_channel_id          TEXT UNIQUE NOT NULL,
  name                        TEXT NOT NULL,
  handle                      TEXT,                       -- @xxxx
  is_own                      BOOLEAN NOT NULL DEFAULT FALSE,
  is_default_competitor       BOOLEAN NOT NULL DEFAULT FALSE,  -- 初期競合(削除不可)
  is_enabled                  BOOLEAN NOT NULL DEFAULT TRUE,   -- 監視有効
  keyword_filter              TEXT[] NOT NULL DEFAULT '{}',    -- 例 {競輪,KEIRIN,けいりん}
  monitoring_interval_minutes INT NOT NULL DEFAULT 60,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_channels_updated BEFORE UPDATE ON channels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 1-2. events (レース開催) ---------------------------------------------
CREATE TABLE events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,            -- 「第80回 日本選手権競輪」等
  venue       TEXT,                     -- 平塚 等
  grade       TEXT,                     -- G1/G2/G3/F1/F2
  start_date  DATE,
  end_date    DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_events_updated BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_events_dates ON events (start_date, end_date);

-- 1-3. videos ----------------------------------------------------------
CREATE TABLE videos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  youtube_video_id  TEXT UNIQUE,                 -- NULL可: 動画ID無しの保持行(GP前々夜祭等)
  channel_id        UUID NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
  event_id          UUID REFERENCES events(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  published_at      TIMESTAMPTZ,                 -- actualStartTime優先, JST→UTC格納
  duration_seconds  INT,
  venue             TEXT,                        -- 競輪場
  grade             TEXT,                        -- G1/G2/G3/F1/F2
  title_tag         TEXT,                        -- 冠タイトル
  program_type      TEXT,                        -- BKL/あす勝ち/ナイター/ミッドナイト/プレミアムトーク/Bar/その他(拡張のため自由値)
  cast_members      TEXT[] NOT NULL DEFAULT '{}',-- 出演者リスト
  thumbnail_url     TEXT,
  is_competitor     BOOLEAN NOT NULL DEFAULT FALSE,
  content_type      TEXT NOT NULL DEFAULT 'regular'
                    CHECK (content_type IN ('regular','short')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_videos_updated BEFORE UPDATE ON videos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_videos_channel       ON videos (channel_id);
CREATE INDEX idx_videos_event         ON videos (event_id);
CREATE INDEX idx_videos_published     ON videos (published_at);
CREATE INDEX idx_videos_program_type  ON videos (program_type);
CREATE INDEX idx_videos_competitor    ON videos (is_competitor);

-- 1-4. x_accounts  [Phase 2] ------------------------------------------
CREATE TABLE x_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle        TEXT UNIQUE NOT NULL,   -- @xxxx
  display_name  TEXT,
  is_own        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_x_accounts_updated BEFORE UPDATE ON x_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 1-5. traffic_sources  [Phase 2 で本格利用] ---------------------------
CREATE TABLE traffic_sources (
  id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key    TEXT UNIQUE NOT NULL,    -- browsing/youtube_search/related/external 等
  label  TEXT NOT NULL
);


-- =====================================================================
-- 2. 定義層
-- =====================================================================

CREATE TABLE metric_definitions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key                TEXT UNIQUE NOT NULL,     -- imp / view_count / max_concurrent_viewers 等
  label              TEXT NOT NULL,            -- 表示名
  unit               TEXT,                     -- 回 / 人 / % / 秒 等
  entity_type        TEXT NOT NULL
                     CHECK (entity_type IN ('videos','channels','x_accounts')),
  category           TEXT,                     -- reach / engagement / loyalty
  aggregation_period TEXT,                     -- lifetime / 90d / daily / live
  display_order      INT NOT NULL DEFAULT 0,
  formula            TEXT,                     -- 計算式(計算指標のみ)
  is_computed        BOOLEAN NOT NULL DEFAULT FALSE,
  is_enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_metric_def_updated BEFORE UPDATE ON metric_definitions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_metric_def_entity ON metric_definitions (entity_type, display_order);


-- =====================================================================
-- 3. 値層 (EAV)
--   polymorphic FK のため entity_id には物理FKを張らない(整合性はアプリ層)。
--   値の意味/単位は metric_definitions.key に従う。
--   - 数値は NUMERIC(精度ロスを避ける)
--   - 割合(平均再生率/リピーター比率)は 0〜1 の小数で格納
--   - 時間(平均視聴時間)は「秒」で格納し表示側で h:mm:ss 整形
-- =====================================================================

-- 3-1. metric_values (スナップショット値) ------------------------------
CREATE TABLE metric_values (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  TEXT NOT NULL
               CHECK (entity_type IN ('videos','channels','x_accounts')),
  entity_id    UUID NOT NULL,
  metric_key   TEXT NOT NULL REFERENCES metric_definitions(key) ON UPDATE CASCADE,
  value        NUMERIC NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source       TEXT NOT NULL DEFAULT 'manual'
               CHECK (source IN ('api','csv','pdf','manual')),
  source_file  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 完全重複(同一エンティティ・指標・時刻・取得元)を防止。
  -- 時系列スナップショットは recorded_at が異なれば複数保持できる。
  UNIQUE (entity_type, entity_id, metric_key, recorded_at, source)
);
CREATE INDEX idx_mv_lookup ON metric_values (entity_type, entity_id, metric_key, recorded_at DESC);
CREATE INDEX idx_mv_metric ON metric_values (metric_key);

-- 各エンティティ×指標の「最新値」を引くためのビュー(全データ一覧/KPI用)
CREATE VIEW latest_metric_values AS
SELECT DISTINCT ON (entity_type, entity_id, metric_key)
       entity_type, entity_id, metric_key, value, recorded_at, source, source_file
FROM   metric_values
ORDER  BY entity_type, entity_id, metric_key, recorded_at DESC;

-- 3-2. metric_timeseries (時系列: 同接/チャット) -----------------------
CREATE TABLE metric_timeseries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     TEXT NOT NULL DEFAULT 'videos'
                  CHECK (entity_type IN ('videos','channels','x_accounts')),
  entity_id       UUID NOT NULL,
  metric_key      TEXT NOT NULL REFERENCES metric_definitions(key) ON UPDATE CASCADE,
  elapsed_seconds INT NOT NULL,              -- 動画開始からの秒数(時系列重ね合わせ用)
  value           NUMERIC NOT NULL,
  recorded_at     TIMESTAMPTZ,               -- 実際の取得時刻
  source          TEXT NOT NULL DEFAULT 'csv'
                  CHECK (source IN ('api','csv','pdf','manual')),
  UNIQUE (entity_type, entity_id, metric_key, elapsed_seconds)
);
CREATE INDEX idx_ts_lookup ON metric_timeseries (entity_id, metric_key, elapsed_seconds);

-- 3-3. demographic_snapshots (視聴者属性)  [Phase 2] -------------------
CREATE TABLE demographic_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  TEXT NOT NULL
               CHECK (entity_type IN ('videos','channels')),
  entity_id    UUID NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  data         JSONB NOT NULL,    -- 年齢/性別/地域/デバイス等を柔軟に格納
  source       TEXT NOT NULL DEFAULT 'csv'
);
CREATE INDEX idx_demo_lookup ON demographic_snapshots (entity_type, entity_id, recorded_at DESC);
CREATE INDEX idx_demo_data   ON demographic_snapshots USING GIN (data);

-- 3-4. traffic_source_metrics  [Phase 2] ------------------------------
CREATE TABLE traffic_source_metrics (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id                 UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  traffic_source_id        UUID NOT NULL REFERENCES traffic_sources(id) ON DELETE RESTRICT,
  view_count               INT,
  avg_watch_time_seconds   INT,
  total_watch_time_seconds BIGINT,
  recorded_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (video_id, traffic_source_id, recorded_at)
);
CREATE INDEX idx_tsm_video ON traffic_source_metrics (video_id);


-- =====================================================================
-- 4. AI分析層
-- =====================================================================

CREATE TABLE analysis_templates (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  screen_type          TEXT,                  -- event_detail / video_detail 等
  prompt               TEXT NOT NULL,
  reference_data_keys  TEXT[] NOT NULL DEFAULT '{}',
  comparison_target    TEXT,
  tone                 TEXT,                  -- 事実重視 / 分析重視 / 経営目線
  length               TEXT,                  -- short / medium / long
  is_default           BOOLEAN NOT NULL DEFAULT FALSE,  -- システム標準
  is_enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_analysis_tmpl_updated BEFORE UPDATE ON analysis_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE analysis_results (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id          UUID REFERENCES analysis_templates(id) ON DELETE SET NULL, -- 一時実行はNULL
  entity_type          TEXT,
  entity_id            UUID,
  generated_text       TEXT NOT NULL,
  input_data_snapshot  JSONB,                 -- 投入データの記録(再現性)
  user_edits           TEXT,                  -- ユーザー編集版
  generated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_results_entity   ON analysis_results (entity_type, entity_id);
CREATE INDEX idx_results_template ON analysis_results (template_id);


-- =====================================================================
-- 5. ログ層
-- =====================================================================

CREATE TABLE ingestion_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type        TEXT NOT NULL
                     CHECK (source_type IN ('youtube_api','csv','pdf','zip')),
  file_name          TEXT,
  records_processed  INT NOT NULL DEFAULT 0,
  records_failed     INT NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'success'
                     CHECK (status IN ('success','partial','failed')),
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  error_log          JSONB
);
CREATE INDEX idx_ingestion_started ON ingestion_logs (started_at DESC);


-- =====================================================================
-- 6. SEED: traffic_sources (Phase 2 用基本セット)
-- =====================================================================
INSERT INTO traffic_sources (key, label) VALUES
  ('browsing',        'ブラウジング機能'),
  ('youtube_search',  'YouTube検索'),
  ('related',         '関連動画'),
  ('external',        '外部'),
  ('channel_page',    'チャンネルページ'),
  ('notifications',   '通知'),
  ('playlist',        '再生リスト'),
  ('direct',          '直接/不明')
ON CONFLICT (key) DO NOTHING;


-- =====================================================================
-- 7. SEED: metric_definitions
--    既存 番組数字サマリ(16列) のうち、動画マスタ属性5列
--    (日時/レース名/番組種別/出演/動画ID) を除く 11 の数値列を定義。
--    + 90日系の補助指標(新規/リピーター)、+ 時系列指標、+ チャンネル指標。
-- =====================================================================
INSERT INTO metric_definitions
  (key, label, unit, entity_type, category, aggregation_period, display_order, formula, is_computed) VALUES
  -- ---- videos: reach(全期間/90日) ----
  ('imp',                     'imp',          '回', 'videos', 'reach',      'lifetime', 1,  NULL, FALSE),
  ('view_count',              '再生数',        '回', 'videos', 'reach',      'lifetime', 2,  NULL, FALSE),
  ('subscriber_gain',         '登録数',        '人', 'videos', 'reach',      'lifetime', 3,  NULL, FALSE),
  ('unique_viewers',          'UU数',          '人', 'videos', 'reach',      '90d',      4,  NULL, FALSE),
  ('live_views',              'ライブ視聴',     '回', 'videos', 'reach',      'lifetime', 5,  NULL, FALSE),
  ('archive_views',           'アーカイブ視聴', '回', 'videos', 'reach',      'lifetime', 6,  NULL, FALSE),
  -- ---- videos: engagement ----
  ('avg_concurrent_viewers',  '平均同接',       '人', 'videos', 'engagement', 'live',     7,  NULL, FALSE),
  ('max_concurrent_viewers',  '最大同接',       '人', 'videos', 'engagement', 'live',     8,  NULL, FALSE),
  ('avg_view_duration',       '平均視聴時間',   '秒', 'videos', 'engagement', 'lifetime', 9,  NULL, FALSE),
  ('avg_view_percentage',     '平均再生率',     '%',  'videos', 'engagement', 'lifetime', 10, NULL, FALSE),
  -- ---- videos: loyalty(90日) ----
  ('new_viewers',             '新規ユーザー',   '人', 'videos', 'loyalty',    '90d',      11, NULL, FALSE),
  ('repeat_viewers',          'リピーター',     '人', 'videos', 'loyalty',    '90d',      12, NULL, FALSE),
  ('repeater_ratio',          'リピーター比率', '%',  'videos', 'loyalty',    '90d',      13,
     'repeat_viewers / unique_viewers', TRUE),
  -- ---- videos: timeseries(時系列重ね合わせ用) ----
  ('concurrent_viewers',      '同時接続数',     '人', 'videos', 'engagement', 'live',     20, NULL, FALSE),
  ('chat_count',              'チャット数(累計)','件','videos', 'engagement', 'live',     21, NULL, FALSE),
  -- ---- channels ----
  ('subscriber_count',        'チャンネル登録者数','人','channels','reach',    'daily',    1,  NULL, FALSE)
ON CONFLICT (key) DO NOTHING;

-- =====================================================================
-- 以上。Phase 2 で x_accounts 系指標(followers / impressions / engagements)を追加予定。
-- =====================================================================
