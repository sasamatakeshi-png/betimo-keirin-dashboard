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
  getDashboardHome,
  getMonthlyDemographics,
  getMonthlyMetrics,
  getMonthlyVideoCounts,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type {
  HomeResponse,
  MonthlyDemographicsResponse,
  MonthlyMetricPoint,
  MonthlySegment,
  MonthlyVideoCountPoint,
} from "@/types/dashboard";

const SEGMENTS: { key: MonthlySegment; label: string }[] = [
  { key: "all", label: "全体" },
  { key: "live", label: "ライブ" },
  { key: "short", label: "ショート" },
];

interface HomeData {
  metrics: Record<MonthlySegment, MonthlyMetricPoint[]>;
  demographics: Record<MonthlySegment, MonthlyDemographicsResponse>;
  counts: MonthlyVideoCountPoint[];
  home: HomeResponse;
}

export default function HomePage() {
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  // 推移グラフ・表で共有する segment（連動）
  const [segment, setSegment] = useState<MonthlySegment>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mAll, mLive, mShort, dAll, dLive, dShort, counts, home] =
        await Promise.all([
          getMonthlyMetrics("all"),
          getMonthlyMetrics("live"),
          getMonthlyMetrics("short"),
          getMonthlyDemographics("all"),
          getMonthlyDemographics("live"),
          getMonthlyDemographics("short"),
          getMonthlyVideoCounts(),
          getDashboardHome(),
        ]);
      setData({
        metrics: { all: mAll.items, live: mLive.items, short: mShort.items },
        demographics: { all: dAll, live: dLive, short: dShort },
        counts: counts.items,
        home,
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
        <DashboardContent
          data={data}
          segment={segment}
          onSegmentChange={setSegment}
        />
      ) : null}
    </main>
  );
}

function DashboardContent({
  data,
  segment,
  onSegmentChange,
}: {
  data: HomeData;
  segment: MonthlySegment;
  onSegmentChange: (s: MonthlySegment) => void;
}) {
  const segMetrics = data.metrics[segment];
  return (
    <div className="space-y-6">
      {/* 1. チャンネル全体サマリ（累計 + 最新月） */}
      <MonthlySummaryCards metrics={data.metrics.all} counts={data.counts} />

      {/* 2-3. 月次推移グラフ + データ表（segment 連動） */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">月次推移</CardTitle>
            <SegmentToggle segment={segment} onChange={onSegmentChange} />
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <MonthlyTrendChart items={segMetrics} />
          <div>
            <div className="mb-2 text-sm font-medium text-muted-foreground">月次データ一覧</div>
            <MonthlyTable items={segMetrics} />
          </div>
        </CardContent>
      </Card>

      {/* 4. 性別・年齢（独立 segment） */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">視聴者の性別・年齢</CardTitle>
        </CardHeader>
        <CardContent>
          <MonthlyDemographicsChart dataBySegment={data.demographics} />
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
