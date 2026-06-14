"use client";

// ホーム: 月次データ基盤でチャンネル全体を俯瞰する。
//  サマリ5枚 → 月次推移グラフ → 月次データ表 → 性別年齢グラフ → 直近イベント → 取得状況。
//  推移グラフと表は segment を共有（連動）。性別年齢は独立 segment。
//  既存 /api/dashboard/home は直近イベント・取得状況の取得に引き続き使用。

import { useCallback, useEffect, useState } from "react";

import { IngestionStatusList } from "@/components/dashboard/ingestion-status";
import { MonthlyDemographicsChart } from "@/components/dashboard/monthly-demographics-chart";
import { MonthlySummaryCards } from "@/components/dashboard/monthly-summary-cards";
import { MonthlyTable } from "@/components/dashboard/monthly-table";
import { MonthlyTrendChart } from "@/components/dashboard/monthly-trend-chart";
import { RecentEventsList } from "@/components/dashboard/recent-events";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getChannelStats,
  getDashboardHome,
  getMonthlyDemographics,
  getMonthlyMetrics,
  getMonthlyVideoCounts,
  getWebcmMonthly,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { adjustMetricsForWebcm, type WebcmMode } from "@/lib/webcm";
import type {
  ChannelStatsResponse,
  HomeResponse,
  MonthlyDemographicsResponse,
  MonthlyMetricPoint,
  MonthlySegment,
  MonthlyVideoCountPoint,
  WebcmMonthlyResponse,
} from "@/types/dashboard";

const SEGMENTS: { key: MonthlySegment; label: string }[] = [
  { key: "all", label: "全体" },
  { key: "live", label: "ライブ" },
  { key: "short", label: "ショート" },
];

// 推移グラフ・月次表の期間フィルタ。months は直近 N ヶ月、all は全期間。
type PeriodKey = "6m" | "12m" | "all";
const PERIODS: { key: PeriodKey; label: string; months: number | null }[] = [
  { key: "6m", label: "直近6ヶ月", months: 6 },
  { key: "12m", label: "直近12ヶ月", months: 12 },
  { key: "all", label: "全期間", months: null },
];

// year_month 昇順の配列から、期間フィルタに応じて末尾 N 件（=直近 N ヶ月）を返す。
function slicePeriod<T>(items: T[], period: PeriodKey): T[] {
  const n = PERIODS.find((p) => p.key === period)?.months ?? null;
  return n == null ? items : items.slice(-n);
}

// 'YYYY-MM' → '2026年3月'
function ymSelectLabel(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  return m ? `${Number(m[1])}年${Number(m[2])}月` : ym;
}

interface HomeData {
  metrics: Record<MonthlySegment, MonthlyMetricPoint[]>;
  demographics: Record<MonthlySegment, MonthlyDemographicsResponse>;
  counts: MonthlyVideoCountPoint[];
  home: HomeResponse;
  // 総登録者数・総再生数の最新スナップショット（取得不可なら null＝CSV値で表示）
  channelStats: ChannelStatsResponse | null;
  // WebCM（広告）の月別・指標別合計（取得不可なら null＝「込む」にフォールバック）
  webcm: WebcmMonthlyResponse | null;
}

export default function HomePage() {
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mAll, mLive, mShort, dAll, dLive, dShort, counts, home, channelStats, webcm] =
        await Promise.all([
          getMonthlyMetrics("all"),
          getMonthlyMetrics("live"),
          getMonthlyMetrics("short"),
          getMonthlyDemographics("all"),
          getMonthlyDemographics("live"),
          getMonthlyDemographics("short"),
          getMonthlyVideoCounts(),
          getDashboardHome(),
          // YouTube 取得（遅延更新つき）は失敗してもホーム全体を落とさない
          getChannelStats().catch(() => null),
          // WebCM 集計の取得失敗もホーム全体を落とさない（null＝「込む」表示）
          getWebcmMonthly().catch(() => null),
        ]);
      setData({
        metrics: { all: mAll.items, live: mLive.items, short: mShort.items },
        demographics: { all: dAll, live: dLive, short: dShort },
        counts: counts.items,
        home,
        channelStats,
        webcm,
      });
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Betimo KEIRIN Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ホーム ・ 自社チャンネルの月次サマリ（2025年11月〜）
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          更新: {updatedAt ? formatDateTime(updatedAt) : "—"}
        </span>
      </header>

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : loading ? (
        <LoadingState />
      ) : data ? (
        <DashboardContent data={data} />
      ) : null}
    </main>
  );
}

