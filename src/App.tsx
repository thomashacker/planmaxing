import { useCallback, useEffect, useRef, useState } from 'react'
import Canvas from './Canvas'
import Inspector from './Inspector'
import { loadSaved, save, useHistory, type Settings } from './store'
import { PRESETS, type Doc, type Item, type Preset, type Pt, type Rect, type Tool, type View } from './types'
import { cm, snapGrid, toWorld, translate, uid, unionBox } from './geometry'

const saved = loadSaved()
const GRIDS = [0, 10, 50, 100]

const TOOLS: { id: Tool; key: string; label: string; icon: string }[] = [
  { id: 'select', key: 'V', label: 'Auswählen', icon: 'M5 3l14 8-6 1.5L10 19z' },
  { id: 'hand', key: 'H', label: 'Ansicht verschieben', icon: 'M8 13V5.5a1.5 1.5 0 013 0V12m0-1V4.5a1.5 1.5 0 013 0V12m0-6.5a1.5 1.5 0 013 0V14a6 6 0 01-6 6h-1a6 6 0 01-5-2.7L3.5 14a1.5 1.5 0 012.5-1.6L8 15' },
  { id: 'line', key: 'L', label: 'Linie / Wand', icon: 'M4 20L20 4M4 20h0M20 4h0' },
  { id: 'rect', key: 'R', label: 'Rechteck', icon: 'M4 6h16v12H4z' },
  { id: 'measure', key: 'M', label: 'Maßband', icon: 'M3 15.5L15.5 3 21 8.5 8.5 21zM7 12l2 2M10 9l2 2M13 6l2 2' },
]

