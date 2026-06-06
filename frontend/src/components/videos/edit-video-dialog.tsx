"use client";

import { useEffect, useState } from "react";

import { Modal } from "@/components/modal";
import { ApiError, patchVideo } from "@/lib/api";
import type { EventLite, Video, VideoUpdate } from "@/types/video";

const PROGRAM_TYPES = ["あす勝ち", "BKL", "ミッドナイト", "ナイター", "プレミアムトーク", "Bar"];
const GRADES = ["G1", "G2", "G3", "F1", "F2"];

export function EditVideoDialog({
  open,
  video,
  events,
  onClose,
  onSaved,
  onRequireLogin,
}: {
  open: boolean;
  video: Video | null;
  events: EventLite[];
  onClose: () => void;
  onSaved: (v: Video) => void;
  onRequireLogin: () => void;
}) {
  const [programType, setProgramType] = useState("");
  const [eventId, setEventId] = useState("");
  const [cast, setCast] = useState("");
  const [venue, setVenue] = useState("");
  const [grade, setGrade] = useState("");
  const [titleTag, setTitleTag] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!video) return;
    setProgramType(video.program_type ?? "");
    setEventId(video.event_id ?? "");
    setCast(video.cast_members.join("・"));
    setVenue(video.venue ?? "");
    setGrade(video.grade ?? "");
    setTitleTag(video.title_tag ?? "");
    setErr(null);
  }, [video]);

  if (!video) return null;

  const orNull = (s: string): string | null => (s.trim() === "" ? null : s.trim());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!video) return;
    setBusy(true);
    setErr(null);
    const body: VideoUpdate = {
      program_type: orNull(programType),
      event_id: orNull(eventId),
      cast_members: cast
        .split(/[・,、]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      venue: orNull(venue),
      grade: orNull(grade),
      title_tag: orNull(titleTag),
    };
    try {
      const updated = await patchVideo(video.id, body);
      onSaved(updated);
      onClose();
    } catch (e2) {
      if (e2 instanceof ApiError && e2.status === 401) {
        setErr("認証が必要です。ログインしてください。");
        onRequireLogin();
      } else {
        setErr(e2 instanceof Error ? e2.message : "保存に失敗しました");
      }
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-md border px-3 py-2 text-sm";

  return (
    <Modal open={open} onClose={onClose} title="番組データの編集">
      <form onSubmit={save} className="space-y-3">
        <div className="text-xs text-muted-foreground">
          {video.published_at?.slice(0, 10)} ・ {video.youtube_video_id ?? "（動画ID無し）"}
        </div>

        <label className="block text-sm">
          番組種別
          <input
            list="program-types"
            value={programType}
            onChange={(e) => setProgramType(e.target.value)}
            className={field}
          />
          <datalist id="program-types">
            {PROGRAM_TYPES.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>

        <label className="block text-sm">
          イベント（レース紐づけ）
          <select
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className={field}
          >
            <option value="">（紐づけなし）</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          出演（・ または , 区切り）
          <input value={cast} onChange={(e) => setCast(e.target.value)} className={field} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            会場(venue)
            <input value={venue} onChange={(e) => setVenue(e.target.value)} className={field} />
          </label>
          <label className="block text-sm">
            グレード(grade)
            <input
              list="grades"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className={field}
            />
            <datalist id="grades">
              {GRADES.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </label>
        </div>

        <label className="block text-sm">
          冠タイトル(title_tag)
          <input value={titleTag} onChange={(e) => setTitleTag(e.target.value)} className={field} />
        </label>

        {err && <p className="text-sm text-red-600">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm">
            キャンセル
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </form>
    </Modal>
  );
}
