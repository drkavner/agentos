import { type Express } from "express";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

/** Pathname for routing checks (SPA fallback must not swallow `/api/*`). */
function requestPathname(req: { originalUrl?: string; url?: string }): string {
  const raw = (req.originalUrl ?? req.url ?? "").split("?")[0] || "";
  if (raw.startsWith("/")) return raw;
  try {
    return new URL(raw).pathname || "";
  } catch {
    return "";
  }
}

export async function setupVite(server: Server, app: Express) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server, path: "/vite-hmr" },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  // If Vite answers first, `/api/*` can incorrectly return `index.html` (200 + HTML). Skip Vite for API paths.
  app.use((req, res, next) => {
    if (requestPathname(req).startsWith("/api")) return next();
    return vite.middlewares(req, res, next);
  });

  app.use("/{*path}", async (req, res, next) => {
    // Unregistered /api/* must never fall through to the SPA (returns HTML → client JSON.parse errors).
    const pathname = requestPathname(req);
    if (pathname.startsWith("/api")) {
      res.status(404).type("application/json").json({
        code: "not_found",
        message: "No API route matched this path. Restart the dev server if you recently added routes.",
      });
      return;
    }

    const url = req.originalUrl;
    const rawPath = (req.originalUrl ?? req.url ?? "").split("?")[0] || "";
    if (rawPath.includes("/api/")) {
      console.warn(
        "[cortex] SPA fallback is serving HTML for a URL that looks like an API path. pathname=%s originalUrl=%s — check Vite path parsing or use `npm run dev` on one port.",
        pathname,
        req.originalUrl,
      );
    }

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
