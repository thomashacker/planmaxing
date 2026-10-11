import { useEffect, useRef, useState } from 'react'
import type { Box, Item, Line, Pt, Rect, Tool, View } from './types'
import type { History, Settings } from './store'
import {
  bbox, boxContains, cm, gaps, hitTest, lineLength, nearest, normBox, overlaps, parseCm, snapAngle,
  snapEdges, snapGrid, snapPoints, toScreen, toWorld, translate, uid, unionBox,
} from './geometry'

type Props = {
  hist: History
  view: View
  setView: (v: View | ((v: View) => View)) => void
  tool: Tool
  setTool: (t: Tool) => void
  selection: Set<string>
  setSelection: (s: Set<string>) => void
  settings: Settings
  onCursor: (p: Pt | null) => void
  onSize: (s: { w: number; h: number }) => void
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

type Drag =
  | { kind: 'pan'; sx: number; sy: number; view: View }
  | { kind: 'marquee'; a: Pt; b: Pt; base: Set<string>; click: Set<string> }
  | { kind: 'move'; start: Pt; sx: number; sy: number; orig: Item[]; moved: boolean; clicked: string }
  | { kind: 'resize'; handle: Handle; orig: Rect }
  | { kind: 'end'; which: 1 | 2; orig: Line; mark?: Pt | null }
  | { kind: 'drawRect'; a: Pt; b: Pt; mark?: Pt | null }

const SNAP_PX = 8
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const handlePos = (r: Rect, h: Handle): Pt => ({
  x: h.includes('w') ? r.x : h.includes('e') ? r.x + r.w : r.x + r.w / 2,
  y: h.includes('n') ? r.y : h.includes('s') ? r.y + r.h : r.y + r.h / 2,
})

const CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
}

/** A "nice" scale-bar length (mm) that is roughly `px` pixels long. */
const niceLength = (scale: number, px: number) => {
  const target = px / scale
  const steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000]
  return steps.find((s) => s >= target) ?? steps[steps.length - 1]
}

