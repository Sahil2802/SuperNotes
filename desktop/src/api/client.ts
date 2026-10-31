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
export type Profile = { name: string; subjects: string[]; avatar?: Record<string, string | number> };
export type Card ={ id: string; question: string; answer: string };
export type ReviewCard = { lecture_id: string; title: string; course: string | null; card: Card };
export type Detail = Lecture & {
  summary: string | null; has_audio: boolean;
  flashcards: Card[];
  terms: { term: string; definition: string }[];
  actions: string[];
};
export type SearchHit = { id: string; title: string; course: string | null; matched: string[]; snippet: string | null };
export type Segment = { start: number; end: number; text: string };
export type Health = {
  ready: boolean;
  ollama: { reachable: boolean; models: string[]; model: string; model_pulled: boolean; loaded: boolean; loading: boolean; error: string | null };
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
  loadModel: () => call("POST", "/model/load"),
  lectures: () => call<Lecture[]>("GET", "/lectures"),
  search: (q: string) => call<SearchHit[]>("GET", `/search?q=${encodeURIComponent(q)}`),
  lecture: (id: string) => call<Detail>("GET", `/lectures/${id}`),
  transcript: (id: string) => call<Segment[]>("GET", `/lectures/${id}/transcript`),
  start: (source: string, course?: string) => call<{ lecture_id: string }>("POST", "/record/start", { source, course: course || null }),
  pause: (lecture_id: string, paused: boolean) => call<{ paused: boolean }>("POST", "/record/pause", { lecture_id, paused }),
  stop: (lecture_id: string) => call<{ duration: number; error: string | null }>("POST", "/record/stop", { lecture_id }),
  process: (id: string) => call("POST", `/process/${id}`),
  cancel: (id: string) => call("POST", `/process/${id}/cancel`),
  patch: (id: string, p: { title?: string; course?: string }) => call("PATCH", `/lectures/${id}`, p),
  remove: (id: string) => call("DELETE", `/lectures/${id}`),
  addCard: (id: string, c: { question: string; answer: string }) => call<Card>("POST", `/lectures/${id}/cards`, c),
  editCard: (id: string, cid: string, p: { question?: string; answer?: string }) => call<Card>("PATCH", `/lectures/${id}/cards/${cid}`, p),
  deleteCard: (id: string, cid: string) => call("DELETE", `/lectures/${id}/cards/${cid}`),
  /** course: omit = all courses, "" = lectures with no course. */
  queue: (f: { course?: string; lecture?: string; practice?: string }) => {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== undefined) as [string, string][]).toString();
    return call<{ cards: ReviewCard[]; due: number; new_left: number }>("GET", `/review/queue${qs ? `?${qs}` : ""}`);
  },
  reviewCourses: () => call<{ due: number; streak: number; courses: { course: string | null; due: number }[] }>("GET", "/review/courses"),
  answer: (lecture_id: string, card_id: string, grade: 1 | 3 | 4 | 5) => call("POST", "/review/answer", { lecture_id, card_id, grade }),
  practiced: () => call("POST", "/review/practiced"),
  profile: () => call<{ profile: Profile | null; streak: number; days: Record<string, number> }>("GET", "/profile"),
  saveProfile: (p: Profile) => call<Profile>("PUT", "/profile", p),
  deleteAudio:(id: string) => call("DELETE", `/lectures/${id}/audio`),
};
