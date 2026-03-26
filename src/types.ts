export interface RouteDefinition {
  method: string;
  path: string;
  description: string;
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  environment: string;
  timestamp: string;
  uptimeSeconds: number;
  capabilities: string[];
}
