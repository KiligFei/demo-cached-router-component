import { Fragment } from 'react'
import type { CachedRouteEntry } from './internal-types'

export const renderCachedElement = (
  key: string,
  entry: CachedRouteEntry | null,
) => {
  if (!entry) return null

  return (
    <Fragment key={`${key}:${entry.version}`}>
      {entry.element}
    </Fragment>
  )
}
