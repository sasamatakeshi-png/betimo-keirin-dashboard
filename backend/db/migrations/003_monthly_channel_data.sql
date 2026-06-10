-- =====================================================================
-- 003. 月次・チャンネル全体データ基盤
--   ホーム刷新（チャンネル全体サマリ + 月次推移 + 性別年齢）の土台。
--   月次CSV(数値/デモグラ)を「対象月 × segment」で取り込み・上書き更新する。
-- =====================================================================
-- 設計方針（既存EAVは流用しない）:
--   - grain は (channel_id, year_month, segment)。専用テーブルで第一級カラム化。
--   - segment は 'all'(全体) / 'live'(ライブ) / 'short'(ショート)。
--     全体は ライブ+ショート の足し算ではなく、全体CSVの実測を独立保存する。
--   - % は生の百分率(例 45.2)のまま格納。/100 しない。
--   - 数値の欠損は NULL（null≠0 の既存方針を踏襲。全指標列 nullable）。
--
-- 後方互換・データ非破壊:
--   - 既存テーブル(videos/events/metric_values 等)・既存行には一切触れない。
--   - 実施するのは「新テーブルのCREATE」と「ingestion_logs CHECK 定義の入れ替え」のみ。
--   - IF NOT EXISTS / DROP CONSTRAINT IF EXISTS で再実行安全（冪等）。
--   - set_updated_at() は 001 で定義済みのものを再利用する。
--
-- 整合(再初期化):
--   001→002→003 を新規DBに通すと、ingestion_logs の CHECK は本ファイルが
--   全8値で再定義するため最終状態が一致する。001/002 は編集しない。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 3-1. monthly_channel_metrics
--   数値CSVの【合計行】のみを、その月・その segment の
--   チャンネル全体実績として 1 レコード保存する。
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_channel_metrics (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id                UUID NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
  year_month                TEXT NOT NULL CHECK (year_month ~ '^[0-9]{4}-[0-9]{2}$'),  -- 'YYYY-MM'
  segment                   TEXT NOT NULL CHECK (segment IN ('all','live','short')),
  -- ---- 合計行の10指標（全列 nullable。欠損は NULL = 0扱いしない） ----
  avg_view_duration_seconds INT,            -- 平均視聴時間（秒で格納）
  avg_view_percentage       NUMERIC,        -- 平均視聴率(%)  ※生の%値(例 45.2)
  unique_viewers            INT,            -- ユニーク視聴者数
  new_viewers               INT,            -- 新しい視聴者数
  repeat_viewers            INT,            -- リピーター
  view_count                BIGINT,         -- 視聴回数
  total_watch_time_hours    NUMERIC,        -- 総再生時間(時間)
  subscribers               INT,            -- チャンネル登録者（CSVの当月値）
  impressions               BIGINT,         -- インプレッション数
  impressions_ctr           NUMERIC,        -- インプレッションのクリック率(%)  ※生の%値
  source_file               TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, year_month, segment)   -- 冪等upsertのキー
);
DROP TRIGGER IF EXISTS trg_mcm_updated ON monthly_channel_metrics;
CREATE TRIGGER trg_mcm_updated BEFORE UPDATE ON monthly_channel_metrics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_mcm_lookup ON monthly_channel_metrics (segment, year_month);


-- ---------------------------------------------------------------------
-- 3-2. monthly_demographics
--   性別年齢CSVの各行 = 年齢層 × 性別 × 視聴回数(%) × 総再生時間(%)。
--   その月・その segment のデモグラ分布を保存する。
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_demographics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
  year_month      TEXT NOT NULL CHECK (year_month ~ '^[0-9]{4}-[0-9]{2}$'),
  segment         TEXT NOT NULL CHECK (segment IN ('all','live','short')),
  age_band        TEXT NOT NULL,           -- '13-17' '18-24' '25-34' ... '65-'
  gender          TEXT NOT NULL CHECK (gender IN ('male','female','other')),
  views_pct       NUMERIC,                 -- 視聴回数(%)        ※生の%値
  watch_time_pct  NUMERIC,                 -- 総再生時間(%)      ※生の%値
  source_file     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, year_month, segment, age_band, gender)
);
DROP TRIGGER IF EXISTS trg_mdemo_updated ON monthly_demographics;
CREATE TRIGGER trg_mdemo_updated BEFORE UPDATE ON monthly_demographics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_mdemo_lookup ON monthly_demographics (segment, year_month);


-- ---------------------------------------------------------------------
-- 3-3. ingestion_logs.source_type の CHECK に月次2種別を追加
--   002 と同じ手順（DROP→ADD、行データには触れない）。
--   変更前(6値): youtube_api / csv / pdf / zip / short_zenkikan_csv / short_90d_csv
--   変更後(8値): 上記6 + monthly_metrics_csv + monthly_demographics_csv
-- ---------------------------------------------------------------------
ALTER TABLE ingestion_logs
  DROP CONSTRAINT IF EXISTS ingestion_logs_source_type_check;

ALTER TABLE ingestion_logs
  ADD CONSTRAINT ingestion_logs_source_type_check
  CHECK (source_type IN (
    'youtube_api',
    'csv',
    'pdf',
    'zip',
    'short_zenkikan_csv',
    'short_90d_csv',
    'monthly_metrics_csv',
    'monthly_demographics_csv'
  ));
