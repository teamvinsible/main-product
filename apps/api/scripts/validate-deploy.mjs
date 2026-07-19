import { readFileSync } from "node:fs";

const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
if (config.includes("REPLACE_WITH_D1_DATABASE_ID")) {
  console.error("Deployment stopped: replace REPLACE_WITH_D1_DATABASE_ID in apps/api/wrangler.jsonc with the real D1 database ID.");
  process.exit(1);
}
if (/"DEV_AUTH_BYPASS"\s*:\s*"true"/.test(config)) {
  console.error("Deployment stopped: DEV_AUTH_BYPASS must not be enabled in wrangler.jsonc.");
  process.exit(1);
}
