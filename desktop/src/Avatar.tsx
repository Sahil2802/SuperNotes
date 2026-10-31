import type { Profile } from "./api/client";

export type Look = Record<string, string | number>;

export const SKIN = ["#ffdbb4", "#f1c27d", "#d29a63", "#a86b3c", "#6b4226"];
export const HAIR = ["#1a1a1a", "#4a2c17", "#8a5a2b", "#d9a441", "#e8d28a", "#b3361f", "#5b8de0", "#c46bd6"];
export const CLOTH = ["#ffffff", "#2b2b3a", "#e0455f", "#f2a03d", "#4caf6e", "#3b8de0", "#6366f1", "#9a6a3c"];
export const STYLES = {
  hair: ["Short", "Spiky", "Long", "Bun"],
  top: ["T-shirt", "Long sleeve"],
  bottom: ["Pants", "Shorts", "Skirt"], // skirt: female only
  shoes: ["Sneakers", "Boots"],
};

export const DEFAULT_LOOK: Look = { gender: "m", skin: 1, hair: 0, hairC: 1, top: 0, topC: 5, bottom: 0, bottomC: 1, shoes: 0, shoesC: 0 };

const W = 14;
const H = 22;

const shade = (hex: string, f = 0.78) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * f).toString(16).padStart(2, "0")).join("");

/** Paints layers back to front onto a W×H grid; each rect call is one layer. */
function paint(look: Look): (string | null)[][] {
  const g: (string | null)[][] = Array.from({ length: H }, () => Array(W).fill(null));
  const r = (x: number, y: number, w: number, h: number, c: string) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (g[j]?.[i] !== undefined) g[j][i] = c;
  };
  const f = look.gender === "f";
  const skin = SKIN[+look.skin] ?? SKIN[0], hair = HAIR[+look.hairC] ?? HAIR[0];
  const top = CLOTH[+look.topC] ?? CLOTH[0], bot = CLOTH[+look.bottomC] ?? CLOTH[0], shoe = CLOTH[+look.shoesC] ?? CLOTH[0];
  const hs = +look.hair, ts = +look.top, bs = f ? +look.bottom : Math.min(+look.bottom, 1), ss = +look.shoes;
  const tx = f ? 4 : 3, tw = f ? 6 : 8; // torso x / width
  const ax = f ? [3, 10] : [2, 11]; // arm columns

  if (hs === 2) r(3, 3, 8, 9, hair); // long hair, behind the body
  // legs
  r(4, 16, 6, 5, skin);
  r(6, 16, 1, 5, shade(skin));
  // bottoms
  if (bs === 0) { r(4, 16, 6, 5, bot); r(6, 16, 2, 5, shade(bot)); }
  if (bs === 1) { r(4, 16, 6, 2, bot); r(6, 16, 2, 2, shade(bot)); }
  if (bs === 2) { r(3, 16, 8, 3, bot); r(3, 18, 8, 1, shade(bot)); r(6, 19, 2, 2, skin); }
  // shoes
  r(4, 21, 3, 1, shoe); r(7, 21, 3, 1, shoe);
  if (ss === 1) { r(4, 20, 3, 1, shade(shoe)); r(7, 20, 3, 1, shade(shoe)); }
  // arms + torso
  for (const x of ax) { r(x, 10, 1, 6, skin); r(x, 10, 1, ts === 1 ? 5 : 2, top); }
  r(tx, 10, tw, 6, top);
  r(tx, 15, tw, 1, shade(top));
  // neck + head
  r(6, 9, 2, 1, shade(skin));
  r(4, 3, 6, 6, skin);
  r(5, 6, 1, 1, "#1a1400"); r(8, 6, 1, 1, "#1a1400");
  r(6, 8, 2, 1, shade(skin, 0.7));
  // front hair
  r(4, 2, 6, 2, hair);
  if (hs === 0 || hs === 3) { r(4, 4, 1, 2, hair); r(9, 4, 1, 2, hair); }
  if (hs === 1) { r(4, 4, 1, 2, hair); r(9, 4, 1, 2, hair); r(4, 1, 1, 1, hair); r(6, 0, 2, 2, hair); r(9, 1, 1, 1, hair); }
  if (hs === 2) { r(4, 4, 1, 3, hair); r(9, 4, 1, 3, hair); }
  if (hs === 3) r(6, 0, 2, 2, hair);
  r(5, 3, 4, 1, shade(hair, 0.85));
  return g;
}

