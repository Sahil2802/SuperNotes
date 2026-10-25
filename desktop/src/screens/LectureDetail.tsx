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

function Flashcards({ cards, id, ready }: { cards: Detail["flashcards"]; id: string; ready: boolean }) {
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
      {ready ? (
        <a className="mb-3 inline-block px-btn px-3 py-1.5 text-sm" href={href}>
          Export to Anki
        </a>
      ) : (
        <p className="mb-3 text-sm text-muted">Anki export is available once the notes are ready.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c, i) => (
          <button key={i} className="px-card min-h-24 p-4 text-left hover:[--e:var(--color-coin)]" onClick={() => toggle(i)}>
            {flipped.has(i) ? <span className="text-green-300">{c.answer}</span> : <span className="font-medium">{c.question}</span>}
          </button>
        ))}
      </div>
      {!cards.length && <p className="text-muted">No flashcards.</p>}
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
      {src && <audio ref={audio} src={src} controls className="sticky top-0 mb-3 w-full" />}
      {q.data?.map((s, i) => (
        <p key={i} className="py-0.5">
          <button className="mr-2 font-pixel text-sm text-coin underline" onClick={() => seek(s.start)}>
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
  if (!d) return <p className="font-pixel text-muted">Loading…</p>;

  return (
    <div>
      <button className="px-link mb-3 text-base" onClick={back}>
        ← Library
      </button>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="font-pixel text-3xl font-bold text-fg">{d.title}</h2>
        <Badge l={d} />
        {BUSY.includes(d.state) && (
          <button className="px-link text-sm" onClick={() => act.mutate(() => api.cancel(id))}>
            cancel
          </button>
        )}
        {d.state === "ready" && (
          <a className="px-link text-sm" href={notes}>
            download notes (.md)
          </a>
        )}
        {d.has_audio && (
          <button
            className="px-link text-sm"
            onClick={() => confirm("Delete the recorded audio? The transcript and notes stay.") && act.mutate(() => api.deleteAudio(id))}
          >
            delete audio
          </button>
        )}
      </div>
      {d.error && <p className="mb-3 text-sm text-red-400">{d.error}</p>}
      <div className="mb-5 flex gap-2 border-b-2 border-edge">
        {TABS.map((t) => (
          <button key={t} className={`px-3 py-1.5 font-pixel text-base ${tab === t ? "px-nick bg-coin text-yellow-950" : "text-muted hover:text-fg"}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Summary" &&
        (d.summary ? (
          <article className="px-card p-5 leading-relaxed [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc">
            <Markdown>{d.summary}</Markdown>
          </article>
        ) : (
          <p className="text-muted">Not generated yet.</p>
        ))}
      {tab === "Transcript" && <Transcript id={id} hasAudio={d.has_audio} />}
      {tab === "Flashcards" && <Flashcards cards={d.flashcards} id={id} ready={d.state === "ready"} />}
      {tab === "Terms & Actions" && (
        <div className="space-y-4">
          <section>
            <h3 className="mb-1 font-pixel text-xl text-coin">Terms</h3>
            {d.terms.map((t, i) => (
              <p key={i}>
                <b>{t.term}</b>: {t.definition}
              </p>
            ))}
          </section>
          <section>
            <h3 className="mb-1 font-pixel text-xl text-coin">Action items</h3>
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
