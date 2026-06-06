import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import type { IngestionStatus } from "@/types/dashboard";

const STATUS_STYLE: Record<string, string> = {
  success: "bg-green-100 text-green-700 border-green-200",
  partial: "bg-amber-100 text-amber-700 border-amber-200",
  failed: "bg-red-100 text-red-700 border-red-200",
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : formatDateTime(d);
}

export function IngestionStatusList({ items }: { items: IngestionStatus[] }) {
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        取り込み履歴なし
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {items.map((it, i) => (
        <li key={i} className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={STATUS_STYLE[it.status] ?? ""}
              >
                {it.status}
              </Badge>
              <span className="truncate text-sm">
                {it.file_name ?? it.source_type}
              </span>
            </div>
          </div>
          <div className="shrink-0 text-xs text-muted-foreground">
            {fmt(it.completed_at)}
          </div>
        </li>
      ))}
    </ul>
  );
}
