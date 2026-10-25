import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { useMeter } from "../api/socket";
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
      <p className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        Recording may require permission from your school or instructor and, in some places, everyone present.
      </p>
      {!id && (
        <div className="flex flex-wrap items-center gap-3">
          {SOURCES.map(([s, label]) => (
            <label key={s} className="flex items-center gap-1 text-sm">
              <input type="radio" checked={source === s} onChange={() => setSource(s)} />
              {label}
            </label>
          ))}
          <input className="rounded border px-2 py-1 text-sm" placeholder="Course (optional)" value={course} onChange={(e) => setCourse(e.target.value)} />
        </div>
      )}
      {id && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-red-600">
            <span className="h-3 w-3 animate-pulse rounded-full bg-red-600" /> Recording {fmtDur(meter.seconds)}
          </div>
          <div className="h-3 w-full overflow-hidden rounded bg-slate-200">
            <div className="h-full bg-green-500 transition-[width] duration-100" style={{ width: `${Math.min(100, meter.level * 400)}%` }} />
          </div>
          {meter.error && <p className="text-sm text-red-600">Recording problem: {meter.error}. What was captured so far is saved — stop to keep it.</p>}
        </div>
      )}
      {err && <p className="text-sm text-red-600">{err.message}</p>}
      <button
        className={`rounded px-6 py-3 text-lg font-medium text-white ${id ? "bg-slate-800" : "bg-red-600"} disabled:opacity-50`}
        disabled={start.isPending || stop.isPending}
        onClick={() => (id ? stop.mutate() : start.mutate())}
      >
        {id ? "■ Stop & generate notes" : "● Start recording"}
      </button>
    </div>
  );
}
