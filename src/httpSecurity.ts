const DEFAULT_HOSTS = new Set(["mcp.callput.app", "localhost", "127.0.0.1"]);
const DEFAULT_REQUESTS_PER_MINUTE = 60;
const MAX_RATE_LIMIT_BUCKETS = 5_000;
const rateLimitBuckets = new Map<string, { count: number; windowStartedAt: number }>();

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

function clientAddress(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || request.headers.get("cf-connecting-ip")?.trim()
    || "unknown";
}

export function rateLimitRequest(
  request: Request,
  scope: string,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now()
): { allowed: boolean; limit: number; remaining: number; retryAfterSeconds: number } {
  const configured = Number(env.CALLPUT_RATE_LIMIT_PER_MINUTE ?? DEFAULT_REQUESTS_PER_MINUTE);
  const limit = Number.isSafeInteger(configured) && configured > 0 ? Math.min(configured, 10_000) : DEFAULT_REQUESTS_PER_MINUTE;
  const windowMs = 60_000;
  const key = `${scope}:${clientAddress(request)}`;
  const current = rateLimitBuckets.get(key);
  const bucket = !current || now - current.windowStartedAt >= windowMs
    ? { count: 0, windowStartedAt: now }
    : current;
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  if (rateLimitBuckets.size > MAX_RATE_LIMIT_BUCKETS) {
    for (const [candidate, value] of rateLimitBuckets) {
      if (now - value.windowStartedAt >= windowMs) rateLimitBuckets.delete(candidate);
      if (rateLimitBuckets.size <= MAX_RATE_LIMIT_BUCKETS) break;
    }
  }

  return {
    allowed: bucket.count <= limit,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.windowStartedAt + windowMs - now) / 1_000))
  };
}
