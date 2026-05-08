import { act, useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
  createMemoryRouter,
} from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import CachedOutlet from './cached-outlet'
import type { CachedOutletProps } from './types'
import {
  createLifecycleScopeId,
  dispatchActivated,
  registerActivatedCallback,
  useActivated,
  useDeactivated,
} from './lifecycle'

type ConfigControl = {
  initialConfig: CachedOutletProps
  setConfig?: Dispatch<SetStateAction<CachedOutletProps>>
}

type RenderHarnessOptions = {
  config: CachedOutletProps
  eventLog?: string[]
  mountCounts?: Record<string, number>
  initialEntry?: string
  control?: ConfigControl
}

type TrackedPageProps = {
  name: string
  onEvent: (event: string) => void
  onMount?: (name: string) => void
}

const TrackedPage = ({ name, onEvent, onMount }: TrackedPageProps) => {
  useEffect(() => {
    onMount?.(name)
  }, [name, onMount])

  useActivated(() => {
    onEvent(`${name}:activated`)
    return () => onEvent(`${name}:activated-cleanup`)
  })

  useDeactivated(() => {
    onEvent(`${name}:deactivated`)
    return () => onEvent(`${name}:deactivated-cleanup`)
  })

  return (
    <div style={{ height: 2000 }}>
      <h1>{name}</h1>
      <input
        aria-label={`${name}-input`}
        defaultValue=""
        name={`${name}-input`}
      />
    </div>
  )
}

const createRootLayout = ({
  initialConfig,
  onConfigReady,
}: {
  initialConfig: CachedOutletProps
  onConfigReady?: (setConfig: Dispatch<SetStateAction<CachedOutletProps>>) => void
}) => {
  const Layout = () => {
    const [config, setConfig] = useState(initialConfig)
    const onConfigReadyRef = useRef(onConfigReady)

    useEffect(() => {
      onConfigReadyRef.current?.(setConfig)
    }, [setConfig])

    return <CachedOutlet {...config} />
  }

  return Layout
}

function renderHarness({
  config,
  eventLog = [],
  mountCounts,
  initialEntry = '/home',
  control,
}: RenderHarnessOptions) {
  const onEvent = (event: string) => {
    eventLog.push(event)
  }
  const onMount = mountCounts
    ? (name: string) => {
        mountCounts[name] = (mountCounts[name] ?? 0) + 1
      }
    : undefined
  const Layout = createRootLayout({
    initialConfig: control?.initialConfig ?? config,
    onConfigReady: control
      ? (setConfig) => {
          control.setConfig = setConfig
        }
      : undefined,
  })

  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <Layout />,
        children: [
          {
            path: 'home',
            element: (
              <TrackedPage
                name="home"
                onEvent={onEvent}
                onMount={onMount}
              />
            ),
          },
          {
            path: 'movie',
            element: (
              <TrackedPage
                name="movie"
                onEvent={onEvent}
                onMount={onMount}
              />
            ),
          },
          {
            path: 'about',
            element: (
              <TrackedPage
                name="about"
                onEvent={onEvent}
                onMount={onMount}
              />
            ),
          },
        ],
      },
    ],
    { initialEntries: [initialEntry] },
  )

  render(<RouterProvider router={router} />)

  return { control, eventLog, mountCounts, router }
}

function getVisibleInput(label: string): HTMLInputElement {
  return (
    screen
      .getAllByLabelText(label)
      .find((element) => !element.closest('div[style*="display: none"]')) as
      | HTMLInputElement
      | undefined
  )!
}

