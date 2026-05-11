import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useLocation, useOutlet } from 'react-router'
import type { Location } from 'react-router'
import { normalizeConfig, shouldCache } from './cache-policy'
import type {
  CachedRouteEntry,
  RouteSlotDescriptor,
} from './internal-types'
import { createLifecycleScopeId, removeLifecycleScope } from './lifecycle'
import { renderCachedElement } from './render-cached-element'
import { RouteSlot } from './route-slot'
import { useCachedRoutes } from './use-cached-routes'
import { useRouteLifecycleDispatch } from './use-route-lifecycle-dispatch'
import { useWindowScroll } from './use-window-scroll'
import type { CachedOutletProps } from './types'

export type { ValidatedConfig } from './types'

const defaultGetCacheKey = (location: Location): string => location.pathname

const createCachedRouteEntry = (
  element: ReactElement,
  version = 1,
): CachedRouteEntry => ({
  element,
  version,
})

const CachedOutlet = ({
  max = 10,
  include,
  exclude,
  invalidateKeys,
  getCacheKey = defaultGetCacheKey,
}: CachedOutletProps) => {
  const outlet = useOutlet()
  const [lifecycleScopeId] = useState(createLifecycleScopeId)

  const location = useLocation()
  const cacheKey = getCacheKey(location)
  const validatedConfig = useMemo(
    () => normalizeConfig({ max, include, exclude }),
    [exclude, include, max],
  )
  const isCurrentRouteCacheable = shouldCache(cacheKey, validatedConfig)
  const scrollPositionsRef = useRef(new Map<string, number>())
  const routeCacheabilityRef = useRef(new Map<string, boolean>())
  const routeActiveStateRef = useRef(new Map<string, boolean>())

  const { scheduleReactivation } = useRouteLifecycleDispatch({
    cacheKey,
    isCurrentRouteCacheable,
    lifecycleScopeId,
    routeActiveStateRef,
    routeCacheabilityRef,
  })

  const { cachedOutlets, isCurrentRouteCacheHit } = useCachedRoutes({
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
  })

  useWindowScroll({
    cacheKey,
    isCurrentRouteCacheHit,
    isCurrentRouteCacheable,
    scrollPositionsRef,
  })

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
      cachedOutlets.get(cacheKey) ??
      (outlet ? createCachedRouteEntry(outlet) : null)

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
