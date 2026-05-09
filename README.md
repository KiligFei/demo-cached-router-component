# Configurable Keep-Alive Router Component

React 19 + React Router 7 + Vite 实现的可配置路由保活组件，核心为 `CachedOutlet`。

## 功能

- 路由组件缓存（cache hit 复用旧实例，不覆盖）
- LRU 缓存淘汰（`max` 控制上限，淘汰最久未使用的路由）
- `include` / `exclude` 缓存控制（`exclude` 优先级更高）
- 生命周期 Hook：`useActivated` / `useDeactivated`
- 自动暂停副作用 Hook：`useKeepAliveEffect`
- 滚动位置记录与恢复（仅缓存命中重激活时恢复）
- 运行时配置变更即时生效

## CachedOutlet API

```tsx
import CachedOutlet from './components/keep-alive/cached-outlet'

<CachedOutlet
  max={10}
  include={['/home', '/movie', '/about', '/list']}
  exclude={['/about']}
  invalidateKeys={['/movie']}
  getCacheKey={(location) => location.pathname === '/' ? '/home' : location.pathname}
/>
```

| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `max` | `number` | `10` | 最大缓存数。`max <= 0` 禁用缓存 |
| `include` | `string[]` | `undefined` | 可缓存路由列表（精确匹配规范化路径）。省略时全部可缓存 |
| `exclude` | `string[]` | `undefined` | 排除的路由。优先级高于 `include` |
| `invalidateKeys` | `string[]` | `undefined` | 立即失效的缓存 key 列表。命中当前激活 key 时会原位刷新当前页 |
| `getCacheKey` | `(location: Location) => string` | `location => location.pathname` | 缓存 key 计算函数，作用于缓存 key、include/exclude 匹配、滚动 key、生命周期分发 |

### 配置校验

- 无效 `max`（非数字/NaN）→ 归一为 `0`，开发环境 `console.warn`
- 无效 `include`/`exclude` 条目被过滤，开发环境 `console.warn`
- 运行时变更 `max`/`include`/`exclude` → 立即裁剪缓存并触发失活通知
- 运行时传入 `invalidateKeys` → 立即删除对应缓存；若包含当前激活 key，则当前页原位刷新

## 生命周期 Hook

```tsx
import { useActivated, useDeactivated } from './components/keep-alive/lifecycle'

const MyPage = () => {
  useActivated(() => {
    console.log('页面激活')
    // 可选：返回 cleanup 函数，在失活时执行
    return () => console.log('activated cleanup')
  })

  useDeactivated(() => {
    console.log('页面失活')
    // 可选：返回 cleanup 函数，在再次激活时执行
    return () => console.log('deactivated cleanup')
  })

  return <div>My Page</div>
}
```

### 执行时机

| 场景 | 触发 |
|------|------|
| 首次进入可缓存路由 | `useActivated` |
| 切离当前路由 | `useDeactivated` + 上一次 `useActivated` 的 cleanup |
| 切回已缓存路由 | `useActivated` + 上一次 `useDeactivated` 的 cleanup |
| 同路径导航 | 无触发 |
| 非缓存路由 | 无触发 |
| 已失活缓存条目被 LRU 淘汰 | 不重复触发 `useDeactivated`；只执行 pending cleanup 并移除缓存 |

### 约束

- 多个回调按注册顺序执行，不去重
- 单个回调抛错不影响后续回调（catch + continue）
- `useActivated` cleanup 在失活时执行
- `useDeactivated` cleanup 在再次激活时执行

### 当前激活态

```tsx
import {
  useKeepAliveEffect,
} from './components/keep-alive/lifecycle'

const MyPage = () => {
  useKeepAliveEffect(() => {
    const timer = window.setInterval(() => {
      console.log('only runs when visible')
    }, 1000)

    return () => window.clearInterval(timer)
  }, [])

  return <div>My Page</div>
}
```

