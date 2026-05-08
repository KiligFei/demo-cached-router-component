import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useOutlet } from 'react-router'
import {
  enforceMaxSize,
  evictLRU,
  normalizeConfig,
  shouldCache,
} from './cache-policy'
import {
  KeepAliveContext,
  dispatchActivated,
  dispatchDeactivated,
  registerActivatedCallback,
  registerDeactivatedCallback,
  removeLifecycleEntry,
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

  // ── Scroll tracking (RAF-throttled, cacheable routes only) ──────
  useEffect(() => {
    let rafId: number | null = null

    const handleScroll = () => {
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(() => {
        const path = currentPathRef.current
        if (cacheabilityRef.current.get(path) !== false) {
          scrollPositionsRef.current.set(path, window.scrollY)
        }
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

  // ── Scroll restore (cacheable routes only) ──────────────────────
  useLayoutEffect(() => {
    if (cacheabilityRef.current.get(key) !== true) return

    const nextScrollTop = scrollPositionsRef.current.get(key) ?? 0
    const frameId = window.requestAnimationFrame(() => {
      window.scrollTo(0, nextScrollTop)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [key])

  // ── Lifecycle dispatch on route transitions ─────────────────────
  const prevRouteKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false
      // First entry into cacheable route → activate
      if (cacheabilityRef.current.get(key) === true) {
        dispatchActivated(key)
      }
    } else {
      const prevKey = prevRouteKeyRef.current
      // Deactivate old route only if it was cacheable
      if (prevKey && prevKey !== key && cacheabilityRef.current.get(prevKey) === true) {
        dispatchDeactivated(prevKey)
      }
      // Activate new route only if it is cacheable
      if (cacheabilityRef.current.get(key) === true) {
        dispatchActivated(key)
      }
    }
    prevRouteKeyRef.current = key
  }, [key])

  // ── Runtime config reconciliation ───────────────────────────────
  const prevConfigRef = useRef({ max, include, exclude })

  useEffect(() => {
    const prev = prevConfigRef.current
    const configChanged =
      prev.max !== max || prev.include !== include || prev.exclude !== exclude

    if (!configChanged) return

    prevConfigRef.current = { max, include, exclude }
    const currentConfig = normalizeConfig(configRef.current)

    // 1. Prune non-cacheable entries (include/exclude changed)
    setCachedOutlets((prev) => {
      const next = new Map(prev)
      let changed = false

      for (const cachedKey of next.keys()) {
        if (!shouldCache(cachedKey, currentConfig)) {
          dispatchDeactivated(cachedKey)
          scrollPositionsRef.current.delete(cachedKey)
          removeLifecycleEntry(cachedKey)
          cacheabilityRef.current.delete(cachedKey)
          lruRef.current.delete(cachedKey)
          next.delete(cachedKey)
          changed = true
        }
      }

      // 2. Enforce new max (max decreased)
      if (currentConfig.max > 0 && next.size > currentConfig.max) {
        while (next.size > currentConfig.max) {
          const evictedKey = evictLRU(lruRef.current, key)
          if (!evictedKey) break
          dispatchDeactivated(evictedKey)
          scrollPositionsRef.current.delete(evictedKey)
          removeLifecycleEntry(evictedKey)
          cacheabilityRef.current.delete(evictedKey)
          lruRef.current.delete(evictedKey)
          next.delete(evictedKey)
          changed = true
        }
      }

      return changed ? next : prev
    })
  }, [max, include, exclude])

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

  // Compute isCacheable fresh at render time (ref updates don't trigger useMemo)
  const isCacheable = cacheabilityRef.current.get(key) !== false

  console.log(
    '%c====cached-outlet.tsx===216==cachedOutlets=',
    'color: #007acc; font-weight: bold;',
    cachedOutlets,
  )
  return (
    <KeepAliveContext.Provider value={{ ...contextValue, isCacheable }}>
      {[...cachedOutlets.entries()].map(([path, element]) => (
        <div
          key={path}
          style={{ display: path === key ? 'block' : 'none', height: '100%' }}
        >
          {element}
        </div>
      ))}
      {/* 非缓存路由：正常渲染但不加入缓存 */}
      {!cachedOutlets.has(key) && (
        <div style={{ height: '100%' }}>{outlet}</div>
      )}
    </KeepAliveContext.Provider>
  )
}

export default CachedOutlet
