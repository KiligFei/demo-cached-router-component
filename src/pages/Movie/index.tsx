import { Input } from 'antd-mobile'
import { useActivated, useDeactivated } from '../../components/keep-alive/lifecycle'

const Movie = () => {
  useActivated(() => {
    console.log('%c[Movie] activated', 'color: #52c41a')
    return () => console.log('%c[Movie] activated cleanup', 'color: #52c41a')
  })

  useDeactivated(() => {
    console.log('%c[Movie] deactivated', 'color: #faad14')
    return () => console.log('%c[Movie] deactivated cleanup', 'color: #faad14')
  })

  return (
    <div style={{ paddingTop: 200, height: 3000 }}>
      <h3>Movie</h3>
      <Input placeholder="Basic usage" />
    </div>
  )
}

export default Movie
