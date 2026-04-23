import { useNavigate } from 'react-router'
import { Badge, TabBar } from 'antd-mobile'
import {
  AppOutline,
  MessageOutline,
  MessageFill,
  UnorderedListOutline,
  UserOutline,
} from 'antd-mobile-icons'
import CachedOutlet from './components/keep-alive/cached-outlet'

const App = () => {
  const tabs = [
    {
      key: '/home',
      title: '首页',
      icon: <AppOutline />,
      badge: Badge.dot,
    },
    {
      key: '/movie',
      title: '电影',
      icon: <UnorderedListOutline />,
    },
    {
      key: '/about',
      title: '关于',
      icon: (active: boolean) =>
        active ? <MessageFill /> : <MessageOutline />,
    },
    {
      key: '/list',
      title: '列表',
      icon: <UserOutline />,
    },
  ]
  const nav = useNavigate()

  return (
    <div style={{ paddingBottom: 50 }}>
      <h1 style={{ position: 'sticky', top: 0, zIndex: 99, background: '#fff' }}>
        APP
      </h1>
      <hr />
      <CachedOutlet />
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          width: '100%',
          borderTop: '1px solid #ddd',
          background: '#fff',
        }}
      >
        <TabBar onChange={(value) => nav(value)}>
          {tabs.map((item) => (
            <TabBar.Item key={item.key} icon={item.icon} title={item.title} />
          ))}
        </TabBar>
      </div>
    </div>
  )
}

export default App
