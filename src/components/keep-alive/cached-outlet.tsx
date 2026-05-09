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
  disposeLifecycleEntry,
  registerActivatedCallback,
  registerDeactivatedCallback,
  removeLifecycleEntry,
  removeLifecycleScope,
} from './lifecycle'
import type { CachedOutletProps } from './types'

export type { ValidatedConfig } from './types'

const defaultGetCacheKey = (location: Location): string => location.pathname

const CachedInstance = ({
  children,
}: {
  children: React.ReactNode
}) => children

type CachedRouteEntry = {
  element: React.ReactElement
  version: number
}

const createCachedRouteEntry = (
  element: React.ReactElement,
  version = 1,
): CachedRouteEntry => ({
  element,
  version,
})

const getRouteVersion = (entry?: CachedRouteEntry): number =>
  entry?.version ?? 1

const renderCachedElement = (
  key: string,
  entry: CachedRouteEntry | null,
) => {
  if (!entry) return null

  return (
    <CachedInstance key={`${key}:${entry.version}`}>
      {entry.element}
    </CachedInstance>
  )
}

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
      isActive,
      isCacheable,
      registerActivated: (cb: () => void | (() => void)) =>
        registerActivatedCallback(scopeId, routeKey, cb),
      registerDeactivated: (cb: () => void | (() => void)) =>
        registerDeactivatedCallback(scopeId, routeKey, cb),
    }),
    [isActive, isCacheable, routeKey, scopeId],
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

type RouteSlotDescriptor = {
  element: React.ReactNode
  isActive: boolean
  isCacheable: boolean
  routeKey: string
}

