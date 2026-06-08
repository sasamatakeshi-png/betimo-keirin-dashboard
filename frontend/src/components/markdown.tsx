"use client";

// 最小依存(=外部依存ゼロ)の Markdown レンダラ。
// AI分析の生成テキスト（見出し / 段落 / 箇条書き / 番号リスト / GFMテーブル / **bold**）を
// 安全に React 要素へ変換する。HTML はそのまま描画しない（XSS 回避: テキストノードのみ）。

import { Fragment, type ReactNode } from "react";

// 行内の **bold** のみ対応（生成テキストで使われるのは太字のみ）。
function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((s) => s !== "");
  return parts.map((part, i) => {
    const m = /^\*\*([^*]+)\*\*$/.exec(part);
    if (m) {
      return (
        <strong key={i} className="font-semibold">
          {m[1]}
        </strong>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  // 例: | --- | :--: | ---: |
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
}

export function Markdown({ text }: { text: string }): ReactNode {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];

  let i = 0;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    blocks.push(
      <p key={`p-${blocks.length}`} className="text-sm leading-relaxed text-foreground">
        {renderInline(para.join(" "))}
      </p>,
    );
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 空行: 段落区切り
    if (trimmed === "") {
      flushPara();
      i += 1;
      continue;
    }

    // 見出し
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h) {
      flushPara();
      const level = h[1].length;
      const content = renderInline(h[2]);
      const cls =
        level <= 1
          ? "mt-4 text-lg font-bold tracking-tight"
          : level === 2
            ? "mt-4 text-base font-bold tracking-tight"
            : "mt-3 text-sm font-semibold";
      blocks.push(
        <p key={`h-${blocks.length}`} className={cls}>
          {content}
        </p>,
      );
      i += 1;
      continue;
    }

    // テーブル: ヘッダ行 + セパレータ行
    if (trimmed.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushPara();
      const header = splitRow(trimmed);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim() !== "" && lines[j].includes("|")) {
        rows.push(splitRow(lines[j]));
        j += 1;
      }
      blocks.push(
        <div key={`t-${blocks.length}`} className="my-3 overflow-x-auto rounded-lg border">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                {header.map((c, ci) => (
                  <th key={ci} className="px-3 py-2 text-left font-medium">
                    {renderInline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-t">
                  {r.map((c, ci) => (
                    <td key={ci} className="px-3 py-1.5 tabular-nums">
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      i = j;
      continue;
    }

    // 番号リスト
    if (/^\d+\.\s+/.test(trimmed)) {
      flushPara();
      const items: ReactNode[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(
          <li key={items.length} className="text-sm leading-relaxed">
            {renderInline(lines[i].trim().replace(/^\d+\.\s+/, ""))}
          </li>,
        );
        i += 1;
      }
      blocks.push(
        <ol key={`ol-${blocks.length}`} className="my-2 list-decimal space-y-1 pl-5">
          {items}
        </ol>,
      );
      continue;
    }

    // 箇条書き
    if (/^[-*]\s+/.test(trimmed)) {
      flushPara();
      const items: ReactNode[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(
          <li key={items.length} className="text-sm leading-relaxed">
            {renderInline(lines[i].trim().replace(/^[-*]\s+/, ""))}
          </li>,
        );
        i += 1;
      }
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="my-2 list-disc space-y-1 pl-5">
          {items}
        </ul>,
      );
      continue;
    }

    // 通常段落
    para.push(trimmed);
    i += 1;
  }
  flushPara();

  return <div className="space-y-2">{blocks}</div>;
}
