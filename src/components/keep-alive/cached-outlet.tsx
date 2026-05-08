import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useOutlet } from 'react-router'
import type { Location } from 'react-router'
import {
  enforceMaxSize,
  evictLRU,
  normalizeConfig,
  shouldCache,
} from './cache-policy'
import {
  KeepAliveContext,
  createLifecycleScopeId,
  dispatchActivated,
  dispatchDeactivated,
  registerActivatedCallback,
  registerDeactivatedCallback,
  removeLifecycleEntry,
  removeLifecycleScope,
} from './lifecycle'
import type { CachedOutletProps } from './types'

export type { ValidatedConfig } from './types'

const defaultGetCacheKey = (location: Location): string => location.pathname

const RouteSlot = ({
  scopeId,
  routeKey,
  isCacheable,
  isActive,
  children,
}: {
  scopeId: string
  routeKey: string
  isCacheable: boolean
  isActive: boolean
  children: React.ReactNode
}) => {
  const contextValue = useMemo(
    () => ({
      scopeId,
      routeKey,
      isCacheable,
      registerActivated: (cb: () => void | (() => void)) =>
        registerActivatedCallback(scopeId, routeKey, cb),
      registerDeactivated: (cb: () => void | (() => void)) =>
        registerDeactivatedCallback(scopeId, routeKey, cb),
    }),
    [isCacheable, routeKey, scopeId],
  )

  return (
    <KeepAliveContext.Provider value={contextValue}>
      <div
        style={{ display: isActive ? 'block' : 'none', height: '100%' }}
      >
        {children}
      </div>
    </KeepAliveContext.Provider>
  )
}