const CachedOutlet = ({
  max = 10,
  include,
  exclude,
  invalidateKeys,
  getCacheKey = defaultGetCacheKey,
}: CachedOutletProps) => {
  const outlet = useOutlet()
  const [cachedOutlets, setCachedOutlets] = useState(
    () => new Map<string, CachedRouteEntry>(),
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
  const invalidationSignature = useMemo(() => {
    if (!invalidateKeys || invalidateKeys.length === 0) return ''
    return JSON.stringify([...new Set(invalidateKeys)].sort())
  }, [invalidateKeys])
  const scrollPositionsRef = useRef(new Map<string, number>())
  const currentPathRef = useRef(cacheKey)
  const currentRouteCacheableRef = useRef(isCurrentRouteCacheable)
  const routeCacheabilityRef = useRef(new Map<string, boolean>())
  const routeActiveStateRef = useRef(new Map<string, boolean>())
  // LRU recency tracking: key → last activated counter
  const lruRef = useRef(new Map<string, number>())
  const lruCounter = useRef(0)
  const isFirstMountRef = useRef(true)
  const pendingReactivationKeyRef = useRef<string | null>(null)
  const [refreshEpoch, setRefreshEpoch] = useState(0)

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

      next.set(cacheKey, createCachedRouteEntry(outlet))
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
          disposeLifecycleEntry(lifecycleScopeId, evictedKey)
          scrollPositionsRef.current.delete(evictedKey)
          routeActiveStateRef.current.delete(evictedKey)
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
        routeActiveStateRef.current.set(cacheKey, true)
      }
    } else if (pendingReactivationKeyRef.current === cacheKey) {
      pendingReactivationKeyRef.current = null
      if (isCurrentRouteCacheable) {
        dispatchActivated(lifecycleScopeId, cacheKey)
        routeActiveStateRef.current.set(cacheKey, true)
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
        routeActiveStateRef.current.set(prevKey, false)
      }
      // Activate new route only if it is cacheable
      if (isCurrentRouteCacheable) {
        dispatchActivated(lifecycleScopeId, cacheKey)
        routeActiveStateRef.current.set(cacheKey, true)
      }
    }
    prevRouteKeyRef.current = cacheKey
  }, [cacheKey, isCurrentRouteCacheable, lifecycleScopeId, refreshEpoch])

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
          const wasActive =
            routeActiveStateRef.current.get(cachedKey) === true
          if (wasActive) {
            dispatchDeactivated(lifecycleScopeId, cachedKey)
          } else {
            disposeLifecycleEntry(lifecycleScopeId, cachedKey)
          }
          scrollPositionsRef.current.delete(cachedKey)
          routeActiveStateRef.current.delete(cachedKey)
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
          disposeLifecycleEntry(lifecycleScopeId, evictedKey)
          scrollPositionsRef.current.delete(evictedKey)
          routeActiveStateRef.current.delete(evictedKey)
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

  const prevInvalidationSignatureRef = useRef('')

  useEffect(() => {
    if (!invalidationSignature) {
      prevInvalidationSignatureRef.current = ''
      return
    }

    if (prevInvalidationSignatureRef.current === invalidationSignature) {
      return
    }
    prevInvalidationSignatureRef.current = invalidationSignature

    const keysToInvalidate = JSON.parse(invalidationSignature) as string[]
    const shouldRefreshCurrentRoute =
      keysToInvalidate.includes(cacheKey) &&
      cachedOutlets.has(cacheKey) &&
      isCurrentRouteCacheable &&
      Boolean(outlet)

    setCachedOutlets((prev) => {
      if (keysToInvalidate.length === 0) return prev

      const next = new Map(prev)
      let changed = false

      for (const invalidKey of keysToInvalidate) {
        const currentEntry = next.get(invalidKey)
        if (!currentEntry) continue

        const isActiveKey =
          invalidKey === cacheKey &&
          routeActiveStateRef.current.get(invalidKey) === true
        if (isActiveKey) {
          dispatchDeactivated(lifecycleScopeId, invalidKey)
        } else {
          disposeLifecycleEntry(lifecycleScopeId, invalidKey)
        }
        scrollPositionsRef.current.delete(invalidKey)
        routeActiveStateRef.current.delete(invalidKey)
        routeCacheabilityRef.current.delete(invalidKey)
        removeLifecycleEntry(lifecycleScopeId, invalidKey)
        lruRef.current.delete(invalidKey)
        next.delete(invalidKey)
        changed = true

        if (invalidKey === cacheKey && isCurrentRouteCacheable && outlet) {
          next.set(
            cacheKey,
            createCachedRouteEntry(
              outlet,
              getRouteVersion(currentEntry) + 1,
            ),
          )
          lruRef.current.set(cacheKey, ++lruCounter.current)
          routeCacheabilityRef.current.set(cacheKey, true)
          pendingReactivationKeyRef.current = cacheKey
        }
      }

      return changed ? next : prev
    })

    if (shouldRefreshCurrentRoute) {
      setRefreshEpoch((value) => value + 1)
    }
  }, [
    cacheKey,
    cachedOutlets,
    invalidationSignature,
    isCurrentRouteCacheable,
    lifecycleScopeId,
    outlet,
  ])

  useEffect(() => {
    return () => {
      removeLifecycleScope(lifecycleScopeId)
    }
  }, [lifecycleScopeId])

  const routeSlots: RouteSlotDescriptor[] = [...cachedOutlets.entries()]
    .filter(([path]) => path !== cacheKey)
    .map(([path, entry]) => ({
      element: renderCachedElement(path, entry),
      isActive: false,
      isCacheable: true,
      routeKey: path,
    }))

  if (isCurrentRouteCacheable) {
    const activeEntry =
      cachedOutlets.get(cacheKey) ?? (outlet ? createCachedRouteEntry(outlet) : null)

    routeSlots.push({
      element: renderCachedElement(cacheKey, activeEntry),
      isActive: true,
      isCacheable: true,
      routeKey: cacheKey,
    })
  } else {
    routeSlots.push({
      element: outlet,
      isActive: true,
      isCacheable: false,
      routeKey: cacheKey,
    })
  }

  return (
    <>
      {routeSlots.map(({ element, isActive, isCacheable, routeKey }) => (
        <RouteSlot
          key={routeKey}
          scopeId={lifecycleScopeId}
          routeKey={routeKey}
          isCacheable={isCacheable}
          isActive={isActive}
        >
          {element}
        </RouteSlot>
      ))}
    </>
  )
}

export default CachedOutlet
