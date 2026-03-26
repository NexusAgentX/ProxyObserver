import type { RouteDefinition } from "./types";

export const appName = "ProxyObserver";

export const featureHighlights = [
  {
    title: "Pure Bun backend",
    body: "后端只使用 Bun 原生的 Bun.serve()、路由对象和标准 Web API，没有额外引入 Express、Hono 或 Vite。",
  },
  {
    title: "One-process full stack",
    body: "React 前端通过 HTML import 接入，开发时用一个进程同时跑 API、静态页面和 HMR。",
  },
  {
    title: "Executable ready",
    body: "脚手架已经内置 compile 脚本，可直接尝试 Bun 的单文件可执行打包能力。",
  },
] as const;

export const routeCatalog: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/health",
    description: "返回运行状态、环境信息和当前实例启动时长。",
  },
  {
    method: "GET/POST/PUT/PATCH/DELETE",
    path: "/api/inspect",
    description: "回显请求方法、路径、查询参数、请求头和请求体，便于后续扩展代理观测能力。",
  },
  {
    method: "GET",
    path: "/api/routes",
    description: "输出当前脚手架内置的 API 目录。",
  },
] as const;

export const defaultInspectBody = JSON.stringify(
  {
    target: "https://example.com/api/agents",
    note: "Replace this payload with the proxy metadata you want to inspect.",
    captureHeaders: true,
    sample: {
      method: "POST",
      traceId: "demo-trace-001",
      tags: ["bun", "proxy", "observability"],
    },
  },
  null,
  2,
);