function DashboardContent({ data }: { data: HomeData }) {
  // データのある月（year_month 昇順）。対象月セレクタの選択肢。
  const months = data.metrics.all.map((m) => m.year_month);
  const latestMonth = months.at(-1) ?? null;

  // --- 対象月セレクタ（単月で見るもの＝数値カード単月・性別年齢に連動） ---
  const [selectedMonth, setSelectedMonth] = useState<string | null>(latestMonth);

  // --- 推移用コントロール（推移グラフ・表に連動） ---
  const [segment, setSegment] = useState<MonthlySegment>("all"); // 全体/ライブ/ショート
  const [period, setPeriod] = useState<PeriodKey>("all"); // 期間フィルタ

  // --- WebCM（広告）除外トグル（ホーム全体に連動。既定=除く） ---
  const [webcmMode, setWebcmMode] = useState<WebcmMode>("exclude");
  const excludeWebcm = webcmMode === "exclude";
  // WebCM 差し引きは加算的に正しい segment='all' のみ適用（live/short は対象外）。
  const segmentAdjustable = segment === "all";
  const webcmActive = excludeWebcm && data.webcm != null;

  // 性別年齢: 対象月ごとにキャッシュ。初期ロード分（最新月）を初期値に。
  const initialDemoMonth = data.demographics.all.year_month;
  const [demoByMonth, setDemoByMonth] = useState<
    Record<string, Record<MonthlySegment, MonthlyDemographicsResponse>>
  >(initialDemoMonth ? { [initialDemoMonth]: data.demographics } : {});
  const [demoLoading, setDemoLoading] = useState(false);

  // 対象月が未キャッシュなら 3 segment 分をまとめて追加フェッチ
  useEffect(() => {
    if (!selectedMonth || demoByMonth[selectedMonth]) return;
    let cancelled = false;
    setDemoLoading(true);
    void Promise.all([
      getMonthlyDemographics("all", selectedMonth),
      getMonthlyDemographics("live", selectedMonth),
      getMonthlyDemographics("short", selectedMonth),
    ])
      .then(([all, live, short]) => {
        if (cancelled) return;
        setDemoByMonth((prev) => ({ ...prev, [selectedMonth]: { all, live, short } }));
      })
      .finally(() => {
        if (!cancelled) setDemoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedMonth, demoByMonth]);

  const segMetrics = data.metrics[segment];
  // 推移グラフ・表用: segment='all' かつ「除く」のとき各月から WebCM 分を差し引く。
  const adjustedSegMetrics = adjustMetricsForWebcm(
    segMetrics,
    data.webcm,
    webcmMode,
    segmentAdjustable,
  );
  const trendItems = slicePeriod(adjustedSegMetrics, period);
  // 数値カードは常に segment='all'。「除く」のとき WebCM を差し引いた all を渡す。
  const cardMetrics = adjustMetricsForWebcm(
    data.metrics.all,
    data.webcm,
    webcmMode,
    true,
  );
  const currentDemo = selectedMonth ? demoByMonth[selectedMonth] : undefined;

  return (
    <div className="space-y-6">
      {/* 0a. WebCM（広告）除外トグル（ホーム全体に連動・既定=除く） */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3">
        <span className="text-sm font-medium">WebCM（広告）</span>
        <WebcmToggle mode={webcmMode} onChange={setWebcmMode} />
        <span className="text-xs text-muted-foreground">
          {excludeWebcm
            ? "※WebCM（広告）経由の再生を除いた数値です（再生数・総再生時間が対象）"
            : "WebCM（広告）経由の再生を含む実数値です"}
          {excludeWebcm && data.webcm == null && "（WebCMデータ取得不可のため実数表示）"}
        </span>
      </div>

      {/* 0b. 対象月セレクタ（単月で見るもの＝数値カード単月・性別年齢に連動） */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
        <span className="text-sm font-medium">対象月</span>
        <MonthSelector months={months} value={selectedMonth} onChange={setSelectedMonth} />
        <span className="text-xs text-muted-foreground">
          数値カードの「単月」と「性別・年齢」に反映（累計・月次推移には影響しません）
        </span>
      </div>

      {/* 1. チャンネル全体サマリ（累計=全期間固定 + 単月=対象月） */}
      <MonthlySummaryCards
        metrics={cardMetrics}
        counts={data.counts}
        channelStats={data.channelStats}
        selectedMonth={selectedMonth}
        excludeWebcm={webcmActive}
      />

      {/* 2-3. 月次推移グラフ + データ表（segment + 期間フィルタ連動。対象月とは無関係） */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">月次推移</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                全期間の推移（期間フィルタで範囲調整）
                {webcmActive && segmentAdjustable && "・再生数/総再生時間はWebCM除く"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <PeriodToggle period={period} onChange={setPeriod} />
              <SegmentToggle segment={segment} onChange={setSegment} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <MonthlyTrendChart
            items={trendItems}
            webcmAdjusted={webcmActive && segmentAdjustable}
          />
          <div>
            <div className="mb-2 text-sm font-medium text-muted-foreground">月次データ一覧</div>
            <MonthlyTable
              items={trendItems}
              webcmAdjusted={webcmActive && segmentAdjustable}
            />
          </div>
        </CardContent>
      </Card>

      {/* 4. 性別・年齢（対象月に連動、segment は独立） */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">視聴者の性別・年齢</CardTitle>
        </CardHeader>
        <CardContent>
          <MonthlyDemographicsChart
            dataBySegment={currentDemo}
            loading={demoLoading}
            yearMonth={selectedMonth}
          />
        </CardContent>
      </Card>

      {/* 5-6. 直近イベント / 取得状況（既存流用） */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">直近イベント</CardTitle>
          </CardHeader>
          <CardContent>
            <RecentEventsList events={data.home.recent_events} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">取得状況</CardTitle>
          </CardHeader>
          <CardContent>
            <IngestionStatusList items={data.home.ingestion_status} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function SegmentToggle({
  segment,
  onChange,
}: {
  segment: MonthlySegment;
  onChange: (s: MonthlySegment) => void;
}) {
  return (
    <div className="inline-flex rounded-md border p-0.5">
      {SEGMENTS.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => onChange(s.key)}
          className={`rounded px-3 py-1 text-sm transition-colors ${
            segment === s.key ? "bg-blue-600 text-white" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

// WebCM（広告）除外トグル。既定=除く。ホーム全体の再生数系指標に連動。
function WebcmToggle({
  mode,
  onChange,
}: {
  mode: WebcmMode;
  onChange: (m: WebcmMode) => void;
}) {
  const opts: { key: WebcmMode; label: string }[] = [
    { key: "exclude", label: "WebCM除く" },
    { key: "include", label: "WebCM込む" },
  ];
  return (
    <div className="inline-flex rounded-md border border-amber-300 p-0.5">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`rounded px-3 py-1 text-sm transition-colors ${
            mode === o.key
              ? "bg-amber-600 text-white"
              : "text-muted-foreground hover:bg-amber-100"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// 対象月セレクタ（プルダウン）。選択肢は降順（最新月が先頭）で見せる。
function MonthSelector({
  months,
  value,
  onChange,
}: {
  months: string[];
  value: string | null;
  onChange: (ym: string) => void;
}) {
  const options = [...months].reverse(); // 最新月を先頭に
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border bg-background px-3 py-1.5 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {options.map((ym) => (
        <option key={ym} value={ym}>
          {ymSelectLabel(ym)}
        </option>
      ))}
    </select>
  );
}

// 期間フィルタ（推移グラフ・月次表で共有）。
function PeriodToggle({
  period,
  onChange,
}: {
  period: PeriodKey;
  onChange: (p: PeriodKey) => void;
}) {
  return (
    <div className="inline-flex rounded-md border p-0.5">
      {PERIODS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onChange(p.key)}
          className={`rounded px-3 py-1 text-sm transition-colors ${
            period === p.key ? "bg-slate-800 text-white" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="px-5 py-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-2 h-8 w-32" />
              <Skeleton className="mt-2 h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </section>
      <Card>
        <CardContent className="py-6">
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-6">
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="border-red-200">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="font-medium text-red-600">読み込みに失敗しました</p>
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700"
        >
          再読み込み
        </button>
      </CardContent>
    </Card>
  );
}
