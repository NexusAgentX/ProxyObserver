# ProxyObserver

具备可观测性的透明反代实验台脚手架，用于研究 agent 请求通信细节。

这个版本是一个纯 Bun 的 full-stack 起步工程：

- 后端只使用 `Bun.serve()` 和 Bun 原生路由能力
- 前端使用 React，但不引入 Vite、Express、Hono 之类的中间层
- 页面通过 HTML import 交给 Bun bundler 处理
- 已预置 Bun 单可执行文件编译脚本

## 启动

安装依赖：

```bash
bun install
```

开发模式：

```bash
bun dev
```

生产模式直接运行：

```bash
bun start
```

静态构建前端资源到 `dist/`：

```bash
bun run build
```

编译前后端一体的 Bun 可执行文件到 `dist/proxyobserver`：

```bash
bun run compile
```

类型检查：

```bash
bun run typecheck
```

## 内置 API

- `GET /api/health`
- `GET /api/routes`
- `GET/POST/PUT/PATCH/DELETE /api/inspect`

`/api/inspect` 会回显请求方法、路径、查询参数、请求头和请求体，方便后续把代理层的观测信息接进去。

## 目录结构

```text
src/
├── index.ts        # Bun 服务端入口
├── frontend.tsx    # React 前端入口
├── App.tsx         # 首页与状态面板
├── APITester.tsx   # API 调试面板
├── siteData.ts     # 前后端共享的脚手架元数据
├── types.ts        # 共享类型
├── index.html      # HTML import 入口
└── index.css       # 页面样式
```

## 下一步建议

可以从这里继续往下接：

- 透明代理转发逻辑
- 请求/响应头和 body 采样
- trace id 注入与链路记录
- WebSocket 或 SSE 形式的实时观测面板
