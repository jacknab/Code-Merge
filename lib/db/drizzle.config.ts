import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: [
    path.join(__dirname, "./src/schema/index.ts"),
    path.join(__dirname, "../../shared/schema.ts"),
    path.join(__dirname, "../../shared/models/auth.ts"),
    path.join(__dirname, "../../shared/schema/billing.ts"),
    path.join(__dirname, "../../shared/schema/intelligence.ts"),
    path.join(__dirname, "../../shared/schema/clients.ts"),
    path.join(__dirname, "../../shared/schema/api-keys.ts"),
    path.join(__dirname, "../../shared/schema/campaigns.ts"),
  ],
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
