import type React from 'react'
import type { Location } from 'react-router'

// ─── Public Props ──────────────────────────────────────────────────

export interface CachedOutletProps {
  /** Maximum number of cached routes. Default 10. max <= 0 disables caching. */
  max?: number
  /** Routes to cache (exact match against computed cache key). Omit to cache all. */
  include?: string[]
  /** Routes to exclude from caching. Higher priority than include. */
  exclude?: string[]
  /** Cache key resolver. Default: location.pathname. Applied to cache key, include/exclude match, scroll key, lifecycle dispatch. */
  getCacheKey?: (location: Location) => string
}

// ─── Internal Cache Entry ──────────────────────────────────────────

export interface CacheEntry {
  /** Resolved cache key for the route instance. */
  key: string
  /** Cached route element instance (never replaced on cache hit). */
  element: React.ReactElement
  /** Monotonically increasing counter updated on each activation, used for LRU ordering. */
  lastActivatedAt: number
}

// ─── Lifecycle ─────────────────────────────────────────────────────

export type LifecycleCleanup = void | (() => void)

export type LifecycleCallback = () => LifecycleCleanup

export interface LifecycleRegistryEntry {
  /** Callbacks registered via useActivated, in registration order. */
  activated: LifecycleCallback[]
  /** Cleanup functions returned by the most recent activated dispatch. */
  activatedCleanups: ((() => void) | undefined)[]
  /** Callbacks registered via useDeactivated, in registration order. */
  deactivated: LifecycleCallback[]
  /** Cleanup functions returned by the most recent deactivated dispatch. */
  deactivatedCleanups: ((() => void) | undefined)[]
}

/** Registry keyed by scope id, then route key. */
export type LifecycleRegistry = Map<string, Map<string, LifecycleRegistryEntry>>

// ─── Validated Config (output of normalizeConfig) ──────────────────

export interface ValidatedConfig {
  max: number
  include: string[] | undefined
  exclude: string[] | undefined
}
