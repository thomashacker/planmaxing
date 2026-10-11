import { useCallback, useRef, useState } from 'react'
import type { Doc, View } from './types'

const KEY = 'planmaxing:v1'
const LIMIT = 200

export type Settings = { grid: number; overlaps: boolean }

export type Saved = { doc: Doc; view?: View; settings?: Settings }

export const loadSaved = (): Saved | null => {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Saved) : null
  } catch {
    return null
  }
}

export const save = (s: Saved) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
    return true
  } catch {
    return false
  }
}

/**
 * Document state with undo/redo.
 * `apply` is a one-shot change. For drags: `begin()`, then `live()` on every move, then `end()`,
 * which records a single history step if anything changed.
 */
export function useHistory(initial: Doc) {
  const [doc, setDoc] = useState(initial)
  const docRef = useRef(doc)
  const past = useRef<Doc[]>([])
  const future = useRef<Doc[]>([])
  const pending = useRef<Doc | null>(null)
  const [, bump] = useState(0)

  const set = (d: Doc) => {
    docRef.current = d
    setDoc(d)
  }

  const push = (prev: Doc) => {
    past.current.push(prev)
    if (past.current.length > LIMIT) past.current.shift()
    future.current = []
  }

  const apply = useCallback((fn: (d: Doc) => Doc) => {
    const prev = docRef.current
    const next = fn(prev)
    if (next === prev) return
    push(prev)
    set(next)
  }, [])

  const begin = useCallback(() => {
    pending.current = docRef.current
  }, [])

  const live = useCallback((fn: (d: Doc) => Doc) => {
    set(fn(docRef.current))
  }, [])

  const end = useCallback(() => {
    const start = pending.current
    pending.current = null
    if (start && start !== docRef.current) {
      push(start)
      bump((n) => n + 1)
    }
  }, [])

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(docRef.current)
    set(prev)
  }, [])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(docRef.current)
    set(next)
  }, [])

  const reset = useCallback((d: Doc) => {
    push(docRef.current)
    set(d)
  }, [])

  return {
    doc,
    docRef,
    apply,
    begin,
    live,
    end,
    undo,
    redo,
    reset,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  }
}

export type History = ReturnType<typeof useHistory>