export default function Canvas(p: Props) {
  const { hist, view, setView, tool, selection, setSelection, settings } = p
  const items = hist.doc.items
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)
  const [, rerender] = useState(0)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [cursor, setCursor] = useState<Pt | null>(null)
  const [guides, setGuides] = useState<{ xs: number[]; ys: number[] }>({ xs: [], ys: [] })
  const [chain, setChain] = useState<Pt | null>(null) // start of the line being drawn
  const [typed, setTyped] = useState('')
  const [measure, setMeasure] = useState<{ a: Pt; b: Pt; live: boolean; sx: number; sy: number } | null>(null)
  const [space, setSpace] = useState(false)
  const keys = useRef({ shift: false, alt: false })

  const S = (pt: Pt) => toScreen(view, pt)
  const tol = SNAP_PX / view.scale

  // ---- size + wheel -------------------------------------------------------
  useEffect(() => {
    const el = svgRef.current!
    const ro = new ResizeObserver(([e]) => {
      const s = { w: e.contentRect.width, h: e.contentRect.height }
      setSize(s)
      p.onSize(s)
    })
    ro.observe(el)
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const mx = e.clientX - r.left, my = e.clientY - r.top
      if (e.ctrlKey || e.metaKey) {
        const f = Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.002))
        setView((v) => {
          const scale = Math.min(20, Math.max(0.01, v.scale * f))
          const k = scale / v.scale
          return { scale, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k }
        })
      } else {
        setView((v) => ({ ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY }))
      }
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener('wheel', wheel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Leaving the line tool ends the chain.
  useEffect(() => {
    if (tool !== 'line') { setChain(null); setTyped('') }
    if (tool !== 'measure') setMeasure(null)
  }, [tool])

  // ---- snapping -----------------------------------------------------------
  /** Snap a free point: other points first, then angle (relative to `anchor`), then grid. */
  const snap = (w: Pt, anchor: Pt | null, exclude: Set<string> = new Set()): { pt: Pt; mark: Pt | null } => {
    if (keys.current.alt) return { pt: w, mark: null }
    let best: Pt | null = null, bd = tol
    for (const q of snapPoints(items, exclude)) {
      const d = Math.hypot(q.x - w.x, q.y - w.y)
      if (d <= bd) { bd = d; best = q }
    }
    if (best) return { pt: best, mark: best }
    const g = settings.grid
    if (anchor) {
      const a = snapAngle(anchor, w, keys.current.shift)
      if (Math.abs(a.x - anchor.x) < 0.01) return { pt: { x: anchor.x, y: snapGrid(a.y - anchor.y, g) + anchor.y }, mark: null }
      if (Math.abs(a.y - anchor.y) < 0.01) return { pt: { x: snapGrid(a.x - anchor.x, g) + anchor.x, y: anchor.y }, mark: null }
      return { pt: a, mark: null }
    }
    return { pt: { x: snapGrid(w.x, g), y: snapGrid(w.y, g) }, mark: null }
  }
  const snapPoint = (w: Pt, anchor: Pt | null, exclude?: Set<string>) => snap(w, anchor, exclude).pt

  const lineEnd = (): Pt | null => {
    if (!chain || !cursor) return null
    const raw = snapPoint(cursor, chain)
    const len = typed ? parseCm(typed) : null
    if (len == null) return raw
    let dx = raw.x - chain.x, dy = raw.y - chain.y
    const d = Math.hypot(dx, dy)
    if (d < 0.01) { dx = 1; dy = 0 } else { dx /= d; dy /= d }
    return { x: chain.x + dx * len, y: chain.y + dy * len }
  }

  const addLine = (a: Pt, b: Pt) => {
    if (Math.hypot(b.x - a.x, b.y - a.y) < 0.5) return
    const r = (v: number) => Math.round(v * 10) / 10
    const line: Line = { id: uid(), type: 'line', x1: r(a.x), y1: r(a.y), x2: r(b.x), y2: r(b.y) }
    hist.apply((d) => ({ items: [...d.items, line] }))
  }

  const stopChain = () => { setChain(null); setTyped('') }

  // ---- keyboard (capture phase, runs before the app shortcuts) -----------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keys.current.shift = e.shiftKey
      keys.current.alt = e.altKey
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select')) return
      if (e.code === 'Space' && !space) { setSpace(true); e.preventDefault() }
      if (tool === 'measure' && measure && e.key === 'Escape') {
        setMeasure(null)
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (tool === 'line' && chain) {
        if (/^[\d.,+\-*/]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
          setTyped((s) => s + e.key)
        } else if (e.key === 'Backspace' && typed) {
          setTyped((s) => s.slice(0, -1))
        } else if (e.key === 'Enter') {
          const end = lineEnd()
          if (typed && end) { addLine(chain, end); setChain(end); setTyped('') } else stopChain()
        } else if (e.key === 'Escape') {
          if (typed) setTyped(''); else stopChain()
        } else return
        e.preventDefault()
        e.stopPropagation()
      }
    }
    const up = (e: KeyboardEvent) => {
      keys.current.shift = e.shiftKey
      keys.current.alt = e.altKey
      if (e.code === 'Space') setSpace(false)
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
    }
  })

  // ---- pointer ------------------------------------------------------------
  const local = (e: React.PointerEvent | React.MouseEvent): Pt => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const selectedItems = items.filter((i) => selection.has(i.id))
  const single = selectedItems.length === 1 ? selectedItems[0] : null

  const onDown = (e: React.PointerEvent) => {
    keys.current.shift = e.shiftKey
    keys.current.alt = e.altKey
    const sp = local(e)
    const w = toWorld(view, sp)
    if (e.button === 2) { if (chain) stopChain(); return }
    svgRef.current!.setPointerCapture(e.pointerId)

    if (e.button === 1 || space || tool === 'hand') {
      drag.current = { kind: 'pan', sx: sp.x, sy: sp.y, view }
      rerender((n) => n + 1)
      return
    }

    if (tool === 'line') {
      const pt = chain ? lineEnd()! : snapPoint(w, null)
      if (chain) addLine(chain, pt)
      setChain(pt)
      setTyped('')
      return
    }

    if (tool === 'measure') {
      if (measure?.live) setMeasure({ ...measure, b: snapPoint(w, measure.a), live: false })
      else { const a = snapPoint(w, null); setMeasure({ a, b: a, live: true, sx: sp.x, sy: sp.y }) }
      return
    }

    if (tool === 'rect') {
      const a = snapPoint(w, null)
      drag.current = { kind: 'drawRect', a, b: a }
      return
    }

    // select tool: handles of a single selection first
    if (single && !single.locked) {
      const near = (q: Pt) => { const s = S(q); return Math.hypot(s.x - sp.x, s.y - sp.y) <= 7 }
      if (single.type === 'rect') {
        const h = HANDLES.find((h) => near(handlePos(single, h)))
        if (h) { hist.begin(); drag.current = { kind: 'resize', handle: h, orig: single }; return }
      } else {
        const which = near({ x: single.x1, y: single.y1 }) ? 1 : near({ x: single.x2, y: single.y2 }) ? 2 : 0
        if (which) { hist.begin(); drag.current = { kind: 'end', which, orig: single }; return }
      }
    }

    const hit = hitTest(items, w, 6 / view.scale)
    if (hit && e.shiftKey) {
      const s = new Set(selection)
      if (s.has(hit.id)) s.delete(hit.id); else s.add(hit.id)
      setSelection(s)
      return
    }
    if (hit && !hit.locked) {
      const sel = selection.has(hit.id) ? selection : new Set([hit.id])
      if (sel !== selection) setSelection(sel)
      hist.begin()
      drag.current = {
        kind: 'move', start: w, sx: sp.x, sy: sp.y, moved: false, clicked: hit.id,
        orig: items.filter((i) => sel.has(i.id) && !i.locked),
      }
      return
    }
    const click = hit ? new Set([hit.id]) : e.shiftKey ? selection : new Set<string>()
    setSelection(click)
    drag.current = { kind: 'marquee', a: w, b: w, base: e.shiftKey ? selection : new Set(), click }
  }

  const onMove = (e: React.PointerEvent) => {
    keys.current.shift = e.shiftKey
    keys.current.alt = e.altKey
    const sp = local(e)
    const w = toWorld(view, sp)
    setCursor(w)
    p.onCursor(w)
    const d = drag.current
    if (tool === 'measure' && measure?.live) setMeasure({ ...measure, b: snapPoint(w, measure.a) })
    if (!d) {
      return
    }
    const noSnap = e.altKey
    const g = noSnap ? 0 : settings.grid

    if (d.kind === 'pan') {
      setView({ ...d.view, tx: d.view.tx + sp.x - d.sx, ty: d.view.ty + sp.y - d.sy })
    } else if (d.kind === 'marquee') {
      d.b = w
      const box = normBox(d.a, d.b)
      if (box.w * view.scale < 3 && box.h * view.scale < 3) { setSelection(d.click); rerender((n) => n + 1); return }
      const s = new Set(d.base)
      for (const it of items) if (boxContains(box, bbox(it))) s.add(it.id)
      setSelection(s)
    } else if (d.kind === 'move') {
      if (!d.moved && Math.hypot(sp.x - d.sx, sp.y - d.sy) < 3) return
      d.moved = true
      let dx = w.x - d.start.x, dy = w.y - d.start.y
      const b = unionBox(d.orig)!
      const ids = new Set(d.orig.map((i) => i.id))
      const gx: number[] = [], gy: number[] = []
      if (!noSnap) {
        const { xs, ys } = snapEdges(items, ids)
        const nx = nearest([b.x + dx, b.x + b.w + dx], xs, tol)
        const ny = nearest([b.y + dy, b.y + b.h + dy], ys, tol)
        if (nx) { dx += nx.d; gx.push(nx.at) } else if (g) dx = snapGrid(b.x + dx, g) - b.x
        if (ny) { dy += ny.d; gy.push(ny.at) } else if (g) dy = snapGrid(b.y + dy, g) - b.y
      }
      setGuides({ xs: gx, ys: gy })
      const byId = new Map(d.orig.map((i) => [i.id, i]))
      hist.live((doc) => ({ items: doc.items.map((i) => (byId.has(i.id) ? translate(byId.get(i.id)!, dx, dy) : i)) }))
    } else if (d.kind === 'resize') {
      const o = d.orig
      let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h
      const { xs, ys } = snapEdges(items, new Set([o.id]))
      const gx: number[] = [], gy: number[] = []
      const sx = (v: number) => {
        const n = noSnap ? null : nearest([v], xs, tol)
        if (n) { gx.push(n.at); return n.at }
        return snapGrid(v, g)
      }
      const sy = (v: number) => {
        const n = noSnap ? null : nearest([v], ys, tol)
        if (n) { gy.push(n.at); return n.at }
        return snapGrid(v, g)
      }
      if (d.handle.includes('w')) x1 = Math.min(sx(w.x), x2 - 5)
      if (d.handle.includes('e')) x2 = Math.max(sx(w.x), x1 + 5)
      if (d.handle.includes('n')) y1 = Math.min(sy(w.y), y2 - 5)
      if (d.handle.includes('s')) y2 = Math.max(sy(w.y), y1 + 5)
      setGuides({ xs: gx, ys: gy })
      hist.live((doc) => ({
        items: doc.items.map((i) => (i.id === o.id ? { ...o, x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : i)),
      }))
    } else if (d.kind === 'end') {
      const o = d.orig
      const anchor = d.which === 1 ? { x: o.x2, y: o.y2 } : { x: o.x1, y: o.y1 }
      const { pt, mark } = snap(w, anchor, new Set([o.id]))
      d.mark = mark
      const next: Line = d.which === 1 ? { ...o, x1: pt.x, y1: pt.y } : { ...o, x2: pt.x, y2: pt.y }
      hist.live((doc) => ({ items: doc.items.map((i) => (i.id === o.id ? next : i)) }))
    } else if (d.kind === 'drawRect') {
      const s = snap(w, null)
      d.b = s.pt
      d.mark = s.mark
      rerender((n) => n + 1)
    }
  }

  const onUp = (e: React.PointerEvent) => {
    // a measuring drag ends on release; a plain click keeps following the cursor until the next click
    if (tool === 'measure' && measure?.live) {
      const sp = local(e)
      if (Math.hypot(sp.x - measure.sx, sp.y - measure.sy) > 4) setMeasure({ ...measure, live: false })
    }
    const d = drag.current
    drag.current = null
    setGuides({ xs: [], ys: [] })
    if (!d) return
    if (d.kind === 'move') {
      hist.end()
      if (!d.moved && selection.size > 1 && !keys.current.shift) setSelection(new Set([d.clicked]))
    } else if (d.kind === 'resize' || d.kind === 'end') {
      hist.end()
    } else if (d.kind === 'drawRect') {
      const box = normBox(d.a, d.b)
      if (box.w >= 5 && box.h >= 5) {
        const r: Rect = { id: uid(), type: 'rect', name: 'Objekt', ...box, color: '#8a8f98' }
        hist.apply((doc) => ({ items: [...doc.items, r] }))
        setSelection(new Set([r.id]))
        p.setTool('select')
      }
    }
    rerender((n) => n + 1)
  }

  // ---- render helpers -----------------------------------------------------
  const minorStep = [10, 50, 100, 500, 1000, 5000].find((s) => s * view.scale >= 10) ?? 5000
  const majorStep = minorStep * (String(minorStep).startsWith('5') ? 2 : 10)
  const d = drag.current
  const box = selectedItems.length ? unionBox(selectedItems) : null
  const showGaps = box && !(d && d.kind === 'marquee')
  const gapList = showGaps ? gaps(box, items.filter((i) => !selection.has(i.id))) : []
  const end = tool === 'line' ? lineEnd() : null
  const snapMark =
    d && (d.kind === 'end' || d.kind === 'drawRect') ? d.mark ?? null
    : !d && cursor && (tool === 'line' || tool === 'rect' || tool === 'measure')
      ? snap(cursor, tool === 'line' ? chain : tool === 'measure' && measure?.live ? measure.a : null).mark
    : null
  const bar = niceLength(view.scale, 100)

  const cursorStyle =
    d?.kind === 'pan' ? 'grabbing'
    : space || tool === 'hand' ? 'grab'
    : tool === 'line' || tool === 'rect' || tool === 'measure' ? 'crosshair'
    : d?.kind === 'resize' ? CURSORS[d.handle]
    : d?.kind === 'move' ? 'move'
    : 'default'

  return (
    <svg
      ref={svgRef}
      className="canvas"
      style={{ cursor: cursorStyle }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={() => { setCursor(null); p.onCursor(null) }}
      onDoubleClick={() => chain && stopChain()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <defs>
        <pattern id="g-minor" width={minorStep * view.scale} height={minorStep * view.scale}
          x={view.tx} y={view.ty} patternUnits="userSpaceOnUse">
          <path d={`M ${minorStep * view.scale} 0 V ${minorStep * view.scale} M 0 ${minorStep * view.scale} H ${minorStep * view.scale}`}
            className="grid-minor" />
        </pattern>
        <pattern id="g-major" width={majorStep * view.scale} height={majorStep * view.scale}
          x={view.tx} y={view.ty} patternUnits="userSpaceOnUse">
          <path d={`M ${majorStep * view.scale} 0 V ${majorStep * view.scale} M 0 ${majorStep * view.scale} H ${majorStep * view.scale}`}
            className="grid-major" />
        </pattern>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" className="hatch" />
        </pattern>
      </defs>
      <rect width={size.w} height={size.h} fill="url(#g-minor)" />
      <rect width={size.w} height={size.h} fill="url(#g-major)" />
      <path d={`M ${view.tx - 8} ${view.ty} H ${view.tx + 8} M ${view.tx} ${view.ty - 8} V ${view.ty + 8}`} className="origin" />

      {items.map((it) => (it.type === 'rect' ? <RectShape key={it.id} r={it} view={view} sel={selection.has(it.id)} /> : null))}

      {settings.overlaps && overlaps(items).map((o, i) => <ScreenBox key={i} b={o} view={view} className="overlap" />)}

      {items.map((it) => (it.type === 'line' ? <LineShape key={it.id} l={it} view={view} sel={selection.has(it.id)} /> : null))}

      {/* dimensions of a single selected rect */}
      {single?.type === 'rect' && !(d && d.kind === 'move') && <RectDims r={single} view={view} />}

      {/* free space around the selection */}
      {gapList.map((g) => {
        const a = S(g.from), b = S(g.to)
        if (Math.hypot(b.x - a.x, b.y - a.y) < 18) return null
        const vert = g.dir === 'up' || g.dir === 'down'
        return (
          <g key={g.dir} className="gap">
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            <path d={vert ? `M ${b.x - 4} ${b.y} H ${b.x + 4}` : `M ${b.x} ${b.y - 4} V ${b.y + 4}`} />
            <Label x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} text={cm(g.dist)} className="gap-label" />
          </g>
        )
      })}

      {/* guides */}
      {guides.xs.map((x, i) => <line key={'gx' + i} className="guide" x1={S({ x, y: 0 }).x} x2={S({ x, y: 0 }).x} y1={0} y2={size.h} />)}
      {guides.ys.map((y, i) => <line key={'gy' + i} className="guide" y1={S({ x: 0, y }).y} y2={S({ x: 0, y }).y} x1={0} x2={size.w} />)}

      {/* handles */}
      {single && !single.locked && !d && (single.type === 'rect'
        ? HANDLES.map((h) => { const q = S(handlePos(single, h)); return <rect key={h} className="handle" x={q.x - 4} y={q.y - 4} width={8} height={8} /> })
        : [S({ x: single.x1, y: single.y1 }), S({ x: single.x2, y: single.y2 })].map((q, i) => <circle key={i} className="handle" cx={q.x} cy={q.y} r={5} />))}

      {/* drawing previews */}
      {d?.kind === 'drawRect' && (() => {
        const b = normBox(d.a, d.b)
        const c = S({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
        return (
          <g>
            <ScreenBox b={b} view={view} className="preview" />
            <Label x={c.x} y={c.y} text={`${cm(b.w)} × ${cm(b.h)}`} />
          </g>
        )
      })()}
      {chain && end && (() => {
        const a = S(chain), b = S(end)
        const len = Math.hypot(end.x - chain.x, end.y - chain.y)
        return (
          <g>
            <line className="preview-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            <circle className="handle" cx={a.x} cy={a.y} r={3} />
            <Label x={b.x + 14} y={b.y - 14} anchor="start" text={typed ? `${typed} cm ↵` : `${cm(len)} cm`} className={typed ? 'typed' : ''} />
          </g>
        )
      })()}
      {snapMark && (() => { const q = S(snapMark); return <circle className="snap" cx={q.x} cy={q.y} r={6} /> })()}

      {measure && <Tape a={measure.a} b={measure.b} view={view} />}

      {d?.kind === 'marquee' && <ScreenBox b={normBox(d.a, d.b)} view={view} className="marquee" />}

      {/* scale bar */}
      <g className="scalebar" transform={`translate(16 ${size.h - 20})`}>
        <path d={`M 0 -5 V 0 H ${bar * view.scale} V -5`} />
        <text x={bar * view.scale + 6} y={0}>{bar >= 1000 ? `${bar / 1000} m` : `${cm(bar)} cm`}</text>
      </g>
    </svg>
  )
}

function Tape({ a, b, view }: { a: Pt; b: Pt; view: View }) {
  const p = toScreen(view, a), q = toScreen(view, b)
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const sl = Math.hypot(q.x - p.x, q.y - p.y)
  if (sl < 1) return <circle className="tape-end" cx={p.x} cy={p.y} r={3} />
  const nx = -(q.y - p.y) / sl * 6, ny = (q.x - p.x) / sl * 6
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y)
  const diag = dx > 0.5 && dy > 0.5
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2
  return (
    <g className="tape">
      <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} />
      <path d={`M ${p.x - nx} ${p.y - ny} L ${p.x + nx} ${p.y + ny} M ${q.x - nx} ${q.y - ny} L ${q.x + nx} ${q.y + ny}`} />
      {diag && <path className="tape-legs" d={`M ${p.x} ${p.y} H ${q.x} V ${q.y}`} />}
      <rect className="tape-pill" x={mx - 34} y={my - (diag ? 32 : 22)} width={68} height={diag ? 34 : 18} rx={9} />
      <text className="tape-text" x={mx} y={my - (diag ? 21 : 13)} textAnchor="middle" dominantBaseline="central">{cm(len)} cm</text>
      {diag && <text className="tape-sub" x={mx} y={my - 7} textAnchor="middle" dominantBaseline="central">{cm(dx)} × {cm(dy)}</text>}
    </g>
  )
}

function Label({ x, y, text, className = '', anchor = 'middle', rotate = 0 }: {
  x: number; y: number; text: string; className?: string; anchor?: 'middle' | 'start'; rotate?: number
}) {
  return (
    <text className={'label ' + className} x={x} y={y} textAnchor={anchor} dominantBaseline="central"
      transform={rotate ? `rotate(${rotate} ${x} ${y})` : undefined}>
      {text}
    </text>
  )
}

function ScreenBox({ b, view, className }: { b: Box; view: View; className: string }) {
  const a = toScreen(view, b)
  return <rect className={className} x={a.x} y={a.y} width={b.w * view.scale} height={b.h * view.scale} />
}

function RectShape({ r, view, sel }: { r: Rect; view: View; sel: boolean }) {
  const a = toScreen(view, r)
  const w = r.w * view.scale, h = r.h * view.scale
  const fits = w > 46 && h > 30
  const dims = `${cm(r.w)} × ${cm(r.h)}${r.z ? ` · H ${cm(r.z)}` : ''}`
  return (
    <g className={'rect' + (sel ? ' sel' : '') + (r.locked ? ' locked' : '')}>
      <rect x={a.x} y={a.y} width={w} height={h} fill={r.color} stroke={r.color} />
      {fits && (
        <g className="rect-text">
          <text x={a.x + w / 2} y={a.y + h / 2 - (h > 44 ? 8 : 0)} textAnchor="middle" dominantBaseline="central" className="name">{r.name}</text>
          {h > 44 && <text x={a.x + w / 2} y={a.y + h / 2 + 9} textAnchor="middle" dominantBaseline="central" className="dims">{dims}</text>}
        </g>
      )}
    </g>
  )
}

function LineShape({ l, view, sel }: { l: Line; view: View; sel: boolean }) {
  const a = toScreen(view, { x: l.x1, y: l.y1 }), b = toScreen(view, { x: l.x2, y: l.y2 })
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  let ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
  if (ang > 90) ang -= 180
  if (ang <= -90) ang += 180
  const rad = (ang * Math.PI) / 180
  const mx = (a.x + b.x) / 2 + Math.sin(rad) * 11, my = (a.y + b.y) / 2 - Math.cos(rad) * 11
  return (
    <g className={'line' + (sel ? ' sel' : '')}>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      {len > 36 && <Label x={mx} y={my} rotate={ang} text={cm(lineLength(l))} className="line-label" />}
    </g>
  )
}

function RectDims({ r, view }: { r: Rect; view: View }) {
  const a = toScreen(view, r)
  const w = r.w * view.scale, h = r.h * view.scale
  const o = 16
  return (
    <g className="dim">
      <path d={`M ${a.x} ${a.y - o - 4} V ${a.y - o + 4} M ${a.x + w} ${a.y - o - 4} V ${a.y - o + 4} M ${a.x} ${a.y - o} H ${a.x + w}`} />
      <Label x={a.x + w / 2} y={a.y - o - 9} text={cm(r.w)} className="dim-label" />
      <path d={`M ${a.x - o - 4} ${a.y} H ${a.x - o + 4} M ${a.x - o - 4} ${a.y + h} H ${a.x - o + 4} M ${a.x - o} ${a.y} V ${a.y + h}`} />
      <Label x={a.x - o - 9} y={a.y + h / 2} rotate={-90} text={cm(r.h)} className="dim-label" />
    </g>
  )
}
