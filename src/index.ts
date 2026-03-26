import index from "./index.html";
import { appName, routeCatalog } from "./siteData";

const startedAt = Date.now();
const port = Number(process.env.PORT ?? 3000);

async function readRequestBody(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") {
    return null;
  }

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      return await request.json();
    } catch (error) {
      return {
        parseError: error instanceof Error ? error.message : "Invalid JSON payload",
      };
    }
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const formData = await request.formData();
    const fields: Record<string, string | { name: string; size: number; type: string }> = {};

    for (const [key, value] of formData.entries()) {
      if (typeof value === "string") {
        fields[key] = value;
        continue;
      }

      const file = value as File;
      fields[key] = {
        name: file.name,
        size: file.size,
        type: file.type,
      };
    }

    return fields;
  }

  const text = await request.text();
  return text.length > 0 ? text : null;
}

function collectSearchParams(searchParams: URLSearchParams) {
  const query: Record<string, string | string[]> = {};

  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    query[key] = values.length > 1 ? values : (values[0] ?? "");
  }

  return query;
}

async function inspectRequest(request: Request) {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};

  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return Response.json({
    service: appName,
    receivedAt: new Date().toISOString(),
    method: request.method,
    path: url.pathname,
    query: collectSearchParams(url.searchParams),
    headers,
    body: await readRequestBody(request),
  });
}

const server = Bun.serve({
  port,
  routes: {
    "/api/health": {
      GET() {
        return Response.json({
          ok: true,
          service: appName,
          environment: process.env.NODE_ENV ?? "development",
          timestamp: new Date().toISOString(),
          uptimeSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
          capabilities: [
            "Bun.serve routes",
            "HTML import bundling",
            "React frontend HMR",
            "Executable packaging via bun build --compile",
          ],
        });
      },
    },

    "/api/routes": {
      GET() {
        return Response.json({
          service: appName,
          routes: routeCatalog,
        });
      },
    },

    "/api/inspect": {
      GET(request) {
        return inspectRequest(request);
      },
      POST(request) {
        return inspectRequest(request);
      },
      PUT(request) {
        return inspectRequest(request);
      },
      PATCH(request) {
        return inspectRequest(request);
      },
      DELETE(request) {
        return inspectRequest(request);
      },
    },

    "/api/*": request =>
      Response.json(
        {
          error: "Unknown API route",
          path: new URL(request.url).pathname,
        },
        { status: 404 },
      ),

    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },

  error(error) {
    console.error(error);

    return Response.json(
      {
        error: error instanceof Error ? error.message : "Unexpected server error",
      },
      { status: 500 },
    );
  },
});

console.log(`[${appName}] listening on ${server.url}`);
