import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ScrollPositionsRef } from './internal-types'

interface UseWindowScrollOptions {
  cacheKey: string
  isCurrentRouteCacheHit: boolean
  isCurrentRouteCacheable: boolean
  scrollPositionsRef: ScrollPositionsRef
}

export function useWindowScroll({
  cacheKey,
  isCurrentRouteCacheHit,
  isCurrentRouteCacheable,
  scrollPositionsRef,
}: UseWindowScrollOptions) {
  const currentPathRef = useRef(cacheKey)
  const currentRouteCacheableRef = useRef(isCurrentRouteCacheable)

  useEffect(() => {
    currentPathRef.current = cacheKey
    currentRouteCacheableRef.current = isCurrentRouteCacheable
  }, [cacheKey, isCurrentRouteCacheable])

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
  }, [scrollPositionsRef])

  useLayoutEffect(() => {
    if (!isCurrentRouteCacheable) return

    const nextScrollTop = isCurrentRouteCacheHit
      ? (scrollPositionsRef.current.get(cacheKey) ?? 0)
      : 0
    const frameId = window.requestAnimationFrame(() => {
      window.scrollTo(0, nextScrollTop)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [
    cacheKey,
    isCurrentRouteCacheHit,
    isCurrentRouteCacheable,
    scrollPositionsRef,
  ])
}
