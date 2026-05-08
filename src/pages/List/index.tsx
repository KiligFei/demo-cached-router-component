import { useState } from 'react'
import type { CSSProperties } from 'react'
import { List, Image, InfiniteScroll } from 'antd-mobile'
import {
  List as VirtualizedList,
  AutoSizer,
  WindowScroller,
} from 'react-virtualized'
import { mockRequest } from './components/mock-request'
import { useActivated, useDeactivated } from '../../components/keep-alive/lifecycle'

type Item = {
  avatar: string
  name: string
  description: string
}

const item = {
  avatar:
    'https://images.unsplash.com/photo-1548532928-b34e3be62fc6?ixlib=rb-1.2.1&q=80&fm=jpg&crop=faces&fit=crop&h=200&w=200&ixid=eyJhcHBfaWQiOjE3Nzg0fQ',
  name: 'Novalee Spicer',
  description: 'Deserunt dolor ea eaque eos',
}

const ListPage = () => {
  const [data, setData] = useState<Item[]>(Array(20).fill(item))
  const [hasMore, setHasMore] = useState(true)

  useActivated(() => {
    console.log('%c[List] activated', 'color: #13c2c2')
    return () => console.log('%c[List] activated cleanup', 'color: #13c2c2')
  })

  useDeactivated(() => {
    console.log('%c[List] deactivated', 'color: #f5222d')
    return () => console.log('%c[List] deactivated cleanup', 'color: #f5222d')
  })

  async function loadMore() {
    const append = await mockRequest()
    setData((val) => [...val, ...Array(append.length).fill(item)])
    setHasMore(append.length > 0)
  }

  function rowRenderer({
    index,
    key,
    style,
  }: {
    index: number
    key: string
    style: CSSProperties
  }) {
    const item = data[index]
    if (!item) return

    return (
      <List.Item
        key={key}
        style={style}
        prefix={
          <Image
            src={item.avatar}
            style={{ borderRadius: 20 }}
            fit="cover"
            width={40}
            height={40}
          />
        }
        description={item.description}
      >
        {item.name} {index}
      </List.Item>
    )
  }

  return (
    <div>
      <WindowScroller>
        {({ height, scrollTop, isScrolling }) => (
          <List>
            <AutoSizer disableHeight>
              {({ width }) => (
                <VirtualizedList
                  autoHeight
                  rowCount={data.length}
                  rowRenderer={rowRenderer}
                  width={width}
                  height={height}
                  rowHeight={70}
                  overscanRowCount={10}
                  isScrolling={isScrolling}
                  scrollTop={scrollTop}
                />
              )}
            </AutoSizer>
          </List>
        )}
      </WindowScroller>
      <InfiniteScroll loadMore={loadMore} hasMore={hasMore} />
    </div>
  )
}

export default ListPage
