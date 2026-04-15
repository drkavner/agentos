import express, { type Express } from "express";
import fs from "fs";
import path from "path";

function requestPathname(req: { originalUrl?: string; url?: string }): string {
  const raw = (req.originalUrl ?? req.url ?? "").split("?")[0] || "";
  if (raw.startsWith("/")) return raw;
  try {
    return new URL(raw).pathname || "";
  } catch {
    return "";
  }
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (req, res) => {
    const pathname = requestPathname(req);
    if (pathname.startsWith("/api")) {
      res.status(404).type("application/json").json({
        code: "not_found",
        message: "No API route matched this path.",
      });
      return;
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
