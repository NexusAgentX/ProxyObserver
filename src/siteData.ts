export const appName = "ProxyObserver";
export const dashboardPollIntervalMs = 1500;

export const featureHighlights = [
  {
    title: "Transparent forwarding",
    body: "代理监听端口只做转发与记录。方法、路径、查询参数、请求体和响应体都尽量保持原样，流式响应也不会先被读完再返回客户端。",
  },
  {
    title: "Runtime-only rules",
    body: "端口与目标 host 的映射完全存活在内存里。关掉进程就归零，没有本地配置文件、数据库和登录流程。",
  },
  {
    title: "Single executable path",
    body: "管理面板与所有动态代理监听器都运行在一个 Bun 进程里，最终可以直接编译成一个单文件可执行程序。",
  },
] as const;

export const quickNotes = [
  "管理面板固定跑在默认端口，代理监听端口在运行时动态创建或关闭。",
  "抓包数据仅保存在内存，默认保留最近一批请求，适合临时排查和研究。",
  "当前实现基于 HTTP(S) 反向透明代理模型，不依赖本地证书、中间件或数据库。",
] as const;

export const defaultListenerDraft = {
  port: "4100",
  target: "https://example.com",
  script: "",
};

export const listenerScriptPlaceholder = `async function beforeRequest(context) {
  const url = new URL(context.url);
  url.searchParams.set("debug", "1");
  context.url = url.toString();
  context.headers["x-proxy-observer"] = "before-request";
  return context;
}

async function afterResponse(context) {
  context.headers["x-proxy-observer-response"] = "after-response";
  return context;
}`;
