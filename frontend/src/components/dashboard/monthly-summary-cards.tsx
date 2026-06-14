"use client";

// チャンネル全体サマリ（5枚）。各カードに「累計(全期間)」と「単月(前月比つき)」を併記。
// 累計はカウント系の単純合算で、対象月セレクタとは無関係に全期間固定。
// 単月部分は対象月セレクタ（selectedMonth）に連動し、選択月＋直前月との比較を表示。
// 比率系は累計に出さない（合算不可のため）。
//
// 例外（YouTube API ハイブリッド）:
//   - 「総登録者数」の累計欄のみ、API で取得した現在の累計値を優先表示する
//     （channelStats）。API値が無い（キー未設定/取得失敗）ときは従来のCSV合算へ
//     フォールバックして表示が壊れないようにする。
//   - 「再生数」の累計欄は CSV（monthly_channel_metrics all）合算ベースに統一する。
//     API 生涯値は WebCM 広告再生を含まず Studio の全期間視聴回数と乖離するため表示に使わない
//     （API の取得・保存は継続。WebCM除く時は WebCM 差引済みの metrics 合算になる）。
//   - 「総再生時間」「インプレッション」「本数」は API に無いため CSV 合算のまま。

import { Card, CardContent } from "@/components/ui/card";
import { formatChangeBadge, formatDate, formatNumber } from "@/lib/format";
import type {
  ChannelStatsResponse,
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

// 前月比の比較対象を「N月比」形式で（例: '2026-02' → '2月比'）
function compareLabel(ym: string | undefined): string | null {
  if (!ym) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  return m ? `${Number(m[2])}月比` : null;
}

// 指定月の行と、その直前（配列上ひとつ前）の行を返す。
// 月が見つからない場合は末尾（最新月）にフォールバック。
function pickMonth<T extends { year_month: string }>(
  items: T[],
  ym: string | null,
): { current: T | undefined; prev: T | undefined } {
  if (ym) {
    const idx = items.findIndex((x) => x.year_month === ym);
    if (idx >= 0) return { current: items[idx], prev: idx > 0 ? items[idx - 1] : undefined };
  }
  return { current: items.at(-1), prev: items.at(-2) };
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

// ラベル横に出す小さな「ⓘ」注記（hover でネイティブ tooltip）。WebCM の含有可否を伝える。
function InfoTip({ text }: { text: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-muted-foreground/40 text-[9px] leading-none text-muted-foreground/70"
    >
      i
    </span>
  );
}

function SummaryCard({
  label,
  cumulative,
  cumulativeLabel = "累計（全期間）",
  latest,
  prev,
  unit,
  monthLabel,
  compareLabel: cmpLabel,
  note,
  children,
}: {
  label: string;
  cumulative: number;
  // 大きい数値の下に出す注記（既定「累計（全期間）」。API由来なら取得日等を渡す）
  cumulativeLabel?: string;
  latest: number | null;
  prev: number | null;
  unit?: string;
  monthLabel: string;
  compareLabel?: string | null;
  // ラベル横の「ⓘ」tooltip 文言（WebCM 含有の事実注記）。未指定なら出さない。
  note?: string;
  children?: React.ReactNode;
}) {
  const badge = formatChangeBadge(changeRatio(latest, prev));
  return (
    <Card className="border-l-4 border-l-blue-500">
      <CardContent className="px-5 py-4">
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <span>{label}</span>
          {note && <InfoTip text={note} />}
        </div>
        {/* 累計（または API 現在値） */}
        <div className="mt-1 text-3xl font-bold tabular-nums tracking-tight">
          {formatNumber(cumulative)}
          {unit && <span className="ml-1 text-base font-normal text-muted-foreground">{unit}</span>}
        </div>
        <div className="text-[11px] text-muted-foreground">{cumulativeLabel}</div>
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
            <div className="flex shrink-0 flex-col items-end gap-0.5">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${BADGE_STYLE[badge.direction]}`}
              >
                {badge.text}
              </span>
              {cmpLabel && (
                <span className="text-[10px] text-muted-foreground">{cmpLabel}</span>
              )}
            </div>
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
  channelStats = null,
  selectedMonth = null,
  excludeWebcm = false,
}: {
  metrics: MonthlyMetricPoint[];
  counts: MonthlyVideoCountPoint[];
  // 総登録者数・総再生数の最新スナップショット（YouTube API）。null なら CSV にフォールバック。
  channelStats?: ChannelStatsResponse | null;
  // 単月部分の対象月（'YYYY-MM'）。null/未指定なら最新月。累計部分には影響しない。
  selectedMonth?: string | null;
  // 「WebCM除く」適用中か。再生数・総再生時間のカードに注記を出し、
  // 再生数累計は API 生涯値ではなく CSV 月次（WebCM差引済み metrics）の合算を使う。
  // metrics は呼び出し側で既に WebCM 差し引き済みを渡す前提（単月・CSV累計に反映済み）。
  excludeWebcm?: boolean;
}) {
  const { current: latest, prev } = pickMonth(metrics, selectedMonth);
  const monthLabel = ymLabel(latest?.year_month);
  const cmpLabel = compareLabel(prev?.year_month);

  // 本数（video-counts）も同じ対象月に合わせる
  const { current: cntLatest, prev: cntPrev } = pickMonth(counts, selectedMonth);
  const cntCumulative = counts.reduce((a, x) => a + x.total, 0);
  const cntBreakdown: Record<string, number> = {};
  for (const c of counts) {
    for (const [k, v] of Object.entries(c.counts)) {
      cntBreakdown[k] = (cntBreakdown[k] ?? 0) + v;
    }
  }

  // 「再生数」累計は CSV（monthly_channel_metrics segment=all）合算ベースに統一する。
  //   Studio の全期間視聴回数と一致させ、Studio を見た人の違和感を避けるため。
  //   - 込む累計 = 全月 view_count 合算（≈27,603,033、Studio 全期間と一致）
  //   - 除く累計 = 全月 (view_count − その月の WebCM) 合算（≈4,649,960）
  //   metrics は呼び出し側で WebCM 差引済み（除く時）／生値（込む時）が渡るため、
  //   sumCol(metrics, "view_count") をそのまま使えば込む/除く両方が CSV 同一範囲になる。
  //   YouTube API 生涯 view_count は WebCM 広告再生を含まず Studio と乖離するため表示には使わない
  //   （channelStats の取得・保存は継続。登録者カードでは引き続き API 値を使う）。
  const csvViewsCumulative = sumCol(metrics, "view_count");
  // 「総登録者数」累計: 従来どおり YouTube API 値を優先し、無ければ CSV 合算へフォールバック。
  const apiSubs = channelStats?.subscriber_count ?? null;
  const snapDate = channelStats?.snapshot_date ?? null;
  // API由来のときは出所と取得日を注記、無ければ従来の累計（CSV）扱いと分かる注記。
  const apiNote = (apiValue: number | null) =>
    apiValue != null
      ? snapDate
        ? `YouTube・${formatDate(snapDate)}時点`
        : "YouTube（最新値）"
      : "累計（CSV合算）";

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <SummaryCard
        label="インプレッション"
        note="WebCM（広告）はインプレッションをほぼ生まないため、ほぼ通常コンテンツの数値です（WebCM<0.1%）。"
        cumulative={sumCol(metrics, "impressions")}
        latest={latest?.impressions ?? null}
        prev={prev?.impressions ?? null}
        monthLabel={monthLabel}
        compareLabel={cmpLabel}
      />
      <SummaryCard
        label={excludeWebcm ? "再生数（WebCM除く）" : "再生数"}
        note={
          excludeWebcm
            ? "「WebCM除く/込む」トグルに連動。現在はWebCM（広告）分を差し引いた数値です。"
            : "「WebCM除く/込む」トグルに連動。現在はWebCM（広告）分を含む数値です。"
        }
        cumulative={csvViewsCumulative}
        cumulativeLabel={`全期間（取り込み済み）${excludeWebcm ? "・WebCM除く" : ""}`}
        latest={latest?.view_count ?? null}
        prev={prev?.view_count ?? null}
        monthLabel={monthLabel}
        compareLabel={cmpLabel}
      />
      <SummaryCard
        label="総登録者数"
        note="YouTube API累計値。WebCM（広告）経由の登録は分離できません。"
        cumulative={apiSubs ?? sumCol(metrics, "subscribers")}
        cumulativeLabel={apiNote(apiSubs)}
        latest={latest?.subscribers ?? null}
        prev={prev?.subscribers ?? null}
        monthLabel={monthLabel}
        compareLabel={cmpLabel}
      />
      <SummaryCard
        label={excludeWebcm ? "総再生時間（WebCM除く）" : "総再生時間"}
        note={
          excludeWebcm
            ? "「WebCM除く/込む」トグルに連動。現在はWebCM（広告）分を差し引いた数値です。"
            : "「WebCM除く/込む」トグルに連動。現在はWebCM（広告）分を含む数値です。"
        }
        cumulative={sumCol(metrics, "total_watch_time_hours")}
        cumulativeLabel={excludeWebcm ? "累計（全期間・WebCM除く）" : "累計（全期間）"}
        latest={latest?.total_watch_time_hours ?? null}
        prev={prev?.total_watch_time_hours ?? null}
        unit="時間"
        monthLabel={monthLabel}
        compareLabel={cmpLabel}
      />
      <SummaryCard
        label="本数"
        note="番組・動画の本数（WebCMは含みません）。"
        cumulative={cntCumulative}
        latest={cntLatest?.total ?? null}
        prev={cntPrev?.total ?? null}
        unit="本"
        monthLabel={ymLabel(cntLatest?.year_month)}
        compareLabel={compareLabel(cntPrev?.year_month)}
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
