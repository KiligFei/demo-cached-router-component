import { createBrowserRouter } from 'react-router'
import App from '../App'
import Home from '../pages/Home'
const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Home /> },
      { path: 'home', element: <Home /> },
      {
        path: 'movie',
        lazy: async () => {
          const { default: Movie } = await import('../pages/Movie')
          return {
            element: <Movie />,
          }
        },
      },
      {
        path: 'about',
        lazy: async () => {
          const { default: About } = await import('../pages/About')
          return {
            element: <About />,
          }
        },
      },
      {
        path: 'list',
        lazy: async () => {
          const { default: List } = await import('../pages/List')
          return {
            element: <List />,
          }
        },
      },
    ],
  },
])

export default router
