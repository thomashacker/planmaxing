import type { Box, Item, Line, Pt, Rect, View } from './types'

export const uid = () => Math.random().toString(36).slice(2, 10)

export const toScreen = (v: View, p: Pt): Pt => ({ x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty })
export const toWorld = (v: View, p: Pt): Pt => ({ x: (p.x - v.tx) / v.scale, y: (p.y - v.ty) / v.scale })

/** mm -> "12.5" (cm, at most one decimal) */
export const cm = (mm: number) => {
  const v = Math.round(mm) / 10
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

export const lineLength = (l: Line) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1)

export const bbox = (it: Item): Box =>
  it.type === 'rect'
    ? { x: it.x, y: it.y, w: it.w, h: it.h }
    : {
        x: Math.min(it.x1, it.x2),
        y: Math.min(it.y1, it.y2),
        w: Math.abs(it.x2 - it.x1),
        h: Math.abs(it.y2 - it.y1),
      }

export const unionBox = (items: Item[]): Box | null => {
  if (!items.length) return null
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const it of items) {
    const b = bbox(it)
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y)
    x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h)
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export const translate = <T extends Item>(it: T, dx: number, dy: number): T =>
  it.type === 'rect'
    ? { ...it, x: it.x + dx, y: it.y + dy }
    : { ...it, x1: it.x1 + dx, y1: it.y1 + dy, x2: it.x2 + dx, y2: it.y2 + dy }

export const distToSegment = (p: Pt, a: Pt, b: Pt) => {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Top-most item under a world point. `tol` is in world units. */
export const hitTest = (items: Item[], p: Pt, tol: number): Item | null => {
  // Lines first (they are thin and usually sit on top of what they outline), then rects top-down.
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.type === 'line' && distToSegment(p, { x: it.x1, y: it.y1 }, { x: it.x2, y: it.y2 }) <= tol) return it
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.type === 'rect' && p.x >= it.x && p.x <= it.x + it.w && p.y >= it.y && p.y <= it.y + it.h) return it
  }
  return null
}

export const boxesIntersect = (a: Box, b: Box) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

export const boxContains = (outer: Box, inner: Box) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h

export const normBox = (a: Pt, b: Pt): Box => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(b.x - a.x),
  h: Math.abs(b.y - a.y),
})

/** Points other things snap to: line endpoints and rect corners. */
export const snapPoints = (items: Item[], exclude: Set<string>): Pt[] => {
  const pts: Pt[] = []
  for (const it of items) {
    if (exclude.has(it.id)) continue
    if (it.type === 'line') pts.push({ x: it.x1, y: it.y1 }, { x: it.x2, y: it.y2 })
    else
      pts.push(
        { x: it.x, y: it.y },
        { x: it.x + it.w, y: it.y },
        { x: it.x, y: it.y + it.h },
        { x: it.x + it.w, y: it.y + it.h },
      )
  }
  return pts
}

/** Edge coordinates other things align to while moving/resizing. */
export const snapEdges = (items: Item[], exclude: Set<string>) => {
  const xs: number[] = [], ys: number[] = []
  for (const it of items) {
    if (exclude.has(it.id)) continue
    if (it.type === 'line') { xs.push(it.x1, it.x2); ys.push(it.y1, it.y2) }
    else { xs.push(it.x, it.x + it.w); ys.push(it.y, it.y + it.h) }
  }
  return { xs, ys }
}

/** Find the candidate closest to any of `values`; returns the correction to apply. */
export const nearest = (values: number[], candidates: number[], tol: number) => {
  let best: { d: number; at: number } | null = null
  for (const v of values)
    for (const c of candidates) {
      const d = c - v
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: c }
    }
  return best
}

export const snapGrid = (v: number, grid: number) => (grid > 0 ? Math.round(v / grid) * grid : v)

