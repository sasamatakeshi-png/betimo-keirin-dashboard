"use client";

import { useCallback, useEffect, useState } from "react";

import { IngestionStatusList } from "@/components/dashboard/ingestion-status";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { RecentEventsList } from "@/components/dashboard/recent-events";
import { ViewsTrendChart } from "@/components/dashboard/views-trend-chart";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getDashboardHome } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { HomeResponse } from "@/types/dashboard";

type Period = "all" | "lastMonth";

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

// 直近の「完成した暦月」（先月）の初日〜末日。月初・年跨ぎも正しく算出。
function lastMonthParams(): { date_from: string; date_to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1); // 先月の初日
  const y = first.getFullYear();
  const m = first.getMonth() + 1;
  const lastDay = new Date(y, m, 0).getDate(); // 先月の末日
  return {
    date_from: `${y}-${pad2(m)}-01`,
    date_to: `${y}-${pad2(m)}-${pad2(lastDay)}`,
  };
}

// 'YYYY-MM-01' → 「YYYY年M月」と前月ラベル
function monthLabels(dateFrom: string): { cur: string; prev: string } | null {
  const mm = /^(\d{4})-(\d{2})/.exec(dateFrom);
  if (!mm) return null;
  const y = Number(mm[1]);
  const mo = Number(mm[2]);
  const prev = mo === 1 ? { y: y - 1, mo: 12 } : { y, mo: mo - 1 };
  return { cur: `${y}年${mo}月`, prev: `${prev.y}年${prev.mo}月` };
}

export default function HomePage() {
  const [data, setData] = useState<HomeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("all");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getDashboardHome(
        p === "lastMonth" ? lastMonthParams() : undefined,
      );
      setData(res);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(period);
  }, [period, load]);

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-8">
      {/* ヘッダー */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Betimo KEIRIN Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ホーム ・ 自社チャンネルの実績サマリ
          </p>
        </div>
        <div className="flex items-center gap-4">
          <PeriodToggle period={period} onChange={setPeriod} disabled={loading} />
          <span className="text-xs text-muted-foreground">
            更新: {updatedAt ? formatDateTime(updatedAt) : "—"}
          </span>
        </div>
      </header>

      {error ? (
        <ErrorState message={error} onRetry={() => load(period)} />
      ) : loading ? (
        <LoadingState />
      ) : data ? (
        <DashboardContent data={data} />
      ) : null}
    </main>
  );
}

function PeriodToggle({
  period,
  onChange,
  disabled,
}: {
  period: Period;
  onChange: (p: Period) => void;
  disabled: boolean;
}) {
  const opts: { key: Period; label: string }[] = [
    { key: "all", label: "全期間" },
    { key: "lastMonth", label: "先月" },
  ];
  return (
    <div className="inline-flex rounded-md border p-0.5">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.key)}
          className={`rounded px-3 py-1 text-sm transition-colors disabled:opacity-50 ${
            period === o.key
              ? "bg-blue-600 text-white"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function DashboardContent({ data }: { data: HomeResponse }) {
  const { kpis } = data;
  const labels = data.date_from ? monthLabels(data.date_from) : null;
  return (
    <div className="space-y-6">
      {/* 対象月の明示（先月表示時のみ） */}
      {labels && (
        <p className="-mb-2 text-sm text-muted-foreground">
          対象: <span className="font-medium text-foreground">{labels.cur}</span>
          （前月比 = 対 {labels.prev}）
        </p>
      )}

      {/* KPIカード4枚 */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="インプレッション" kpi={kpis.total_impressions} />
        <KpiCard label="再生数" kpi={kpis.total_views} />
        <KpiCard label="登録増" kpi={kpis.total_subscriber_gain} />
        <KpiCard
          label="最大同接（単一番組）"
          kpi={kpis.max_concurrent_viewers}
          note="※1番組の瞬間最大値（合計ではありません）"
        />
      </section>

      {/* 再生数推移 */}
      <Card>
        <CardHeader>
          <div className="flex items-baseline justify-between gap-2">
            <CardTitle className="text-base">再生数の推移（日別・JST）</CardTitle>
            <span className="text-xs text-muted-foreground">単位: 回（k = 千）</span>
          </div>
        </CardHeader>
        <CardContent>
          <ViewsTrendChart
            data={data.views_trend}
            markers={data.events_markers}
          />
        </CardContent>
      </Card>

      {/* 直近イベント / 取得状況 */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">直近イベント</CardTitle>
          </CardHeader>
          <CardContent>
            <RecentEventsList events={data.recent_events} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">取得状況</CardTitle>
          </CardHeader>
          <CardContent>
            <IngestionStatusList items={data.ingestion_status} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
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
          <Skeleton className="h-[320px] w-full" />
        </CardContent>
      </Card>
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="py-6">
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-6">
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
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
