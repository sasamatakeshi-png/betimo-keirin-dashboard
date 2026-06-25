"use client";

// 依存ゼロの範囲選択カレンダー（react-day-picker 不使用）。
// 月グリッドで開始日〜終了日を選ぶ。min/max（実データ範囲）外の日は選択不可。
// 配色は既存 X/トラフィック画面に合わせて自社=青系。

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

export interface DateRange {
  from?: string; // "yyyy-mm-dd"
  to?: string; // "yyyy-mm-dd"
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function parseIso(iso?: string): Date | undefined {
  if (!iso) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

// 時刻成分を捨てた日付の比較（>0: a が後）。
function cmp(a: Date, b: Date): number {
  return (
    a.getFullYear() - b.getFullYear() ||
    a.getMonth() - b.getMonth() ||
    a.getDate() - b.getDate()
  );
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function Calendar({
  selected,
  onSelect,
  min,
  max,
  className,
}: {
  selected?: DateRange;
  onSelect?: (range: DateRange) => void;
  min?: string;
  max?: string;
  className?: string;
}) {
  const minD = parseIso(min);
  const maxD = parseIso(max);
  const fromD = parseIso(selected?.from);
  const toD = parseIso(selected?.to);

  // 表示中の月。初期は選択開始月→なければ最大月（=最新データ）。
  const [view, setView] = React.useState<Date>(
    () => startOfMonth(fromD ?? maxD ?? new Date()),
  );

  const monthGrid = React.useMemo(() => {
    const first = startOfMonth(view);
    const lead = first.getDay(); // 先頭の曜日（0=日）
    const cells: (Date | null)[] = [];
    for (let i = 0; i < lead; i += 1) cells.push(null);
    const daysInMonth = new Date(
      view.getFullYear(),
      view.getMonth() + 1,
      0,
    ).getDate();
    for (let d = 1; d <= daysInMonth; d += 1) {
      cells.push(new Date(view.getFullYear(), view.getMonth(), d));
    }
    return cells;
  }, [view]);

  function isDisabled(day: Date): boolean {
    if (minD && cmp(day, minD) < 0) return true;
    if (maxD && cmp(day, maxD) > 0) return true;
    return false;
  }

  function handleClick(day: Date) {
    if (isDisabled(day)) return;
    const iso = toIso(day);
    // 未確定（開始のみ）の状態でなければ、新たに開始日を引き直す。
    if (!fromD || (fromD && toD)) {
      onSelect?.({ from: iso, to: undefined });
      return;
    }
    // 開始日あり・終了日なし → 終点を確定。開始より前なら引き直し。
    if (cmp(day, fromD) < 0) {
      onSelect?.({ from: iso, to: undefined });
    } else {
      onSelect?.({ from: selected?.from, to: iso });
    }
  }

  function inRange(day: Date): boolean {
    if (!fromD || !toD) return false;
    return cmp(day, fromD) >= 0 && cmp(day, toD) <= 0;
  }

  function isEndpoint(day: Date): boolean {
    return (
      (fromD != null && cmp(day, fromD) === 0) ||
      (toD != null && cmp(day, toD) === 0)
    );
  }

  // 月送りの可否（min/max を跨がせない）。
  const prevDisabled = minD != null && cmp(view, startOfMonth(minD)) <= 0;
  const nextDisabled = maxD != null && cmp(view, startOfMonth(maxD)) >= 0;

  return (
    <div className={cn("w-[17rem] select-none", className)}>
      {/* 月ナビゲーション */}
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="前の月"
          disabled={prevDisabled}
          onClick={() => setView((v) => addMonths(v, -1))}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="text-sm font-medium tabular-nums">
          {view.getFullYear()}年{view.getMonth() + 1}月
        </div>
        <button
          type="button"
          aria-label="次の月"
          disabled={nextDisabled}
          onClick={() => setView((v) => addMonths(v, 1))}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {/* 曜日ヘッダ */}
      <div className="grid grid-cols-7 text-center text-[0.7rem] text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>

      {/* 日グリッド */}
      <div className="grid grid-cols-7 gap-y-0.5 text-sm">
        {monthGrid.map((day, i) => {
          if (!day) return <div key={`e${i}`} />;
          const disabled = isDisabled(day);
          const endpoint = isEndpoint(day);
          const between = inRange(day) && !endpoint;
          return (
            <div key={toIso(day)} className="flex justify-center py-0.5">
              <button
                type="button"
                disabled={disabled}
                onClick={() => handleClick(day)}
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-md tabular-nums transition-colors",
                  disabled && "pointer-events-none text-muted-foreground/30",
                  !disabled && !endpoint && !between && "hover:bg-muted",
                  between && "bg-blue-50 text-blue-700",
                  endpoint && "bg-blue-600 font-medium text-white hover:bg-blue-600",
                )}
              >
                {day.getDate()}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
