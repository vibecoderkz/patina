import { useRef, useState, type ReactNode } from "react";

let dragSeq = 0;

/**
 * Scrubbable value: drag anywhere on it, or double-click to type. `onChange(value, key)` gets one
 * history key per drag so a whole drag is one undo step.
 */
export function Slider({ name, value, min = 0, max = 1, step = 0.01, onChange, format, disabled }: {
  name: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number, historyKey: string) => void;
  format?: (v: number) => string;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ key: string; x0: number; v0: number; moved: boolean } | null>(null);
  const clampV = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const frac = (value - min) / (max - min || 1);
  const fmt = format ?? ((v: number) => (step >= 1 ? String(Math.round(v)) : v.toFixed(step < 0.01 ? 3 : 2)));
  if (editing)
    return (
      <div className="slider">
        <input
          autoFocus
          defaultValue={fmt(value)}
          onBlur={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(clampV(v), `type-${++dragSeq}`);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(false);
            e.stopPropagation();
          }}
        />
      </div>
    );
  return (
    <div
      ref={ref}
      className="slider"
      style={disabled ? { opacity: 0.45, pointerEvents: "none" } : undefined}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { key: `drag-${++dragSeq}`, x0: e.clientX, v0: value, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const w = ref.current!.clientWidth;
        const dx = e.clientX - d.x0;
        if (!d.moved && Math.abs(dx) < 2) return;
        d.moved = true;
        const fine = e.shiftKey ? 0.1 : 1;
        onChange(clampV(d.v0 + (dx / w) * (max - min) * fine), d.key);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) {
          // click: jump to the clicked position
          const r = ref.current!.getBoundingClientRect();
          onChange(clampV(min + ((e.clientX - r.left) / r.width) * (max - min)), d.key);
        }
      }}
      onDoubleClick={() => setEditing(true)}
    >
      <div className="fill" style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%` }} />
      <span className="nm">{name}</span>
      <span className="val">{fmt(value)}</span>
    </div>
  );
}

export function ColorField({ value, onChange }: { value: string; onChange: (hex: string, historyKey: string) => void }) {
  const key = useRef(`color-${++dragSeq}`);
  return (
    <div className="color">
      <div className="swatch" style={{ background: value }}>
        <input
          type="color"
          value={value}
          onFocus={() => (key.current = `color-${++dragSeq}`)}
          onChange={(e) => onChange(e.target.value, key.current)}
        />
      </div>
      <input
        className="hex"
        key={value}
        defaultValue={value}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (/^#?[0-9a-fA-F]{6}$/.test(v)) onChange(v.startsWith("#") ? v.toLowerCase() : `#${v.toLowerCase()}`, `hex-${++dragSeq}`);
          else e.target.value = value;
        }}
      />
    </div>
  );
}

export function Toggle({ on, onChange, title }: { on: boolean; onChange: (v: boolean) => void; title?: string }) {
  return <button className={`tog ${on ? "on" : ""}`} title={title} onClick={() => onChange(!on)} aria-pressed={on} />;
}

export function Ctl({ label, children, off }: { label: string; children: ReactNode; off?: boolean }) {
  return (
    <div className={`ctl ${off ? "off" : ""}`}>
      <label>{label}</label>
      {children}
    </div>
  );
}

export function Select<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <select className="sel" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export const BLEND_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "multiply", label: "Multiply" },
  { value: "add", label: "Add" },
  { value: "subtract", label: "Subtract" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
  { value: "max", label: "Lighten (max)" },
  { value: "min", label: "Darken (min)" },
  { value: "difference", label: "Difference" },
] as const;
