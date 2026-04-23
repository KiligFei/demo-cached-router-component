# Configurable Keep-Alive Router Component

`demo-cached-router-component` 是一个基于 `React 19 + React Router 7 + Vite` 的可配置路由保活组件实验项目，核心组件为 `CachedOutlet`。

目标是把“示例缓存逻辑”升级为“可配置、可复用”的 keep-alive 组件能力。

## v1 目标能力

- 路由组件缓存（cache hit 复用旧实例，不覆盖）
- LRU 缓存策略（支持 `max`，超限淘汰最久未使用）
- `include` / `exclude` 缓存控制（`exclude` 优先）
- 生命周期 Hook（仅 `useActivated` / `useDeactivated`）
- 滚动位置记录与恢复（仅 `window`，仅缓存命中重激活时恢复）

## 组件 API（v1 设计）

`CachedOutlet` 通过 props 配置（v1 无 Provider）：

```ts
type CachedOutletProps = {
  max?: number // default: 10
  include?: string[] // exact match on normalized pathname
  exclude?: string[] // higher priority than include
  normalizePath?: (pathname: string) => string // default: identity
}
```

行为约定（核心）：

- `max <= 0` 视为不缓存
- 非法 `max` 归一到 `0`（开发环境 `console.warn`）
- 非法 `include/exclude` 项会被过滤（开发环境 `console.warn`）
- 配置运行时变更立即生效，并裁剪现有缓存

## 生命周期 Hook（v1 设计）

```ts
useActivated(callback: () => void | (() => void))
useDeactivated(callback: () => void | (() => void))
```

语义约定（核心）：

- 首次进入可缓存路由，触发一次 `useActivated`
- 同路径重复导航不触发生命周期切换
- 非缓存路由不触发 keep-alive 生命周期
- 多个回调按注册顺序执行，不去重
- `useActivated` cleanup 在失活时执行
- `useDeactivated` cleanup 在再次激活时执行
- 单回调抛错不影响后续回调（捕获并继续）

## 滚动恢复规则（v1）

- 仅跟踪 `window` 滚动
- 使用固定 `requestAnimationFrame` 节流记录
- 仅在“缓存命中并重新激活”时恢复滚动
- 首次进入从 `0` 开始
- 激活顺序：先恢复滚动，再触发 `useActivated`
- 条目被 LRU 淘汰或规则裁剪时，同时清理滚动记录

## 当前仓库状态

- 已有基础版 `CachedOutlet` 与滚动记录恢复 demo
- 正在按 v1 需求升级为完整可配置组件能力


## 关键目录

```text
src/
├── App.tsx                                  # Demo 壳层与 Tab 导航
├── router/index.tsx                         # 路由配置
├── components/keep-alive/cached-outlet.tsx # Keep-alive 核心
└── pages/                                   # 演示页面
```

## 本地运行

```bash
pnpm install
pnpm dev
```

```bash
pnpm build
pnpm preview
pnpm lint
```
