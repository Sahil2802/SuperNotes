import { useQuery } from "@tanstack/react-query";
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
    refetchInterval: (q) => (q.state.data ? 15000 : 700),
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
          <button className="px-btn ghost px-3 py-1.5 text-base" title="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "☀ Light" : "☾ Dark"}
          </button>
          <button className="px-btn red px-4 py-1.5 text-base" onClick={() => setView({ name: "record" })}>
            ● Record
          </button>
        </div>
      </header>
      {view.name === "library" && <Banner />}
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
