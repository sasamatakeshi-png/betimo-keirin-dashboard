-- =====================================================================
-- 004. channel_stats_daily — チャンネル全体の日次スナップショット
--   YouTube Data API (channels.list?part=statistics) で取得した
--   総登録者数 / 総再生数（生涯累計）を「日付 × チャンネル」で日次保存する。
--   ホームの数値カード「総登録者数 / 再生数」の累計を、この最新値で表示する。
-- =====================================================================
-- 設計方針（既存EAV・月次テーブルとは独立）:
--   - grain は (channel_id, snapshot_date)。snapshot_date は取得した日(JST)。
--   - subscriber_count / view_count は API statistics の「現在の累計値」
--     （= 生涯合計）。月次CSVの当月値/当月増とは意味が異なる別物。
--   - 1日1回・冪等。同日に複数回取得しても UNIQUE で1行に集約（DO UPDATE）。
--   - 毎日貯めることで「総登録者数の推移」が将来そのまま読める。
--   - 欠損は NULL（API が値を返さない/取得失敗時。0扱いしない方針を踏襲）。
--
-- 後方互換・データ非破壊:
--   - 既存テーブル(channels/videos/monthly_* 等)・既存行には一切触れない。
--   - 実施するのは「新テーブルの CREATE」のみ。
--   - IF NOT EXISTS / DROP ... IF EXISTS で再実行安全（冪等）。
--   - set_updated_at() は 001 で定義済みのものを再利用する。
--
-- 整合(再初期化):
--   001→002→003→004 を新規DBに通すと最終状態が一致する。
--   本ファイルは新テーブルを自己完結で定義するため 001/002/003 は編集しない。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 4-1. channel_stats_daily
--   自社チャンネルの「総登録者数・総再生数（累計値）」を日次1行で保存する。
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS channel_stats_daily (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id       UUID NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
  snapshot_date    DATE NOT NULL,                       -- 取得日(JST基準)
  subscriber_count BIGINT,                              -- statistics.subscriberCount（総登録者数）
  view_count       BIGINT,                              -- statistics.viewCount（総再生数=生涯累計）
  video_count      INT,                                 -- statistics.videoCount（任意）
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),  -- 実取得時刻（24h判定に使用）
  source           TEXT NOT NULL DEFAULT 'youtube_api',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, snapshot_date)                    -- 冪等upsertのキー
);
DROP TRIGGER IF EXISTS trg_csd_updated ON channel_stats_daily;
CREATE TRIGGER trg_csd_updated BEFORE UPDATE ON channel_stats_daily
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- 最新スナップショット参照・推移読み出し用（チャンネル別に日付降順）
CREATE INDEX IF NOT EXISTS idx_csd_lookup
  ON channel_stats_daily (channel_id, snapshot_date DESC);
