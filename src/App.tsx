import { useEffect, useState } from "react";
import { APITester } from "./APITester";
import "./index.css";
import { appName, featureHighlights, routeCatalog } from "./siteData";
import type { HealthResponse } from "./types";

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHealth() {
      try {
        const response = await fetch("/api/health");

        if (!response.ok) {
          throw new Error(`Health check failed with status ${response.status}`);
        }

        const data = (await response.json()) as HealthResponse;

        if (!cancelled) {
          setHealth(data);
          setHealthError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setHealthError(error instanceof Error ? error.message : "Failed to load server status");
        }
      }
    }

    void loadHealth();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="page-shell">
      <section className="hero-grid">
        <div className="panel hero-panel">
          <p className="eyebrow">Pure Bun Full-Stack Scaffold</p>
          <h1>{appName}</h1>
          <p className="lede">
            具备可观测性的透明反代实验台起步骨架。后端由 <code>Bun.serve()</code> 直接提供 API，前端通过
            HTML import 交给 Bun bundler 处理，开发和部署链路都保持尽量轻量。
          </p>

          <div className="chip-row">
            <span className="chip">No Express</span>
            <span className="chip">No Hono</span>
            <span className="chip">React via HTML import</span>
            <span className="chip">Compile to executable</span>
          </div>
        </div>

        <aside className="panel status-panel">
          <div className="panel-header">
            <span>Runtime Snapshot</span>
            <span className={health ? "status-badge status-ok" : "status-badge"}>{health ? "ONLINE" : "LOADING"}</span>
          </div>

          {health ? (
            <div className="status-stack">
              <div className="status-row">
                <span>Service</span>
                <strong>{health.service}</strong>
              </div>
              <div className="status-row">
                <span>Environment</span>
                <strong>{health.environment}</strong>
              </div>
              <div className="status-row">
                <span>Uptime</span>
                <strong>{health.uptimeSeconds}s</strong>
              </div>
              <div className="status-row">
                <span>Timestamp</span>
                <strong>{new Date(health.timestamp).toLocaleString()}</strong>
              </div>
              <div className="capability-list">
                {health.capabilities.map(item => (
                  <span key={item} className="capability-pill">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="panel-copy">
              {healthError ? `状态接口暂时不可用：${healthError}` : "正在读取 Bun 服务端的健康状态。"}
            </p>
          )}
        </aside>
      </section>

      <section className="feature-grid">
        {featureHighlights.map(item => (
          <article key={item.title} className="panel feature-card">
            <p className="feature-title">{item.title}</p>
            <p className="panel-copy">{item.body}</p>
          </article>
        ))}
      </section>

      <section className="workspace-grid">
        <article className="panel route-panel">
          <div className="panel-header">
            <span>Built-in Routes</span>
            <code>src/index.ts</code>
          </div>

          <div className="route-list">
            {routeCatalog.map(route => (
              <div key={`${route.method}-${route.path}`} className="route-card">
                <div className="route-heading">
                  <span className="route-method">{route.method}</span>
                  <code className="route-path">{route.path}</code>
                </div>
                <p className="panel-copy">{route.description}</p>
              </div>
            ))}
          </div>
        </article>

        <APITester />
      </section>
    </main>
  );
}

export default App;
