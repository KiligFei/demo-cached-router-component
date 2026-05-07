import { createContext, useCallback, useContext, useRef } from 'react'
import type {
  LifecycleCallback,
  LifecycleRegistry,
  LifecycleRegistryEntry,
} from './types'

// ─── Context ───────────────────────────────────────────────────────

export interface KeepAliveContextValue {
  /** Normalized route key for the current route. */
  routeKey: string
  /** Register an activated callback for the current route (called during render). */
  registerActivated: (cb: LifecycleCallback) => void
  /** Register a deactivated callback for the current route (called during render). */
  registerDeactivated: (cb: LifecycleCallback) => void
}

export const KeepAliveContext = createContext<KeepAliveContextValue | null>(
  null,
)

// ─── Module-level Registry ─────────────────────────────────────────

const registry: LifecycleRegistry = new Map()

function getOrCreateEntry(key: string): LifecycleRegistryEntry {
  let entry = registry.get(key)
  if (!entry) {
    entry = {
      activated: [],
      activatedCleanups: [],
      deactivated: [],
      deactivatedCleanups: [],
    }
    registry.set(key, entry)
  }
  return entry
}

// ─── Registration (with dedup by reference identity) ───────────────

export function registerActivatedCallback(key: string, cb: LifecycleCallback) {
  const list = getOrCreateEntry(key).activated
  if (list[list.length - 1] !== cb) {
    list.push(cb)
  }
}

export function registerDeactivatedCallback(
  key: string,
  cb: LifecycleCallback,
) {
  const list = getOrCreateEntry(key).deactivated
  if (list[list.length - 1] !== cb) {
    list.push(cb)
  }
}

/** Clear registration lists before a new render cycle (preserves cleanups). */
export function resetRegistrations(key: string) {
  const entry = registry.get(key)
  if (entry) {
    entry.activated = []
    entry.deactivated = []
  }
}

// ─── Dispatch (called by CachedOutlet on route transitions) ────────

export function dispatchActivated(key: string) {
  const entry = registry.get(key)
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

export function dispatchDeactivated(key: string) {
  const entry = registry.get(key)
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

export function removeLifecycleEntry(key: string) {
  registry.delete(key)
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

  const cbRef = useRef(callback)
  cbRef.current! = callback

  // Register during render so callbacks are available before dispatch.
  // Dedup: only push if not already the last registered entry (same closure identity).
  const stableCb = useCallback(() => cbRef.current(), [])
  ctx.registerActivated(stableCb)
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

  const cbRef = useRef(callback)
  cbRef.current! = callback

  const stableCb = useCallback(() => cbRef.current(), [])
  ctx.registerDeactivated(stableCb)
}
