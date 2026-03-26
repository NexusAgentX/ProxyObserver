import { useState, type FormEvent } from "react";
import { defaultInspectBody } from "./siteData";

const presets = [
  {
    label: "Health",
    method: "GET",
    endpoint: "/api/health",
  },
  {
    label: "Inspect",
    method: "POST",
    endpoint: "/api/inspect?source=dashboard",
  },
  {
    label: "Routes",
    method: "GET",
    endpoint: "/api/routes",
  },
] as const;

function prettyPrintResponse(contentType: string | null, body: string) {
  if (contentType?.includes("application/json")) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }

  return body;
}

export function APITester() {
  const [method, setMethod] = useState("POST");
  const [endpoint, setEndpoint] = useState("/api/inspect?source=dashboard");
  const [requestBody, setRequestBody] = useState(defaultInspectBody);
  const [responseBody, setResponseBody] = useState("// Response will appear here.");
  const [responseMeta, setResponseMeta] = useState("Ready to send a request");
  const [isLoading, setIsLoading] = useState(false);

  const testEndpoint = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const headers = new Headers();
      const requestInit: RequestInit = { method, headers };
      const canSendBody = method !== "GET" && method !== "HEAD";

      if (canSendBody) {
        headers.set("content-type", "application/json");
        requestInit.body = requestBody;
      }

      const response = await fetch(endpoint, requestInit);
      const text = await response.text();

      setResponseMeta(`${response.status} ${response.statusText}`);
      setResponseBody(prettyPrintResponse(response.headers.get("content-type"), text));
    } catch (error) {
      setResponseMeta("Request failed");
      setResponseBody(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <article className="panel tester-panel">
      <div className="panel-header">
        <span>Request Inspector</span>
        <span className="response-meta">{responseMeta}</span>
      </div>

      <div className="preset-row">
        {presets.map(preset => (
          <button
            key={preset.label}
            type="button"
            className="preset-button"
            onClick={() => {
              setMethod(preset.method);
              setEndpoint(preset.endpoint);
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <form onSubmit={testEndpoint} className="tester-form">
        <label className="field">
          <span>Method</span>
          <select value={method} onChange={event => setMethod(event.target.value)} className="method-select">
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
          </select>
        </label>

        <label className="field field-grow">
          <span>Endpoint</span>
          <input
            type="text"
            value={endpoint}
            onChange={event => setEndpoint(event.target.value)}
            className="url-input"
            placeholder="/api/inspect"
          />
        </label>

        <label className="field field-full">
          <span>JSON Body</span>
          <textarea
            value={requestBody}
            onChange={event => setRequestBody(event.target.value)}
            className="editor"
            spellCheck={false}
          />
        </label>

        <div className="button-row">
          <button type="submit" className="primary-button" disabled={isLoading}>
            {isLoading ? "Sending..." : "Send Request"}
          </button>
        </div>
      </form>

      <label className="field field-full">
        <span>Response</span>
        <textarea value={responseBody} readOnly className="response-area" spellCheck={false} />
      </label>
    </article>
  );
}
