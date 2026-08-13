import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import versionHandler from "../api/version.js";
import healthHandler from "../api/health.js";
import { CALLPUT_VERSION } from "./version.js";

async function main() {
  const headers = new Map<string, string>();
  let body = "";
  const req = { method: "GET" };
  const res = {
    statusCode: 0,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    end(value?: string) {
      body = value ?? "";
    }
  };

  await versionHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(headers.get("cache-control"), "no-store");
  const payload = JSON.parse(body);
  assert.equal(payload.name, "callput-lite-agent-mcp");
  assert.equal(payload.version, CALLPUT_VERSION);
  assert.equal(payload.commit, null);

  const healthResult: { status?: number; body?: string } = {};
  await healthHandler({ method: "POST" }, {
    statusCode: 0,
    setHeader() {},
    end(value?: string) {
      healthResult.status = this.statusCode;
      healthResult.body = value ?? "";
    }
  });
  assert.equal(healthResult.status, 405, "health endpoint must be read-only");

  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.version, CALLPUT_VERSION, "package and runtime versions must match");

  const config = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url), "utf8"));
  const headerRoute = config.routes?.find((entry: { src?: string; continue?: boolean }) => entry.src === "/(.*)" && entry.continue === true);
  assert.ok(headerRoute?.headers, "vercel.json must define a continuing global security-header route");
  const headerMap = new Map(Object.entries(headerRoute.headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
  assert.equal(headerMap.get("x-content-type-options"), "nosniff");
  assert.equal(headerMap.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(headerMap.get("x-frame-options"), "SAMEORIGIN");
  assert.match(headerMap.get("permissions-policy") ?? "", /camera=\(\)/);
  assert.match(headerMap.get("strict-transport-security") ?? "", /max-age=/);

  const workflow = await readFile(new URL("../../.github/workflows/production-smoke.yml", import.meta.url), "utf8");
  assert.match(workflow, /cron:\s*['"]17 2 \* \* \*['"]/, "production smoke must run daily");
  assert.match(workflow, /npm run smoke:production/, "scheduled monitoring must execute the production smoke suite");
  assert.match(workflow, /workflow_dispatch:/, "production smoke must support manual verification");

  console.log("Release operations tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
