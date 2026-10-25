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

function Flashcards({ cards, id, ready, review }: { cards: Detail["flashcards"]; id: string; ready: boolean; review: () => void }) {
  const qc = useQueryClient();
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ question: "", answer: "" });
  const href = useUrl(`/lectures/${id}/anki`);
  const save = useMutation({
    mutationFn: (f: () => Promise<unknown>) => f(),
    onSuccess: () => {
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["lecture", id] });
      qc.invalidateQueries({ queryKey: ["review"] });
    },
  });
  const toggle = (cid: string) =>
    setFlipped((s) => {
      const n = new Set(s);
      if (!n.delete(cid)) n.add(cid);
      return n;
    });
  const form = (submit: () => void, label: string) => (
    <div className="space-y-2">
      <input className="w-full bg-transparent border-2 border-edge p-2" placeholder="Question" value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} />
      <textarea className="w-full bg-transparent border-2 border-edge p-2" placeholder="Answer" value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} />
      <div className="flex gap-3 text-sm">
        <button className="px-btn px-3 py-1" disabled={!draft.question.trim() || !draft.answer.trim() || save.isPending} onClick={submit}>{label}</button>
        <button className="px-link" onClick={() => setEditing(null)}>Cancel</button>
      </div>
    </div>
  );
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {ready ? (
          <a className="px-btn px-3 py-1.5 text-sm" href={href}>Export to Anki</a>
        ) : (
          <p className="text-sm text-muted">Anki export, review and editing are available once the notes are ready.</p>
        )}
        {ready && cards.length > 0 && <button className="px-btn px-3 py-1.5 text-sm" onClick={review}>Review this lecture</button>}
        {ready && <button className="px-link text-sm" onClick={() => { setDraft({ question: "", answer: "" }); setEditing("new"); }}>+ Add card</button>}
      </div>
      {save.error && <p className="mb-2 text-sm text-red-400">{String(save.error.message)}</p>}
      {editing === "new" && <div className="px-card mb-3 p-4">{form(() => save.mutate(() => api.addCard(id, draft)), "Add")}</div>}
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <div key={c.id} className="px-card min-h-24 p-4">
            {editing === c.id ? (
              form(() => save.mutate(() => api.editCard(id, c.id, draft)), "Save")
            ) : (
              <>
                <button className="w-full text-left" onClick={() => toggle(c.id)}>
                  {flipped.has(c.id) ? <span className="text-green-300">{c.answer}</span> : <span className="font-medium">{c.question}</span>}
                </button>
                {ready && (
                  <div className="mt-2 flex gap-3 text-sm">
                    <button className="px-link" onClick={() => { setDraft({ question: c.question, answer: c.answer }); setEditing(c.id); }}>edit</button>
                    <button className="px-link" onClick={() => confirm("Delete this card?") && save.mutate(() => api.deleteCard(id, c.id))}>delete</button>
                  </div>
                )}
              </>
            )}
          </div>
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

export default function LectureDetail({ id, back, review }: { id: string; back: () => void; review: (id: string) => void }) {
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
      {tab === "Flashcards" && <Flashcards cards={d.flashcards} id={id} ready={d.state === "ready"} review={() => review(id)} />}
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
