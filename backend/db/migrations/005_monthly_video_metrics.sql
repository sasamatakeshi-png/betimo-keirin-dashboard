-- =====================================================================
-- 005. 月次・動画別データ基盤 (monthly_video_metrics)
--   WebCM切り出し 第1段階。「月 × 動画」ごとの明細を参照用に保持する。
--   当面の用途: タイトルに "WebCM" を含む動画(=広告)を月別に集計し、
--   ホームの再生数から WebCM を除く/込むを切り替える材料にする。
--   将来: 番組別の月次比較へ発展（汎用の月次動画テーブルとして設計）。
-- =====================================================================
-- 位置づけ（データの正）:
--   - 数値の「正」は従来どおり monthly_channel_metrics（月次集計CSVの合計行）。
--   - 本テーブルは「月別の動画明細」を持つ参照用。合計を置き換えるものではない。
--
-- 後方互換・データ非破壊:
--   - 既存テーブル(videos/metric_values/monthly_* 等)・既存行には一切触れない。
--   - 実施するのは「新テーブルのCREATE」と「ingestion_logs CHECK 定義の入れ替え」のみ。
--   - IF NOT EXISTS / DROP ... IF EXISTS で再実行安全（冪等）。
--   - set_updated_at() は 001 で定義済みのものを再利用する。
--
-- 整合(再初期化):
--   001→002→003→004→005 を新規DBに通すと、ingestion_logs の CHECK は
--   本ファイルが全9値で再定義するため最終状態が一致する。001〜004 は編集しない。
--
-- youtube_video_id が NULL の行の扱い（重要・設計判断）:
--   一意制約 UNIQUE(channel_id, year_month, youtube_video_id) は、PostgreSQL の
--   既定で NULL を互いに「異なる」と見なすため、NULL 行は冪等 upsert が効かず
--   再取込で重複し得る。動画別CSVでは実動画行に必ず先頭列「コンテンツID」が入り、
--   先頭の合計行のみ ID 空になる。合計行は取り込み側でスキップするため、
--   本テーブルに入るのは youtube_video_id を持つ行だけになる前提。
--   → 列は将来の手入力余地のため NULL 許容のままにするが、CSV取り込み経路は
--      ID 空の行を取り込まない（= 合計行除外）方針とし、冪等性を担保する。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 5-1. monthly_video_metrics
--   動画別CSV（YouTube Studio のコンテンツ別エクスポート）の各動画行を
--   「対象月 × 動画」で 1 レコード保存する。合計行は保存しない。
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_video_metrics (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id                UUID NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
  year_month                TEXT NOT NULL CHECK (year_month ~ '^[0-9]{4}-[0-9]{2}$'),  -- 'YYYY-MM'
  youtube_video_id          TEXT,            -- 動画別CSV先頭列(コンテンツID)。NULL可（取込経路では非NULL）
  title                     TEXT,
  published_at              TIMESTAMPTZ,     -- 動画公開時刻（JST→UTC格納）。空欄可
  content_label             TEXT,            -- CSVの「長さ」等の補助ラベル（あれば。無ければNULL）
  is_ad                     BOOLEAN NOT NULL DEFAULT FALSE,  -- title に "WebCM" を含むか（取込時判定）
  -- ---- 動画別の月次指標（全列 nullable。欠損は NULL = 0扱いしない） ----
  view_count                BIGINT,          -- 視聴回数
  impressions               BIGINT,          -- インプレッション数
  total_watch_time_hours    NUMERIC,         -- 総再生時間(時間)
  unique_viewers            BIGINT,          -- ユニーク視聴者数
  new_viewers               BIGINT,          -- 新しい視聴者数
  repeat_viewers            BIGINT,          -- リピーター
  avg_view_duration_seconds NUMERIC,         -- 平均視聴時間（秒）
  avg_view_percentage       NUMERIC,         -- 平均視聴率(%)  ※生の%値(例 45.2)
  source                    TEXT NOT NULL DEFAULT 'monthly_video_csv',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 冪等upsertのキー（同じ月・同じ動画を再取込したら上書き）
  CONSTRAINT monthly_video_metrics_uq UNIQUE (channel_id, year_month, youtube_video_id)
);
DROP TRIGGER IF EXISTS trg_mvm_updated ON monthly_video_metrics;
CREATE TRIGGER trg_mvm_updated BEFORE UPDATE ON monthly_video_metrics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 集計しやすいインデックス
CREATE INDEX IF NOT EXISTS idx_mvm_channel_month ON monthly_video_metrics (channel_id, year_month);
CREATE INDEX IF NOT EXISTS idx_mvm_month_ad      ON monthly_video_metrics (year_month, is_ad);


-- ---------------------------------------------------------------------
-- 5-2. ingestion_logs.source_type の CHECK に動画別月次を追加
--   003 と同じ手順（DROP→ADD、行データには触れない）。
--   変更前(8値): 003 で定義した8値
--   変更後(9値): 上記8 + monthly_video_csv
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
    'monthly_demographics_csv',
    'monthly_video_csv'
  ));
