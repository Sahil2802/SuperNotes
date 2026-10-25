import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { api, ReviewCard } from "../api/client";

const RATINGS = [
  { label: "Again", grade: 1 as const },
  { label: "Hard", grade: 3 as const },
  { label: "Good", grade: 4 as const },
  { label: "Easy", grade: 5 as const },
];
const ALL = "\u0000all"; // select value for "all courses"; "" is the no-course group

export default function Review({ lecture, back }: { lecture?: string; back: () => void }) {
  const qc = useQueryClient();
  const [course, setCourse] = useState(ALL);
  const [session, setSession] = useState<ReviewCard[] | null>(null);
  const [newLeft, setNewLeft] = useState(0);
  const [shown, setShown] = useState(false);
  const [error, setError] = useState("");
  const courses = useQuery({ queryKey: ["review", "courses"], queryFn: api.reviewCourses });

  useEffect(() => {
    setSession(null);
    setShown(false);
    api.queue({ course: lecture || course === ALL ? undefined : course, lecture }).then(
      (r) => { setSession(r.cards); setNewLeft(r.new_left); },
      (e) => setError(String(e.message)),
    );
  }, [course, lecture]);

  const rate = useCallback(
    async (grade: 1 | 3 | 4 | 5) => {
      const cur = session?.[0];
      if (!cur) return;
      try {
        await api.answer(cur.lecture_id, cur.card.id, grade);
      } catch (e) {
        setError(String((e as Error).message));
        return;
      }
      setShown(false);
      setSession((s) => (s ? [...s.slice(1), ...(grade === 1 ? [s[0]] : [])] : s)); // Again: back of the line
      qc.invalidateQueries({ queryKey: ["review"] });
    },
    [session, qc],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (!shown && (e.key === " " || e.key === "Enter")) { e.preventDefault(); setShown(true); }
      else if (shown && "1234".includes(e.key)) rate(RATINGS[Number(e.key) - 1].grade);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, rate]);

  const cur = session?.[0];
  return (
    <div>
      <button className="px-link mb-3 text-base" onClick={back}>← Back</button>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <h2 className="font-pixel text-3xl font-bold text-fg">Review</h2>
        {!lecture && (
          <select className="border-2 border-edge bg-transparent p-1" value={course} onChange={(e) => setCourse(e.target.value)}>
            <option value={ALL}>All courses{courses.data ? ` (${courses.data.due})` : ""}</option>
            {courses.data?.courses.map((c) => (
              <option key={c.course ?? ""} value={c.course ?? ""}>{c.course ?? "No course"} ({c.due})</option>
            ))}
          </select>
        )}
        {session && <span className="text-muted">{session.length} left</span>}
      </div>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      {!session ? (
        <p className="font-pixel text-muted">Loading…</p>
      ) : !cur ? (
        <p className="text-muted">
          Nothing due. Come back later.{newLeft <= 0 && " (Today's new-card limit has been reached.)"}
        </p>
      ) : (
        <div className="px-card p-6">
          <p className="mb-1 text-sm text-muted">{cur.course ?? "No course"} · {cur.title}</p>
          <p className="mb-4 text-xl font-medium">{cur.card.question}</p>
          {shown ? (
            <>
              <p className="mb-6 border-t-2 border-edge pt-4 text-green-300">{cur.card.answer}</p>
              <div className="flex gap-3">
                {RATINGS.map((r, i) => (
                  <button key={r.label} className="px-btn px-4 py-2" onClick={() => rate(r.grade)}>{r.label} <span className="text-xs opacity-60">{i + 1}</span></button>
                ))}
              </div>
            </>
          ) : (
            <button className="px-btn px-4 py-2" onClick={() => setShown(true)}>Show answer</button>
          )}
        </div>
      )}
    </div>
  );
}
