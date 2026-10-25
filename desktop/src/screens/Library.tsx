import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, Lecture } from "../api/client";
import { Dot, Sprite } from "../Pixel";

export const fmtDur = (s: number) => {
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  return `${h ? h + ":" : ""}${mm}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

const IDLE = ["ready", "failed", "cancelled", "recorded"];
const dot: Record<string, string> = {
  ready: "bg-green-400",
  failed: "bg-red-400",
  cancelled: "bg-slate-400",
  recording: "bg-red-400",
  recorded: "bg-indigo-300",
};

const LABEL: Record<string, string> = {
  transcribe: "transcribing",
  summarize: "summarising",
  extract: "extracting",
  assemble: "assembling",
};

// A colored dot; the step name fades in 400ms after a process starts.
export const Badge = ({ l }: { l: Lecture }) => {
  const busy = !IDLE.includes(l.state);
  const name = LABEL[l.state] ?? l.state;
  return (
    <span className="flex items-center gap-2 font-pixel text-sm text-muted">
      <Dot color={dot[l.state] ?? "bg-coin"} pulse={busy} label={name} />
      {busy && (
        <span key={l.state} className="px-label">
          {name}
          {l.state === "transcribe" && l.progress ? ` ${Math.round(l.progress * 100)}%` : ""}
        </span>
      )}
    </span>
  );
};

function Menu({ items }: { items: { label: string; run: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button className="flex h-11 w-11 items-center justify-center font-pixel text-2xl leading-none text-muted hover:text-coin" aria-label="Actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        ⋮
      </button>
      {open && (
        <div role="menu" className="px-card px-pop absolute! right-0 top-full z-20 mt-2 flex w-44 flex-col p-2">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              className={`px-3 py-2.5 text-left font-pixel text-base hover:bg-edge/40 ${it.danger ? "mt-1 border-t-2 border-edge pt-3 text-red-400" : "text-fg"}`}
              onClick={() => {
                setOpen(false);
                it.run();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Library({ open }: { open: (id: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["lectures"],
    queryFn: api.lectures,
    refetchInterval: (query) => (query.state.data?.some((l) => !IDLE.includes(l.state)) ? 1500 : 10000),
  });
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["lectures"] });
  const del = useMutation({ mutationFn: api.remove, onSuccess: refresh });
  const reprocess = useMutation({ mutationFn: api.process, onSuccess: refresh });
  const rename = useMutation({ mutationFn: (v: { id: string; title: string }) => api.patch(v.id, { title: v.title }), onSuccess: refresh });

  if (!q.data?.length) return <p className="font-pixel text-lg text-muted">No lectures yet. Hit Record to start one.</p>;
  return (
    <ul className="space-y-4">
      {q.data.map((l) => (
        <li key={l.id} className="px-card flex items-center gap-4 p-4 focus-within:z-10">
          <Sprite name="book" size={4} />
          {editing?.id === l.id ? (
            <input
              autoFocus
              className="px-nick flex-1 border-2 border-edge bg-ink px-2 py-1 font-pixel text-xl text-fg"
              value={editing.title}
              onChange={(e) => setEditing({ id: l.id, title: e.target.value })}
              onBlur={() => setEditing(null)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(null);
                if (e.key === "Enter") {
                  if (editing.title.trim()) rename.mutate({ id: l.id, title: editing.title.trim() });
                  setEditing(null);
                }
              }}
            />
          ) : (
          <button className="flex-1 text-left" onClick={() => open(l.id)}>
            <div className="font-pixel text-xl text-fg">{l.title}</div>
            <div className="text-xs text-muted">
              {l.course ?? "No course"} · {new Date(l.created * 1000).toLocaleString()} · {fmtDur(l.duration)}
            </div>
          </button>
          )}
          <Badge l={l} />
          <Menu
            items={[
              { label: "Rename", run: () => setEditing({ id: l.id, title: l.title }) },
              ...(IDLE.includes(l.state) ? [{ label: l.state === "ready" ? "Re-process" : "Process", run: () => reprocess.mutate(l.id) }] : []),
              { label: "Delete", danger: true, run: () => confirm("Delete this lecture and all its files?") && del.mutate(l.id) },
            ]}
          />
        </li>
      ))}
    </ul>
  );
}
