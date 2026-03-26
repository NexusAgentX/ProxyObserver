import { useEffect, useState } from "react";
import "./index.css";
import { appName, dashboardPollIntervalMs, defaultListenerDraft } from "./siteData";
import type { BodySnapshot, CaptureRecord, CaptureState, ListenerSummary, OverviewResponse } from "./types";

function formatDateTime(value: string | undefined) {
  if (!value) return "pending";
  return new Date(value).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
}

function formatDuration(durationMs: number | undefined) {
  if (durationMs === undefined) return "pending";
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function formatBody(body: BodySnapshot | undefined) {
  if (!body) return "// No body captured.";
  if (body.kind === "pending") return "// Body capture in progress...";
  if (body.kind === "empty") return "// Empty body.";
  if (body.kind === "text") return body.text ?? "";
  if (body.kind === "base64") return body.base64 ?? "";
  return `// Capture error: ${body.error ?? "unknown"}`;
}

function getStatusClass(status: number | undefined, state: CaptureState) {
  if (state === "failed") return "status-error";
  if (state === "pending" || !status) return "status-pending";
  if (status >= 200 && status < 300) return "status-2xx";
  if (status >= 300 && status < 400) return "status-3xx";
  if (status >= 400 && status < 500) return "status-4xx";
  if (status >= 500) return "status-5xx";
  return "";
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
  
  const [actionMessage, setActionMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function refreshDashboard() {
      try {
        const nextOverview = await fetchJson<OverviewResponse>("/api/admin/overview");
        if (!cancelled) setOverview(nextOverview);

        if (selectedCaptureId) {
          try {
            const detail = await fetchJson<{ capture: CaptureRecord }>(`/api/admin/captures/${selectedCaptureId}`);
            if (!cancelled) setSelectedCapture(detail.capture);
          } catch (error) {
            if (!cancelled) {
              setSelectedCapture(null);
              setSelectedCaptureId(null);
            }
          }
        }
      } catch (error) {
        // Silently fail on status poll
      }
    }
    
    void refreshDashboard();
    const intervalId = window.setInterval(refreshDashboard, dashboardPollIntervalMs);
    return () => { cancelled = true; window.clearInterval(intervalId); };
  }, [selectedCaptureId]);

  const listeners = overview?.listeners ?? [];
  const captures = overview?.captures ?? [];
  const liveState = overview ? "ONLINE" : "SYNCING";

  const saveListener = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setActionMessage(null);
    try {
      const port = Number(portInput);
      await fetchJson<{ listener: ListenerSummary }>("/api/admin/listeners", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ port, target: targetInput }),
      });
      const nextOverview = await fetchJson<OverviewResponse>("/api/admin/overview");
      setOverview(nextOverview);
      setActionMessage({ text: `Port ${port} mapped to ${targetInput}`, type: 'success' });
    } catch (error) {
      setActionMessage({ text: error instanceof Error ? error.message : "Failed to save", type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const deleteListener = async (port: number) => {
    try {
      await fetchJson<{ ok: true }>(`/api/admin/listeners/${port}`, { method: "DELETE" });
      const nextOverview = await fetchJson<OverviewResponse>("/api/admin/overview");
      setOverview(nextOverview);
      setActionMessage({ text: `Closed port ${port}`, type: 'success' });
    } catch (error) {
      setActionMessage({ text: error instanceof Error ? error.message : "Failed to remove", type: 'error' });
    }
  };

  const clearAllCaptures = async () => {
    setIsClearing(true);
    setActionMessage(null);
    try {
      await fetchJson<{ ok: true }>("/api/admin/captures", { method: "DELETE" });
      const nextOverview = await fetchJson<OverviewResponse>("/api/admin/overview");
      setOverview(nextOverview);
      setSelectedCapture(null);
      setSelectedCaptureId(null);
      setActionMessage({ text: "Cleared all captures", type: "success" });
    } catch (error) {
      setActionMessage({ text: error instanceof Error ? error.message : "Failed to clear logs", type: "error" });
    } finally {
      setIsClearing(false);
    }
  };

  const editListener = (port: number, target: string) => {
    setPortInput(String(port));
    setTargetInput(target);
  };

  return (
    <div className="layout">
      {/* LEFT SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand">
            <h1>{appName}</h1>
            <div className="status">
              <span className={`status-dot ${overview ? 'online' : 'syncing'}`}></span>
              {liveState}
            </div>
          </div>
        </div>

        <div className="sidebar-content">
          <div className="metrics-grid">
             <div className="metric-card">
                <span className="metric-value">{listeners.length}</span>
                <span className="metric-label">Active Ports</span>
             </div>
             <div className="metric-card">
                <span className="metric-value">{captures.length}</span>
                <span className="metric-label">Captures</span>
             </div>
          </div>

          <div className="panel">
            <h2 className="section-title">New Proxy Rule</h2>
            <form className="listener-form" onSubmit={saveListener}>
              <div className="input-group">
                <input 
                  type="number" 
                  min="1" 
                  max="65535" 
                  value={portInput} 
                  onChange={e => setPortInput(e.target.value)} 
                  className="input-port"
                  required
                  placeholder="Port"
                />
                <input 
                  type="text" 
                  value={targetInput} 
                  onChange={e => setTargetInput(e.target.value)} 
                  className="input-target"
                  placeholder="Target (e.g. api.openai.com)"
                  required
                />
              </div>
              <button type="submit" className="primary" disabled={isSaving}>
                {isSaving ? "Saving..." : "Apply Rule"}
              </button>
              {actionMessage && (
                <div className={actionMessage.type === 'error' ? 'text-error' : 'text-success'}>
                  {actionMessage.text}
                </div>
              )}
            </form>
          </div>

          <div className="panel">
            <h2 className="section-title">Active Rules</h2>
            <div className="listener-list">
              {listeners.length === 0 ? (
                <div className="empty-state" style={{fontSize: 12}}>No rules configured.</div>
              ) : (
                listeners.map(l => (
                  <div key={l.port} className="listener-item">
                    <div className="listener-route">
                      <span className="listener-port">:{l.port}</span>
                      <span>&rarr;</span>
                      <span>{l.target}</span>
                    </div>
                    <div className="listener-actions">
                      <button type="button" onClick={() => editListener(l.port, l.target)}>Edit</button>
                      <button type="button" className="btn-danger" onClick={() => deleteListener(l.port)}>Close</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="main-content">
        
        {/* TOP: CAPTURES LIST */}
        <div className="captures-pane">
          <div className="pane-header">
            <h2 className="pane-title">Traffic Log</h2>
            <button onClick={clearAllCaptures} disabled={isClearing || captures.length === 0}>
              {isClearing ? "Clearing..." : "Clear Logs"}
            </button>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Method</th>
                  <th>Path</th>
                  <th>Proxy Port</th>
                  <th>Target</th>
                  <th>Status</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {captures.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{textAlign: 'center', padding: '32px', color: 'var(--text-muted)'}}>
                      No captured requests yet. Waiting for traffic...
                    </td>
                  </tr>
                ) : (
                  captures.map(c => (
                    <tr 
                      key={c.id} 
                      className={c.id === selectedCaptureId ? "active" : ""} 
                      onClick={() => setSelectedCaptureId(c.id)}
                    >
                      <td>{formatDateTime(c.startedAt)}</td>
                      <td>
                        <span className={`method-tag method-${c.method}`}>{c.method}</span>
                      </td>
                      <td className="url-cell" title={c.pathname}>{c.pathname}</td>
                      <td>:{c.listenerPort}</td>
                      <td>{c.target}</td>
                      <td>
                        <span className={`status-tag ${getStatusClass(c.status, c.state)}`}>
                          {c.state === 'pending' ? '...' : c.status ?? 'ERR'}
                        </span>
                      </td>
                      <td>{formatDuration(c.durationMs)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* BOTTOM: INSPECTOR */}
        <div className="inspector-pane">
           <div className="pane-header">
             <h2 className="pane-title">Inspector</h2>
             {selectedCapture && (
               <span className="metadata-tag" style={{fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)'}}>
                 ID: {selectedCapture.id}
               </span>
             )}
           </div>

           {selectedCapture ? (
             <div className="inspector-split">
                
                {/* REQUEST COL */}
                <div className="inspector-col">
                   <div className="inspector-header">
                     <span>Request</span>
                     <span style={{color: 'var(--text-muted)'}}>{selectedCapture.request.method}</span>
                   </div>
                   <div className="inspector-content">
                     <div className="data-group">
                       <h4 className="data-title">Headers</h4>
                       <pre>
{JSON.stringify({
  url: selectedCapture.request.url,
  clientIp: selectedCapture.request.clientIp,
  headers: selectedCapture.request.headers
}, null, 2)}
                       </pre>
                     </div>
                     <div className="data-group">
                       <h4 className="data-title">Body ({selectedCapture.request.body.contentType || 'none'})</h4>
                       <pre>
{formatBody(selectedCapture.request.body)}
                       </pre>
                     </div>
                   </div>
                </div>

                {/* RESPONSE COL */}
                <div className="inspector-col">
                   <div className="inspector-header">
                     <span>Response</span>
                     <span style={{color: 'var(--text-muted)'}}>
                       {selectedCapture.response ? `${selectedCapture.response.status} ${selectedCapture.response.statusText}` : selectedCapture.state}
                     </span>
                   </div>
                   <div className="inspector-content">
                     <div className="data-group">
                       <h4 className="data-title">Headers</h4>
                       <pre>
{JSON.stringify(
  selectedCapture.response ?? { state: selectedCapture.state, error: selectedCapture.error ?? "Pending" },
  null, 2
)}
                       </pre>
                     </div>
                     <div className="data-group">
                       <h4 className="data-title">Body ({selectedCapture.response?.body.contentType || 'none'})</h4>
                       <pre>
{formatBody(selectedCapture.response?.body)}
                       </pre>
                     </div>
                   </div>
                </div>

             </div>
           ) : (
             <div className="empty-state">
               Select a request from the list above to inspect details.
             </div>
           )}
        </div>
        
      </main>
    </div>
  );
}

export default App;