describe('CachedOutlet', () => {
  it('preserves input state and restores scroll position on cache hit re-activation', async () => {
    const { router } = renderHarness({
      config: {
        include: ['/home', '/movie'],
        max: 2,
      },
    })

    const homeInput = getVisibleInput('home-input')
    fireEvent.change(homeInput, { target: { value: 'keep-me' } })
    window.scrollTo(0, 480)
    fireEvent.scroll(window)

    await act(async () => {
      await router.navigate('/movie')
    })
    await screen.findByText('movie')

    await act(async () => {
      await router.navigate('/home')
    })

    await waitFor(() => {
      const restoredInput = screen.getByLabelText('home-input') as HTMLInputElement
      expect(restoredInput.value).toBe('keep-me')
      expect(window.scrollY).toBe(480)
    })
  })

  it('evicts the least recently used route when max is exceeded', async () => {
    const mountCounts: Record<string, number> = {}
    const { router } = renderHarness({
      config: {
        include: ['/home', '/movie', '/about'],
        max: 2,
      },
      mountCounts,
    })

    const homeInput = getVisibleInput('home-input')
    fireEvent.change(homeInput, { target: { value: 'evict-me' } })
    const initialHomeMounts = mountCounts.home ?? 0

    await act(async () => {
      await router.navigate('/movie')
    })
    await screen.findByText('movie')

    await act(async () => {
      await router.navigate('/about')
    })
    await screen.findByText('about')

    await act(async () => {
      await router.navigate('/home')
    })

    await waitFor(() => {
      const nextHomeInput = getVisibleInput('home-input')
      expect(nextHomeInput.value).toBe('')
      expect(mountCounts.home).toBeGreaterThan(initialHomeMounts)
    })
  })

  it('dispatches lifecycle callbacks and cleanup in the expected order', async () => {
    const eventLog: string[] = []
    const { router } = renderHarness({
      config: {
        include: ['/home', '/movie'],
        max: 2,
      },
      eventLog,
    })

    await screen.findByText('home')

    await act(async () => {
      await router.navigate('/movie')
    })
    await screen.findByText('movie')

    await act(async () => {
      await router.navigate('/home')
    })

    await waitFor(() => {
      expect(eventLog).toEqual([
        'home:activated',
        'home:activated-cleanup',
        'home:deactivated',
        'movie:activated',
        'movie:activated-cleanup',
        'movie:deactivated',
        'home:deactivated-cleanup',
        'home:activated',
      ])
    })
  })

  it('reconciles existing cache immediately when max shrinks at runtime', async () => {
    const control: ConfigControl = {
      initialConfig: {
        include: ['/home', '/movie', '/about'],
        max: 3,
      },
    }
    const mountCounts: Record<string, number> = {}
    const { router } = renderHarness({
      config: control.initialConfig,
      control,
      mountCounts,
    })

    await screen.findByText('home')
    const initialHomeMounts = mountCounts.home ?? 0

    await act(async () => {
      await router.navigate('/movie')
    })
    await screen.findByText('movie')

    await act(async () => {
      await router.navigate('/about')
    })
    await screen.findByText('about')

    await act(async () => {
      control.setConfig?.((prev) => ({ ...prev, max: 1 }))
    })

    await act(async () => {
      await router.navigate('/home')
    })

    await waitFor(() => {
      expect(mountCounts.home).toBeGreaterThan(initialHomeMounts)
    })
  })

  it('isolates lifecycle registry between multiple CachedOutlet instances', async () => {
    const leftEvents: string[] = []
    const rightEvents: string[] = []

    const ScopedPage = ({
      label,
      onEvent,
    }: {
      label: string
      onEvent: (event: string) => void
    }) => {
      useActivated(() => {
        onEvent(`${label}:activated`)
      })

      return <h1>{label}</h1>
    }

    render(
      <>
        <MemoryRouter initialEntries={['/home']}>
          <Routes>
            <Route element={<CachedOutlet include={['/home']} />}>
              <Route
                path="/home"
                element={
                  <ScopedPage
                    label="left"
                    onEvent={(event) => leftEvents.push(event)}
                  />
                }
              />
            </Route>
          </Routes>
        </MemoryRouter>
        <MemoryRouter initialEntries={['/home']}>
          <Routes>
            <Route element={<CachedOutlet include={['/home']} />}>
              <Route
                path="/home"
                element={
                  <ScopedPage
                    label="right"
                    onEvent={(event) => rightEvents.push(event)}
                  />
                }
              />
            </Route>
          </Routes>
        </MemoryRouter>
      </>,
    )

    await waitFor(() => {
      expect(leftEvents).toEqual(['left:activated'])
      expect(rightEvents).toEqual(['right:activated'])
    })
  })

  it('supports cache keys derived from location.search', async () => {
    const { router } = renderHarness({
      config: {
        include: ['/home?tab=a', '/home?tab=b'],
        getCacheKey: (location) => `${location.pathname}${location.search}`,
        max: 2,
      },
      initialEntry: '/home?tab=a',
    })

    const firstTabInput = getVisibleInput('home-input')
    fireEvent.change(firstTabInput, { target: { value: 'tab-a-state' } })

    await act(async () => {
      await router.navigate('/home?tab=b')
    })

    const secondTabInput = getVisibleInput('home-input')
    fireEvent.change(secondTabInput, { target: { value: 'tab-b-state' } })

    await act(async () => {
      await router.navigate('/home?tab=a')
    })

    await waitFor(() => {
      const restoredInput = getVisibleInput('home-input')
      expect(restoredInput.value).toBe('tab-a-state')
    })
  })

  it('does not dispatch extra lifecycle events on same-path navigation', async () => {
    const eventLog: string[] = []
    const { router } = renderHarness({
      config: {
        include: ['/home'],
        max: 1,
      },
      eventLog,
    })

    await screen.findByText('home')

    await act(async () => {
      await router.navigate('/home')
    })

    await waitFor(() => {
      expect(eventLog).toEqual(['home:activated'])
    })
  })

  it('prunes cached routes immediately when exclude changes at runtime', async () => {
    const control: ConfigControl = {
      initialConfig: {
        include: ['/home', '/movie'],
        max: 2,
      },
    }
    const { router } = renderHarness({
      config: control.initialConfig,
      control,
    })

    const homeInput = getVisibleInput('home-input')
    fireEvent.change(homeInput, { target: { value: 'exclude-me' } })

    await act(async () => {
      await router.navigate('/movie')
    })
    await screen.findByText('movie')

    await act(async () => {
      control.setConfig?.((prev) => ({ ...prev, exclude: ['/home'] }))
    })

    await act(async () => {
      await router.navigate('/home')
    })

    await waitFor(() => {
      const nextHomeInput = getVisibleInput('home-input')
      expect(nextHomeInput.value).toBe('')
    })
  })

  it('continues running remaining lifecycle callbacks when one callback throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const events: string[] = []
    const scopeId = createLifecycleScopeId()

    registerActivatedCallback(scopeId, '/home', () => {
      throw new Error('boom')
    })
    registerActivatedCallback(scopeId, '/home', () => {
      events.push('second-activated')
    })

    dispatchActivated(scopeId, '/home')

    expect(events).toEqual(['second-activated'])
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})
