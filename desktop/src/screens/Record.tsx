import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { useMeter } from "../api/socket";
import { Sprite } from "../Pixel";
import Select from "../Select";
import { fmtDur } from "./Library";

const NEW = "\u0000new"; // select value for "add a new course"
const SOURCES = [
  ["mic", "Microphone"],
  ["loopback", "System audio"],
  ["both", "Both"],
];

export default function Record({ done, back }: { done: (id: string) => void; back: () => void }) {
  const [source, setSource] = useState("mic");
  const [course, setCourse] = useState("");
  const [adding, setAdding] = useState(false);
  const profile = useQuery({ queryKey: ["profile"], queryFn: api.profile });
  const lectures = useQuery({ queryKey: ["lectures"], queryFn: api.lectures });
  const courses = [...new Set([...(profile.data?.profile?.subjects ?? []), ...(lectures.data?.map((l) => l.course).filter(Boolean) as string[] ?? [])])];
  const [startedId, setId] = useState<string | null>(null);
  const meter = useMeter();
  // the engine is the source of truth: leaving this screen mid-recording must not lose the stop button
  const id = startedId ?? (meter.recording ? meter.lecture_id : null);
  const qc = useQueryClient();
  const start = useMutation({
    mutationFn: () => {
      const c = course.trim();
      return api.start(source, courses.find((x) => x.toLowerCase() === c.toLowerCase()) ?? c); // reuse an existing course's spelling
    },
    onSuccess: async (r) => {
      setId(r.lecture_id);
      const p = profile.data?.profile, c = course.trim();
      if (p && c && !p.subjects.some((s) => s.toLowerCase() === c.toLowerCase())) {
        await api.saveProfile({ ...p, subjects: [...p.subjects, c] }).catch(() => {}); // the recording is already running; don't fail it
        qc.invalidateQueries({ queryKey: ["profile"] });
      }
    },
  });
  const stop = useMutation({
    mutationFn: async () => {
      await api.stop(id!);
      await api.process(id!);
    },
    onSuccess: () => done(id!),
  });
  const err = (start.error ?? stop.error) as Error | null;

  return (
    <div className="space-y-4">
      {!id && <button className="px-link text-base" onClick={back}>← Back</button>}
      <div className="flex justify-center py-2" style={{ "--sprite-k": "var(--fg)" } as React.CSSProperties}><Sprite name="mic" size={8} /></div>
      <p className="px-card p-3 text-sm text-muted">
        Recording may require permission from your school or instructor and, in some places, everyone present.
      </p>
      {!id && (
        <div className="flex flex-wrap items-center gap-3">
          {SOURCES.map(([s, label]) => (
            <label key={s} className="flex items-center gap-2 font-pixel text-base">
              <input type="radio" className="accent-yellow-400" checked={source === s} onChange={() => setSource(s)} />
              {label}
            </label>
          ))}
          <Select
            value={adding ? NEW : course}
            onChange={(v) => { const add = v === NEW; setAdding(add); setCourse(add ? "" : v); }}
            options={[{ value: "", label: "No course" }, ...courses.map((c) => ({ value: c, label: c })), { value: NEW, label: "+ Add new…" }]}
          />
          {adding && (
            <div className="px-card px-search">
              <input autoFocus className="bg-transparent px-3 py-1 text-sm text-fg" placeholder="New course name" value={course} onChange={(e) => setCourse(e.target.value)} />
            </div>
          )}
        </div>
      )}
      {id && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 font-pixel text-xl text-red-400">
            <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" /> Recording {fmtDur(meter.seconds)}
          </div>
          <div className="h-4 w-full px-nick overflow-hidden border-2 border-edge bg-black">
            <div className="h-full bg-green-400 transition-[width] duration-100" style={{ width: `${Math.min(100, meter.level * 400)}%` }} />
          </div>
          {meter.error && <p className="text-sm text-red-400">Recording problem: {meter.error}. What was captured so far is saved. Stop to keep it.</p>}
        </div>
      )}
      {err && <p className="text-sm text-red-400">{err.message}</p>}
      <button
        className={`px-btn ${id ? "ghost" : "red"} px-6 py-3 text-xl disabled:opacity-50`}
        disabled={start.isPending || stop.isPending}
        onClick={() => (id ? stop.mutate() : start.mutate())}
      >
        {id ? "■ Stop & generate notes" : "● Start recording"}
      </button>
    </div>
  );
}
