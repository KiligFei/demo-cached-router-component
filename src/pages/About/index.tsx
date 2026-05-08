import { Input } from 'antd-mobile'
import { useActivated, useDeactivated } from '../../components/keep-alive/lifecycle'

const About = () => {
  useActivated(() => {
    console.log('%c[About] activated', 'color: #722ed1')
    return () => console.log('%c[About] activated cleanup', 'color: #722ed1')
  })

  useDeactivated(() => {
    console.log('%c[About] deactivated', 'color: #eb2f96')
    return () => console.log('%c[About] deactivated cleanup', 'color: #eb2f96')
  })

  return (
    <div style={{ paddingTop: 200, height: 3000 }}>
      <h3>About</h3>
      <Input placeholder="Basic usage" />
    </div>
  )
}

export default About
