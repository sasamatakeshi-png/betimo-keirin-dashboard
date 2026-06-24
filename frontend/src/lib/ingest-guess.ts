// 取り込みファイル名からの推測ロジック（自動判別＋不一致警告で共有）。
// 推測できない場合は null を返す（手動選択を尊重し、警告も出さない方針）。

import type {
  IngestType,
  MonthlyKind,
  MonthlySegment,
  ShortIngestType,
} from "@/types/ingestion";

// 各取り込み口の命名ルール（画面に小さく表示する）。
export const NAMING_RULES = {
  normal: "推奨: 種別が分かる名前（例: 全期間_チャンネル.csv / 90日_チャンネル.csv / 全期間データ（ライブ視聴）.csv / 全期間データ（アーカイブ視聴）.csv）。種別を自動判別。",
  short: "推奨: ショート全期間.csv / ショート90日.csv。「全期間」「90日」で種別を自動判別。",
  monthly: "推奨: 数値_全体_2026-05.csv / 性別年齢_全体_2026-05.csv。種別・セグメント・月を自動判別。",
  video: "推奨: 動画別_2026-05.csv。ファイル名の YYYY-MM で対象月を自動判別。",
  concurrent:
    "同時接続数xlsx（1ファイル=1レース1日）。「設定」シートの計測開始日時と「データ」シートの時系列を読み、Betimo＋競合3社（ぺーちゃんねる/オッズパーク/楽天Kドリームス）のみ取り込みます。複数ファイルをまとめて投入できます。",
} as const;

// 通常CSVの種別を推測。判別不能は null。
// ライブ/アーカイブ視聴は名前に「全期間」を含むため、90日/全期間より先に判定する。
export function guessNormalType(name: string): IngestType | null {
  if (/アーカイブ視聴|archive/i.test(name)) return "archive_views_csv";
  if (/ライブ視聴|live[\s_-]?view/i.test(name)) return "live_views_csv";
  if (/90\s*日|90d|90day/i.test(name)) return "90d_csv";
  if (/全期間|zenki|all[\s_-]?time/i.test(name)) return "zenkikan_csv";
  return null;
}

// ショートCSVの種別を推測。判別不能は null。
export function guessShortType(name: string): ShortIngestType | null {
  if (/90\s*日|90d|90day/i.test(name)) return "short_90d_csv";
  if (/全期間|zenki|all[\s_-]?time/i.test(name)) return "short_zenkikan_csv";
  return null;
}

// 月次CSVの種別（数値/性別年齢）を推測。判別不能は null。
export function guessMonthlyKind(name: string): MonthlyKind | null {
  if (/性別|年齢|demograph|gender|age/i.test(name)) return "demographics";
  if (/数値|metric|チャンネル|視聴|サマリ/i.test(name)) return "metrics";
  return null;
}

// セグメント（全体/ライブ/ショート）を推測。判別不能は null。
export function guessSegment(name: string): MonthlySegment | null {
  if (/ショート|short/i.test(name)) return "short";
  if (/ライブ|live|配信/i.test(name)) return "live";
  if (/全体|all|チャンネル/i.test(name)) return "all";
  return null;
}

// ファイル名から対象月 'YYYY-MM' を推測。monthValues（選択肢）に在るもののみ返す。
//  - 'YYYY-MM'/'YYYY_MM'/'YYYYMM'/'YYYY年M月' を優先。
//  - 年の無い 'M月' は、その月を持つ最新の選択肢（monthValues は新しい順前提）。
//  - 候補に無ければ null（＝自動セットも不一致警告もしない）。
export function guessYearMonth(name: string, monthValues: string[]): string | null {
  const valid = new Set(monthValues);
  const ym = /(20\d{2})[-_.]?(0[1-9]|1[0-2])/.exec(name);
  if (ym && valid.has(`${ym[1]}-${ym[2]}`)) return `${ym[1]}-${ym[2]}`;

  const mm = /(\d{1,2})\s*月/.exec(name);
  const month = mm ? Number(mm[1]) : 0;
  if (month >= 1 && month <= 12) {
    const mp = String(month).padStart(2, "0");
    const yyyy = /(20\d{2})\s*年/.exec(name);
    if (yyyy && valid.has(`${yyyy[1]}-${mp}`)) return `${yyyy[1]}-${mp}`;
    const found = monthValues.find((v) => v.endsWith(`-${mp}`));
    if (found) return found;
  }
  return null;
}

// 月次CSV（数値/性別年齢）の月・種別・セグメントをまとめて推測。
// 各値は推測できなければ既定（ym=fallback, kind=metrics, segment=all）。
// inferred には「ファイル名から実際に推測できたか」を項目別に持たせ、不一致強調に使う。
export interface MonthlyGuess {
  yearMonth: string;
  kind: MonthlyKind;
  segment: MonthlySegment;
  inferred: { yearMonth: boolean; kind: boolean; segment: boolean };
}

export function guessMonthly(
  name: string,
  monthValues: string[],
  fallbackYearMonth: string,
): MonthlyGuess {
  const ym = guessYearMonth(name, monthValues);
  const kind = guessMonthlyKind(name);
  const segment = guessSegment(name);
  return {
    yearMonth: ym ?? fallbackYearMonth,
    kind: kind ?? "metrics",
    segment: segment ?? "all",
    inferred: { yearMonth: ym != null, kind: kind != null, segment: segment != null },
  };
}
