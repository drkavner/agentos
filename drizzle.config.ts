import { defineConfig } from "drizzle-kit";
import path from "path";

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url:
      process.env.DB_PATH ||
      process.env.DATABASE_URL ||
      path.join(process.cwd(), "data.db"),
  },
});
