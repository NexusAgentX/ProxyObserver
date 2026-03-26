import { useEffect, useState } from "react";
import "./index.css";
import { appName, dashboardPollIntervalMs, defaultListenerDraft, featureHighlights, quickNotes } from "./siteData";
import type { BodySnapshot, CaptureRecord, ListenerSummary, OverviewResponse } from "./types";

function formatDateTime(value: string | undefined) {
  if (!value) {
    return "pending";
  }

  return new Date(value).toLocaleString();
}

function formatDuration(durationMs: number | undefined) {
  if (durationMs === undefined) {
    return "pending";
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(2)} s`;
}

function formatBody(body: BodySnapshot | undefined) {
  if (!body) {
    return "// No body captured.";
  }

  if (body.kind === "pending") {
    return "// Body capture still in progress.";
  }

  if (body.kind === "empty") {
    return "// Empty body.";
  }

  if (body.kind === "text") {
    return body.text ?? "";
  }

  if (body.kind === "base64") {
    return body.base64 ?? "";
  }

  return `// Capture error: ${body.error ?? "unknown"}`;
}

async function fetchJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with status ${response.status}`);
  }

  return payload;
}

export function App() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [selectedCapture, setSelectedCapture] = useState<CaptureRecord | null>(null);
  const [targetInput, setTargetInput] = useState(defaultListenerDraft.target);
  const [portInput, setPortInput] = useState(defaultListenerDraft.port);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function refreshDashboard() {
      try {
        const nextOverview = await fetchJson<OverviewResponse>("/api/admin/overview");

        if (!cancelled) {
          setOverview(nextOverview);
          setLoadError(null);
        }

        if (selectedCaptureId) {
          try {
            const detail = await fetchJson<{ capture: CaptureRecord }>(`/api/admin/captures/${selectedCaptureId}`);
            if (!cancelled) {
              setSelectedCapture(detail.capture);
            }
          } catch (error) {
            if (!cancelled) {
              setSelectedCapture(null);
              setSelectedCaptureId(null);
              setLoadError(error instanceof Error ? error.message : "Failed to load capture detail");
            }
          }
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Failed to load dashboard");
        }
      }
    }

    void refreshDashboard();
    const intervalId = window.setInterval(() => {
      void refreshDashboard();
    }, dashboardPollIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [selectedCaptureId]);

  const listeners = overview?.listeners ?? [];
  const captures = overview?.captures ?? [];
  const runtimeAddress = `http://${overview?.listenHost ?? "127.0.0.1"}:${overview?.adminPort ?? 3000}`;
  const liveState = overview ? "ONLINE" : "SYNCING";

  const saveListener = async () => {
    setIsSaving(true);

    try {
      const port = Number(portInput);
      await fetchJson<{ listener: ListenerSummary }>("/api/admin/listeners", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          port,
          target: targetInput,
        }),
      });

      const nextOverview = await fetchJson<OverviewResponse>("/api/admin/overview");
      setOverview(nextOverview);
      setActionMessage(`Port ${port} now forwards to ${targetInput}`);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to save listener");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteListener = async (port: number) => {
    try {
      await fetchJson<{ ok: true }>(`/api/admin/listeners/${port}`, {
        method: "DELETE",
      });

      const nextOverview = await fetchJson<OverviewResponse>("/api/admin/overview");
      setOverview(nextOverview);
      setActionMessage(`Port ${port} has been closed`);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to remove listener");
    }
  };

  const clearAllCaptures = async () => {
    setIsClearing(true);

    try {
      await fetchJson<{ ok: true }>("/api/admin/captures", {
        method: "DELETE",
      });

      const nextOverview = await fetchJson<OverviewResponse>("/api/admin/overview");
      setOverview(nextOverview);
      setSelectedCapture(null);
      setSelectedCaptureId(null);
      setActionMessage("All in-memory captures were cleared");
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to clear captures");
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <main className="app-shell">
      <section className="masthead">
        <div className="masthead-copy">
          <p className="eyebrow">Runtime Admin Console</p>
          <h1>{appName}</h1>
          <p className="lede">
            一个随用随开的透明代理工作台。管理面板固定端口运行，代理规则在运行时动态增删，所有请求与响应只记录在内存里，
            方便直接观察 agent 到上游模型的真实 HTTP 行为。
          </p>
        </div>

        <aside className="masthead-aside">
          <span className={`status-badge ${overview ? "status-ok" : ""}`}>{liveState}</span>
          <div className="runtime-address">
            <span>Panel</span>
            <strong>{runtimeAddress}</strong>
          </div>
          <p className="aside-copy">
            {overview
              ? `当前已开启 ${listeners.length} 个监听端口，缓冲 ${captures.length} 条抓包记录。`
              : loadError ?? "正在同步管理端状态。"}
          </p>
          <div className="note-stack">
            {quickNotes.map(item => (
              <p key={item} className="note-line">
                {item}
              </p>
            ))}
          </div>
        </aside>
      </section>

      <section className="summary-strip">
        <article className="summary-block">
          <span className="summary-label">Active listeners</span>
          <strong>{listeners.length}</strong>
          <p>运行中的代理端口数量</p>
        </article>
        <article className="summary-block">
          <span className="summary-label">Buffered captures</span>
          <strong>{captures.length}</strong>
          <p>当前保存在内存里的抓包条目</p>
        </article>
        <article className="summary-block">
          <span className="summary-label">Capture limit</span>
          <strong>{overview?.captureLimit ?? "--"}</strong>
          <p>达到上限后会自动丢弃最旧记录</p>
        </article>
        <article className="summary-block">
          <span className="summary-label">Admin host</span>
          <strong>{overview?.listenHost ?? "127.0.0.1"}</strong>
          <p>默认仅本机可访问</p>
        </article>
      </section>

      <section className="notes-grid">
        {featureHighlights.map(item => (
          <article key={item.title} className="note-panel">
            <p className="feature-title">{item.title}</p>
            <p className="panel-copy">{item.body}</p>
          </article>
        ))}
      </section>

      <section className="workspace-grid">
        <article className="surface">
          <div className="section-head">
            <div>
              <p className="section-kicker">Routing</p>
              <h2>Listener Rules</h2>
              <p className="section-copy">新增一个本地端口，并把整条请求链路透明转发到指定 target host。</p>
            </div>
            <span className="micro-label">runtime only</span>
          </div>

          <div className="listener-form">
            <label className="field">
              <span>Proxy Port</span>
              <input
                type="number"
                min="1"
                max="65535"
                value={portInput}
                onChange={event => setPortInput(event.target.value)}
                className="url-input"
              />
            </label>

            <label className="field field-grow">
              <span>Target Host</span>
              <input
                type="text"
                value={targetInput}
                onChange={event => setTargetInput(event.target.value)}
                className="url-input"
                placeholder="https://api.openai.com"
              />
            </label>

            <div className="button-row">
              <button type="button" className="primary-button" onClick={() => void saveListener()} disabled={isSaving}>
                {isSaving ? "Saving..." : "Open Or Update Port"}
              </button>
            </div>
          </div>

          {actionMessage ? <p className="success-copy">{actionMessage}</p> : null}
          {loadError ? <p className="error-copy">{loadError}</p> : null}

          <div className="route-list">
            {listeners.length === 0 ? (
              <div className="empty-state">
                <p className="panel-copy">还没有开启任何代理端口。先创建一条规则，然后把 agent 工具指向对应本地端口。</p>
              </div>
            ) : (
              listeners.map(listener => (
                <div key={listener.port} className="route-card">
                  <div className="route-heading">
                    <div className="route-title-group">
                      <span className="route-method">Port {listener.port}</span>
                      <strong className="route-target">{listener.target}</strong>
                    </div>
                    <span className="route-endpoint">
                      http://{overview?.listenHost ?? "127.0.0.1"}:{listener.port}
                    </span>
                  </div>
                  <div className="route-meta">
                    <span>Requests: {listener.requestCount}</span>
                    <span>Updated: {formatDateTime(listener.updatedAt)}</span>
                  </div>
                  <div className="button-row compact-row">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setPortInput(String(listener.port));
                        setTargetInput(listener.target);
                      }}
                    >
                      Edit
                    </button>
                    <button type="button" className="danger-button" onClick={() => void deleteListener(listener.port)}>
                      Close Port
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="surface surface-captures">
          <div className="section-head">
            <div>
              <p className="section-kicker">Traffic</p>
              <h2>Recent Captures</h2>
              <p className="section-copy">点击任意一条流量查看完整请求头、请求体和上游响应。</p>
            </div>
            <div className="panel-actions">
              <span className="response-meta">{captures.length} buffered</span>
              <button type="button" className="secondary-button" onClick={() => void clearAllCaptures()} disabled={isClearing}>
                {isClearing ? "Clearing..." : "Clear"}
              </button>
            </div>
          </div>

          <div className="capture-list">
            {captures.length === 0 ? (
              <div className="empty-state">
                <span>等代理流量进来后，这里会实时列出请求和响应。</span>
              </div>
            ) : (
              captures.map(capture => (
                <button
                  key={capture.id}
                  type="button"
                  className={`capture-row ${capture.id === selectedCaptureId ? "capture-row-active" : ""}`}
                  onClick={() => {
                    setSelectedCaptureId(capture.id);
                  }}
                >
                  <span className="capture-main">
                    <span className="capture-label">
                      {capture.method} :{capture.listenerPort}
                    </span>
                    <strong>{capture.pathname}</strong>
                    <span>{capture.target}</span>
                  </span>
                  <span className="capture-meta">
                    <span className={`state-pill state-${capture.state}`}>{capture.state}</span>
                    <span>{capture.status ?? "..."}</span>
                    <span>{formatDuration(capture.durationMs)}</span>
                    <span>{formatDateTime(capture.startedAt)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="detail-grid">
        <article className="surface detail-surface">
          <div className="section-head">
            <div>
              <p className="section-kicker">Inspector</p>
              <h2>Capture Detail</h2>
              <p className="section-copy">右侧列表选中的抓包会在这里展开，适合逐项核对 headers、body 和响应行为。</p>
            </div>
            <span className="micro-label">{selectedCapture ? selectedCapture.id : "none selected"}</span>
          </div>

          {selectedCapture ? (
            <>
              <div className="detail-meta-grid">
                <div className="detail-meta-card">
                  <span>Listener</span>
                  <strong>:{selectedCapture.listenerPort}</strong>
                </div>
                <div className="detail-meta-card">
                  <span>Target</span>
                  <strong>{selectedCapture.target}</strong>
                </div>
                <div className="detail-meta-card">
                  <span>Upstream</span>
                  <strong>{selectedCapture.upstreamUrl}</strong>
                </div>
                <div className="detail-meta-card">
                  <span>State</span>
                  <strong>{selectedCapture.state}</strong>
                </div>
              </div>

              <div className="detail-columns">
                <section className="detail-section">
                  <div className="detail-section-head">
                    <h3>Request</h3>
                    <span className="micro-label">{selectedCapture.request.method}</span>
                  </div>
                  <pre className="json-view">
                    {JSON.stringify(
                      {
                        method: selectedCapture.request.method,
                        url: selectedCapture.request.url,
                        clientIp: selectedCapture.request.clientIp,
                        headers: selectedCapture.request.headers,
                        body: selectedCapture.request.body,
                      },
                      null,
                      2,
                    )}
                  </pre>
                  <div className="detail-section-head secondary-head">
                    <h4>Request Body</h4>
                    <span className="micro-label">{selectedCapture.request.body.contentType ?? "no content-type"}</span>
                  </div>
                  <pre className="body-view">{formatBody(selectedCapture.request.body)}</pre>
                </section>

                <section className="detail-section">
                  <div className="detail-section-head">
                    <h3>Response</h3>
                    <span className="micro-label">
                      {selectedCapture.response
                        ? `${selectedCapture.response.status} ${selectedCapture.response.statusText}`
                        : selectedCapture.state}
                    </span>
                  </div>
                  <pre className="json-view">
                    {JSON.stringify(
                      selectedCapture.response ?? {
                        state: selectedCapture.state,
                        error: selectedCapture.error ?? "Response not available yet",
                      },
                      null,
                      2,
                    )}
                  </pre>
                  <div className="detail-section-head secondary-head">
                    <h4>Response Body</h4>
                    <span className="micro-label">
                      {selectedCapture.response?.body.contentType ?? "response pending"}
                    </span>
                  </div>
                  <pre className="body-view">{formatBody(selectedCapture.response?.body)}</pre>
                </section>
              </div>
            </>
          ) : (
            <div className="empty-state detail-empty">
              <p className="panel-copy">先从上面的 Recent Captures 里选择一条流量记录，这里会展开显示请求与响应的全部细节。</p>
            </div>
          )}
        </article>
      </section>
    </main>
  );
}

export default App;
