import { adminPort, appName, captureLimit, listenHost } from "./config";
import type {
  BodySnapshot,
  CaptureRecord,
  CaptureSummary,
  HeadersSnapshot,
  ListenerPayload,
  ListenerSummary,
} from "./types";

const hopByHopRequestHeaders = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

type ListenerServer = ReturnType<typeof Bun.serve>;

interface ListenerRuntime extends ListenerSummary {
  server: ListenerServer;
}

const listeners = new Map<number, ListenerRuntime>();
const captures: CaptureRecord[] = [];
const captureIndex = new Map<string, CaptureRecord>();

function normalizeTarget(input: string) {
  const url = new URL(input.trim());

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http:// and https:// targets are supported");
  }

  url.hash = "";

  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

function validatePort(port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Port must be an integer between 1 and 65535");
  }

  if (port === adminPort) {
    throw new Error(`Port ${adminPort} is reserved for the admin panel`);
  }
}

function buildUpstreamUrl(target: string, incomingUrl: URL) {
  const upstreamUrl = new URL(target);
  const targetPath = upstreamUrl.pathname === "/" ? "" : upstreamUrl.pathname.replace(/\/+$/, "");
  const nextPath = incomingUrl.pathname.startsWith("/") ? incomingUrl.pathname : `/${incomingUrl.pathname}`;

  upstreamUrl.pathname = `${targetPath}${nextPath}`.replace(/\/{2,}/g, "/");
  upstreamUrl.search = incomingUrl.search;

  return upstreamUrl;
}

function isTextualContentType(contentType: string | null) {
  if (!contentType) {
    return false;
  }

  return [
    "application/graphql",
    "application/javascript",
    "application/json",
    "application/ld+json",
    "application/problem+json",
    "application/sql",
    "application/vnd.api+json",
    "application/x-ndjson",
    "application/x-www-form-urlencoded",
    "application/xml",
    "text/",
  ].some(pattern => contentType.includes(pattern));
}

function pendingBody(contentType: string | null): BodySnapshot {
  return {
    kind: "pending",
    contentType,
    size: 0,
  };
}

function emptyBody(contentType: string | null): BodySnapshot {
  return {
    kind: "empty",
    contentType,
    size: 0,
  };
}

function captureHeaders(headers: Headers): HeadersSnapshot {
  const entries: HeadersSnapshot["entries"] = [];
  headers.forEach((value, name) => {
    entries.push({ name, value });
  });

  return {
    entries,
    combined: headers.toJSON(),
  };
}

async function readBodySnapshot(message: Request | Response): Promise<BodySnapshot> {
  const contentType = message.headers.get("content-type");

  try {
    const bytes = await message.arrayBuffer();
    const size = bytes.byteLength;

    if (size === 0) {
      return emptyBody(contentType);
    }

    if (isTextualContentType(contentType)) {
      return {
        kind: "text",
        contentType,
        size,
        text: new TextDecoder().decode(bytes),
      };
    }

    return {
      kind: "base64",
      contentType,
      size,
      base64: Buffer.from(bytes).toString("base64"),
    };
  } catch (error) {
    return {
      kind: "error",
      contentType,
      size: 0,
      error: error instanceof Error ? error.message : "Failed to read body",
    };
  }
}

function addCapture(record: CaptureRecord) {
  captures.unshift(record);
  captureIndex.set(record.id, record);

  while (captures.length > captureLimit) {
    const dropped = captures.pop();
    if (dropped) {
      captureIndex.delete(dropped.id);
    }
  }
}

function mutateCapture(id: string, updater: (record: CaptureRecord) => void) {
  const record = captureIndex.get(id);
  if (record) {
    updater(record);
  }
}

function toSummary(record: CaptureRecord): CaptureSummary {
  return {
    id: record.id,
    listenerPort: record.listenerPort,
    target: record.target,
    upstreamUrl: record.upstreamUrl,
    method: record.request.method,
    pathname: record.request.pathname,
    startedAt: record.startedAt,
    state: record.state,
    status: record.response?.status,
    durationMs: record.durationMs,
    clientIp: record.request.clientIp,
  };
}

function serializableError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown proxy error";
}

function requestBodyCanExist(method: string) {
  return method !== "GET" && method !== "HEAD";
}

function buildForwardHeaders(source: Headers) {
  const headers = new Headers(source);

  for (const header of hopByHopRequestHeaders) {
    headers.delete(header);
  }

  return headers;
}

