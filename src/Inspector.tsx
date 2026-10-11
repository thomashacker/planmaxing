import { useEffect, useState } from 'react'
import type { Item, Line, Rect } from './types'
import { COLORS } from './types'
import type { History } from './store'
import { cm, gaps, lineLength, parseCm, unionBox } from './geometry'

type Props = {
  hist: History
  selection: Set<string>
  onDuplicate: () => void
  onDelete: () => void
}

export default function Inspector({ hist, selection, onDuplicate, onDelete }: Props) {
  const items = hist.doc.items
  const sel = items.filter((i) => selection.has(i.id))

  const patch = (id: string, fn: (i: Item) => Item) =>
    hist.apply((d) => ({ items: d.items.map((i) => (i.id === id ? fn(i) : i)) }))

  const patchAll = (fn: (i: Item) => Item) =>
    hist.apply((d) => ({ items: d.items.map((i) => (selection.has(i.id) ? fn(i) : i)) }))

  const reorder = (front: boolean) =>
    hist.apply((d) => {
      const picked = d.items.filter((i) => selection.has(i.id))
      const rest = d.items.filter((i) => !selection.has(i.id))
      return { items: front ? [...rest, ...picked] : [...picked, ...rest] }
    })

  if (!sel.length) return <Help />

  const allLocked = sel.every((i) => i.locked)
  const common = (
    <div className="row buttons">
      <button onClick={() => patchAll((i) => ({ ...i, locked: !allLocked }))}>{allLocked ? 'Entsperren' : 'Sperren'}</button>
      <button onClick={onDuplicate}>Duplizieren</button>
      <button onClick={() => reorder(true)} title="Nach vorne">Vorne</button>
      <button onClick={() => reorder(false)} title="Nach hinten">Hinten</button>
      <button className="danger" onClick={onDelete}>Löschen</button>
    </div>
  )

  if (sel.length > 1) {
    const b = unionBox(sel)!
    const align = (fn: (i: Item, dx: number, dy: number) => Item, edge: 'l' | 'r' | 't' | 'b' | 'cx' | 'cy') =>
      patchAll((i) => {
        if (i.locked) return i
        const ib = unionBox([i])!
        const dx = edge === 'l' ? b.x - ib.x : edge === 'r' ? b.x + b.w - ib.x - ib.w : edge === 'cx' ? b.x + b.w / 2 - ib.x - ib.w / 2 : 0
        const dy = edge === 't' ? b.y - ib.y : edge === 'b' ? b.y + b.h - ib.y - ib.h : edge === 'cy' ? b.y + b.h / 2 - ib.y - ib.h / 2 : 0
        return fn(i, dx, dy)
      })
    const mv = (i: Item, dx: number, dy: number): Item =>
      i.type === 'rect' ? { ...i, x: i.x + dx, y: i.y + dy } : { ...i, x1: i.x1 + dx, x2: i.x2 + dx, y1: i.y1 + dy, y2: i.y2 + dy }
    return (
      <div className="inspector">
        <h3>{sel.length} Objekte</h3>
        <Stat label="Gesamt" value={`${cm(b.w)} × ${cm(b.h)} cm`} />
        <Section title="Ausrichten">
          <div className="row buttons">
            <button onClick={() => align(mv, 'l')}>Links</button>
            <button onClick={() => align(mv, 'cx')}>Mitte</button>
            <button onClick={() => align(mv, 'r')}>Rechts</button>
          </div>
          <div className="row buttons">
            <button onClick={() => align(mv, 't')}>Oben</button>
            <button onClick={() => align(mv, 'cy')}>Mitte</button>
            <button onClick={() => align(mv, 'b')}>Unten</button>
          </div>
        </Section>
        <Gaps items={items} selection={selection} />
        {common}
      </div>
    )
  }

  const it = sel[0]
  if (it.type === 'line') return <LineInspector l={it} patch={(fn) => patch(it.id, fn as (i: Item) => Item)} common={common} />

  const r = it as Rect
  const set = (k: keyof Rect) => (v: number | null) => patch(r.id, (i) => ({ ...i, [k]: v ?? undefined }))
  const pos = (k: 'w' | 'h') => (v: number | null) => v != null && v > 0 && patch(r.id, (i) => ({ ...i, [k]: v }))
  return (
    <div className="inspector">
      <input className="name" value={r.name} onChange={(e) => { const name = e.target.value; hist.live((d) => ({ items: d.items.map((i) => (i.id === r.id ? { ...i, name } : i)) })) }}
        onFocus={() => hist.begin()} onBlur={() => hist.end()} />
      <div className="swatches">
        {COLORS.map((c) => (
          <button key={c} className={'swatch' + (c === r.color ? ' on' : '')} style={{ background: c }}
            onClick={() => patch(r.id, (i) => ({ ...i, color: c }))} aria-label={c} />
        ))}
      </div>
      <Section title="Größe">
        <div className="row">
          <Num label="Breite" value={r.w} onChange={pos('w')} />
          <Num label="Tiefe" value={r.h} onChange={pos('h')} />
        </div>
        <div className="row">
          <Num label="Höhe" value={r.z} optional onChange={set('z')} />
          <button className="rotate" title="Breite und Tiefe tauschen (um die Mitte drehen)"
            onClick={() => patch(r.id, (i) => {
              const q = i as Rect
              return { ...q, w: q.h, h: q.w, x: q.x + (q.w - q.h) / 2, y: q.y + (q.h - q.w) / 2 }
            })}>⟳ 90°</button>
        </div>
      </Section>
      <Section title="Position">
        <div className="row">
          <Num label="X" value={r.x} onChange={(v) => v != null && set('x')(v)} />
          <Num label="Y" value={r.y} onChange={(v) => v != null && set('y')(v)} />
        </div>
      </Section>
      <Gaps items={items} selection={selection} />
      <Stat label="Fläche" value={`${(r.w * r.h / 1e6).toFixed(2)} m²`} />
      {common}
    </div>
  )
}

