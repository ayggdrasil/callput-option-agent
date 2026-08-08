type NodeRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | string>;
};

type NodeResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: Uint8Array | string): void;
};

const MAX_ADAPTER_BODY_BYTES = 64 * 1024;

class RequestBodyTooLargeError extends Error {}

async function requestBody(req: NodeRequest, maxBytes: number): Promise<BodyInit | undefined> {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return undefined;
  const declaredValue = req.headers["content-length"];
  const declared = Number(Array.isArray(declaredValue) ? declaredValue[0] : declaredValue ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new RequestBodyTooLargeError("Request body is too large");
  if (req.body !== undefined) {
    const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(body) > maxBytes) throw new RequestBodyTooLargeError("Request body is too large");
    return body;
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  if (req[Symbol.asyncIterator]) {
    for await (const chunk of req as any) {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      totalBytes += bytes.byteLength;
      if (totalBytes > maxBytes) throw new RequestBodyTooLargeError("Request body is too large");
      chunks.push(bytes);
    }
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

export async function runVercelHandler(
  req: NodeRequest,
  res: NodeResponse,
  handler: (request: Request) => Promise<Response>
): Promise<void> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "mcp.callput.app";
  const proto = headers.get("x-forwarded-proto") ?? "https";
  let request: Request;
  try {
    request = new Request(`${proto}://${host}${req.url ?? "/"}`, {
      method: req.method ?? "GET",
      headers,
      body: await requestBody(req, MAX_ADAPTER_BODY_BYTES)
    });
  } catch (error) {
    if (!(error instanceof RequestBodyTooLargeError)) throw error;
    res.statusCode = 413;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: error.message }));
    return;
  }
  const response = await handler(request);
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(new Uint8Array(await response.arrayBuffer()));
}
