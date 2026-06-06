"use client";

import { useState } from "react";

import { Modal } from "@/components/modal";
import { login } from "@/lib/auth";

export function LoginDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await login(pw);
      setPw("");
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "ログインに失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="ログイン">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted-foreground">
          編集（インライン保存）にはログインが必要です。
        </p>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="APP_PASSWORD"
          autoFocus
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            ログイン
          </button>
        </div>
      </form>
    </Modal>
  );
}
