import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, Profile as P } from "../api/client";

/** First-launch onboarding (`onboarding`) and the Profile screen share this form. */
export function ProfileForm({ initial, onboarding, done }: { initial?: P; onboarding?: boolean; done?: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name ?? "");
  const [subjects, setSubjects] = useState(initial?.subjects.join(", ") ?? "");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const save = async () => {
    try {
      await api.saveProfile({ name, subjects: subjects.split(",") });
      await qc.invalidateQueries({ queryKey: ["profile"] });
      setSaved(true);
      done?.();
    } catch (e) {
      setError(String((e as Error).message));
    }
  };

  return (
    <form className="px-card flex flex-col gap-4 p-6" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <label className="flex flex-col gap-1">
        <span className="font-pixel text-lg">What is your name?</span>
        <input className="border-2 border-edge bg-transparent p-2" autoFocus value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-pixel text-lg">Which subjects do you want to take notes on?</span>
        <input className="border-2 border-edge bg-transparent p-2" placeholder="Physics, Organic Chemistry, History…" value={subjects} onChange={(e) => { setSubjects(e.target.value); setSaved(false); }} />
        <span className="text-sm text-muted">Separate with commas.</span>
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center gap-3">
        <button className="px-btn px-4 py-2" disabled={!name.trim()}>{onboarding ? "Get started" : "Save"}</button>
        {saved && !onboarding && <span className="text-sm text-muted">Saved</span>}
      </div>
    </form>
  );
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Shade 1-4 by cards reviewed: 1-5, 6-10, 11-15, 16+. Days saved before counts existed (0) get the lightest. */
const shade = (n: number) => Math.min(4, Math.max(1, Math.ceil(n / 5)));

/** GitHub-style year grid: one column per week (Sun→Sat), green = reviewed that day, darker = more cards. */
function Heatmap({ days }: { days: Record<string, number> }) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 364 - today.getDay());
  const cells = Array.from({ length: 371 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)).filter((d) => d <= today);
  const inYear = cells.filter((d) => iso(d) in days).length;
  return (
    <section>
      <h3 className="mb-3 font-pixel text-xl text-fg">{inYear} days reviewed in the last year</h3>
      <div className="px-card p-4">
        <div className="grid grid-flow-col grid-rows-7 gap-1" style={{ gridAutoColumns: "1fr" }}>
          {cells.map((d) => {
            const n = days[iso(d)];
            const label = n === undefined ? "No reviews" : n ? `${n} card${n > 1 ? "s" : ""} reviewed` : "Reviewed";
            return <div key={+d} title={`${label} · ${d.toDateString()}`} className="aspect-square bg-edge/40" style={n === undefined ? undefined : { background: `var(--g${shade(n)})` }} />;
          })}
        </div>
      </div>
    </section>
  );
}

export default function Profile({ back }: { back: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["profile"], queryFn: api.profile });
  const lectures = useQuery({ queryKey: ["lectures"], queryFn: api.lectures });
  const due = useQuery({ queryKey: ["review", "courses"], queryFn: api.reviewCourses });
  const [name, setName] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const [error, setError] = useState("");
  const p = q.data?.profile;
  if (!p) return null;

  const save = async (next: P) => {
    try {
      await api.saveProfile(next);
      setError("");
      await qc.invalidateQueries({ queryKey: ["profile"] });
    } catch (e) {
      setError(String((e as Error).message));
    }
  };
  const commitName = () => {
    const n = (name ?? p.name).trim();
    setName(null);
    if (n && n !== p.name) save({ ...p, name: n });
  };
  const addSubject = () => {
    const s = adding.trim();
    setAdding("");
    if (s && !p.subjects.includes(s)) save({ ...p, subjects: [...p.subjects, s] });
  };
  const count = (c: string) => lectures.data?.filter((l) => l.course === c).length ?? 0;
  const stats: [string, string | number][] = [
    ["Day streak", `🔥 ${q.data?.streak ?? 0}`],
    ["Lectures", lectures.data?.length ?? 0],
    ["Cards due", due.data?.due ?? 0],
  ];

  return (
    <div className="space-y-6">
      <button className="px-link text-base" onClick={back}>← Back</button>
      <div className="flex items-center gap-4">
        <div className="px-card flex h-16 w-16 items-center justify-center font-pixel text-3xl text-coin">{p.name[0]?.toUpperCase()}</div>
        <input
          aria-label="Name"
          className="border-b-2 border-transparent bg-transparent font-pixel text-3xl font-bold text-fg hover:border-edge focus:border-coin focus:outline-none"
          value={name ?? p.name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </div>
      <div className="grid grid-cols-3 gap-4">
        {stats.map(([label, v]) => (
          <div key={label} className="px-card p-4">
            <div className="font-pixel text-3xl text-fg">{v}</div>
            <div className="text-sm text-muted">{label}</div>
          </div>
        ))}
      </div>
      <Heatmap days={q.data?.days ?? {}} />
      <section>
        <h3 className="mb-3 font-pixel text-xl text-fg">Subjects</h3>
        <ul className="mb-3 flex flex-wrap gap-2">
          {p.subjects.map((s) => (
            <li key={s} className="px-card flex items-center gap-2 px-3 py-1.5">
              <span>{s}</span>
              <span className="text-xs text-muted">{count(s)}</span>
              <button
                aria-label={`Remove ${s}`}
                title="Remove (lectures keep their course)"
                className="text-muted hover:text-red-400"
                onClick={() => confirm(`Remove "${s}" from your subjects? Lectures keep their course.`) && save({ ...p, subjects: p.subjects.filter((x) => x !== s) })}
              >×</button>
            </li>
          ))}
          {!p.subjects.length && <li className="text-muted">No subjects yet.</li>}
        </ul>
        <form className="flex gap-3" onSubmit={(e) => { e.preventDefault(); addSubject(); }}>
          <div className="px-card px-search flex-1">
            <input className="w-full bg-transparent px-3 py-2 text-fg" placeholder="Add a subject" value={adding} onChange={(e) => setAdding(e.target.value)} />
          </div>
          <button className="px-btn px-4 py-2" disabled={!adding.trim()}>Add</button>
        </form>
      </section>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
