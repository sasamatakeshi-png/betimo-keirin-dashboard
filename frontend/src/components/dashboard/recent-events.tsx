import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber } from "@/lib/format";
import type { RecentEvent } from "@/types/dashboard";

export function RecentEventsList({ events }: { events: RecentEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        イベントがありません
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {events.map((ev) => (
        <Link
          key={ev.id}
          href={`/events/${ev.id}`}
          className="flex items-center justify-between gap-3 py-3 hover:bg-muted/40"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {ev.grade && (
                <Badge variant="outline" className="shrink-0">
                  {ev.grade}
                </Badge>
              )}
              <span className="truncate font-medium">{ev.name}</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {formatDate(ev.start_date)} 〜 {formatDate(ev.end_date)}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-lg font-semibold tabular-nums">
              {formatNumber(ev.video_count)}
            </div>
            <div className="text-xs text-muted-foreground">番組</div>
          </div>
        </Link>
      ))}
    </ul>
  );
}
