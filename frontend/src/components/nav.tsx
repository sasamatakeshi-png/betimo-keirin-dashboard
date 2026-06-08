"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { LoginDialog } from "@/components/auth/login-dialog";
import { initAuth, logout, useAuth } from "@/lib/auth";

export function Nav() {
  const { loggedIn, authRequired } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    void initAuth();
  }, []);

  const linkCls = (href: string) =>
    pathname === href
      ? "font-semibold text-foreground"
      : "text-muted-foreground hover:text-foreground";

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <span className="font-bold tracking-tight">Betimo KEIRIN</span>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/" className={linkCls("/")}>
              ホーム
            </Link>
            <Link href="/videos" className={linkCls("/videos")}>
              全データ一覧
            </Link>
            <Link href="/shorts" className={linkCls("/shorts")}>
              ショート
            </Link>
            <Link href="/events" className={linkCls("/events")}>
              イベント
            </Link>
            <Link href="/concurrent-analysis" className={linkCls("/concurrent-analysis")}>
              同接分析
            </Link>
            <Link href="/ingest" className={linkCls("/ingest")}>
              取り込み
            </Link>
          </nav>
        </div>
        <div className="text-sm">
          {authRequired === false ? (
            <span className="text-xs text-muted-foreground">編集可（認証不要）</span>
          ) : loggedIn ? (
            <button
              type="button"
              onClick={logout}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ログアウト
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setLoginOpen(true)}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
            >
              編集するにはログイン
            </button>
          )}
        </div>
      </div>
      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
    </header>
  );
}
