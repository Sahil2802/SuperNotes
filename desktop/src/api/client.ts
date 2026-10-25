declare global {
  interface Window {
    engine: { config: () => Promise<{ port: number; token: string }> };
  }
}

export type Stage = "transcribe" | "summarize" | "extract" | "assemble";
export type Lecture = {
  id: string; title: string; course: string | null; source: string; created: number; duration: number;
  state: string; stages: Record<Stage, string>; error: string | null; progress?: number;
};
export type Detail = Lecture & {
  summary: string | null; has_audio: boolean;
  flashcards: { question: string; answer: string }[];
  terms: { term: string; definition: string }[];
  actions: string[];
};
export type Segment = { start: number; end: number; text: string };
export type Health = {
  ready: boolean;
  ollama: { reachable: boolean; models: string[]; model: string; model_pulled: boolean };
  whisper: { model: string; present: boolean };
};

let cfgP: Promise<{ port: number; token: string }> | undefined;
const cfg = () => (cfgP ??= window.engine.config());

/** Absolute engine URL with the token as a query param (for <audio>, <a href>, WebSocket). */
export const url = async (path: string) => {
  const { port, token } = await cfg();
  return `http://127.0.0.1:${port}${path}${path.includes("?") ? "&" : "?"}token=${token}`;
};

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { port, token } = await cfg();
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "X-Token": token, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `${r.status}`);
  return r.json();
}

export const api = {
  health: () => call<Health>("GET", "/health"),
  lectures: () => call<Lecture[]>("GET", "/lectures"),
  lecture: (id: string) => call<Detail>("GET", `/lectures/${id}`),
  transcript: (id: string) => call<Segment[]>("GET", `/lectures/${id}/transcript`),
  start: (source: string, course?: string) => call<{ lecture_id: string }>("POST", "/record/start", { source, course: course || null }),
  stop: (lecture_id: string) => call<{ duration: number; error: string | null }>("POST", "/record/stop", { lecture_id }),
  process: (id: string) => call("POST", `/process/${id}`),
  cancel: (id: string) => call("POST", `/process/${id}/cancel`),
  patch: (id: string, p: { title?: string; course?: string }) => call("PATCH", `/lectures/${id}`, p),
  remove: (id: string) => call("DELETE", `/lectures/${id}`),
  deleteAudio: (id: string) => call("DELETE", `/lectures/${id}/audio`),
};