export function Avatar({ look, size = 4 }: { look?: Look | null; size?: number }) {
  const g = paint({ ...DEFAULT_LOOK, ...look });
  return (
    <svg width={W * size} height={H * size} viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges" className="shrink-0" role="img" aria-label="Your character">
      {g.flatMap((row, y) => row.map((c, x) => (c ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={c} /> : null)))}
    </svg>
  );
}

const Swatches = ({ colors, value, onPick, label }: { colors: string[]; value: number; onPick: (i: number) => void; label: string }) => (
  <div className="flex flex-wrap gap-1.5">
    {colors.map((c, i) => (
      <button key={c} type="button" aria-label={`${label} color ${i + 1}`} aria-pressed={i === value} onClick={() => onPick(i)}
        className={`h-6 w-6 border-2 ${i === value ? "border-coin" : "border-edge"}`} style={{ background: c }} />
    ))}
  </div>
);

const Styles = ({ names, value, onPick }: { names: string[]; value: number; onPick: (i: number) => void }) => (
  <div className="flex flex-wrap gap-1.5">
    {names.map((n, i) => (
      <button key={n} type="button" aria-pressed={i === value} onClick={() => onPick(i)}
        className={`border-2 px-2 py-0.5 font-pixel text-sm ${i === value ? "border-coin text-coin" : "border-edge text-muted"}`}>{n}</button>
    ))}
  </div>
);

/** Live preview + option rows. `onChange` receives the full new look. */
export function AvatarEditor({ profile, onChange }: { profile: Profile; onChange: (look: Look) => void }) {
  const look = { ...DEFAULT_LOOK, ...profile.avatar };
  const set = (k: string, v: string | number) => onChange({ ...look, [k]: v });
  const female = look.gender === "f";
  const bottoms = STYLES.bottom.slice(0, female ? 3 : 2);
  const rows: [string, string, string[] | null, string[]][] = [
    ["Skin", "skin", null, SKIN],
    ["Hair", "hair", STYLES.hair, HAIR],
    ["Top", "top", STYLES.top, CLOTH],
    ["Bottom", "bottom", bottoms, CLOTH],
    ["Shoes", "shoes", STYLES.shoes, CLOTH],
  ];
  return (
    <section>
      <h3 className="mb-3 font-pixel text-xl text-fg">Your character</h3>
      <div className="px-card flex flex-wrap gap-6 p-4">
        <div className="flex items-center justify-center px-4"><Avatar look={look} size={8} /></div>
        <div className="flex min-w-60 flex-1 flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="w-16 font-pixel text-base text-muted">Body</span>
            <Styles names={["Male", "Female"]} value={female ? 1 : 0} onPick={(i) => onChange({ ...look, gender: i ? "f" : "m", bottom: Math.min(+look.bottom, i ? 2 : 1) })} />
          </div>
          {rows.map(([label, key, names, colors]) => (
            <div key={key} className="flex items-start gap-3">
              <span className="w-16 pt-0.5 font-pixel text-base text-muted">{label}</span>
              <div className="flex flex-col gap-1.5">
                {names && <Styles names={names} value={+look[key]} onPick={(i) => set(key, i)} />}
                <Swatches colors={colors} label={label} value={+look[key === "skin" ? "skin" : key + "C"]} onPick={(i) => set(key === "skin" ? "skin" : key + "C", i)} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
