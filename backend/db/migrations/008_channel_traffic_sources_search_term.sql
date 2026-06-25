-- =====================================================================
-- 008. channel_traffic_sources.source_type の CHECK 制約に 'search_term' を追加
-- =====================================================================
-- 背景:
--   YouTube検索キーワードCSV（トラフィックソース → YouTube検索 のエクスポート）を
--   「検索語 × 視聴回数」の内訳として取り込むため、source_type='search_term' を
--   新たに許可する。既存の external_url / related_video と同じ列構成に格納する。
--
-- 方針（後方互換・データ非破壊）:
--   - 既存の許可値（category / external_url / related_video）は残す。
--   - 'search_term' を「追加」するだけ（行データには一切触れない）。
--   - 006 では CHECK がインライン定義のため自動命名
--     （channel_traffic_sources_source_type_check）。その制約を入れ替える。
--   - DROP CONSTRAINT IF EXISTS で再実行安全（冪等）。新規DBで 001→008 を
--     通した最終状態は 4 値の CHECK となり、本マイグレーション適用後と一致する。
--   - ingestion_logs 側は変更不要（流入経路系の取り込みは source_type='csv' で
--     記録し、詳細は error_log JSON に持つ既存方式のため）。
-- =====================================================================

ALTER TABLE channel_traffic_sources
  DROP CONSTRAINT IF EXISTS channel_traffic_sources_source_type_check;

ALTER TABLE channel_traffic_sources
  ADD CONSTRAINT channel_traffic_sources_source_type_check
  CHECK (source_type IN (
    'category',
    'external_url',
    'related_video',
    'search_term'
  ));