/** While drawing a line: snap the angle to 45° steps (always with shift, magnetically otherwise). */
export const snapAngle = (from: Pt, to: Pt, force: boolean): Pt => {
  const dx = to.x - from.x, dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (!len) return to
  const ang = Math.atan2(dy, dx)
  const step = Math.PI / 4
  const snapped = Math.round(ang / step) * step
  if (!force && Math.abs(ang - snapped) > (4 * Math.PI) / 180) return to
  return { x: from.x + Math.cos(snapped) * len, y: from.y + Math.sin(snapped) * len }
}

type Seg = [Pt, Pt]
const segments = (it: Item): Seg[] => {
  if (it.type === 'line') return [[{ x: it.x1, y: it.y1 }, { x: it.x2, y: it.y2 }]]
  const a = { x: it.x, y: it.y }, b = { x: it.x + it.w, y: it.y }
  const c = { x: it.x + it.w, y: it.y + it.h }, d = { x: it.x, y: it.y + it.h }
  return [[a, b], [b, c], [c, d], [d, a]]
}

/** Clip segment to `lo <= p[axis] <= hi`. */
const clip = (s: Seg, axis: 'x' | 'y', lo: number, hi: number): Seg | null => {
  let [p, q] = s
  if (p[axis] > q[axis]) [p, q] = [q, p]
  if (q[axis] < lo || p[axis] > hi) return null
  const at = (v: number): Pt => {
    const span = q[axis] - p[axis]
    const t = span ? (v - p[axis]) / span : 0
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }
  }
  return [p[axis] < lo ? at(lo) : p, q[axis] > hi ? at(hi) : q]
}

export type Gap = { dir: 'left' | 'right' | 'up' | 'down'; dist: number; from: Pt; to: Pt }

/** Free space from a box to the nearest obstacle in each of the four directions. */
export const gaps = (box: Box, others: Item[]): Gap[] => {
  const out: Gap[] = []
  const eps = 0.01
  const dirs = [
    { dir: 'right', axis: 'x', cross: 'y', edge: box.x + box.w, sign: 1 },
    { dir: 'left', axis: 'x', cross: 'y', edge: box.x, sign: -1 },
    { dir: 'down', axis: 'y', cross: 'x', edge: box.y + box.h, sign: 1 },
    { dir: 'up', axis: 'y', cross: 'x', edge: box.y, sign: -1 },
  ] as const
  for (const d of dirs) {
    const lo = d.cross === 'y' ? box.y : box.x
    const hi = d.cross === 'y' ? box.y + box.h : box.x + box.w
    let best: { dist: number; cross: number } | null = null
    for (const it of others)
      for (const s of segments(it)) {
        const c = clip(s, d.cross, lo + eps, hi - eps)
        if (!c) continue
        const da = (c[0][d.axis] - d.edge) * d.sign
        const db = (c[1][d.axis] - d.edge) * d.sign
        if (da < -eps || db < -eps) continue // crosses or behind the edge
        const dist = Math.min(da, db)
        const pts = Math.abs(da - db) < eps ? c : [da < db ? c[0] : c[1]]
        const crossAt = pts.reduce((sum, p) => sum + p[d.cross], 0) / pts.length
        if (!best || dist < best.dist) best = { dist, cross: crossAt }
      }
    if (!best || best.dist < 0.5) continue
    const mk = (along: number): Pt => (d.axis === 'x' ? { x: along, y: best!.cross } : { x: best!.cross, y: along })
    out.push({ dir: d.dir, dist: best.dist, from: mk(d.edge), to: mk(d.edge + best.dist * d.sign) })
  }
  return out
}

export const overlaps = (items: Item[]): Box[] => {
  const rects = items.filter((i): i is Rect => i.type === 'rect')
  const out: Box[] = []
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j]
      const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y)
      const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h)
      if (x2 - x1 > 0.5 && y2 - y1 > 0.5) out.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 })
    }
  return out
}

/** Parse "85,5" or "200-60" (cm) into mm. */
export const parseCm = (s: string): number | null => {
  const t = s.replace(/,/g, '.').replace(/\s|cm/g, '')
  if (!t || !/^[\d.+\-*/()]+$/.test(t)) return null
  try {
    const v = Function(`"use strict";return (${t})`)()
    return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) : null
  } catch {
    return null
  }
}
