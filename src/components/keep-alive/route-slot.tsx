import { useMemo } from 'react'
import type { ReactNode } from 'react'
import {
  KeepAliveContext,
  registerActivatedCallback,
  registerDeactivatedCallback,
} from './lifecycle'

interface RouteSlotProps {
  scopeId: string
  routeKey: string
  isCacheable: boolean
  isActive: boolean
  children: ReactNode
}

export const RouteSlot = ({
  scopeId,
  routeKey,
  isCacheable,
  isActive,
  children,
}: RouteSlotProps) => {
  const contextValue = useMemo(
    () => ({
      scopeId,
      routeKey,
      isActive,
      isCacheable,
      registerActivated: (cb: () => void | (() => void)) =>
        registerActivatedCallback(scopeId, routeKey, cb),
      registerDeactivated: (cb: () => void | (() => void)) =>
        registerDeactivatedCallback(scopeId, routeKey, cb),
    }),
    [isActive, isCacheable, routeKey, scopeId],
  )

  return (
    <KeepAliveContext.Provider value={contextValue}>
      <div style={{ display: isActive ? 'block' : 'none', height: '100%' }}>
        {children}
      </div>
    </KeepAliveContext.Provider>
  )
}