export default function App() {
  const hist = useHistory(saved?.doc ?? { items: [] })
  const [view, setView] = useState<View>(saved?.view ?? { tx: 120, ty: 120, scale: 0.3 })
  const [settings, setSettings] = useState<Settings>(saved?.settings ?? { grid: 10, overlaps: true })
  const [tool, setTool] = useState<Tool>('select')
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [cursor, setCursor] = useState<Pt | null>(null)
  const [savedOk, setSavedOk] = useState(true)
  const size = useRef({ w: 800, h: 600 })
  const clipboard = useRef<Item[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const { doc } = hist

  // autosave (debounced, flushed when the tab goes away)
  const latest = useRef({ doc, view, settings })
  latest.current = { doc, view, settings }
  useEffect(() => {
    const t = setTimeout(() => setSavedOk(save({ doc, view, settings })), 250)
    return () => clearTimeout(t)
  }, [doc, view, settings])
  useEffect(() => {
    const flush = () => save(latest.current)
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [])

  // drop selection of items that no longer exist (after undo, delete, …)
  useEffect(() => {
    const ids = new Set(doc.items.map((i) => i.id))
    if ([...selection].some((id) => !ids.has(id))) setSelection(new Set([...selection].filter((id) => ids.has(id))))
  }, [doc, selection])

  const fit = useCallback((items: Item[] = hist.docRef.current.items) => {
    const b = unionBox(items)
    const { w, h } = size.current
    if (!b) return setView({ tx: w / 2, ty: h / 2, scale: 0.3 })
    const scale = Math.min(4, Math.max(0.02, Math.min((w - 160) / Math.max(b.w, 1), (h - 160) / Math.max(b.h, 1))))
    setView({ scale, tx: w / 2 - (b.x + b.w / 2) * scale, ty: h / 2 - (b.y + b.h / 2) * scale })
  }, [hist.docRef])

  const zoom = (f: number) =>
    setView((v) => {
      const { w, h } = size.current
      const scale = Math.min(20, Math.max(0.01, v.scale * f))
      const k = scale / v.scale
      return { scale, tx: w / 2 - (w / 2 - v.tx) * k, ty: h / 2 - (h / 2 - v.ty) * k }
    })

  const addPreset = (p: Preset) => {
    const c = toWorld(view, { x: size.current.w / 2, y: size.current.h / 2 })
    const g = settings.grid || 10
    const r: Rect = { id: uid(), type: 'rect', name: p.name, w: p.w, h: p.h, z: p.z, color: p.color,
      x: snapGrid(c.x - p.w / 2, g), y: snapGrid(c.y - p.h / 2, g) }
    hist.apply((d) => ({ items: [...d.items, r] }))
    setSelection(new Set([r.id]))
    setTool('select')
  }

  const paste = (src: Item[], offset = 100) => {
    if (!src.length) return
    const copies = src.map((i) => ({ ...translate(i, offset, offset), id: uid(), locked: false }))
    hist.apply((d) => ({ items: [...d.items, ...copies] }))
    setSelection(new Set(copies.map((c) => c.id)))
  }

  const selected = () => hist.docRef.current.items.filter((i) => selection.has(i.id))
  const duplicate = () => paste(selected())
  const remove = () => {
    if (!selection.size) return
    hist.apply((d) => ({ items: d.items.filter((i) => !selection.has(i.id) || i.locked) }))
  }
  const nudge = (dx: number, dy: number) =>
    hist.apply((d) => ({ items: d.items.map((i) => (selection.has(i.id) && !i.locked ? translate(i, dx, dy) : i)) }))

  // shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) hist.redo(); else hist.undo(); return }
      if (mod && k === 'y') { e.preventDefault(); hist.redo(); return }
      if (mod && k === 'd') { e.preventDefault(); duplicate(); return }
      if (mod && k === 'c') { clipboard.current = selected(); return }
      if (mod && k === 'x') { clipboard.current = selected(); remove(); return }
      if (mod && k === 'v') { e.preventDefault(); paste(clipboard.current); return }
      if (mod && k === 'a') { e.preventDefault(); setSelection(new Set(hist.docRef.current.items.map((i) => i.id))); return }
      if (mod && k === 's') { e.preventDefault(); exportJson(); return }
      if (mod) return
      if (k === 'backspace' || k === 'delete') { e.preventDefault(); remove(); return }
      if (k === 'escape') { setSelection(new Set()); setTool('select'); return }
      if (e.key.startsWith('Arrow') && selection.size) {
        e.preventDefault()
        const step = e.altKey ? 1 : e.shiftKey ? 100 : 10
        nudge(k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0)
        return
      }
      const t = TOOLS.find((t) => t.key.toLowerCase() === k)
      if (t) return setTool(t.id)
      if (k === '0') return fit()
      if (k === '=' || k === '+') return zoom(1.25)
      if (k === '-') return zoom(0.8)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ app: 'planmaxing', version: 1, ...hist.docRef.current }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `plan-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importJson = async (f: File) => {
    try {
      const data = JSON.parse(await f.text()) as Doc
      if (!Array.isArray(data.items)) throw new Error('no items')
      hist.reset({ items: data.items })
      setSelection(new Set())
      setTimeout(() => fit(data.items))
    } catch {
      alert('Die Datei ist kein gültiger Plan.')
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">planmaxing</div>
        <div className="group">
          <button onClick={() => { if (confirm('Neuen leeren Plan anfangen? (Rückgängig geht weiterhin)')) { hist.reset({ items: [] }); setSelection(new Set()) } }}>Neu</button>
          <button onClick={() => fileInput.current?.click()}>Öffnen</button>
          <button onClick={exportJson} title="⌘S">Exportieren</button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = '' }} />
        </div>
        <div className="group">
          <button onClick={hist.undo} disabled={!hist.canUndo} title="Rückgängig (⌘Z)">↶</button>
          <button onClick={hist.redo} disabled={!hist.canRedo} title="Wiederholen (⇧⌘Z)">↷</button>
        </div>
        <div className="spacer" />
        <div className="group">
          <span className="muted">Raster</span>
          {GRIDS.map((g) => (
            <button key={g} className={settings.grid === g ? 'on' : ''} onClick={() => setSettings({ ...settings, grid: g })}>
              {g ? `${cm(g)}` : 'aus'}
            </button>
          ))}
        </div>
        <div className="group">
          <button className={settings.overlaps ? 'on' : ''} onClick={() => setSettings({ ...settings, overlaps: !settings.overlaps })}
            title="Überlappende Objekte rot schraffieren">Überlappung</button>
          <button onClick={() => zoom(0.8)}>−</button>
          <button className="zoom" onClick={() => fit()} title="Alles zeigen (0)">{Math.round(view.scale * 1000) / 10}%</button>
          <button onClick={() => zoom(1.25)}>+</button>
        </div>
      </header>

      <aside className="toolbar">
        {TOOLS.map((t) => (
          <button key={t.id} className={'tool' + (tool === t.id ? ' on' : '')} onClick={() => setTool(t.id)} title={`${t.label} (${t.key})`}>
            <svg viewBox="0 0 24 24"><path d={t.icon} /></svg>
          </button>
        ))}
        <div className="sep" />
        {PRESETS.map((p) => (
          <button key={p.name} className="preset" onClick={() => addPreset(p)} title={`${p.name} ${cm(p.w)} × ${cm(p.h)} cm`}>
            <i style={{ background: p.color }} />
            <span>{p.name}</span>
          </button>
        ))}
      </aside>

      <main className="stage">
        <Canvas hist={hist} view={view} setView={setView} tool={tool} setTool={setTool}
          selection={selection} setSelection={setSelection} settings={settings}
          onCursor={setCursor} onSize={(s) => (size.current = s)} />
      </main>

      <aside className="panel">
        <Inspector hist={hist} selection={selection} onDuplicate={duplicate} onDelete={remove} />
      </aside>

      <footer className="status">
        <span>{cursor ? `x ${cm(cursor.x)}  y ${cm(cursor.y)} cm` : ' '}</span>
        <span>{doc.items.length} Elemente</span>
        <span className={savedOk ? 'muted' : 'warn'}>{savedOk ? 'lokal gespeichert' : 'Speichern fehlgeschlagen'}</span>
      </footer>
    </div>
  )
}