function createProxyHandler(listener: ListenerRuntime) {
  return async (request: Request, server: ListenerServer) => {
    const startedAt = Date.now();
    const requestUrl = new URL(request.url);
    const upstreamUrl = buildUpstreamUrl(listener.target, requestUrl);
    const requestClone = request.clone();
    const requestBodyState = requestBodyCanExist(request.method)
      ? pendingBody(request.headers.get("content-type"))
      : emptyBody(request.headers.get("content-type"));
    const clientIp = server.requestIP(request)?.address ?? null;

    const record: CaptureRecord = {
      id: crypto.randomUUID(),
      listenerPort: listener.port,
      target: listener.target,
      upstreamUrl: upstreamUrl.toString(),
      state: "pending",
      startedAt: new Date(startedAt).toISOString(),
      request: {
        method: request.method,
        url: requestUrl.toString(),
        pathname: requestUrl.pathname,
        search: requestUrl.search,
        clientIp,
        headers: captureHeaders(request.headers),
        body: requestBodyState,
      },
    };

    listener.requestCount += 1;
    listener.updatedAt = new Date().toISOString();
    addCapture(record);

    if (requestBodyCanExist(request.method)) {
      void readBodySnapshot(requestClone).then(body => {
        mutateCapture(record.id, capture => {
          capture.request.body = body;
        });
      });
    }

    try {
      const fetchInit: BunFetchRequestInit = {
        method: request.method,
        headers: buildForwardHeaders(request.headers),
        body: requestBodyCanExist(request.method) ? request.body : undefined,
        redirect: "manual",
        decompress: false,
        signal: request.signal,
      };

      const upstreamResponse = await fetch(upstreamUrl, fetchInit);

      const durationMs = Date.now() - startedAt;
      const responseClone = upstreamResponse.clone();

      mutateCapture(record.id, capture => {
        capture.state = "completed";
        capture.completedAt = new Date().toISOString();
        capture.durationMs = durationMs;
        capture.response = {
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          headers: captureHeaders(upstreamResponse.headers),
          body: pendingBody(upstreamResponse.headers.get("content-type")),
          durationMs,
        };
      });

      void readBodySnapshot(responseClone).then(body => {
        mutateCapture(record.id, capture => {
          if (capture.response) {
            capture.response.body = body;
          }
        });
      });

      return upstreamResponse;
    } catch (error) {
      const message = serializableError(error);
      const durationMs = Date.now() - startedAt;

      mutateCapture(record.id, capture => {
        capture.state = "failed";
        capture.completedAt = new Date().toISOString();
        capture.durationMs = durationMs;
        capture.error = message;
      });

      return Response.json(
        {
          error: "Proxy request failed",
          message,
          target: listener.target,
          service: appName,
        },
        { status: 502 },
      );
    }
  };
}

export function listListeners() {
  return [...listeners.values()]
    .map(({ port, target, startedAt, updatedAt, requestCount }) => ({
      port,
      target,
      startedAt,
      updatedAt,
      requestCount,
    }))
    .sort((left, right) => left.port - right.port);
}

export function listCaptureSummaries() {
  return captures.map(toSummary);
}

export function getCapture(id: string) {
  return captureIndex.get(id) ?? null;
}

export function clearCaptures() {
  captures.length = 0;
  captureIndex.clear();
}

export async function upsertListener(input: ListenerPayload) {
  const port = Number(input.port);
  validatePort(port);

  const target = normalizeTarget(input.target);
  const existing = listeners.get(port);
  const startedAt = existing?.startedAt ?? new Date().toISOString();

  if (existing) {
    await existing.server.stop(true);
    listeners.delete(port);
  }

  try {
    const runtime: ListenerRuntime = {
      port,
      target,
      startedAt,
      updatedAt: new Date().toISOString(),
      requestCount: existing?.requestCount ?? 0,
      server: null as unknown as ListenerServer,
    };

    runtime.server = Bun.serve({
      hostname: listenHost,
      port,
      fetch: createProxyHandler(runtime),
      error(error) {
        return Response.json(
          {
            error: serializableError(error),
            port,
          },
          { status: 500 },
        );
      },
    });

    listeners.set(port, runtime);
    return runtime;
  } catch (error) {
    throw error;
  }
}

export async function removeListener(portValue: number) {
  const port = Number(portValue);
  const listener = listeners.get(port);

  if (!listener) {
    return false;
  }

  listeners.delete(port);
  await listener.server.stop(true);
  return true;
}
