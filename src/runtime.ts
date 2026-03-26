import { adminPort, appName, captureLimit, listenHost } from "./config";
import type {
  BodySnapshot,
  CaptureRecord,
  CaptureResponseSnapshot,
  CaptureScriptSnapshot,
  CaptureSummary,
  HeadersSnapshot,
  ListenerPayload,
  ListenerSummary,
  RequestScriptContext,
  ResponseScriptContext,
  ScriptBodyPayload,
  ScriptHookPhase,
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

const hopByHopResponseHeaders = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type ListenerServer = ReturnType<typeof Bun.serve>;
type MaybePromise<T> = T | Promise<T>;
type BeforeRequestHook = (
  context: RequestScriptContext,
) => MaybePromise<Partial<RequestScriptContext> | RequestScriptContext | void>;
type AfterResponseHook = (
  context: ResponseScriptContext,
) => MaybePromise<Partial<ResponseScriptContext> | ResponseScriptContext | void>;

interface CompiledListenerScript {
  source: string;
  beforeRequest?: BeforeRequestHook;
  afterResponse?: AfterResponseHook;
}

interface BufferedBody {
  bytes: Uint8Array;
  contentType: string | null;
}

interface ListenerRuntime extends ListenerSummary {
  server: ListenerServer;
  scriptRuntime: CompiledListenerScript | null;
}

class ScriptExecutionError extends Error {
  phase: ScriptHookPhase;

  constructor(phase: ScriptHookPhase, message: string) {
    super(message);
    this.name = "ScriptExecutionError";
    this.phase = phase;
  }
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

function bodySnapshotFromBufferedBody(body: BufferedBody): BodySnapshot {
  const { bytes, contentType } = body;
  const size = bytes.byteLength;

  if (size === 0) {
    return emptyBody(contentType);
  }

  if (isTextualContentType(contentType)) {
    return {
      kind: "text",
      contentType,
      size,
      text: textDecoder.decode(bytes),
    };
  }

  return {
    kind: "base64",
    contentType,
    size,
    base64: Buffer.from(bytes).toString("base64"),
  };
}

async function readBufferedBody(message: Request | Response): Promise<BufferedBody> {
  return {
    bytes: new Uint8Array(await message.arrayBuffer()),
    contentType: message.headers.get("content-type"),
  };
}

async function readBodySnapshot(message: Request | Response): Promise<BodySnapshot> {
  try {
    return bodySnapshotFromBufferedBody(await readBufferedBody(message));
  } catch (error) {
    return {
      kind: "error",
      contentType: message.headers.get("content-type"),
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

function headersToRecord(headers: Headers) {
  const record: Record<string, string> = {};
  headers.forEach((value, name) => {
    record[name] = value;
  });
  return record;
}

function normalizeHeadersRecord(input: unknown) {
  if (input instanceof Headers) {
    return headersToRecord(input);
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("context.headers must be a plain object or Headers");
  }

  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new Error(`Header "${name}" must be a string, number, boolean, null, or undefined`);
    }

    normalized[name] = String(value);
  }

  return normalized;
}

function normalizeNullableString(value: unknown, label: string) {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${label} must be a string or null`);
  }

  return value;
}

function cloneScriptBody(body: ScriptBodyPayload | null): ScriptBodyPayload | null {
  if (!body) {
    return null;
  }

  return {
    text: body.text,
    base64: body.base64,
    contentType: body.contentType,
  };
}

function normalizeScriptBody(input: unknown, fallback: ScriptBodyPayload | null): ScriptBodyPayload | null {
  if (input === null) {
    return null;
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("context.body must be an object or null");
  }

  const candidate = input as Partial<ScriptBodyPayload>;

  return {
    text: candidate.text === undefined ? fallback?.text ?? null : normalizeNullableString(candidate.text, "context.body.text"),
    base64:
      candidate.base64 === undefined ? fallback?.base64 ?? null : normalizeNullableString(candidate.base64, "context.body.base64"),
    contentType:
      candidate.contentType === undefined
        ? fallback?.contentType ?? null
        : normalizeNullableString(candidate.contentType, "context.body.contentType"),
  };
}

function scriptBodyFromBufferedBody(body: BufferedBody): ScriptBodyPayload | null {
  if (body.bytes.byteLength === 0) {
    return null;
  }

  return {
    text: isTextualContentType(body.contentType) ? textDecoder.decode(body.bytes) : null,
    base64: Buffer.from(body.bytes).toString("base64"),
    contentType: body.contentType,
  };
}

function bufferedBodyFromScriptBody(body: ScriptBodyPayload | null): BufferedBody {
  if (!body) {
    return {
      bytes: new Uint8Array(0),
      contentType: null,
    };
  }

  if (body.text !== null) {
    return {
      bytes: textEncoder.encode(body.text),
      contentType: body.contentType,
    };
  }

  if (body.base64 !== null) {
    try {
      return {
        bytes: new Uint8Array(Buffer.from(body.base64, "base64")),
        contentType: body.contentType,
      };
    } catch {
      throw new Error("context.body.base64 must be valid base64");
    }
  }

  return {
    bytes: new Uint8Array(0),
    contentType: body.contentType,
  };
}

function bodyInitFromBytes(bytes: Uint8Array) {
  if (bytes.byteLength === 0) {
    return undefined;
  }

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer]);
}

function sameScriptBody(left: ScriptBodyPayload | null, right: ScriptBodyPayload | null) {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return left === right;
  }

  return left.text === right.text && left.base64 === right.base64 && left.contentType === right.contentType;
}

function normalizeScriptUrl(input: unknown) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error("context.url must be a non-empty absolute URL");
  }

  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("context.url must use http:// or https://");
  }

  return url.toString();
}

function cloneRequestScriptContext(context: RequestScriptContext): RequestScriptContext {
  return {
    url: context.url,
    method: context.method,
    headers: { ...context.headers },
    body: cloneScriptBody(context.body),
  };
}

function cloneResponseScriptContext(context: ResponseScriptContext): ResponseScriptContext {
  return {
    requestUrl: context.requestUrl,
    requestMethod: context.requestMethod,
    headers: { ...context.headers },
    body: cloneScriptBody(context.body),
    status: context.status,
    statusText: context.statusText,
  };
}

function normalizeRequestScriptContext(input: unknown, fallback: RequestScriptContext): RequestScriptContext {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("beforeRequest must return a context object");
  }

  const candidate = input as Partial<RequestScriptContext>;
  const methodInput = candidate.method ?? fallback.method;

  if (typeof methodInput !== "string" || methodInput.trim() === "") {
    throw new Error("context.method must be a non-empty string");
  }

  return {
    url: normalizeScriptUrl(candidate.url ?? fallback.url),
    method: methodInput.toUpperCase(),
    headers: candidate.headers === undefined ? { ...fallback.headers } : normalizeHeadersRecord(candidate.headers),
    body: candidate.body === undefined ? cloneScriptBody(fallback.body) : normalizeScriptBody(candidate.body, fallback.body),
  };
}

function normalizeResponseScriptContext(input: unknown, fallback: ResponseScriptContext): ResponseScriptContext {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("afterResponse must return a context object");
  }

  const candidate = input as Partial<ResponseScriptContext>;
  const statusInput = candidate.status ?? fallback.status;
  const statusTextInput = candidate.statusText ?? fallback.statusText;
  const requestUrlInput = candidate.requestUrl ?? fallback.requestUrl;
  const requestMethodInput = candidate.requestMethod ?? fallback.requestMethod;

  if (!Number.isInteger(statusInput) || statusInput < 100 || statusInput > 999) {
    throw new Error("context.status must be an integer between 100 and 999");
  }

  if (typeof statusTextInput !== "string") {
    throw new Error("context.statusText must be a string");
  }

  if (typeof requestUrlInput !== "string" || requestUrlInput.trim() === "") {
    throw new Error("context.requestUrl must be a non-empty string");
  }

  if (typeof requestMethodInput !== "string" || requestMethodInput.trim() === "") {
    throw new Error("context.requestMethod must be a non-empty string");
  }

  return {
    requestUrl: requestUrlInput,
    requestMethod: requestMethodInput,
    headers: candidate.headers === undefined ? { ...fallback.headers } : normalizeHeadersRecord(candidate.headers),
    body: candidate.body === undefined ? cloneScriptBody(fallback.body) : normalizeScriptBody(candidate.body, fallback.body),
    status: statusInput,
    statusText: statusTextInput,
  };
}

function createScriptSnapshot(scriptRuntime: CompiledListenerScript): CaptureScriptSnapshot {
  return {
    beforeRequestDefined: Boolean(scriptRuntime.beforeRequest),
    afterResponseDefined: Boolean(scriptRuntime.afterResponse),
    beforeRequestApplied: false,
    afterResponseApplied: false,
    errors: [],
  };
}

function appendScriptError(recordId: string, phase: ScriptHookPhase, message: string) {
  mutateCapture(recordId, capture => {
    if (!capture.script) {
      return;
    }

    capture.script.errors.push({
      phase,
      message,
      occurredAt: new Date().toISOString(),
    });
  });
}

function markScriptApplied(recordId: string, phase: ScriptHookPhase) {
  mutateCapture(recordId, capture => {
    if (!capture.script) {
      return;
    }

    if (phase === "beforeRequest") {
      capture.script.beforeRequestApplied = true;
    } else {
      capture.script.afterResponseApplied = true;
    }
  });
}

function buildRequestHeadersFromScript(
  headerRecord: Record<string, string>,
  contentType: string | null,
  bodyChanged: boolean,
) {
  const headers = new Headers(headerRecord);

  for (const header of hopByHopRequestHeaders) {
    headers.delete(header);
  }

  if (bodyChanged) {
    headers.delete("content-encoding");
  }

  if (contentType === null) {
    headers.delete("content-type");
  } else {
    headers.set("content-type", contentType);
  }

  return headers;
}

function buildResponseHeadersFromScript(
  headerRecord: Record<string, string>,
  contentType: string | null,
  bodyChanged: boolean,
) {
  const headers = new Headers(headerRecord);

  for (const header of hopByHopResponseHeaders) {
    headers.delete(header);
  }

  if (bodyChanged) {
    headers.delete("content-encoding");
  }

  if (contentType === null) {
    headers.delete("content-type");
  } else {
    headers.set("content-type", contentType);
  }

  return headers;
}

function createRequestSnapshot(request: Request, clientIp: string | null, body: BodySnapshot) {
  const url = new URL(request.url);

  return {
    method: request.method,
    url: url.toString(),
    pathname: url.pathname,
    search: url.search,
    clientIp,
    headers: captureHeaders(request.headers),
    body,
  };
}

function createResponseSnapshot(response: Response, durationMs: number, body: BodySnapshot): CaptureResponseSnapshot {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: captureHeaders(response.headers),
    body,
    durationMs,
  };
}

async function snapshotResponse(response: Response, durationMs: number) {
  return createResponseSnapshot(response, durationMs, await readBodySnapshot(response.clone()));
}

function trackForwardedRequest(recordId: string, request: Request, clientIp: string | null) {
  const body = requestBodyCanExist(request.method)
    ? pendingBody(request.headers.get("content-type"))
    : emptyBody(request.headers.get("content-type"));
  const requestClone = requestBodyCanExist(request.method) ? request.clone() : null;

  mutateCapture(recordId, capture => {
    capture.upstreamUrl = request.url;
    capture.forwardedRequest = createRequestSnapshot(request, clientIp, body);
  });

  if (!requestClone) {
    return;
  }

  void readBodySnapshot(requestClone).then(snapshot => {
    mutateCapture(recordId, capture => {
      if (capture.forwardedRequest) {
        capture.forwardedRequest.body = snapshot;
      }
    });
  });
}

async function executeBeforeRequestScript(
  listener: ListenerRuntime,
  recordId: string,
  defaultUpstreamUrl: URL,
  request: Request,
): Promise<Request> {
  const script = listener.scriptRuntime;
  const defaultHeaders = buildForwardHeaders(request.headers);

  if (!script?.beforeRequest) {
    return new Request(defaultUpstreamUrl.toString(), {
      method: request.method,
      headers: defaultHeaders,
      body: requestBodyCanExist(request.method) ? request.body : undefined,
      redirect: "manual",
      signal: request.signal,
    });
  }

  const initialBody = requestBodyCanExist(request.method)
    ? await readBufferedBody(request)
    : {
        bytes: new Uint8Array(0),
        contentType: request.headers.get("content-type"),
      };
  const initialContext: RequestScriptContext = {
    url: defaultUpstreamUrl.toString(),
    method: request.method,
    headers: headersToRecord(defaultHeaders),
    body: scriptBodyFromBufferedBody(initialBody),
  };
  const workingContext = cloneRequestScriptContext(initialContext);
  const originalBody = cloneScriptBody(workingContext.body);

  try {
    const result = await script.beforeRequest(workingContext);
    const normalized = normalizeRequestScriptContext(result ?? workingContext, workingContext);
    const finalBody = bufferedBodyFromScriptBody(normalized.body);

    if (!requestBodyCanExist(normalized.method) && finalBody.bytes.byteLength > 0) {
      throw new Error(`${normalized.method} requests cannot include a body`);
    }

    const bodyChanged = !sameScriptBody(originalBody, normalized.body);
    const headers = buildRequestHeadersFromScript(normalized.headers, finalBody.contentType, bodyChanged);

    markScriptApplied(recordId, "beforeRequest");

    return new Request(normalized.url, {
      method: normalized.method,
      headers,
      body: requestBodyCanExist(normalized.method) ? bodyInitFromBytes(finalBody.bytes) : undefined,
      redirect: "manual",
      signal: request.signal,
    });
  } catch (error) {
    const message = serializableError(error);
    appendScriptError(recordId, "beforeRequest", message);
    throw new ScriptExecutionError("beforeRequest", message);
  }
}

async function executeAfterResponseScript(
  listener: ListenerRuntime,
  recordId: string,
  request: Request,
  upstreamResponse: Response,
): Promise<Response> {
  const script = listener.scriptRuntime;

  if (!script?.afterResponse) {
    return upstreamResponse;
  }

  const initialBody = await readBufferedBody(upstreamResponse);
  const initialContext: ResponseScriptContext = {
    requestUrl: request.url,
    requestMethod: request.method,
    headers: headersToRecord(upstreamResponse.headers),
    body: scriptBodyFromBufferedBody(initialBody),
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
  };
  const workingContext = cloneResponseScriptContext(initialContext);
  const originalBody = cloneScriptBody(workingContext.body);

  try {
    const result = await script.afterResponse(workingContext);
    const normalized = normalizeResponseScriptContext(result ?? workingContext, workingContext);
    const finalBody = bufferedBodyFromScriptBody(normalized.body);
    const bodyChanged = !sameScriptBody(originalBody, normalized.body);
    const headers = buildResponseHeadersFromScript(normalized.headers, finalBody.contentType, bodyChanged);

    markScriptApplied(recordId, "afterResponse");

    return new Response(bodyInitFromBytes(finalBody.bytes), {
      status: normalized.status,
      statusText: normalized.statusText,
      headers,
    });
  } catch (error) {
    const message = serializableError(error);
    appendScriptError(recordId, "afterResponse", message);
    throw new ScriptExecutionError("afterResponse", message);
  }
}

function createFailureResponse(
  listener: ListenerRuntime,
  status: number,
  payload: Record<string, unknown>,
) {
  return Response.json(
    {
      ...payload,
      target: listener.target,
      port: listener.port,
      service: appName,
    },
    { status },
  );
}

function buildScriptPrelude(source: string) {
  return `"use strict";
const globalThis = undefined;
const process = undefined;
const Bun = undefined;
const require = undefined;
const fetch = undefined;
const WebSocket = undefined;
${source}
return {
  beforeRequest: typeof beforeRequest === "function" ? beforeRequest : undefined,
  afterResponse: typeof afterResponse === "function" ? afterResponse : undefined,
};`;
}

function compileListenerScript(source: string) {
  if (source.trim() === "") {
    return null;
  }

  let factory: (
    consoleArg: Console,
    URLArg: typeof URL,
    TextEncoderArg: typeof TextEncoder,
    TextDecoderArg: typeof TextDecoder,
    atobArg: typeof atob,
    btoaArg: typeof btoa,
  ) => { beforeRequest?: BeforeRequestHook; afterResponse?: AfterResponseHook };

  try {
    factory = new Function(
      "consoleArg",
      "URLArg",
      "TextEncoderArg",
      "TextDecoderArg",
      "atobArg",
      "btoaArg",
      `const console = consoleArg;
const URL = URLArg;
const TextEncoder = TextEncoderArg;
const TextDecoder = TextDecoderArg;
const atob = atobArg;
const btoa = btoaArg;
${buildScriptPrelude(source)}`,
    ) as typeof factory;
  } catch (error) {
    throw new Error(`Invalid script: ${serializableError(error)}`);
  }

  try {
    const compiled = factory(console, URL, TextEncoder, TextDecoder, atob, btoa);
    const beforeRequest = typeof compiled.beforeRequest === "function" ? compiled.beforeRequest : undefined;
    const afterResponse = typeof compiled.afterResponse === "function" ? compiled.afterResponse : undefined;

    if (!beforeRequest && !afterResponse) {
      throw new Error("Script must define beforeRequest(context) and/or afterResponse(context)");
    }

    return {
      source,
      beforeRequest,
      afterResponse,
    } satisfies CompiledListenerScript;
  } catch (error) {
    throw new Error(`Failed to initialize script: ${serializableError(error)}`);
  }
}

function createProxyHandler(listener: ListenerRuntime) {
  return async (request: Request, server: ListenerServer) => {
    const startedAt = Date.now();
    const requestUrl = new URL(request.url);
    const defaultUpstreamUrl = buildUpstreamUrl(listener.target, requestUrl);
    const requestClone = request.clone();
    const requestBodyState = requestBodyCanExist(request.method)
      ? pendingBody(request.headers.get("content-type"))
      : emptyBody(request.headers.get("content-type"));
    const clientIp = server.requestIP(request)?.address ?? null;

    const record: CaptureRecord = {
      id: crypto.randomUUID(),
      listenerPort: listener.port,
      target: listener.target,
      upstreamUrl: defaultUpstreamUrl.toString(),
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
      script: listener.scriptRuntime ? createScriptSnapshot(listener.scriptRuntime) : undefined,
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
      const outgoingRequest = await executeBeforeRequestScript(listener, record.id, defaultUpstreamUrl, request);

      if (listener.scriptRuntime) {
        trackForwardedRequest(record.id, outgoingRequest, clientIp);
      }

      const upstreamResponse = await fetch(outgoingRequest, {
        redirect: "manual",
        decompress: false,
        signal: request.signal,
      });
      const upstreamDurationMs = Date.now() - startedAt;

      if (listener.scriptRuntime?.afterResponse) {
        const upstreamBody = await readBufferedBody(upstreamResponse.clone());

        mutateCapture(record.id, capture => {
          capture.upstreamResponse = createResponseSnapshot(
            upstreamResponse,
            upstreamDurationMs,
            bodySnapshotFromBufferedBody(upstreamBody),
          );
        });
      }

      const finalResponse = await executeAfterResponseScript(listener, record.id, outgoingRequest, upstreamResponse);
      const durationMs = Date.now() - startedAt;

      if (listener.scriptRuntime?.afterResponse) {
        const finalBody = await readBufferedBody(finalResponse.clone());

        mutateCapture(record.id, capture => {
          capture.state = "completed";
          capture.completedAt = new Date().toISOString();
          capture.durationMs = durationMs;
          capture.response = createResponseSnapshot(finalResponse, durationMs, bodySnapshotFromBufferedBody(finalBody));
        });

        return finalResponse;
      }

      const responseClone = finalResponse.clone();
      mutateCapture(record.id, capture => {
        capture.state = "completed";
        capture.completedAt = new Date().toISOString();
        capture.durationMs = durationMs;
        capture.response = {
          status: finalResponse.status,
          statusText: finalResponse.statusText,
          headers: captureHeaders(finalResponse.headers),
          body: pendingBody(finalResponse.headers.get("content-type")),
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

      return finalResponse;
    } catch (error) {
      const durationMs = Date.now() - startedAt;

      if (error instanceof ScriptExecutionError) {
        const response = createFailureResponse(listener, 500, {
          error: "Proxy script failed",
          phase: error.phase,
          message: error.message,
        });
        const responseSnapshot = await snapshotResponse(response, durationMs);

        mutateCapture(record.id, capture => {
          capture.state = "failed";
          capture.completedAt = new Date().toISOString();
          capture.durationMs = durationMs;
          capture.error = `${error.phase}: ${error.message}`;
          capture.response = responseSnapshot;
        });

        return response;
      }

      const message = serializableError(error);
      const response = createFailureResponse(listener, 502, {
        error: "Proxy request failed",
        message,
      });
      const responseSnapshot = await snapshotResponse(response, durationMs);

      mutateCapture(record.id, capture => {
        capture.state = "failed";
        capture.completedAt = new Date().toISOString();
        capture.durationMs = durationMs;
        capture.error = message;
        capture.response = responseSnapshot;
      });

      return response;
    }
  };
}

export function listListeners() {
  return [...listeners.values()]
    .map(({ port, target, script, startedAt, updatedAt, requestCount }) => ({
      port,
      target,
      script,
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
  const script = typeof input.script === "string" ? input.script : "";
  const scriptRuntime = compileListenerScript(script);
  const existing = listeners.get(port);
  const startedAt = existing?.startedAt ?? new Date().toISOString();

  if (existing) {
    await existing.server.stop(true);
    listeners.delete(port);
  }

  const runtime: ListenerRuntime = {
    port,
    target,
    script,
    startedAt,
    updatedAt: new Date().toISOString(),
    requestCount: existing?.requestCount ?? 0,
    server: null as unknown as ListenerServer,
    scriptRuntime,
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
