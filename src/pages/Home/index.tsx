import { Input } from 'antd-mobile'
import {
  useActivated,
  useDeactivated,
} from '../../components/keep-alive/lifecycle'

const Home = () => {
  useActivated(() => {
    console.log('Home activated')
    return () => console.log('Home activated cleanup')
  })

  useDeactivated(() => {
    console.log('Home deactivated')
    return () => console.log('Home deactivated cleanup')
  })
  return (
    <div style={{ paddingTop: 200, height: 3000 }}>
      <h3>Home</h3>
      <Input placeholder="Basic usage" />
    </div>
  )
}

export default Home
