import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Lecture } from "../api/client";

export const fmtDur = (s: number) => {
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  return `${h ? h + ":" : ""}${mm}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

const IDLE = ["ready", "failed", "cancelled", "recorded"];
const color: Record<string, string> = {
  ready: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-slate-200 text-slate-700",
  recording: "bg-red-100 text-red-800",
  recorded: "bg-slate-100 text-slate-700",
};

export const Badge = ({ l }: { l: Lecture }) => (
  <span className={`rounded px-2 py-0.5 text-xs ${color[l.state] ?? "bg-blue-100 text-blue-800"}`}>
    {l.state}
    {l.state === "transcribe" && l.progress ? ` ${Math.round(l.progress * 100)}%` : ""}
  </span>
);

export default function Library({ open }: { open: (id: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["lectures"],
    queryFn: api.lectures,
    refetchInterval: (query) => (query.state.data?.some((l) => !IDLE.includes(l.state)) ? 1500 : 10000),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["lectures"] });
  const del = useMutation({ mutationFn: api.remove, onSuccess: refresh });
  const reprocess = useMutation({ mutationFn: api.process, onSuccess: refresh });
  const rename = useMutation({ mutationFn: (v: { id: string; title: string }) => api.patch(v.id, { title: v.title }), onSuccess: refresh });

  if (!q.data?.length) return <p className="text-slate-500">No lectures yet. Hit Record to start one.</p>;
  return (
    <ul className="divide-y rounded border">
      {q.data.map((l) => (
        <li key={l.id} className="flex items-center gap-3 p-3">
          <button className="flex-1 text-left" onClick={() => open(l.id)}>
            <div className="font-medium">{l.title}</div>
            <div className="text-xs text-slate-500">
              {l.course ?? "No course"} · {new Date(l.created * 1000).toLocaleString()} · {fmtDur(l.duration)}
            </div>
          </button>
          <Badge l={l} />
          <button
            className="text-xs underline"
            onClick={() => {
              const t = prompt("Rename lecture", l.title);
              if (t) rename.mutate({ id: l.id, title: t });
            }}
          >
            rename
          </button>
          {IDLE.includes(l.state) && l.state !== "recording" && (
            <button className="text-xs underline" onClick={() => reprocess.mutate(l.id)}>
              {l.state === "ready" ? "re-process" : "process"}
            </button>
          )}
          <button className="text-xs text-red-600 underline" onClick={() => confirm("Delete this lecture and all its files?") && del.mutate(l.id)}>
            delete
          </button>
        </li>
      ))}
    </ul>
  );
}
