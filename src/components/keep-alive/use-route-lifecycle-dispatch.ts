import { useCallback, useEffect, useRef, useState } from 'react'
import { dispatchActivated, dispatchDeactivated } from './lifecycle'
import type { RouteStateRef } from './internal-types'

interface UseRouteLifecycleDispatchOptions {
  cacheKey: string
  isCurrentRouteCacheable: boolean
  lifecycleScopeId: string
  routeActiveStateRef: RouteStateRef
  routeCacheabilityRef: RouteStateRef
}

export function useRouteLifecycleDispatch({
  cacheKey,
  isCurrentRouteCacheable,
  lifecycleScopeId,
  routeActiveStateRef,
  routeCacheabilityRef,
}: UseRouteLifecycleDispatchOptions) {
  const isFirstMountRef = useRef(true)
  const pendingReactivationKeyRef = useRef<string | null>(null)
  const prevRouteKeyRef = useRef<string | null>(null)
  const [refreshEpoch, setRefreshEpoch] = useState(0)

  const scheduleReactivation = useCallback((key: string) => {
    pendingReactivationKeyRef.current = key
    setRefreshEpoch((value) => value + 1)
  }, [])

  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false
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
      if (
        prevKey &&
        prevKey !== cacheKey &&
        routeCacheabilityRef.current.get(prevKey) === true
      ) {
        dispatchDeactivated(lifecycleScopeId, prevKey)
        routeActiveStateRef.current.set(prevKey, false)
      }

      if (isCurrentRouteCacheable) {
        dispatchActivated(lifecycleScopeId, cacheKey)
        routeActiveStateRef.current.set(cacheKey, true)
      }
    }

    prevRouteKeyRef.current = cacheKey
  }, [
    cacheKey,
    isCurrentRouteCacheable,
    lifecycleScopeId,
    refreshEpoch,
    routeActiveStateRef,
    routeCacheabilityRef,
  ])

  return { scheduleReactivation }
}
