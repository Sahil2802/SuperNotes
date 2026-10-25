import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { api, Detail, url } from "../api/client";
import { Badge, fmtDur } from "./Library";

const TABS = ["Summary", "Transcript", "Flashcards", "Terms & Actions"] as const;
const BUSY = ["queued", "transcribe", "summarize", "extract", "assemble"];

function useUrl(path: string, enabled = true) {
  const [u, setU] = useState("");
  useEffect(() => {
    if (enabled) url(path).then(setU);
  }, [path, enabled]);
  return u;
}

function Flashcards({ cards, id }: { cards: Detail["flashcards"]; id: string }) {
  const [flipped, setFlipped] = useState<Set<number>>(new Set());
  const href = useUrl(`/lectures/${id}/anki`);
  const toggle = (i: number) =>
    setFlipped((s) => {
      const n = new Set(s);
      if (!n.delete(i)) n.add(i);
      return n;
    });
  return (
    <div>
      <a className="mb-3 inline-block rounded bg-slate-800 px-3 py-1.5 text-sm text-white" href={href}>
        Export to Anki
      </a>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c, i) => (
          <button key={i} className="min-h-24 rounded border p-4 text-left" onClick={() => toggle(i)}>
            {flipped.has(i) ? <span className="text-green-800">{c.answer}</span> : <span className="font-medium">{c.question}</span>}
          </button>
        ))}
      </div>
      {!cards.length && <p className="text-slate-500">No flashcards.</p>}
    </div>
  );
}

function Transcript({ id, hasAudio }: { id: string; hasAudio: boolean }) {
  const q = useQuery({ queryKey: ["transcript", id], queryFn: () => api.transcript(id) });
  const audio = useRef<HTMLAudioElement>(null);
  const src = useUrl(`/lectures/${id}/audio`, hasAudio);
  const seek = (t: number) => {
    if (!audio.current) return;
    audio.current.currentTime = t;
    audio.current.play();
  };
  return (
    <div>
      {src && <audio ref={audio} src={src} controls className="sticky top-0 mb-3 w-full bg-white" />}
      {q.data?.map((s, i) => (
        <p key={i} className="py-0.5">
          <button className="mr-2 font-mono text-xs text-blue-700 underline" onClick={() => seek(s.start)}>
            {fmtDur(s.start)}
          </button>
          {s.text}
        </p>
      ))}
    </div>
  );
}

export default function LectureDetail({ id, back }: { id: string; back: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Summary");
  const q = useQuery({
    queryKey: ["lecture", id],
    queryFn: () => api.lecture(id),
    refetchInterval: (query) => (BUSY.includes(query.state.data?.state ?? "") ? 1500 : false),
  });
  const act = useMutation({
    mutationFn: (f: () => Promise<unknown>) => f(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lecture", id] }),
  });
  const notes = useUrl(`/lectures/${id}/notes`);
  const d = q.data;
  if (!d) return <p className="text-slate-500">Loading…</p>;

  return (
    <div>
      <button className="mb-2 text-sm underline" onClick={back}>
        ← Library
      </button>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">{d.title}</h2>
        <Badge l={d} />
        {BUSY.includes(d.state) && (
          <button className="text-xs underline" onClick={() => act.mutate(() => api.cancel(id))}>
            cancel
          </button>
        )}
        {d.state === "ready" && (
          <a className="text-xs underline" href={notes}>
            download notes (.md)
          </a>
        )}
        {d.has_audio && (
          <button
            className="text-xs underline"
            onClick={() => confirm("Delete the recorded audio? The transcript and notes stay.") && act.mutate(() => api.deleteAudio(id))}
          >
            delete audio
          </button>
        )}
      </div>
      {d.error && <p className="mb-3 text-sm text-red-600">{d.error}</p>}
      <div className="mb-4 flex gap-2 border-b">
        {TABS.map((t) => (
          <button key={t} className={`px-3 py-1.5 text-sm ${tab === t ? "border-b-2 border-slate-900 font-medium" : "text-slate-500"}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Summary" &&
        (d.summary ? (
          <article className="[&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc">
            <Markdown>{d.summary}</Markdown>
          </article>
        ) : (
          <p className="text-slate-500">Not generated yet.</p>
        ))}
      {tab === "Transcript" && <Transcript id={id} hasAudio={d.has_audio} />}
      {tab === "Flashcards" && <Flashcards cards={d.flashcards} id={id} />}
      {tab === "Terms & Actions" && (
        <div className="space-y-4">
          <section>
            <h3 className="mb-1 font-semibold">Terms</h3>
            {d.terms.map((t, i) => (
              <p key={i}>
                <b>{t.term}</b> — {t.definition}
              </p>
            ))}
          </section>
          <section>
            <h3 className="mb-1 font-semibold">Action items</h3>
            <ul>
              {d.actions.map((a, i) => (
                <li key={i} className="ml-5 list-disc">
                  {a}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