- `useKeepAliveEffect(effect, deps)` 是 keep-alive 页面副作用的推荐默认写法
- 页面隐藏时会自动执行 cleanup，重新激活时会自动重新运行 effect
- 适合轮询、订阅、播放器、全局监听、定时器等需要“可见时运行、隐藏时暂停”的副作用
- `useActivated()` / `useDeactivated()` 仍然保留，适合表达“进入页面时做一次事 / 离开页面时做一次事”的路由事件语义
- `useActivated()` 适合一次性的激活动作，比如激活时打点、聚焦输入框、触发一次刷新、恢复某个非 effect 状态
- `useDeactivated()` 适合一次性的失活动作，比如离开前保存草稿、上报离开事件、通知外部模块暂停
- `useDeactivated()` 表达的是一次 `active -> inactive` 转换；如果页面已经隐藏，后续只是被 LRU 淘汰，不会再次触发这个 Hook
- 如果你需要读取当前可见状态，仍可使用 `useKeepAliveActive()`
- `useKeepAliveActive()` 返回当前缓存页是否处于可见激活态
- 对于直接写在原生 `useEffect` 里的副作用，隐藏页默认仍然只是 `display: none`，不会被框架强制暂停

### 何时使用哪个 Hook

- `useKeepAliveEffect()`：管理“副作用在可见期内存活”的场景。适合轮询、订阅、播放器、全局监听、定时器这类需要“显示时启动、隐藏时暂停、回来时恢复”的逻辑。
- `useActivated()`：管理“页面重新进入前台这一刻”的事件。适合激活时打点、聚焦输入框、触发一次刷新、恢复某个非 effect 状态。
- `useDeactivated()`：管理“页面离开前台这一刻”的事件。适合离开前保存草稿、上报离开事件、通知外部模块暂停、冻结某段 UI 状态。

### 场景示例

- 如果你要“页面可见时启动轮询，隐藏时停止，回来时恢复”，优先用 `useKeepAliveEffect()`。
- 如果你要“每次回到这个页面时自动 focus 搜索框”，用 `useActivated()`。
- 如果你要“每次离开编辑页时自动保存草稿”，用 `useDeactivated()`。

## 滚动恢复

- 仅跟踪 `window` 滚动（v1）
- 使用 `requestAnimationFrame` 节流记录
- 仅在缓存命中重激活时恢复滚动位置
- 首次进入从顶部（`0`）开始
- 执行顺序：先恢复滚动 → 再触发 `useActivated`
- 非缓存路由不参与滚动记录和恢复
- 条目被淘汰或规则裁剪时，同时清理滚动记录

## 缓存行为

### Cache key

使用 `getCacheKey(location)` 作为缓存 key。默认行为是 `location.pathname`，可通过 `getCacheKey` 将 `/` 归一为 `/home`，或将 query/hash 纳入缓存 key 计算。

### include / exclude 规则

```
include 未定义 → 所有路由可缓存
include 已定义 → 仅列表中的路由可缓存
exclude 已定义 → exclude 命中的路由不可缓存（优先级高于 include）
```

### LRU 淘汰

- 缓存条目数超过 `max` 时，淘汰最久未激活的路由
- **当前活跃路由永不被淘汰**
- 已失活条目被淘汰时：只释放 pending cleanup → 清理滚动记录 → 移除生命周期注册 → 移除缓存
- 不会因为“缓存被淘汰”而对同一个页面重复分发 `useDeactivated`

### 运行时配置变更

修改 `max`/`include`/`exclude` prop 后立即生效：
- 不再可缓存的路由被裁剪（触发失活通知）
- `max` 减小 → 按 LRU 顺序逐个淘汰

### 主动失效缓存

- 通过 `invalidateKeys` 传入需要立即删除的缓存 key
- 非当前页：直接从缓存中移除，下次进入重新创建
- 当前页：先失效，再用最新 `outlet` 原位刷新当前页实例

## 项目结构

```
src/
├── main.tsx                                   # 入口
├── App.tsx                                    # 布局 + TabBar + CachedOutlet 配置
├── router/index.tsx                           # 路由配置（createBrowserRouter）
├── components/keep-alive/
│   ├── cached-outlet.tsx                      # 核心组件：缓存、生命周期分发、滚动管理
│   ├── cache-policy.ts                        # 配置校验、缓存能力判定、LRU 淘汰
│   ├── lifecycle.ts                           # useActivated/useDeactivated、注册与分发
│   └── types.ts                               # 类型定义
└── pages/
    ├── Home/index.tsx                         # 演示页面（带生命周期日志）
    ├── Movie/index.tsx                        # 演示页面（懒加载）
    ├── About/index.tsx                        # 演示页面（懒加载）
    └── List/index.tsx                         # 虚拟化无限滚动列表
```

## 本地运行

```bash
pnpm install
pnpm dev
```

```bash
pnpm build
pnpm test
pnpm preview
```
