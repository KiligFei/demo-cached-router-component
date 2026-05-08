import type { CachedOutletProps, ValidatedConfig } from './types'

/**
 * Validate and normalize CachedOutlet config values.
 * - invalid max (non-number, NaN) → 0 + dev warning
 * - invalid include/exclude entries filtered out + dev warning
 */
export function normalizeConfig(
  props: Pick<CachedOutletProps, 'max' | 'include' | 'exclude'>,
): ValidatedConfig {
  const isDev = import.meta.env?.DEV

  // max
  let max = props.max
  if (max !== undefined) {
    if (typeof max !== 'number' || Number.isNaN(max)) {
      max = 0
      if (isDev) {
        console.warn(
          '[keep-alive] Invalid max value, normalized to 0. Caching disabled.',
        )
      }
    }
  }

  // include
  let include = props.include
  if (include !== undefined) {
    const valid = include.filter((item) => typeof item === 'string')
    if (valid.length !== include.length && isDev) {
      console.warn(
        '[keep-alive] Invalid include entries filtered out:',
        include.filter((item) => typeof item !== 'string'),
      )
    }
    include = valid
  }

  // exclude
  let exclude = props.exclude
  if (exclude !== undefined) {
    const valid = exclude.filter((item) => typeof item === 'string')
    if (valid.length !== exclude.length && isDev) {
      console.warn(
        '[keep-alive] Invalid exclude entries filtered out:',
        exclude.filter((item) => typeof item !== 'string'),
      )
    }
    exclude = valid
  }

  return { max: max ?? 10, include, exclude }
}

/**
 * Determine if a route (by normalized key) is cacheable under the given config.
 * - max <= 0 → not cacheable
 * - include omitted → all included
 * - exclude wins over include
 */
export function shouldCache(key: string, config: ValidatedConfig): boolean {
  if (config.max <= 0) return false

  const included =
    config.include === undefined || config.include.includes(key)
  const excluded = config.exclude?.includes(key) ?? false

  return included && !excluded
}

/**
 * Evict the least recently used non-active entry from the LRU map.
 * Returns the key of the evicted entry, or null if no candidate found.
 */
export function evictLRU(
  lru: Map<string, number>,
  activeKey: string,
): string | null {
  let lruKey: string | null = null
  let lruTime = Infinity

  for (const [k, counter] of lru) {
    if (k === activeKey) continue
    if (counter < lruTime) {
      lruTime = counter
      lruKey = k
    }
  }

  return lruKey
}

/**
 * Enforce max cache size by evicting LRU entries (never the active route).
 * Modifies both the content map and the LRU map. Returns the set of evicted keys.
 */
export function enforceMaxSize(
  content: Map<string, unknown>,
  lru: Map<string, number>,
  max: number,
  activeKey: string,
): Set<string> {
  const evicted = new Set<string>()

  if (max <= 0) return evicted

  while (content.size > max) {
    const victim = evictLRU(lru, activeKey)
    if (!victim) break // only active route remains
    content.delete(victim)
    lru.delete(victim)
    evicted.add(victim)
  }

  return evicted
}

/**
 * Remove entries that no longer pass shouldCache under the new config.
 * Returns the set of pruned keys.
 */
export function pruneNonCacheable(
  cache: Map<string, unknown>,
  config: ValidatedConfig,
): Set<string> {
  const pruned = new Set<string>()

  for (const key of cache.keys()) {
    if (!shouldCache(key, config)) {
      cache.delete(key)
      pruned.add(key)
    }
  }

  return pruned
}
