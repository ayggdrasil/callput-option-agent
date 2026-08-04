import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createCallputMcpServer } from "./index.js";
import { bodyWithinLimit, isAllowedHttpHost } from "./httpSecurity.js";

const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_ORIGINS = ["https://bankr.bot", "https://mcp.callput.app"];

function corsHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "content-type, mcp-protocol-version, mcp-session-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function allowedOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set([
    ...DEFAULT_ORIGINS,
    ...(env.CALLPUT_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean)
  ]);
}

function jsonError(status: number, message: string, origin: string | null): Response {
  return Response.json({ error: message }, { status, headers: corsHeaders(origin) });
}

export async function handleMcpHttpRequest(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (!isAllowedHttpHost(request)) return jsonError(421, "Host is not allowed", null);
  if (origin && !allowedOrigins().has(origin)) return jsonError(403, "Origin is not allowed", null);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return jsonError(405, "Only POST is supported", origin);

  if (!(await bodyWithinLimit(request, MAX_BODY_BYTES))) {
    return jsonError(413, "Request body is too large", origin);
  }

  const server = createCallputMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return jsonError(500, message, origin);
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}
