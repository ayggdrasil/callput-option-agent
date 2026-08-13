import { CALLPUT_SERVER_NAME, CALLPUT_VERSION } from "../src/version.js";
import { buildHealthReport } from "../src/health.js";

export default async function handler(req: any, res: any) {
  const isHealth = String(req.url ?? "").split("?")[0] === "/api/health";
  if (isHealth) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, HEAD");
      res.end(JSON.stringify({ error: "Use GET" }));
      return;
    }
    const report = await buildHealthReport();
    res.statusCode = report.status === "ok" ? 200 : 503;
    res.end(req.method === "HEAD" ? undefined : JSON.stringify(report));
    return;
  }
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null;
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({ name: CALLPUT_SERVER_NAME, version: CALLPUT_VERSION, commit }));
}
