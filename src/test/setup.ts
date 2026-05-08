import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

let scrollYValue = 0

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  writable: true,
  value: true,
})

Object.defineProperty(window, 'scrollY', {
  configurable: true,
  get: () => scrollYValue,
})

Object.defineProperty(window, 'scrollTo', {
  configurable: true,
  writable: true,
  value: vi.fn((x: number | ScrollToOptions, y?: number) => {
    if (typeof x === 'object') {
      scrollYValue = x.top ?? 0
      return
    }
    scrollYValue = y ?? 0
  }),
})

Object.defineProperty(window, 'requestAnimationFrame', {
  configurable: true,
  writable: true,
  value: vi.fn((callback: FrameRequestCallback) => {
    callback(0)
    return 1
  }),
})

Object.defineProperty(window, 'cancelAnimationFrame', {
  configurable: true,
  writable: true,
  value: vi.fn(),
})

afterEach(() => {
  cleanup()
  scrollYValue = 0
  vi.clearAllMocks()
})
