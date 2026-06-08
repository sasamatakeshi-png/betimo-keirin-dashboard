-- =====================================================================
-- 002. ingestion_logs.source_type の CHECK 制約にショート取り込み種別を追加
-- =====================================================================
-- 背景:
--   ショートCSV取り込み(ingest_short_csv)は source_type に
--   'short_zenkikan_csv' / 'short_90d_csv' を記録するが、初期スキーマ(001)の
--   CHECK では許可されておらず、履歴INSERTが CheckViolation(500) になる。
--
-- 方針（後方互換・データ非破壊）:
--   - 既存の許可値（youtube_api / csv / pdf / zip）は残す。
--   - ショート種別 2値を「追加」する。
--   - 制約名は 001 と同じ ingestion_logs_source_type_check を維持。
--   - 行データには一切触れない（制約定義の入れ替えのみ）。
-- =====================================================================

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
    'short_90d_csv'
  ));
