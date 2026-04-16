import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import type { AddressInfo } from "net";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { removeDemoTenantIfPresent, seedDatabase } from "./seed";
import { ensureAgentDefinitionsCatalog } from "./agentDefinitionsCatalog";
import { repairAllTenantsMissingCeo } from "./ceoBootstrap";
import { isApiError, type ApiErrorResponse } from "./apiError";
import { startHeartbeatRunner } from "./heartbeatRunner";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Ensure DB schema is up-to-date before anything touches tables.
  migrate(db, { migrationsFolder: path.join(process.cwd(), "migrations") });

  // Safety: add parent_task_id if migration didn't run (e.g. existing DB).
  try { db.run(sql`ALTER TABLE tasks ADD COLUMN parent_task_id INTEGER`); } catch { /* already exists */ }

  // Agent Library catalog must exist even when full demo seed is disabled (e.g. production).
  ensureAgentDefinitionsCatalog();

  // Demo seed: opt-in with SEED=true. Without it, data persists across restarts.
  const shouldSeed = process.env.SEED === "true";
  if (shouldSeed) seedDatabase();

  await registerRoutes(httpServer, app);
  repairAllTenantsMissingCeo();
  startHeartbeatRunner();

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;

    if (status >= 500) {
      console.error("Internal Server Error:", err);
    } else if (isApiError(err)) {
      // Expected 4xx — don’t log as internal server failure
    } else {
      console.error("Request error:", err);
    }

    if (res.headersSent) {
      return next(err);
    }

    const body: ApiErrorResponse = isApiError(err)
      ? { code: err.code, message: err.message, details: err.details }
      : { code: "internal_error", message: err?.message || "Internal Server Error" };

    return res.status(status).json(body);
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const requestedPort = parseInt(process.env.PORT || "5000", 10);
  const host =
    process.env.HOST ||
    (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");

  const startServer = (port: number, attemptsLeft: number) => {
    httpServer.once("error", (err: any) => {
      if (
        err?.code === "EADDRINUSE" &&
        process.env.NODE_ENV !== "production" &&
        attemptsLeft > 0
      ) {
        // Dev should be predictable. If the requested port is taken, fail fast
        // so we don't silently hop to a random port (confusing for users).
        throw err;
      }
      throw err;
    });

    httpServer.listen({ port, host }, () => {
      const addr = httpServer.address() as AddressInfo | null;
      const actualPort = addr?.port ?? port;
      log(`serving on port ${actualPort}`);
    });
  };

  startServer(requestedPort, 0);
})();
