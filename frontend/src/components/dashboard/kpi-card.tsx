import { Card, CardContent } from "@/components/ui/card";
import { formatChangeBadge, formatNumber } from "@/lib/format";
import type { Kpi } from "@/types/dashboard";

const BADGE_STYLE: Record<string, string> = {
  // 設計方針: 成長・良指標=緑系 / 悪化=赤系
  up: "bg-green-50 text-green-700 border border-green-200",
  down: "bg-red-50 text-red-700 border border-red-200",
  flat: "bg-muted text-muted-foreground border",
};

export function KpiCard({
  label,
  kpi,
  note,
}: {
  label: string;
  kpi: Kpi;
  note?: string;
}) {
  const badge = formatChangeBadge(kpi.change_ratio);

  return (
    // 自社データ=青系（設計方針）。左アクセントで意味を示す。
    <Card className="border-l-4 border-l-blue-500">
      <CardContent className="px-5 py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm text-muted-foreground">{label}</div>
            {note && (
              <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground/80">
                {note}
              </div>
            )}
          </div>
          {badge && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
                BADGE_STYLE[badge.direction]
              }`}
            >
              {badge.text}
            </span>
          )}
        </div>
        <div className="mt-2 text-3xl font-bold tabular-nums tracking-tight">
          {formatNumber(kpi.value)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {formatNumber(kpi.count)} 件で集計
          {badge && kpi.prev_value !== null && (
            <span className="ml-2">前期 {formatNumber(kpi.prev_value)}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
