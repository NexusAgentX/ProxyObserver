import { appName } from "./siteData";

function readNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

export const adminPort = readNumberEnv("ADMIN_PORT", readNumberEnv("PORT", 3000));
export const captureLimit = readNumberEnv("CAPTURE_LIMIT", 200);
export const idleTimeout = readNumberEnv("IDLE_TIMEOUT", 0);
export const listenHost = process.env.LISTEN_HOST ?? "127.0.0.1";
export { appName };
