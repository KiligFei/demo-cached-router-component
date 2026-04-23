import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useOutlet } from 'react-router'

const normalizePath = (pathname: string) => {
  return pathname === '/' ? '/home' : pathname
}

const CachedOutlet = () => {
  const outlet = useOutlet()
  const [cachedOutlets, setCachedOutlets] = useState(
    new Map<string, React.ReactElement>(),
  )

  const location = useLocation()
  const key = normalizePath(location.pathname)
  const outletRef = useRef<React.ReactElement | null>(null)
  const scrollPositionsRef = useRef(new Map<string, number>())
  const currentPathRef = useRef(key)

  useEffect(() => {
    if (outlet) {
      outletRef.current = outlet
      setCachedOutlets((prev) => {
        const newMap = new Map(prev)
        newMap.set(key, outletRef.current!)
        return newMap
      })
    }
  }, [key, outlet])

  useEffect(() => {
    currentPathRef.current = key
  }, [key])

  useEffect(() => {
    let rafId: number | null = null

    const handleScroll = () => {
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(() => {
        scrollPositionsRef.current.set(currentPathRef.current, window.scrollY)
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
  }, [])

  useLayoutEffect(() => {
    const nextScrollTop = scrollPositionsRef.current.get(key) ?? 0
    const frameId = window.requestAnimationFrame(() => {
      window.scrollTo(0, nextScrollTop)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [key])

  return (
    <>
      {[...cachedOutlets.entries()].map(([path, element]) => {
        return (
          <div
            key={path}
            style={{ display: path === key ? 'block' : 'none', height: '100%' }}
          >
            {element}
          </div>
        )
      })}
    </>
  )
}

export default CachedOutlet
