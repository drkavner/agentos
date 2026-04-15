import path from "path";

export function resolveSqliteDbPath() {
  const fromEnv = process.env.DB_PATH || process.env.DATABASE_URL;
  if (!fromEnv) return path.join(process.cwd(), "data.db");
  // Treat DATABASE_URL as a SQLite file path (local-only app).
  return path.isAbsolute(fromEnv)
    ? fromEnv
    : path.resolve(process.cwd(), fromEnv);
}

