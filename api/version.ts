import { CALLPUT_SERVER_NAME, CALLPUT_VERSION } from "../src/version.js";

export default async function handler(_req: any, res: any) {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null;
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({ name: CALLPUT_SERVER_NAME, version: CALLPUT_VERSION, commit }));
}

