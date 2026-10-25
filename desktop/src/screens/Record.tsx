import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { useMeter } from "../api/socket";
import { Sprite } from "../Pixel";
import { fmtDur } from "./Library";

const SOURCES = [
  ["mic", "Microphone"],
  ["loopback", "System audio"],
  ["both", "Both"],
];

export default function Record({ done }: { done: (id: string) => void }) {
  const [source, setSource] = useState("mic");
  const [course, setCourse] = useState("");
  const [id, setId] = useState<string | null>(null);
  const meter = useMeter();
  const start = useMutation({ mutationFn: () => api.start(source, course), onSuccess: (r) => setId(r.lecture_id) });
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
      <div className="flex justify-center py-2"><Sprite name="mic" size={8} /></div>
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
          <input className="px-nick border-2 border-edge bg-ink px-2 py-1 text-sm text-fg" placeholder="Course (optional)" value={course} onChange={(e) => setCourse(e.target.value)} />
        </div>
      )}
      {id && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 font-pixel text-xl text-red-400">
            <span className="h-3 w-3 animate-pulse bg-red-500" /> Recording {fmtDur(meter.seconds)}
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
