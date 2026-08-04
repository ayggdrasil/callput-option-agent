const DEFAULT_HOSTS = new Set(["mcp.callput.app", "localhost", "127.0.0.1"]);

export function isAllowedHttpHost(request: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  const host = new URL(request.url).hostname.toLowerCase();
  const configured = (env.CALLPUT_ALLOWED_HOSTS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  return DEFAULT_HOSTS.has(host) || host.endsWith(".vercel.app") || configured.includes(host);
}

export async function bodyWithinLimit(request: Request, maxBytes: number): Promise<boolean> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return false;
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return true;
  return (await request.clone().arrayBuffer()).byteLength <= maxBytes;
}
