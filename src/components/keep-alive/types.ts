import type { DependencyList } from 'react'
import type { Location } from 'react-router'

// ─── Public Props ──────────────────────────────────────────────────

export interface CachedOutletProps {
  /** Maximum number of cached routes. Default 10. max <= 0 disables caching. */
  max?: number
  /** Routes to cache (exact match against computed cache key). Omit to cache all. */
  include?: string[]
  /** Routes to exclude from caching. Higher priority than include. */
  exclude?: string[]
  /** Cache keys to invalidate immediately. Current active key will be refreshed in place when included. */
  invalidateKeys?: string[]
  /** Cache key resolver. Default: location.pathname. Applied to cache key, include/exclude match, scroll key, lifecycle dispatch. */
  getCacheKey?: (location: Location) => string
}

// ─── Lifecycle ─────────────────────────────────────────────────────

export type LifecycleCleanup = void | (() => void)

export type LifecycleCallback = () => LifecycleCleanup

export type KeepAliveEffectDependencies = DependencyList

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
