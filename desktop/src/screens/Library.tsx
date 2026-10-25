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

const highlight = (text: string, words: string[]) => {
  if (!words.length) return text;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).map((p, i) => (i % 2 ? <mark key={i} className="bg-coin text-[#1a1400]">{p}</mark> : p));
};

export default function Library({ open }: { open: (id: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["lectures"],
    queryFn: api.lectures,
    refetchInterval: (query) => (query.state.data?.some((l) => !IDLE.includes(l.state)) ? 1500 : 10000),
  });
  const [editing, setEditing] = useState<{ id: string; field: "title" | "course"; value: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["lectures"] });
  const del = useMutation({ mutationFn: api.remove, onSuccess: refresh });
  const reprocess = useMutation({ mutationFn: api.process, onSuccess: refresh });
  const edit = useMutation({ mutationFn: (v: { id: string; field: "title" | "course"; value: string }) => api.patch(v.id, { [v.field]: v.value }), onSuccess: refresh });
  const profile = useQuery({ queryKey: ["profile"], queryFn: api.profile });
  const courseOptions = [...new Set([...(profile.data?.profile?.subjects ?? []), ...(q.data?.map((l) => l.course).filter(Boolean) as string[] ?? [])])];

  const suggestions = editing?.field === "course" ? courseOptions.filter((c) => c.toLowerCase().includes(editing.value.toLowerCase())) : [];

  const [text, setText] = useState("");
  const [scope, setScope] = useState<"all" | "names">("all");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const hits = useQuery({ queryKey: ["search", term], queryFn: () => api.search(term), enabled: !!term && scope === "all" });

  const [view, setView] = useState<"subjects" | "recordings">("subjects");
  const [subject, setSubject] = useState<string | null>(null); // "" = lectures without a course

  if (!q.data?.length) return <p className="font-pixel text-lg text-muted">No lectures yet. Hit Record to start one.</p>;
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const inSubject = view === "subjects" && subject !== null;
  const base = inSubject ? q.data.filter((l) => (l.course ?? "") === subject) : q.data;
  const shown = scope === "names" ? base.filter((l) => words.every((w) => l.title.toLowerCase().includes(w))) : base;
  const gallery = view === "subjects" && subject === null && !text.trim();
  const counts = new Map<string, number>();
  q.data.forEach((l) => counts.set(l.course ?? "", (counts.get(l.course ?? "") ?? 0) + 1));
  const subjects = [...new Set([...(profile.data?.profile?.subjects ?? []), ...counts.keys()].filter(Boolean)), ...(counts.has("") ? [""] : [])];
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        {([["subjects", "All subjects"], ["recordings", "All recordings"]] as const).map(([v, label]) => (
          <button key={v} aria-pressed={view === v} className={`px-btn px-3 text-base ${view === v ? "" : "ghost soft"}`} onClick={() => { setView(v); setSubject(null); }}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex gap-3">
        <div className="px-card px-search flex-1">
          <input
            className="w-full bg-transparent px-3 py-2 font-pixel text-lg text-fg"
            placeholder={scope === "all" ? "Search transcripts, summaries, terms…" : "Search lecture names…"}
            aria-label="Search lectures"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        {(["all", "names"] as const).map((s) => (
          <button
            key={s}
            aria-pressed={scope === s}
            className={`px-btn px-3 text-base ${scope === s ? "" : "ghost soft"}`}
            onClick={() => setScope(s)}
          >
            {s === "all" ? "Everything" : "Names"}
          </button>
        ))}
      </div>
      {term && scope === "all" ? (
        <ul className="space-y-4">
          {hits.data?.map((h) => (
            <li key={h.id}>
              <button className="px-card w-full p-4 text-left" onClick={() => open(h.id)}>
                <div className="font-pixel text-xl text-fg">{h.title}</div>
                {h.snippet && <div className="mt-1 text-sm text-muted">{highlight(h.snippet, words)}</div>}
                <div className="mt-1 text-xs text-muted">
                  {h.course || "No course"} · matched in {h.matched.join(", ")}
                </div>
              </button>
            </li>
          ))}
          {hits.data?.length === 0 && <p className="font-pixel text-lg text-muted">No matches.</p>}
        </ul>
      ) : gallery ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {subjects.map((s) => (
            <li key={s}>
              <button className="px-card flex w-full flex-col gap-3 p-4 text-left" onClick={() => setSubject(s)}>
                <Sprite name="book" size={4} />
                <div className="font-pixel text-xl text-fg">{s || "No course"}</div>
                <div className="text-sm text-muted">{counts.get(s) ?? 0} lecture{counts.get(s) === 1 ? "" : "s"}</div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
    <>
    {inSubject && !text.trim() && (
      <div className="flex items-center gap-3">
        <button className="px-link text-base" onClick={() => setSubject(null)}>← All subjects</button>
        <h2 className="font-pixel text-2xl text-fg">{subject || "No course"}</h2>
      </div>
    )}
    <ul className="space-y-4">
      {shown.map((l) => (
        <li key={l.id} className="px-card flex items-center gap-4 p-4 focus-within:z-10">
          <Sprite name="book" size={4} />
          {editing?.id === l.id ? (
            <div className="relative flex-1">
              <div className="px-card px-search">
                <input
                  autoFocus
                  className="w-full bg-transparent px-3 py-1 font-pixel text-xl text-fg"
                  placeholder={editing.field === "course" ? "Course" : undefined}
                  value={editing.value}
                  onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                  onBlur={() => setEditing(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setEditing(null);
                    if (e.key === "Enter") {
                      if (editing.field === "course" || editing.value.trim()) edit.mutate({ ...editing, value: editing.value.trim() });
                      setEditing(null);
                    }
                  }}
                />
              </div>
              {editing.field === "course" && suggestions.length > 0 && (
                <ul className="px-card left-0 top-full z-10 mt-2 min-w-full py-2" style={{ position: "absolute" }}>
                  {suggestions.map((c) => (
                    <li
                      key={c}
                      className="cursor-pointer whitespace-nowrap px-4 py-1 font-pixel text-base text-fg hover:bg-edge/40"
                      onMouseDown={(e) => { e.preventDefault(); edit.mutate({ ...editing, value: c }); setEditing(null); }}
                    >{c}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
          <button className="flex-1 text-left" onClick={() => open(l.id)}>
            <div className="font-pixel text-xl text-fg">{l.title}</div>
            <div className="text-xs text-muted">
              {l.course || "No course"} · {new Date(l.created * 1000).toLocaleString()} · {fmtDur(l.duration)}
            </div>
          </button>
          )}
          <Badge l={l} />
          <Menu
            items={[
              { label: "Rename", run: () => setEditing({ id: l.id, field: "title", value: l.title }) },
              { label: "Set course", run: () => setEditing({ id: l.id, field: "course", value: l.course ?? "" }) },
              ...(IDLE.includes(l.state) ? [{ label: l.state === "ready" ? "Re-process" : "Process", run: () => (l.state !== "ready" || confirm("Re-process this lecture? Its summary and flashcards will be regenerated.")) && reprocess.mutate(l.id) }] : []),
              { label: "Delete", danger: true, run: () => confirm("Delete this lecture and all its files?") && del.mutate(l.id) },
            ]}
          />
        </li>
      ))}
    </ul>
    </>
      )}
    </div>
  );
}
