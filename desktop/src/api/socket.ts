import { useEffect, useState } from "react";
import { url } from "./client";

export type Meter = { level: number; recording: boolean; lecture_id: string | null; seconds: number; error: string | null };

export function useMeter(): Meter {
  const [m, setM] = useState<Meter>({ level: 0, recording: false, lecture_id: null, seconds: 0, error: null });
  useEffect(() => {
    let ws: WebSocket | undefined;
    let dead = false;
    url("/ws").then((u) => {
      if (dead) return;
      ws = new WebSocket(u.replace("http", "ws"));
      ws.onmessage = (e) => setM(JSON.parse(e.data));
    });
    return () => {
      dead = true;
      ws?.close();
    };
  }, []);
  return m;
}
