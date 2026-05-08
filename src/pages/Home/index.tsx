import { Input } from 'antd-mobile'
import { useActivated, useDeactivated } from '../../components/keep-alive/lifecycle'

const Home = () => {
  useActivated(() => {
    console.log('%c[Home] activated', 'color: #1890ff')
    return () => console.log('%c[Home] activated cleanup', 'color: #1890ff')
  })

  useDeactivated(() => {
    console.log('%c[Home] deactivated', 'color: #fa8c16')
    return () => console.log('%c[Home] deactivated cleanup', 'color: #fa8c16')
  })

  return (
    <div style={{ paddingTop: 200, height: 3000 }}>
      <h3>Home</h3>
      <Input
        id="home-basic-usage"
        name="home-basic-usage"
        placeholder="Basic usage"
      />
    </div>
  )
}

export default Home