const CachedOutlet = ({
  max = 10,
  include,
  exclude,
  getCacheKey = defaultGetCacheKey,
}: CachedOutletProps) => {
  const outlet = useOutlet()
  const [cachedOutlets, setCachedOutlets] = useState(
    () => new Map<string, React.ReactElement>(),
  )
  const [lifecycleScopeId] = useState(createLifecycleScopeId)

  const location = useLocation()
  const cacheKey = getCacheKey(location)
  const validatedConfig = useMemo(
    () => normalizeConfig({ max, include, exclude }),
    [exclude, include, max],
  )
  const isCurrentRouteCacheable = shouldCache(cacheKey, validatedConfig)
  const isCurrentRouteCacheHit = cachedOutlets.has(cacheKey)
  const scrollPositionsRef = useRef(new Map<string, number>())
  const currentPathRef = useRef(cacheKey)
  const currentRouteCacheableRef = useRef(isCurrentRouteCacheable)
  const routeCacheabilityRef = useRef(new Map<string, boolean>())
  // LRU recency tracking: key → last activated counter
  const lruRef = useRef(new Map<string, number>())
  const lruCounter = useRef(0)
  const isFirstMountRef = useRef(true)

  // ── Cache write + config validation + LRU eviction ─────────────
  useEffect(() => {
    if (!outlet) return

    setCachedOutlets((prev) => {
      // Cache hit: reuse existing instance, update LRU recency
      if (prev.has(cacheKey)) {
        routeCacheabilityRef.current.set(cacheKey, true)
        lruRef.current.set(cacheKey, ++lruCounter.current)
        return prev
      }

      // Non-cacheable route: render normally but don't cache
      if (!isCurrentRouteCacheable) {
        routeCacheabilityRef.current.set(cacheKey, false)
        return prev
      }

      // Cache miss: insert with eviction
      routeCacheabilityRef.current.set(cacheKey, true)
      const next = new Map(prev)
      const lru = lruRef.current

      next.set(cacheKey, outlet)
      lru.set(cacheKey, ++lruCounter.current)

      // Enforce max: evict LRU entries (never active route)
      if (validatedConfig.max > 0 && next.size > validatedConfig.max) {
        const evicted = enforceMaxSize(
          next,
          lru,
          validatedConfig.max,
          cacheKey,
        )
        for (const evictedKey of evicted) {
          dispatchDeactivated(lifecycleScopeId, evictedKey)
          scrollPositionsRef.current.delete(evictedKey)
          routeCacheabilityRef.current.delete(evictedKey)
          removeLifecycleEntry(lifecycleScopeId, evictedKey)
        }
      }

      return next
    })
  }, [
    cacheKey,
    isCurrentRouteCacheable,
    lifecycleScopeId,
    outlet,
    validatedConfig.max,
  ])

  useEffect(() => {
    currentPathRef.current = cacheKey
    currentRouteCacheableRef.current = isCurrentRouteCacheable
  }, [cacheKey, isCurrentRouteCacheable])

  // ── Scroll tracking (RAF-throttled, cacheable routes only) ──────
  useEffect(() => {
    let rafId: number | null = null

    const handleScroll = () => {
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(() => {
        if (currentRouteCacheableRef.current) {
          scrollPositionsRef.current.set(currentPathRef.current, window.scrollY)
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
    if (!isCurrentRouteCacheable) return

    const nextScrollTop = isCurrentRouteCacheHit
      ? (scrollPositionsRef.current.get(cacheKey) ?? 0)
      : 0
    const frameId = window.requestAnimationFrame(() => {
      window.scrollTo(0, nextScrollTop)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [cacheKey, isCurrentRouteCacheHit, isCurrentRouteCacheable])

  // ── Lifecycle dispatch on route transitions ─────────────────────
  const prevRouteKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false
      // First entry into cacheable route → activate
      if (isCurrentRouteCacheable) {
        dispatchActivated(lifecycleScopeId, cacheKey)
      }
    } else {
      const prevKey = prevRouteKeyRef.current
      // Deactivate old route only if it was cacheable.
      if (
        prevKey &&
        prevKey !== cacheKey &&
        routeCacheabilityRef.current.get(prevKey) === true
      ) {
        dispatchDeactivated(lifecycleScopeId, prevKey)
      }
      // Activate new route only if it is cacheable
      if (isCurrentRouteCacheable) {
        dispatchActivated(lifecycleScopeId, cacheKey)
      }
    }
    prevRouteKeyRef.current = cacheKey
  }, [cacheKey, isCurrentRouteCacheable, lifecycleScopeId])

  // ── Runtime config reconciliation ───────────────────────────────
  const prevConfigRef = useRef({ max, include, exclude })

  useEffect(() => {
    const prev = prevConfigRef.current
    const configChanged =
      prev.max !== max || prev.include !== include || prev.exclude !== exclude

    if (!configChanged) return

    prevConfigRef.current = { max, include, exclude }

    // 1. Prune non-cacheable entries (include/exclude changed)
    setCachedOutlets((prev) => {
      const next = new Map(prev)
      let changed = false

      for (const cachedKey of next.keys()) {
        if (!shouldCache(cachedKey, validatedConfig)) {
          dispatchDeactivated(lifecycleScopeId, cachedKey)
          scrollPositionsRef.current.delete(cachedKey)
          routeCacheabilityRef.current.delete(cachedKey)
          removeLifecycleEntry(lifecycleScopeId, cachedKey)
          lruRef.current.delete(cachedKey)
          next.delete(cachedKey)
          changed = true
        }
      }

      // 2. Enforce new max (max decreased)
      if (validatedConfig.max > 0 && next.size > validatedConfig.max) {
        while (next.size > validatedConfig.max) {
          const evictedKey = evictLRU(lruRef.current, cacheKey)
          if (!evictedKey) break
          dispatchDeactivated(lifecycleScopeId, evictedKey)
          scrollPositionsRef.current.delete(evictedKey)
          routeCacheabilityRef.current.delete(evictedKey)
          removeLifecycleEntry(lifecycleScopeId, evictedKey)
          lruRef.current.delete(evictedKey)
          next.delete(evictedKey)
          changed = true
        }
      }

      return changed ? next : prev
    })
  }, [cacheKey, exclude, include, lifecycleScopeId, max, validatedConfig])

  useEffect(() => {
    return () => {
      removeLifecycleScope(lifecycleScopeId)
    }
  }, [lifecycleScopeId])

  return (
    <>
      {[...cachedOutlets.entries()].map(([path, element]) => (
        <RouteSlot
          key={path}
          scopeId={lifecycleScopeId}
          routeKey={path}
          isCacheable
          isActive={path === cacheKey}
        >
          {element}
        </RouteSlot>
      ))}
      {/* 非缓存路由：正常渲染但不加入缓存 */}
      {!cachedOutlets.has(cacheKey) && (
        <RouteSlot
          scopeId={lifecycleScopeId}
          routeKey={cacheKey}
          isCacheable={isCurrentRouteCacheable}
          isActive
        >
          {outlet}
        </RouteSlot>
      )}
    </>
  )
}

export default CachedOutlet
