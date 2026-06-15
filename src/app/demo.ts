'use client'
import { useEffect, useState } from 'react'

export const DEMO_KEY   = 'mcpetty_demo'
export const DEMO_EVENT = 'mcpetty-demo-change'

// Demo mode replaces all real data with invented, fully-populated data so the
// dashboard and insights look "in use" for screenshots. Nothing is fetched or
// written — it's purely presentational and reverses cleanly when toggled off.
export function useDemo(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    setOn(localStorage.getItem(DEMO_KEY) === '1')
    const h = () => setOn(localStorage.getItem(DEMO_KEY) === '1')
    window.addEventListener(DEMO_EVENT, h)
    return () => window.removeEventListener(DEMO_EVENT, h)
  }, [])
  return on
}

export function setDemo(v: boolean): void {
  localStorage.setItem(DEMO_KEY, v ? '1' : '0')
  window.dispatchEvent(new Event(DEMO_EVENT))
}
