import index from "./index.html";
import { adminPort, appName, captureLimit, listenHost } from "./config";
import { clearCaptures, getCapture, listCaptureSummaries, listListeners, removeListener, upsertListener } from "./runtime";
import type { ListenerPayload, OverviewResponse } from "./types";

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

function createOverview(): OverviewResponse {
  return {
    appName,
    adminPort,
    listenHost,
    captureLimit,
    listeners: listListeners(),
    captures: listCaptureSummaries(),
  };
}

async function readJson<T>(request: Request) {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function parsePort(portValue: string) {
  const port = Number(portValue);

  if (!Number.isInteger(port)) {
    throw new Error("Port must be an integer");
  }

  return port;
}

const server = Bun.serve({
  hostname: listenHost,
  port: adminPort,
  routes: {
    "/api/health": {
      GET() {
        return json({
          ok: true,
          service: appName,
          adminPort,
          listenHost,
          captureLimit,
          listeners: listListeners().length,
          captures: listCaptureSummaries().length,
          timestamp: new Date().toISOString(),
        });
      },
    },

    "/api/admin/overview": {
      GET() {
        return json(createOverview());
      },
    },

    "/api/admin/listeners": {
      GET() {
        return json({ listeners: listListeners() });
      },
      async POST(request) {
        try {
          const payload = await readJson<ListenerPayload>(request);
          const listener = await upsertListener(payload);

          return json(
            {
              listener: {
                port: listener.port,
                target: listener.target,
                script: listener.script,
                startedAt: listener.startedAt,
                updatedAt: listener.updatedAt,
                requestCount: listener.requestCount,
              },
            },
            { status: 201 },
          );
        } catch (error) {
          return json(
            {
              error: error instanceof Error ? error.message : "Failed to save listener",
            },
            { status: 400 },
          );
        }
      },
    },

    "/api/admin/listeners/:port": {
      async DELETE(request) {
        try {
          const deleted = await removeListener(parsePort(request.params.port));
          if (!deleted) {
            return json({ error: "Listener not found" }, { status: 404 });
          }

          return json({ ok: true });
        } catch (error) {
          return json(
            {
              error: error instanceof Error ? error.message : "Failed to remove listener",
            },
            { status: 400 },
          );
        }
      },
    },

    "/api/admin/captures": {
      GET() {
        return json({ captures: listCaptureSummaries() });
      },
      DELETE() {
        clearCaptures();
        return json({ ok: true });
      },
    },

    "/api/admin/captures/:id": {
      GET(request) {
        const capture = getCapture(request.params.id);
        if (!capture) {
          return json({ error: "Capture not found" }, { status: 404 });
        }

        return json({ capture });
      },
    },

    "/api/*": request => {
      return json(
        {
          error: "Unknown admin API route",
          path: new URL(request.url).pathname,
        },
        { status: 404 },
      );
    },

    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },

  error(error) {
    console.error(error);

    return json(
      {
        error: error instanceof Error ? error.message : "Unexpected server error",
      },
      { status: 500 },
    );
  },
});

console.log(`[${appName}] listening on ${server.url}`);
