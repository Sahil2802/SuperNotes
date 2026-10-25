import { useEffect, useRef, useState } from "react";

/** Themed dropdown (replaces the OS-drawn <select>, which ignores the theme). */
export default function Select({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} className="px-btn ghost soft flex items-center gap-2 px-3 py-1.5 text-base" onClick={() => setOpen(!open)}>
        {options.find((o) => o.value === value)?.label}
        <span className="text-xs text-muted">▾</span>
      </button>
      {open && (
        <ul role="listbox" className="px-card left-0 top-full z-10 mt-2 min-w-full py-2" style={{ position: "absolute" }}>
          {options.map((o) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`cursor-pointer whitespace-nowrap px-4 py-1 font-pixel text-base hover:bg-edge/40 ${o.value === value ? "text-coin" : "text-fg"}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >{o.label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
