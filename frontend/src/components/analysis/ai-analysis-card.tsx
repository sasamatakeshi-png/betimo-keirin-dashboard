"use client";

// AI分析カード（共通）。entity_type / entity_id / screen_type を受け取り、
// 保存済みの最新分析を表示し、ログイン時は生成/再生成できる。
// - 取得(GET /results, /templates)は認証不要。
// - 生成(POST /run)は要ログイン（/ingest と同じ作法）。

import { useCallback, useEffect, useState } from "react";

import { LoginDialog } from "@/components/auth/login-dialog";
import { Markdown } from "@/components/markdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ApiError,
  getAnalysisResults,
  getAnalysisTemplates,
  runAnalysis,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import type { AnalysisEntityType, AnalysisResult } from "@/types/analysis";

export function AIAnalysisCard({
  entityType,
  entityId,
  screenType,
}: {
  entityType: AnalysisEntityType;
  entityId: string;
  screenType: string;
}) {
  const { canEdit, authRequired, probed } = useAuth();

  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);

  // 最新結果 + 有効テンプレを取得（どちらも認証不要）。
  const load = useCallback(() => {
    setLoading(true);
    return Promise.all([
      getAnalysisResults(entityType, entityId),
      getAnalysisTemplates(screenType),
    ])
      .then(([resPage, tplPage]) => {
        setResult(resPage.items[0] ?? null);
        const tpl = tplPage.items.find((t) => t.is_enabled) ?? tplPage.items[0];
        setTemplateId(tpl?.id ?? null);
        setLoadError(null);
      })
      .catch((e) => {
        setLoadError(e instanceof Error ? e.message : "分析の取得に失敗しました");
      })
      .finally(() => setLoading(false));
  }, [entityType, entityId, screenType]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRun() {
    if (!canEdit || running || !templateId) return;
    setRunning(true);
    setRunError(null);
    try {
      await runAnalysis({
        entity_type: entityType,
        entity_id: entityId,
        template_id: templateId,
        length: "medium",
      });
      await load();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) setRunError("ログインの有効期限が切れています。再ログインしてください");
        else if (e.status === 503) setRunError("AI分析が利用できません（APIキー未設定の可能性）");
        else setRunError(e.message);
      } else {
        setRunError(e instanceof Error ? e.message : "分析の生成に失敗しました");
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">AI分析</CardTitle>
        <div className="flex items-center gap-2">
          {authRequired === true && !canEdit && (
            <button
              type="button"
              onClick={() => setLoginOpen(true)}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
            >
              ログイン
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={!canEdit || running || !templateId || loading}
            className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {running ? "生成中…" : result ? "再生成" : "分析を生成"}
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {running && (
          <div className="rounded-md border border-blue-200 bg-blue-50/50 p-3 text-sm text-blue-700">
            AIが分析を生成しています…（30秒程度かかります）
          </div>
        )}
        {runError && (
          <div className="rounded-md border border-red-200 bg-red-50/50 p-3 text-sm text-red-600">
            {runError}
          </div>
        )}

        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">読み込み中…</div>
        ) : loadError ? (
          <div className="py-6 text-center text-sm text-muted-foreground">{loadError}</div>
        ) : result ? (
          <>
            <Markdown text={result.user_edits ?? result.generated_text} />
            <div className="pt-1 text-xs text-muted-foreground">
              生成日時: {formatDateTime(new Date(result.generated_at))}
            </div>
          </>
        ) : (
          <div className="py-6 text-center text-sm text-muted-foreground">
            まだAI分析がありません
            {!canEdit && probed && "（生成にはログインが必要です）"}
            {!templateId && canEdit && "（分析テンプレートが未登録です）"}
          </div>
        )}
      </CardContent>
      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
    </Card>
  );
}
