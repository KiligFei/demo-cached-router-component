import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  enforceMaxSize,
  evictLRU,
  shouldCache,
} from './cache-policy'
import {
  dispatchDeactivated,
  disposeLifecycleEntry,
  removeLifecycleEntry,
} from './lifecycle'
import type {
  CachedRouteEntry,
  RouteStateRef,
  ScrollPositionsRef,
} from './internal-types'
import type { ValidatedConfig } from './types'

interface UseCachedRoutesOptions {
  cacheKey: string
  max: number
  include: string[] | undefined
  exclude: string[] | undefined
  invalidateKeys: string[] | undefined
  isCurrentRouteCacheable: boolean
  lifecycleScopeId: string
  outlet: ReactElement | null
  routeActiveStateRef: RouteStateRef
  routeCacheabilityRef: RouteStateRef
  scheduleReactivation: (key: string) => void
  scrollPositionsRef: ScrollPositionsRef
  validatedConfig: ValidatedConfig
}

const createCachedRouteEntry = (
  element: ReactElement,
  version = 1,
): CachedRouteEntry => ({
  element,
  version,
})

const getRouteVersion = (entry?: CachedRouteEntry): number =>
  entry?.version ?? 1

export function useCachedRoutes({
  cacheKey,
  max,
  include,
  exclude,
  invalidateKeys,
  isCurrentRouteCacheable,
  lifecycleScopeId,
  outlet,
  routeActiveStateRef,
  routeCacheabilityRef,
  scheduleReactivation,
  scrollPositionsRef,
  validatedConfig,
}: UseCachedRoutesOptions) {
  const [cachedOutlets, setCachedOutlets] = useState(
    () => new Map<string, CachedRouteEntry>(),
  )
  const lruRef = useRef(new Map<string, number>())
  const lruCounter = useRef(0)
  const prevConfigRef = useRef({ max, include, exclude })
  const prevInvalidationSignatureRef = useRef('')
  const invalidationSignature = useMemo(() => {
    if (!invalidateKeys || invalidateKeys.length === 0) return ''
    return JSON.stringify([...new Set(invalidateKeys)].sort())
  }, [invalidateKeys])

  const removeRouteMetadata = useCallback((key: string) => {
    scrollPositionsRef.current.delete(key)
    routeActiveStateRef.current.delete(key)
    routeCacheabilityRef.current.delete(key)
    removeLifecycleEntry(lifecycleScopeId, key)
    lruRef.current.delete(key)
  }, [
    lifecycleScopeId,
    routeActiveStateRef,
    routeCacheabilityRef,
    scrollPositionsRef,
  ])

  const disposeRoute = useCallback((key: string) => {
    if (routeActiveStateRef.current.get(key) === true) {
      dispatchDeactivated(lifecycleScopeId, key)
    } else {
      disposeLifecycleEntry(lifecycleScopeId, key)
    }

    removeRouteMetadata(key)
  }, [lifecycleScopeId, removeRouteMetadata, routeActiveStateRef])

  useEffect(() => {
    if (!outlet) return

    setCachedOutlets((prevCachedOutlets) => {
      if (prevCachedOutlets.has(cacheKey)) {
        routeCacheabilityRef.current.set(cacheKey, true)
        lruRef.current.set(cacheKey, ++lruCounter.current)
        return prevCachedOutlets
      }

      if (!isCurrentRouteCacheable) {
        routeCacheabilityRef.current.set(cacheKey, false)
        return prevCachedOutlets
      }

      const next = new Map(prevCachedOutlets)
      next.set(cacheKey, createCachedRouteEntry(outlet))
      lruRef.current.set(cacheKey, ++lruCounter.current)
      routeCacheabilityRef.current.set(cacheKey, true)

      if (validatedConfig.max > 0 && next.size > validatedConfig.max) {
        const evicted = enforceMaxSize(
          next,
          lruRef.current,
          validatedConfig.max,
          cacheKey,
        )
        for (const evictedKey of evicted) {
          disposeRoute(evictedKey)
        }
      }

      return next
    })
  }, [
    cacheKey,
    disposeRoute,
    isCurrentRouteCacheable,
    outlet,
    routeCacheabilityRef,
    validatedConfig.max,
  ])

  useEffect(() => {
    const prev = prevConfigRef.current
    const configChanged =
      prev.max !== max || prev.include !== include || prev.exclude !== exclude

    if (!configChanged) return

    prevConfigRef.current = { max, include, exclude }

    setCachedOutlets((prevCachedOutlets) => {
      const next = new Map(prevCachedOutlets)
      let changed = false

      for (const cachedKey of next.keys()) {
        if (!shouldCache(cachedKey, validatedConfig)) {
          disposeRoute(cachedKey)
          next.delete(cachedKey)
          changed = true
        }
      }

      if (validatedConfig.max > 0 && next.size > validatedConfig.max) {
        while (next.size > validatedConfig.max) {
          const evictedKey = evictLRU(lruRef.current, cacheKey)
          if (!evictedKey) break
          disposeRoute(evictedKey)
          next.delete(evictedKey)
          changed = true
        }
      }

      return changed ? next : prevCachedOutlets
    })
  }, [cacheKey, disposeRoute, exclude, include, max, validatedConfig])

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

    setCachedOutlets((prevCachedOutlets) => {
      if (keysToInvalidate.length === 0) return prevCachedOutlets

      const next = new Map(prevCachedOutlets)
      let changed = false

      for (const invalidKey of keysToInvalidate) {
        const currentEntry = next.get(invalidKey)
        if (!currentEntry) continue

        disposeRoute(invalidKey)
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
        }
      }

      return changed ? next : prevCachedOutlets
    })

    if (shouldRefreshCurrentRoute) {
      scheduleReactivation(cacheKey)
    }
  }, [
    cacheKey,
    cachedOutlets,
    disposeRoute,
    invalidationSignature,
    isCurrentRouteCacheable,
    outlet,
    routeCacheabilityRef,
    scheduleReactivation,
  ])

  return {
    cachedOutlets,
    isCurrentRouteCacheHit: cachedOutlets.has(cacheKey),
  }
}
