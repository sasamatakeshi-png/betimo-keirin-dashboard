"use client";

// チャンネル全体サマリ（5枚）。各カードに「累計(全期間)」と「最新月(先月比つき)」を併記。
// 累計はカウント系の単純合算。比率系は累計に出さない（合算不可のため）。

import { Card, CardContent } from "@/components/ui/card";
import { formatChangeBadge, formatNumber } from "@/lib/format";
import type {
  MonthlyMetricPoint,
  MonthlyVideoCountPoint,
} from "@/types/dashboard";

const BADGE_STYLE: Record<string, string> = {
  up: "bg-green-50 text-green-700 border border-green-200",
  down: "bg-red-50 text-red-700 border border-red-200",
  flat: "bg-muted text-muted-foreground border",
};

// 本数内訳の表示順（0件は控えめにグレー表示）
const COUNT_CATEGORIES = [
  "BKL",
  "あす勝ち",
  "ナイター",
  "ミッドナイト",
  "プレミアムトーク",
  "Bar",
  "short",
  "その他",
];

function ymLabel(ym: string | undefined): string {
  if (!ym) return "—";
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  return m ? `${Number(m[1])}年${Number(m[2])}月` : ym;
}

type NumKey =
  | "view_count"
  | "impressions"
  | "subscribers"
  | "total_watch_time_hours"
  | "new_viewers";

function sumCol(items: MonthlyMetricPoint[], key: NumKey): number {
  return items.reduce((a, x) => a + (x[key] ?? 0), 0);
}

function changeRatio(
  latest: number | null | undefined,
  prev: number | null | undefined,
): number | null {
  if (latest == null || prev == null || prev === 0) return null;
  return (latest - prev) / prev;
}

function SummaryCard({
  label,
  cumulative,
  latest,
  prev,
  unit,
  monthLabel,
  children,
}: {
  label: string;
  cumulative: number;
  latest: number | null;
  prev: number | null;
  unit?: string;
  monthLabel: string;
  children?: React.ReactNode;
}) {
  const badge = formatChangeBadge(changeRatio(latest, prev));
  return (
    <Card className="border-l-4 border-l-blue-500">
      <CardContent className="px-5 py-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        {/* 累計（全期間） */}
        <div className="mt-1 text-3xl font-bold tabular-nums tracking-tight">
          {formatNumber(cumulative)}
          {unit && <span className="ml-1 text-base font-normal text-muted-foreground">{unit}</span>}
        </div>
        <div className="text-[11px] text-muted-foreground">累計（全期間）</div>
        {/* 最新月 + 先月比 */}
        <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
          <div className="min-w-0">
            <div className="text-[11px] text-muted-foreground">{monthLabel}</div>
            <div className="text-lg font-semibold tabular-nums">
              {formatNumber(latest)}
              {unit && <span className="ml-0.5 text-xs font-normal text-muted-foreground">{unit}</span>}
            </div>
          </div>
          {badge && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${BADGE_STYLE[badge.direction]}`}
            >
              {badge.text}
            </span>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export function MonthlySummaryCards({
  metrics,
  counts,
}: {
  metrics: MonthlyMetricPoint[];
  counts: MonthlyVideoCountPoint[];
}) {
  const latest = metrics.at(-1);
  const prev = metrics.at(-2);
  const monthLabel = ymLabel(latest?.year_month);

  // 本数（video-counts）
  const cntLatest = counts.at(-1);
  const cntPrev = counts.at(-2);
  const cntCumulative = counts.reduce((a, x) => a + x.total, 0);
  const cntBreakdown: Record<string, number> = {};
  for (const c of counts) {
    for (const [k, v] of Object.entries(c.counts)) {
      cntBreakdown[k] = (cntBreakdown[k] ?? 0) + v;
    }
  }

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <SummaryCard
        label="インプレッション"
        cumulative={sumCol(metrics, "impressions")}
        latest={latest?.impressions ?? null}
        prev={prev?.impressions ?? null}
        monthLabel={monthLabel}
      />
      <SummaryCard
        label="再生数"
        cumulative={sumCol(metrics, "view_count")}
        latest={latest?.view_count ?? null}
        prev={prev?.view_count ?? null}
        monthLabel={monthLabel}
      />
      <SummaryCard
        label="登録増"
        cumulative={sumCol(metrics, "subscribers")}
        latest={latest?.subscribers ?? null}
        prev={prev?.subscribers ?? null}
        monthLabel={monthLabel}
      />
      <SummaryCard
        label="総再生時間"
        cumulative={sumCol(metrics, "total_watch_time_hours")}
        latest={latest?.total_watch_time_hours ?? null}
        prev={prev?.total_watch_time_hours ?? null}
        unit="時間"
        monthLabel={monthLabel}
      />
      <SummaryCard
        label="本数"
        cumulative={cntCumulative}
        latest={cntLatest?.total ?? null}
        prev={cntPrev?.total ?? null}
        unit="本"
        monthLabel={ymLabel(cntLatest?.year_month)}
      >
        {/* 累計の内訳 */}
        <div className="mt-2 flex flex-wrap gap-1 border-t pt-2">
          {COUNT_CATEGORIES.map((cat) => {
            const n = cntBreakdown[cat] ?? 0;
            return (
              <span
                key={cat}
                className={`rounded px-1.5 py-0.5 text-[10px] tabular-nums ${
                  n > 0 ? "bg-muted text-foreground" : "text-muted-foreground/40"
                }`}
              >
                {cat} {n}
              </span>
            );
          })}
        </div>
      </SummaryCard>
    </section>
  );
}
