# Configurable Keep-Alive Router Component

React 19 + React Router 7 + Vite 实现的可配置路由保活组件，核心为 `CachedOutlet`。

## 功能

- 路由组件缓存（cache hit 复用旧实例，不覆盖）
- LRU 缓存淘汰（`max` 控制上限，淘汰最久未使用的路由）
- `include` / `exclude` 缓存控制（`exclude` 优先级更高）
- 生命周期 Hook：`useActivated` / `useDeactivated`
- 滚动位置记录与恢复（仅缓存命中重激活时恢复）
- 运行时配置变更即时生效

## CachedOutlet API

```tsx
import CachedOutlet from './components/keep-alive/cached-outlet'

<CachedOutlet
  max={10}
  include={['/home', '/movie', '/about', '/list']}
  exclude={['/about']}
  normalizePath={(pathname) => pathname === '/' ? '/home' : pathname}
/>
```

| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `max` | `number` | `10` | 最大缓存数。`max <= 0` 禁用缓存 |
| `include` | `string[]` | `undefined` | 可缓存路由列表（精确匹配规范化路径）。省略时全部可缓存 |
| `exclude` | `string[]` | `undefined` | 排除的路由。优先级高于 `include` |
| `normalizePath` | `(pathname: string) => string` | 恒等函数 | 路径规范化函数，作用于缓存 key、include/exclude 匹配、滚动 key |

### 配置校验

- 无效 `max`（非数字/NaN）→ 归一为 `0`，开发环境 `console.warn`
- 无效 `include`/`exclude` 条目被过滤，开发环境 `console.warn`
- 运行时变更 `max`/`include`/`exclude` → 立即裁剪缓存并触发失活通知

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
| LRU 淘汰 | `useDeactivated` + cleanup，然后移除缓存 |

### 约束

- 多个回调按注册顺序执行，不去重
- 单个回调抛错不影响后续回调（catch + continue）
- `useActivated` cleanup 在失活时执行
- `useDeactivated` cleanup 在再次激活时执行

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

使用 `normalizePath(location.pathname)` 作为缓存 key。默认恒等映射，可通过 `normalizePath` prop 自定义（如 `/` → `/home`）。

### include / exclude 规则

```
include 未定义 → 所有路由可缓存
include 已定义 → 仅列表中的路由可缓存
exclude 已定义 → exclude 命中的路由不可缓存（优先级高于 include）
```

### LRU 淘汰

- 缓存条目数超过 `max` 时，淘汰最久未激活的路由
- **当前活跃路由永不被淘汰**
- 淘汰时：触发 `useDeactivated` → 清理滚动记录 → 移除生命周期注册 → 移除缓存

### 运行时配置变更

修改 `max`/`include`/`exclude` prop 后立即生效：
- 不再可缓存的路由被裁剪（触发失活通知）
- `max` 减小 → 按 LRU 顺序逐个淘汰

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
pnpm preview
```
