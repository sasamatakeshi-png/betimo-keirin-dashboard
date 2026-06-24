-- =====================================================================
-- 006. チャンネル全体の流入経路(トラフィックソース)基盤
--   流入経路系CSV(流入経路/外部流入/関連動画)を「対象月 × source_type × source_key」
--   で取り込み・上書き更新(upsert)する。動画別ではなくチャンネル全体集計。
-- =====================================================================
-- 設計方針:
--   - grain は (year_month, source_type, source_key)。再投入=置換(冪等upsert)。
--   - source_type: 'category'(流入経路の大カテゴリ) / 'external_url'(外部URL別)
--     / 'related_video'(関連動画別。source_key は接頭辞除去後の動画ID)。
--   - imp/ctr/view_count/avg_watch_seconds/total_watch_hours は全て nullable
--     (null≠0 の既存方針を踏襲)。ctr は 0〜1 の小数で格納。
--   - 既存テーブル(videos/events/metric_values/traffic_source_metrics 等)・既存行
--     には一切触れない。CREATE のみ。set_updated_at() は 001 のものを再利用。
--   - IF NOT EXISTS / DROP TRIGGER IF EXISTS で再実行安全(冪等)。
-- =====================================================================

CREATE TABLE IF NOT EXISTS channel_traffic_sources (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month        VARCHAR(7)  NOT NULL CHECK (year_month ~ '^[0-9]{4}-[0-9]{2}$'),  -- 'YYYY-MM'
  source_type       VARCHAR(20) NOT NULL
                    CHECK (source_type IN ('category','external_url','related_video')),
  source_key        VARCHAR(255) NOT NULL,   -- カテゴリ名 / 外部URL / 関連動画ID(接頭辞除去後)
  source_name       VARCHAR(500),            -- 表示名(関連動画のタイトル等)。無ければ NULL
  imp               BIGINT,                  -- インプレッション数
  ctr               NUMERIC(5,4),            -- インプレッションのクリック率 0〜1
  view_count        INTEGER,                 -- 視聴回数
  avg_watch_seconds INTEGER,                 -- 平均視聴時間(秒)
  total_watch_hours NUMERIC(12,4),           -- 総再生時間(時間)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (year_month, source_type, source_key)   -- 冪等upsertのキー
);

DROP TRIGGER IF EXISTS trg_cts_updated ON channel_traffic_sources;
CREATE TRIGGER trg_cts_updated BEFORE UPDATE ON channel_traffic_sources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_cts_year_month  ON channel_traffic_sources (year_month);
CREATE INDEX IF NOT EXISTS idx_cts_source_type ON channel_traffic_sources (source_type);
