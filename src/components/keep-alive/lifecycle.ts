import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
} from 'react'
import type {
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
  for (const cleanup of entry.deactivatedCleanups) {
    try {
      cleanup?.()
    } catch (e) {
      console.error('[keep-alive] deactivated cleanup error:', e)
    }
  }
  entry.deactivatedCleanups = []

  // 2. Run activated callbacks in registration order
  const cleanups: ((() => void) | undefined)[] = []
  for (const cb of entry.activated) {
    try {
      cleanups.push(cb() ?? undefined)
    } catch (e) {
      console.error('[keep-alive] activated callback error:', e)
      cleanups.push(undefined)
    }
  }
  entry.activatedCleanups = cleanups
}

export function dispatchDeactivated(scopeId: string, key: string) {
  const entry = registry.get(scopeId)?.get(key)
  if (!entry) return

  // 1. Run cleanups from previous activated dispatch
  for (const cleanup of entry.activatedCleanups) {
    try {
      cleanup?.()
    } catch (e) {
      console.error('[keep-alive] activated cleanup error:', e)
    }
  }
  entry.activatedCleanups = []

  // 2. Run deactivated callbacks in registration order
  const cleanups: ((() => void) | undefined)[] = []
  for (const cb of entry.deactivated) {
    try {
      cleanups.push(cb() ?? undefined)
    } catch (e) {
      console.error('[keep-alive] deactivated callback error:', e)
      cleanups.push(undefined)
    }
  }
  entry.deactivatedCleanups = cleanups
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
 * Register a callback that runs when the route becomes active (cache-hit re-entry).
 * Callback may return a cleanup function that runs on deactivation.
 */
export function useActivated(callback: LifecycleCallback) {
  const ctx = useContext(KeepAliveContext)
  if (!ctx) {
    throw new Error('useActivated must be used within a CachedOutlet')
  }
  const { isCacheable, registerActivated, routeKey } = ctx

  const cbRef = useRef(callback)
  cbRef.current! = callback

  const stableCb = useCallback(() => cbRef.current(), [])

  useLayoutEffect(() => {
    if (!isCacheable) {
      if (import.meta.env?.DEV) {
        console.warn(
          `[keep-alive] useActivated on route "${routeKey}" has no effect — this route is not cached (check include/exclude config).`,
        )
      }
      return
    }

    return registerActivated(stableCb)
  }, [isCacheable, registerActivated, routeKey, stableCb])
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

  const cbRef = useRef(callback)
  cbRef.current! = callback

  const stableCb = useCallback(() => cbRef.current(), [])

  useLayoutEffect(() => {
    if (!isCacheable) {
      if (import.meta.env?.DEV) {
        console.warn(
          `[keep-alive] useDeactivated on route "${routeKey}" has no effect — this route is not cached (check include/exclude config).`,
        )
      }
      return
    }

    return registerDeactivated(stableCb)
  }, [isCacheable, registerDeactivated, routeKey, stableCb])
}
