import {
  createContext,
  useEffect,
  useEffectEvent,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type {
  KeepAliveEffectDependencies,
  LifecycleCallback,
  LifecycleRegistry,
  LifecycleRegistryEntry,
} from './types'

// ─── Context ───────────────────────────────────────────────────────

export interface KeepAliveContextValue {
  /** CachedOutlet instance scope id for lifecycle isolation. */
  scopeId: string
  /** Normalized route key for the current route. */
  routeKey: string
  /** Whether the current route is cacheable under the active config. */
  isCacheable: boolean
  /** Whether the current route is the active visible route. */
  isActive: boolean
  /** Register an activated callback for the current route. */
  registerActivated: (cb: LifecycleCallback) => () => void
  /** Register a deactivated callback for the current route. */
  registerDeactivated: (cb: LifecycleCallback) => () => void
}

export const KeepAliveContext = createContext<KeepAliveContextValue | null>(
  null,
)

// ─── Module-level Registry ─────────────────────────────────────────

const registry: LifecycleRegistry = new Map()
let scopeIdCounter = 0

function runLifecycleCleanups(
  cleanups: ((() => void) | undefined)[],
  errorLabel: string,
) {
  for (const cleanup of cleanups) {
    try {
      cleanup?.()
    } catch (e) {
      console.error(`[keep-alive] ${errorLabel}:`, e)
    }
  }
}

function collectLifecycleCleanups(
  callbacks: LifecycleCallback[],
  errorLabel: string,
) {
  const cleanups: ((() => void) | undefined)[] = []

  for (const callback of callbacks) {
    try {
      cleanups.push(callback() ?? undefined)
    } catch (e) {
      console.error(`[keep-alive] ${errorLabel}:`, e)
      cleanups.push(undefined)
    }
  }

  return cleanups
}

function getOrCreateScope(scopeId: string) {
  let scope = registry.get(scopeId)
  if (!scope) {
    scope = new Map()
    registry.set(scopeId, scope)
  }
  return scope
}

function getOrCreateEntry(
  scopeId: string,
  key: string,
): LifecycleRegistryEntry {
  const scope = getOrCreateScope(scopeId)
  let entry = scope.get(key)
  if (!entry) {
    entry = {
      activated: [],
      activatedCleanups: [],
      deactivated: [],
      deactivatedCleanups: [],
    }
    scope.set(key, entry)
  }
  return entry
}

export function createLifecycleScopeId(): string {
  scopeIdCounter += 1
  return `keep-alive-scope-${scopeIdCounter}`
}

// ─── Registration ──────────────────────────────────────────────────

export function registerActivatedCallback(
  scopeId: string,
  key: string,
  cb: LifecycleCallback,
) {
  const entry = getOrCreateEntry(scopeId, key)
  entry.activated.push(cb)

  return () => {
    const current = registry.get(scopeId)?.get(key)
    if (!current) return
    const index = current.activated.indexOf(cb)
    if (index >= 0) {
      current.activated.splice(index, 1)
    }
  }
}

export function registerDeactivatedCallback(
  scopeId: string,
  key: string,
  cb: LifecycleCallback,
) {
  const entry = getOrCreateEntry(scopeId, key)
  entry.deactivated.push(cb)

  return () => {
    const current = registry.get(scopeId)?.get(key)
    if (!current) return
    const index = current.deactivated.indexOf(cb)
    if (index >= 0) {
      current.deactivated.splice(index, 1)
    }
  }
}

// ─── Dispatch (called by CachedOutlet on route transitions) ────────

export function dispatchActivated(scopeId: string, key: string) {
  const entry = registry.get(scopeId)?.get(key)
  if (!entry) return

  // 1. Run cleanups from previous deactivated dispatch
  runLifecycleCleanups(
    entry.deactivatedCleanups,
    'deactivated cleanup error',
  )
  entry.deactivatedCleanups = []

  // 2. Run activated callbacks in registration order
  entry.activatedCleanups = collectLifecycleCleanups(
    entry.activated,
    'activated callback error',
  )
}

export function dispatchDeactivated(scopeId: string, key: string) {
  const entry = registry.get(scopeId)?.get(key)
  if (!entry) return

  // 1. Run cleanups from previous activated dispatch
  runLifecycleCleanups(entry.activatedCleanups, 'activated cleanup error')
  entry.activatedCleanups = []

  // 2. Run deactivated callbacks in registration order
  entry.deactivatedCleanups = collectLifecycleCleanups(
    entry.deactivated,
    'deactivated callback error',
  )
}

/**
 * Dispose a lifecycle entry without re-dispatching route transition callbacks.
 * Used when an already inactive cache entry is evicted or invalidated.
 */
export function disposeLifecycleEntry(scopeId: string, key: string) {
  const entry = registry.get(scopeId)?.get(key)
  if (!entry) return

  runLifecycleCleanups(entry.activatedCleanups, 'activated cleanup error')
  entry.activatedCleanups = []

  runLifecycleCleanups(
    entry.deactivatedCleanups,
    'deactivated cleanup error',
  )
  entry.deactivatedCleanups = []
}

// ─── Eviction ──────────────────────────────────────────────────────

export function removeLifecycleEntry(scopeId: string, key: string) {
  const scope = registry.get(scopeId)
  if (!scope) return

  scope.delete(key)
  if (scope.size === 0) {
    registry.delete(scopeId)
  }
}

export function removeLifecycleScope(scopeId: string) {
  registry.delete(scopeId)
}

// ─── Hooks ─────────────────────────────────────────────────────────

/**
 * Register a callback that runs when the route becomes active.
 * This includes the first entry into a cacheable route and later cache-hit re-entry.
 * Callback may return a cleanup function that runs on deactivation.
 */
export function useActivated(callback: LifecycleCallback) {
  const ctx = useContext(KeepAliveContext)
  if (!ctx) {
    throw new Error('useActivated must be used within a CachedOutlet')
  }
  const { isCacheable, registerActivated, routeKey } = ctx
  const onActivated = useEffectEvent(callback)

  useLayoutEffect(() => {
    if (!isCacheable) {
      if (import.meta.env?.DEV) {
        console.warn(
          `[keep-alive] useActivated on route "${routeKey}" has no effect — this route is not cached (check include/exclude config).`,
        )
      }
      return
    }

    return registerActivated(onActivated)
  }, [isCacheable, registerActivated, routeKey])
}

/**
 * Register a callback that runs when the route becomes inactive (navigate away).
 * Callback may return a cleanup function that runs on next activation.
 */
export function useDeactivated(callback: LifecycleCallback) {
  const ctx = useContext(KeepAliveContext)
  if (!ctx) {
    throw new Error('useDeactivated must be used within a CachedOutlet')
  }
  const { isCacheable, registerDeactivated, routeKey } = ctx
  const onDeactivated = useEffectEvent(callback)

  useLayoutEffect(() => {
    if (!isCacheable) {
      if (import.meta.env?.DEV) {
        console.warn(
          `[keep-alive] useDeactivated on route "${routeKey}" has no effect — this route is not cached (check include/exclude config).`,
        )
      }
      return
    }

    return registerDeactivated(onDeactivated)
  }, [isCacheable, registerDeactivated, routeKey])
}

export function useKeepAliveStatus() {
  const ctx = useContext(KeepAliveContext)
  if (!ctx) {
    throw new Error('useKeepAliveStatus must be used within a CachedOutlet')
  }

  return {
    isActive: ctx.isActive,
    isCacheable: ctx.isCacheable,
    routeKey: ctx.routeKey,
    scopeId: ctx.scopeId,
  }
}

export function useKeepAliveActive() {
  return useKeepAliveStatus().isActive
}

function areDependenciesEqual(
  prevDeps: KeepAliveEffectDependencies,
  nextDeps: KeepAliveEffectDependencies,
) {
  if (prevDeps.length !== nextDeps.length) return false

  for (let index = 0; index < prevDeps.length; index += 1) {
    if (!Object.is(prevDeps[index], nextDeps[index])) {
      return false
    }
  }

  return true
}

function useDependencyVersion(deps: KeepAliveEffectDependencies) {
  const previousDepsRef = useRef(deps)
  const [version, setVersion] = useState(0)

  // eslint-disable-next-line react-hooks/exhaustive-deps -- custom shallow compare for a dynamic dependency list
  useLayoutEffect(() => {
    if (areDependenciesEqual(previousDepsRef.current, deps)) {
      return
    }

    previousDepsRef.current = deps
    setVersion((currentVersion) => currentVersion + 1)
  })

  return version
}

/**
 * useEffect variant for keep-alive pages.
 * The effect only runs while the route is active/visible.
 * When the page becomes hidden, the previous cleanup runs automatically.
 */
export function useKeepAliveEffect(
  effect: LifecycleCallback,
  deps: KeepAliveEffectDependencies = [],
) {
  const { isActive } = useKeepAliveStatus()
  const effectVersion = useDependencyVersion(deps)
  const onVisibleEffect = useEffectEvent(effect)

  useEffect(() => {
    if (!isActive) return

    return onVisibleEffect()
  }, [effectVersion, isActive])
}
