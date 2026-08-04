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

async function requestBody(req: NodeRequest): Promise<BodyInit | undefined> {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return undefined;
  if (req.body !== undefined) return typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  const chunks: Uint8Array[] = [];
  if (req[Symbol.asyncIterator]) {
    for await (const chunk of req as any) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
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
  const request = new Request(`${proto}://${host}${req.url ?? "/"}`, {
    method: req.method ?? "GET",
    headers,
    body: await requestBody(req)
  });
  const response = await handler(request);
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(new Uint8Array(await response.arrayBuffer()));
}
