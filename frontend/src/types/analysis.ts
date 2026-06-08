// AI分析関連の型（backend/app/schemas/analysis.py に対応）。

export interface AnalysisTemplate {
  id: string;
  name: string;
  screen_type: string | null;
  prompt: string;
  reference_data_keys: string[];
  comparison_target: string | null;
  tone: string | null;
  length: string | null;
  is_default: boolean;
  is_enabled: boolean;
}

export interface AnalysisResult {
  id: string;
  template_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  generated_text: string;
  input_data_snapshot: Record<string, unknown> | null;
  user_edits: string | null;
  generated_at: string;
}

export interface AnalysisRunResult {
  id: string;
  generated_text: string;
}

export type AnalysisEntityType = "events" | "videos";
