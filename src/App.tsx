import { useEffect, useState } from "react";
import "./index.css";
import { appName, dashboardPollIntervalMs } from "./config";
import { defaultListenerDraft, featureHighlights, quickNotes } from "./siteData";
import type { BodySnapshot, CaptureRecord, CaptureSummary, ListenerSummary, OverviewResponse } from "./types";

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
    <main className="page-shell">
      <section className="hero-grid">
        <div className="panel hero-panel">
          <p className="eyebrow">Runtime Admin Console</p>
          <h1>{appName}</h1>
          <p className="lede">
            一个随用随开的透明代理工具。管理面板固定端口运行，其他端口在运行时动态开启，把请求转发到你指定的
            target host，同时把请求与响应完整记录到内存，供前端直接查看。
          </p>

          <div className="chip-row">
            <span className="chip">Pure Bun</span>
            <span className="chip">Dynamic ports</span>
            <span className="chip">In-memory capture</span>
            <span className="chip">Single executable</span>
          </div>
        </div>

        <aside className="panel status-panel">
          <div className="panel-header">
            <span>Admin Runtime</span>
            <span className={overview ? "status-badge status-ok" : "status-badge"}>{overview ? "ONLINE" : "LOADING"}</span>
          </div>

          {overview ? (
            <div className="status-stack">
              <div className="status-row">
                <span>Panel</span>
                <strong>
                  http://{overview.listenHost}:{overview.adminPort}
                </strong>
              </div>
              <div className="status-row">
                <span>Active listeners</span>
                <strong>{listeners.length}</strong>
              </div>
              <div className="status-row">
                <span>Capture slots</span>
                <strong>{overview.captureLimit}</strong>
              </div>
              <div className="status-row">
                <span>Buffered traffic</span>
                <strong>{captures.length}</strong>
              </div>
              <div className="capability-list">
                {quickNotes.map(item => (
                  <span key={item} className="capability-pill">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="panel-copy">{loadError ? `管理端暂时不可用：${loadError}` : "正在连接管理面板。"}</p>
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
            <span>Listener Rules</span>
            <code>runtime only</code>
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
              <div className="route-card">
                <p className="panel-copy">还没有开启任何代理端口。先创建一条规则，然后把 agent 工具指向对应本地端口。</p>
              </div>
            ) : (
              listeners.map(listener => (
                <div key={listener.port} className="route-card">
                  <div className="route-heading">
                    <span className="route-method">PORT {listener.port}</span>
                    <code className="route-path">{listener.target}</code>
                  </div>
                  <p className="panel-copy">
                    Local endpoint: http://{overview?.listenHost ?? "127.0.0.1"}:{listener.port}
                  </p>
                  <p className="panel-copy">
                    Requests seen: {listener.requestCount} | Updated: {formatDateTime(listener.updatedAt)}
                  </p>
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

        <article className="panel tester-panel">
          <div className="panel-header">
            <span>Recent Captures</span>
            <div className="panel-actions">
              <span className="response-meta">{captures.length} buffered</span>
              <button type="button" className="secondary-button" onClick={() => void clearAllCaptures()} disabled={isClearing}>
                {isClearing ? "Clearing..." : "Clear"}
              </button>
            </div>
          </div>

          <div className="capture-list">
            {captures.length === 0 ? (
              <div className="capture-row empty-row">
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
                    <strong>
                      {capture.method} :{capture.listenerPort}
                      {capture.pathname}
                    </strong>
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
        <article className="panel detail-panel">
          <div className="panel-header">
            <span>Capture Detail</span>
            <span className="response-meta">{selectedCapture ? selectedCapture.id : "none selected"}</span>
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
                  <h2>Request</h2>
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
                  <h3>Request Body</h3>
                  <pre className="body-view">{formatBody(selectedCapture.request.body)}</pre>
                </section>

                <section className="detail-section">
                  <h2>Response</h2>
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
                  <h3>Response Body</h3>
                  <pre className="body-view">{formatBody(selectedCapture.response?.body)}</pre>
                </section>
              </div>
            </>
          ) : (
            <p className="panel-copy">先从上面的 Recent Captures 里选择一条流量记录，这里会展开显示请求与响应的全部细节。</p>
          )}
        </article>
      </section>
    </main>
  );
}

export default App;
