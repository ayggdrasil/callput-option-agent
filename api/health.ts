import { buildHealthReport } from "../src/health.js";

export default async function handler(req: any, res: any) {
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
}
