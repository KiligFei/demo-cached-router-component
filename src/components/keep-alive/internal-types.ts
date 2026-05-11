import type {
  MutableRefObject,
  ReactElement,
  ReactNode,
} from 'react'

export interface CachedRouteEntry {
  element: ReactElement
  version: number
}

export interface RouteSlotDescriptor {
  element: ReactNode
  isActive: boolean
  isCacheable: boolean
  routeKey: string
}

export type RouteStateRef = MutableRefObject<Map<string, boolean>>

export type ScrollPositionsRef = MutableRefObject<Map<string, number>>