function LineInspector({ l, patch, common }: { l: Line; patch: (fn: (l: Line) => Line) => void; common: React.ReactNode }) {
  const len = lineLength(l)
  const ang = (Math.atan2(-(l.y2 - l.y1), l.x2 - l.x1) * 180) / Math.PI
  const setPolar = (newLen: number, newAng: number) => {
    const a = (newAng * Math.PI) / 180
    patch((i) => ({ ...i, x2: i.x1 + Math.cos(a) * newLen, y2: i.y1 - Math.sin(a) * newLen }))
  }
  const set = (k: 'x1' | 'y1' | 'x2' | 'y2') => (v: number | null) => v != null && patch((i) => ({ ...i, [k]: v }))
  return (
    <div className="inspector">
      <h3>Linie</h3>
      <Section title="Maß">
        <div className="row">
          <Num label="Länge" value={len} onChange={(v) => v != null && v > 0 && setPolar(v, ang)} />
          <Field label="Winkel" unit="°" value={String(Math.round(ang * 10) / 10)}
            onCommit={(s) => { const v = parseFloat(s.replace(',', '.')); if (Number.isFinite(v)) setPolar(len, v) }} />
        </div>
      </Section>
      <Section title="Start">
        <div className="row"><Num label="X" value={l.x1} onChange={set('x1')} /><Num label="Y" value={l.y1} onChange={set('y1')} /></div>
      </Section>
      <Section title="Ende">
        <div className="row"><Num label="X" value={l.x2} onChange={set('x2')} /><Num label="Y" value={l.y2} onChange={set('y2')} /></div>
      </Section>
      {common}
    </div>
  )
}

function Gaps({ items, selection }: { items: Item[]; selection: Set<string> }) {
  const sel = items.filter((i) => selection.has(i.id))
  const box = unionBox(sel)
  if (!box) return null
  const g = gaps(box, items.filter((i) => !selection.has(i.id)))
  const get = (d: string) => { const x = g.find((q) => q.dir === d); return x ? cm(x.dist) : '–' }
  return (
    <Section title="Freiraum (cm)">
      <div className="gaps">
        <span>← {get('left')}</span><span>→ {get('right')}</span><span>↑ {get('up')}</span><span>↓ {get('down')}</span>
      </div>
    </Section>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="section"><div className="section-title">{title}</div>{children}</div>
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="stat"><span>{label}</span><span>{value}</span></div>
}

/** Text field that commits on Enter/blur; Escape reverts. */
function Field({ label, value, unit, onCommit, placeholder }: {
  label: string; value: string; unit: string; onCommit: (s: string) => void; placeholder?: string
}) {
  const [text, setText] = useState(value)
  const [focus, setFocus] = useState(false)
  useEffect(() => { if (!focus) setText(value) }, [value, focus])
  return (
    <label className="field">
      <span>{label}</span>
      <input value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)}
        onFocus={(e) => { setFocus(true); e.target.select() }}
        onBlur={() => { setFocus(false); if (text !== value) onCommit(text) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { onCommit(text); (e.target as HTMLInputElement).blur() }
          if (e.key === 'Escape') { setText(value); setTimeout(() => (e.target as HTMLInputElement).blur()) }
        }} />
      <em>{unit}</em>
    </label>
  )
}

/** Centimetre input over a millimetre value. Accepts "85,5" and simple maths like "200-60". */
function Num({ label, value, onChange, optional }: {
  label: string; value: number | undefined; onChange: (mm: number | null) => void; optional?: boolean
}) {
  const shown = value == null ? '' : cm(value)
  return (
    <Field label={label} unit="cm" value={shown} placeholder={optional ? '–' : ''}
      onCommit={(s) => {
        if (!s.trim() && optional) return onChange(null)
        const v = parseCm(s)
        if (v != null) onChange(v)
      }} />
  )
}

function Help() {
  const keys: [string, string][] = [
    ['V', 'Auswählen'], ['H / Leertaste', 'Verschieben der Ansicht'], ['L', 'Linie (Klick, Klick … Esc)'],
    ['Zahl + ↵', 'exakte Länge beim Zeichnen'], ['R', 'Rechteck ziehen'], ['M', 'Maßband (ziehen oder 2 Klicks)'], ['⇧', '45°-Winkel / Mehrfachauswahl'],
    ['⌥', 'Einrasten aus'], ['Pfeile', '1 cm verschieben (⇧ 10 cm)'], ['⌘Z / ⇧⌘Z', 'Rückgängig / Wiederholen'],
    ['⌘D', 'Duplizieren'], ['⌫', 'Löschen'], ['⌘ + Scrollen', 'Zoom'], ['0', 'Alles zeigen'],
  ]
  return (
    <div className="inspector help">
      <h3>Nichts ausgewählt</h3>
      <p>Wände mit <b>L</b> zeichnen, links Objekte hinzufügen, anklicken zum Bearbeiten. Felder rechnen mit: <code>200-60</code>.</p>
      <dl>{keys.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </div>
  )
}
