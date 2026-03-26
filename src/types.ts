export type CaptureState = "pending" | "completed" | "failed";
export type BodyKind = "pending" | "empty" | "text" | "base64" | "error";

export interface HeaderEntry {
  name: string;
  value: string;
}

export interface HeadersSnapshot {
  entries: HeaderEntry[];
  combined: Record<string, string | string[]>;
}

export interface BodySnapshot {
  kind: BodyKind;
  contentType: string | null;
  size: number;
  text?: string;
  base64?: string;
  error?: string;
}

export interface ListenerSummary {
  port: number;
  target: string;
  startedAt: string;
  updatedAt: string;
  requestCount: number;
}

export interface CaptureRequestSnapshot {
  method: string;
  url: string;
  pathname: string;
  search: string;
  clientIp: string | null;
  headers: HeadersSnapshot;
  body: BodySnapshot;
}

export interface CaptureResponseSnapshot {
  status: number;
  statusText: string;
  headers: HeadersSnapshot;
  body: BodySnapshot;
  durationMs: number;
}

export interface CaptureRecord {
  id: string;
  listenerPort: number;
  target: string;
  upstreamUrl: string;
  state: CaptureState;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  request: CaptureRequestSnapshot;
  response?: CaptureResponseSnapshot;
  error?: string;
}

export interface CaptureSummary {
  id: string;
  listenerPort: number;
  target: string;
  upstreamUrl: string;
  method: string;
  pathname: string;
  startedAt: string;
  state: CaptureState;
  status?: number;
  durationMs?: number;
  clientIp: string | null;
}

export interface OverviewResponse {
  appName: string;
  adminPort: number;
  listenHost: string;
  captureLimit: number;
  listeners: ListenerSummary[];
  captures: CaptureSummary[];
}

export interface ListenerPayload {
  port: number;
  target: string;
}
