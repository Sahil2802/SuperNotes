const PAL: Record<string, string> = {
  k: "#1a1400", y: "#ffd60a", o: "#e8a200", w: "#ffffff", r: "#ff4d6d", d: "#a3203a", g: "#6ee7a0", b: "#6366f1", p: "#c4b5fd",
};

const SPRITES = {
  mic: [
    "...kkkk...",
    "..kwwwwk..",
    "..kwppwk..",
    "..kwppwk..",
    "..kwppwk..",
    "k.kwwwwk.k",
    "k..kkkk..k",
    ".k......k.",
    "..kkkkkk..",
    "....kk....",
    "...kkkk...",
  ],
  book: [
    "..........",
    ".kkkkkkkk.",
    "kbbbbbbbbk",
    "kbwwwwwwbk",
    "kbbbbbbbbk",
    "kbwwwwbbbk",
    "kbbbbbbbbk",
    "kbwwwwwwbk",
    "kbbbbbbbbk",
    ".kkkkkkkk.",
  ],
  coin: [
    "..kkkk..",
    ".kyyyyk.",
    "kyyowyyk",
    "kyyowyyk",
    "kyyowyyk",
    "kyyooyyk",
    ".kyyyyk.",
    "..kkkk..",
  ],
};

export function Sprite({ name, size = 4 }: { name: keyof typeof SPRITES; size?: number }) {
  const rows = SPRITES[name];
  return (
    <svg width={rows[0].length * size} height={rows.length * size} viewBox={`0 0 ${rows[0].length} ${rows.length}`} shapeRendering="crispEdges" className="shrink-0" aria-hidden>
      {rows.flatMap((row, y) => [...row].map((c, x) => (c === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={PAL[c]} />)))}
    </svg>
  );
}

const W = 120;
const H = 24;
const SKY = ["#2d1b69", "#3b2380", "#4c2a85", "#6b2f8a", "#8a3a8c", "#a8458a", "#c4527f", "#da6a74"];
const ridge = (x: number, base: number, amp: number, f: number) => Math.round(base + amp * Math.abs(Math.sin(x / f)) + amp * 0.4 * Math.sin(x / (f * 0.37)));

// ponytail: static scene, drawn once; swap for a PNG if you want real art
const scene = (() => {
  const px: [number, number, string][] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px.push([x, y, SKY[Math.min(SKY.length - 1, Math.floor((y / H) * SKY.length * 1.4))]]);
  for (let x = 0; x < W; x++) {
    for (let y = H - ridge(x, 6, 9, 9); y < H; y++) px.push([x, y, "#5b3a8c"]);
    for (let y = H - ridge(x + 40, 3, 5, 6); y < H; y++) px.push([x, y, "#2e2455"]);
  }
  // snow cap on tallest back peak
  for (let x = 0; x < W; x++) {
    const top = H - ridge(x, 6, 9, 9);
    if (top < 8) for (let y = top; y < top + 2; y++) px.push([x, y, "#f3e8ff"]);
  }
  for (const [cx, cy, c] of [[100, 4, "#ffe28a"]] as const) for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) if (x * x + y * y <= 9) px.push([cx + x, cy + y, c]);
  for (const [cx, cy] of [[18, 4], [58, 7], [84, 3]]) for (const [dx, dy, w] of [[0, 0, 8], [2, -1, 4], [-1, 1, 10]]) for (let i = 0; i < w; i++) px.push([cx + dx + i, cy + dy, "#e9c2f0"]);
  return px.filter(([x, y]) => x >= 0 && x < W && y >= 0 && y < H);
})();

export function Banner() {
  return (
    <div className="px-card mb-8 p-[2px]">
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" shapeRendering="crispEdges" className="block h-36 w-full" style={{ clipPath: "var(--pc)" }} aria-hidden>
      {scene.map(([x, y, c], i) => (
        <rect key={i} x={x} y={y} width="1" height="1" fill={c} />
      ))}
    </svg>
    </div>
  );
}
