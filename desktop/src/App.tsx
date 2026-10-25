import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, Health } from "./api/client";
import LectureDetail from "./screens/LectureDetail";
import Library from "./screens/Library";
import { Banner, Sprite } from "./Pixel";
import Record from "./screens/Record";

type View = { name: "library" } | { name: "record" } | { name: "lecture"; id: string };

function Setup({ h }: { h: Health }) {
  const o = h.ollama;
  return (
    <div className="mb-4 px-card [--e:var(--color-coin)] p-3 text-sm text-amber-200">
      {!o.reachable && <p>Ollama isn't running. Install it from ollama.com and start it.</p>}
      {o.reachable && !o.model_pulled && (
        <p>
          Model not pulled. Run <code className="bg-edge/30 px-1">ollama pull {o.model}</code>
        </p>
      )}
      {!h.whisper.present && <p>The Whisper "{h.whisper.model}" model downloads on first transcription (needs internet).</p>}
    </div>
  );
}

function ModelStatus({ h }: { h: Health }) {
  const qc = useQueryClient();
  const load = useMutation({ mutationFn: api.loadModel, onSuccess: () => qc.invalidateQueries({ queryKey: ["health"] }) });
  const o = h.ollama;
  if (!o.reachable || !o.model_pulled) return null; // the setup banner covers these
  if (o.loaded) return <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 bg-green-400" />model: loaded</span>;
  if (o.loading || load.isPending)
    return <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 animate-pulse bg-coin" />model: loading…</span>;
  return (
    <button className="px-btn ghost px-3 py-1.5 text-base" title={o.error ?? "Load the model now so the first lecture isn't slow"} onClick={() => load.mutate()}>
      {o.error ? "Retry load model" : "Load model"}
    </button>
  );
}

export default function App() {
  const [view, setView] = useState<View>({ name: "library" });
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") ?? "dark");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: (q) => (!q.state.data ? 700 : q.state.data.ollama.loading ? 1000 : 15000),
  });
  const h = health.data;

  return (
    <div className="mx-auto max-w-4xl p-6 font-sans">
      <header className="mb-8 flex items-center justify-between border-b-2 border-edge pb-4">
        <button className="font-pixel text-3xl font-bold tracking-wide text-fg" onClick={() => setView({ name: "library" })}>
          <span className="mr-3 inline-block align-middle"><Sprite name="coin" size={4} /></span>Live Notes
        </button>
        <div className="flex items-center gap-4 font-pixel text-sm text-muted">
          <span className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 ${h ? "bg-green-400" : "animate-pulse bg-coin"}`} />
            engine: {h ? "ready" : "starting…"}
          </span>
          {h && <ModelStatus h={h} />}
          <button className="px-btn ghost px-3 py-1.5 text-base" title="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "☀ Light" : "☾ Dark"}
          </button>
          <button className="px-btn red px-4 py-1.5 text-base" onClick={() => setView({ name: "record" })}>
            ● Record
          </button>
        </div>
      </header>
      <div hidden={view.name !== "library"}>
        <Banner />
      </div>
      {h && (!h.ollama.model_pulled || !h.whisper.present) && <Setup h={h} />}
      {!h ? (
        <p className="font-pixel text-muted">Waiting for the engine…</p>
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
