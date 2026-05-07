import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useOutlet } from 'react-router'
import {
  KeepAliveContext,
  registerActivatedCallback,
  registerDeactivatedCallback,
} from './lifecycle'
import type { CachedOutletProps } from './types'

const defaultNormalize = (pathname: string): string => pathname

const CachedOutlet = ({
  max = 10,
  include,
  exclude,
  normalizePath = defaultNormalize,
}: CachedOutletProps) => {
  const outlet = useOutlet()
  const [cachedOutlets, setCachedOutlets] = useState(
    () => new Map<string, React.ReactElement>(),
  )

  // Config refs — consumed by cache policy logic in Phase 2
  const configRef = useRef({ max, include, exclude })
  configRef.current! = { max, include, exclude }

  const location = useLocation()
  const key = normalizePath(location.pathname)
  const outletRef = useRef<React.ReactElement | null>(null)
  const scrollPositionsRef = useRef(new Map<string, number>())
  const currentPathRef = useRef(key)

  // ── Cache write ─────────────────────────────────────────────────
  useEffect(() => {
    if (outlet) {
      outletRef.current = outlet
      setCachedOutlets((prev) => {
        // Cache hit: reuse existing instance, do not overwrite
        if (prev.has(key)) return prev
        const next = new Map(prev)
        next.set(key, outletRef.current!)
        return next
      })
    }
  }, [key, outlet])

  useEffect(() => {
    currentPathRef.current = key
  }, [key])

  // ── Scroll tracking (RAF-throttled) ─────────────────────────────
  useEffect(() => {
    let rafId: number | null = null

    const handleScroll = () => {
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(() => {
        scrollPositionsRef.current.set(currentPathRef.current, window.scrollY)
        rafId = null
      })
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
      }
    }
  }, [])

  // ── Scroll restore ──────────────────────────────────────────────
  useLayoutEffect(() => {
    const nextScrollTop = scrollPositionsRef.current.get(key) ?? 0
    const frameId = window.requestAnimationFrame(() => {
      window.scrollTo(0, nextScrollTop)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [key])

  // ── Lifecycle context value ─────────────────────────────────────
  const contextValue = useMemo(
    () => ({
      routeKey: key,
      registerActivated: (cb: () => void | (() => void)) =>
        registerActivatedCallback(key, cb),
      registerDeactivated: (cb: () => void | (() => void)) =>
        registerDeactivatedCallback(key, cb),
    }),
    [key],
  )

  // ── Render ──────────────────────────────────────────────────────
  return (
    <KeepAliveContext.Provider value={contextValue}>
      {[...cachedOutlets.entries()].map(([path, element]) => (
        <div
          key={path}
          style={{ display: path === key ? 'block' : 'none', height: '100%' }}
        >
          {element}
        </div>
      ))}
    </KeepAliveContext.Provider>
  )
}

export default CachedOutlet
