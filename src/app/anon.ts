'use client'
import { useEffect, useState } from 'react'

export const ANON_KEY   = 'mcpetty_anon'
export const ANON_EVENT = 'mcpetty-anon-change'

export function useAnon(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    setOn(localStorage.getItem(ANON_KEY) === '1')
    const h = () => setOn(localStorage.getItem(ANON_KEY) === '1')
    window.addEventListener(ANON_EVENT, h)
    return () => window.removeEventListener(ANON_EVENT, h)
  }, [])
  return on
}

export function setAnon(v: boolean): void {
  localStorage.setItem(ANON_KEY, v ? '1' : '0')
  window.dispatchEvent(new Event(ANON_EVENT))
}

export function buildAnonMap(ids: string[]): Map<string, string> {
  const sorted = [...new Set(ids)].sort()
  const m = new Map<string, string>()
  sorted.forEach((id, i) => m.set(id, `mcp-${i + 1}`))
  return m
}

export function ap(id: string, m: Map<string, string>): string {
  return m.get(id) ?? id
}
