// All lengths are stored in millimetres. The UI shows centimetres.

export type Rect = {
  id: string
  type: 'rect'
  name: string
  x: number
  y: number
  w: number
  h: number
  /** Optional real-world height (e.g. a fridge is 85 cm tall), only shown as info. */
  z?: number
  color: string
  locked?: boolean
}

export type Line = {
  id: string
  type: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
  locked?: boolean
}

export type Item = Rect | Line

export type Doc = { items: Item[] }

export type View = { tx: number; ty: number; scale: number }

export type Tool = 'select' | 'hand' | 'line' | 'rect' | 'measure'

export type Pt = { x: number; y: number }

export type Box = { x: number; y: number; w: number; h: number }

export const COLORS = ['#8a8f98', '#c9a27e', '#7fa6c9', '#8fbf9a', '#d98c8c', '#b59ad6']

export type Preset = { name: string; w: number; h: number; z?: number; color: string }

export const PRESETS: Preset[] = [
  { name: 'Arbeitsplatte', w: 2000, h: 600, z: 900, color: COLORS[1] },
  { name: 'Bein', w: 50, h: 50, z: 860, color: COLORS[0] },
  { name: 'Kühlschrank', w: 600, h: 600, z: 850, color: COLORS[2] },
  { name: 'Schrank', w: 600, h: 580, z: 820, color: COLORS[3] },
]
