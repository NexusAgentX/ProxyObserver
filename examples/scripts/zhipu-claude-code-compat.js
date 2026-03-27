// Zhipu Anthropic compatibility hook for Claude Code.
// Paste this into a listener rule's "Dynamic JS Script" field.

async function beforeRequest(context) {
  const betaHeader = context.headers["anthropic-beta"];
  if (betaHeader) {
    const blockedBetas = new Set([
      "interleaved-thinking-2025-05-14",
      "context-management-2025-06-27",
      "prompt-caching-scope-2026-01-05",
    ]);

    const nextBetas = betaHeader
      .split(",")
      .map(item => item.trim())
      .filter(Boolean)
      .filter(item => !blockedBetas.has(item));

    if (nextBetas.length > 0) {
      context.headers["anthropic-beta"] = nextBetas.join(",");
    } else {
      delete context.headers["anthropic-beta"];
    }
  }

  if (context.body?.text && context.body.contentType?.includes("application/json")) {
    try {
      const payload = JSON.parse(context.body.text);

      const stripCacheControl = value => {
        if (Array.isArray(value)) {
          return value.map(stripCacheControl);
        }

        if (value && typeof value === "object") {
          const next = {};
          for (const [key, child] of Object.entries(value)) {
            if (key === "cache_control") {
              continue;
            }
            next[key] = stripCacheControl(child);
          }
          return next;
        }

        return value;
      };

      context.body.text = JSON.stringify(stripCacheControl(payload));
    } catch {
      // Keep the original body when it is not valid JSON.
    }
  }

  return context;
}
