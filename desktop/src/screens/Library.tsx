import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Lecture } from "../api/client";
import { Sprite } from "../Pixel";

export const fmtDur = (s: number) => {
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  return `${h ? h + ":" : ""}${mm}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

const IDLE = ["ready", "failed", "cancelled", "recorded"];
const color: Record<string, string> = {
  ready: "bg-green-400 text-green-950",
  failed: "bg-red-400 text-red-950",
  cancelled: "bg-slate-400 text-slate-900",
  recording: "bg-red-400 text-red-950",
  recorded: "bg-indigo-200 text-indigo-950",
};

const LABEL: Record<string, string> = {
  transcribe: "transcribing",
  summarize: "summarising",
  extract: "extracting",
  assemble: "assembling",
};

export const Badge = ({ l }: { l: Lecture }) => (
  <span className={`cursor-default select-none px-nick font-pixel px-2 py-0.5 text-sm ${color[l.state] ?? "bg-coin text-yellow-950"}`}>
    {LABEL[l.state] ?? l.state}
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

  if (!q.data?.length) return <p className="font-pixel text-lg text-muted">No lectures yet. Hit Record to start one.</p>;
  return (
    <ul className="space-y-4">
      {q.data.map((l) => (
        <li key={l.id} className="px-card flex items-center gap-4 p-4">
          <Sprite name="book" size={4} />
          <button className="flex-1 text-left" onClick={() => open(l.id)}>
            <div className="font-pixel text-xl text-fg">{l.title}</div>
            <div className="text-xs text-muted">
              {l.course ?? "No course"} · {new Date(l.created * 1000).toLocaleString()} · {fmtDur(l.duration)}
            </div>
          </button>
          <Badge l={l} />
          <button
            className="px-link text-sm"
            onClick={() => {
              const t = prompt("Rename lecture", l.title);
              if (t) rename.mutate({ id: l.id, title: t });
            }}
          >
            rename
          </button>
          {IDLE.includes(l.state) && l.state !== "recording" && (
            <button className="px-link text-sm" onClick={() => reprocess.mutate(l.id)}>
              {l.state === "ready" ? "re-process" : "process"}
            </button>
          )}
          <button className="px-link text-sm text-red-400" onClick={() => confirm("Delete this lecture and all its files?") && del.mutate(l.id)}>
            delete
          </button>
        </li>
      ))}
    </ul>
  );
}
