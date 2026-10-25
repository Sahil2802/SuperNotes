import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, Health } from "./api/client";
import LectureDetail from "./screens/LectureDetail";
import Library from "./screens/Library";
import Record from "./screens/Record";

type View = { name: "library" } | { name: "record" } | { name: "lecture"; id: string };

function Setup({ h }: { h: Health }) {
  const o = h.ollama;
  return (
    <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      {!o.reachable && <p>Ollama isn't running. Install it from ollama.com and start it.</p>}
      {o.reachable && !o.model_pulled && (
        <p>
          Model not pulled. Run <code className="rounded bg-amber-100 px-1">ollama pull {o.model}</code>
        </p>
      )}
      {!h.whisper.present && <p>The Whisper "{h.whisper.model}" model downloads on first transcription (needs internet).</p>}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>({ name: "library" });
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: (q) => (q.state.data ? 15000 : 700),
  });
  const h = health.data;

  return (
    <div className="mx-auto max-w-4xl p-6 font-sans text-slate-900">
      <header className="mb-6 flex items-center justify-between">
        <button className="text-2xl font-semibold" onClick={() => setView({ name: "library" })}>
          Live Notes
        </button>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          engine: {h ? "ready" : "starting…"}
          <button className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white" onClick={() => setView({ name: "record" })}>
            ● Record
          </button>
        </div>
      </header>
      {h && (!h.ollama.model_pulled || !h.whisper.present) && <Setup h={h} />}
      {!h ? (
        <p className="text-slate-500">Waiting for the engine…</p>
      ) : view.name === "library" ? (
        <Library open={(id) => setView({ name: "lecture", id })} />
      ) : view.name === "record" ? (
        <Record done={(id) => setView({ name: "lecture", id })} />
      ) : (
        <LectureDetail id={view.id} back={() => setView({ name: "library" })} />
      )}
    </div>
  );
}
