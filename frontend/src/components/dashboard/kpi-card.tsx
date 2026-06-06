import { Card, CardContent } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";

export function KpiCard({
  label,
  value,
  count,
}: {
  label: string;
  value: string;
  count: number;
}) {
  return (
    // 自社データ=青系（設計方針）。左アクセントで意味を示す。
    <Card className="border-l-4 border-l-blue-500">
      <CardContent className="px-5 py-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-1 text-3xl font-bold tabular-nums tracking-tight">
          {value}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {formatNumber(count)} 件で集計
        </div>
      </CardContent>
    </Card>
  );
}
