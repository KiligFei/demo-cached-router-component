import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useOutlet } from 'react-router'
import {
  enforceMaxSize,
  normalizeConfig,
  shouldCache,
} from './cache-policy'
import {
  KeepAliveContext,
  dispatchActivated,
  dispatchDeactivated,
  removeLifecycleEntry,
  registerActivatedCallback,
  registerDeactivatedCallback,
} from './lifecycle'
import type { CachedOutletProps } from './types'

export type { ValidatedConfig } from './types'

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

  // Config refs — updated before cache logic runs
  const configRef = useRef({ max, include, exclude })
  configRef.current! = { max, include, exclude }

  const location = useLocation()
  const key = normalizePath(location.pathname)
  const outletRef = useRef<React.ReactElement | null>(null)
  const scrollPositionsRef = useRef(new Map<string, number>())
  const currentPathRef = useRef(key)
  // LRU recency tracking: key → last activated counter
  const lruRef = useRef(new Map<string, number>())
  const lruCounter = useRef(0)
  const isFirstMountRef = useRef(true)
  // Ref-based cacheability tracker (avoids stale state in lifecycle effect)
  const cacheabilityRef = useRef(new Map<string, boolean>())

  // ── Cache write + config validation + LRU eviction ─────────────
  useEffect(() => {
    if (!outlet) return

    outletRef.current = outlet
    const currentConfig = normalizeConfig(configRef.current)

    setCachedOutlets((prev) => {
      // Cache hit: reuse existing instance, update LRU recency
      if (prev.has(key)) {
        lruRef.current.set(key, ++lruCounter.current)
        cacheabilityRef.current.set(key, true)
        return prev
      }

      // Non-cacheable route: render normally but don't cache
      if (!shouldCache(key, currentConfig)) {
        cacheabilityRef.current.set(key, false)
        return prev
      }

      // Cache miss: insert with eviction
      cacheabilityRef.current.set(key, true)
      const next = new Map(prev)
      const lru = lruRef.current

      next.set(key, outletRef.current!)
      lru.set(key, ++lruCounter.current)

      // Enforce max: evict LRU entries (never active route)
      if (currentConfig.max > 0 && next.size > currentConfig.max) {
        const evicted = enforceMaxSize(next, lru, currentConfig.max, key)
        for (const evictedKey of evicted) {
          dispatchDeactivated(evictedKey)
          scrollPositionsRef.current.delete(evictedKey)
          removeLifecycleEntry(evictedKey)
        }
      }

      return next
    })
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

  // ── Lifecycle dispatch on route transitions ─────────────────────
  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false
      // First entry into cacheable route → activate
      if (cacheabilityRef.current.get(key) === true) {
        dispatchActivated(key)
      }
    } else {
      // Route changed → deactivate old, activate new
      dispatchActivated(key)
    }
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
