# ProxyObserver

具备可观测性的透明反代临时工具，用于研究各类 agent 工具调用 LLM 时的真实 HTTP 请求与响应。

## 设计目标

- 极轻量，随用随开，随关随失
- 透明转发：请求和响应尽量保持原样，不改业务语义
- 运行时动态配置：在前端面板里新增或关闭监听端口，并设置每个端口转发到哪个 host
- 抓包只保存在内存里，便于直接在面板查看所有细节
- 不需要数据库、本地配置文件和登录密码
- 最终可编译成单文件可执行程序

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

默认管理面板地址：

```text
http://127.0.0.1:3000
```

可通过环境变量覆盖：

```bash
ADMIN_PORT=3001 LISTEN_HOST=127.0.0.1 bun dev
```

## 当前能力

- 管理端固定端口运行
- 在面板里动态开启或关闭代理监听端口
- 每个监听端口绑定一个上游 `http(s)` target
- 转发时保留方法、路径、查询参数、请求头、请求体和上游响应
- 抓取请求与响应到内存，在管理面板中查看原始详情
- 支持流式响应透传，且关闭自动解压以保留压缩响应

## 管理端 API

- `GET /api/health`
- `GET /api/admin/overview`
- `POST /api/admin/listeners`
- `DELETE /api/admin/listeners/:port`
- `GET /api/admin/captures`
- `GET /api/admin/captures/:id`
- `DELETE /api/admin/captures`

## 目录结构

```text
src/
├── index.ts        # 管理端 Bun 服务入口
├── runtime.ts      # 动态监听端口与内存抓包状态
├── config.ts       # 运行时环境变量配置
├── frontend.tsx    # React 前端入口
├── App.tsx         # 管理面板
├── siteData.ts     # 文案与默认值
├── types.ts        # 前后端共享类型
├── index.html      # HTML import 入口
└── index.css       # 页面样式
```

## 已知边界

- 当前是 HTTP(S) 透明反代，不是通用的 CONNECT 隧道代理
- 抓包只保存在内存里，进程退出后历史会丢失
- 默认绑定 `127.0.0.1`，适合本机工具排查；如果要局域网访问可改 `LISTEN_HOST`
