const origin = (process.env.CALLPUT_PRODUCTION_URL || "https://mcp.callput.app").replace(/\/$/, "");
const rpcUrl = process.env.CALLPUT_LOAD_RPC_URL || "https://base-rpc.publicnode.com";
const wallet = process.env.CALLPUT_LOAD_WALLET || "0x27D94004169aDFb965a6bC1aDF1606CB6d82dfB4";
const total = readPositiveInteger("CALLPUT_LOAD_TOTAL", 100);
const concurrency = readPositiveInteger("CALLPUT_LOAD_CONCURRENCY", 5);
const timeoutMs = readPositiveInteger("CALLPUT_LOAD_TIMEOUT_MS", 30_000);

type LoadResult = {
  index: number;
  ok: boolean;
  stage: "scan" | "prepare" | "simulate";
  elapsed_ms: number;
  error?: string;
};

function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

async function post(path: string, body: unknown) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${text.slice(0, 240)}`);
  return parsed;
}

async function runCycle(index: number): Promise<LoadResult> {
  const startedAt = Date.now();
  let stage: LoadResult["stage"] = "scan";
  try {
    const scan = await post("/api/bankr/scan", {
      underlying_asset: "TSLA",
      bias: "bullish",
      max_results: 1
    });
    const candidate = scan.candidates?.[0];
    if (!candidate) throw new Error("scan returned no candidate");

    stage = "prepare";
    const prepared = await post("/api/bankr/prepare", {
      strategy: candidate.strategy,
      from_address: wallet,
      long_leg_id: candidate.long_leg_id,
      short_leg_id: candidate.short_leg_id,
      size: 0.01,
      min_fill_ratio: 0.78
    });
    const tx = prepared.unsigned_tx;
    if (!tx?.to || !tx?.data) throw new Error("prepare returned no unsigned transaction");

    stage = "simulate";
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: index,
        method: "eth_call",
        params: [{
          from: wallet,
          to: tx.to,
          data: tx.data,
          value: `0x${BigInt(tx.value || "0").toString(16)}`
        }, "latest"]
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const result = await response.json() as any;
    if (!response.ok || result.error) throw new Error(`Base eth_call failed: ${response.status} ${JSON.stringify(result.error)}`);
    return { index, ok: true, stage, elapsed_ms: Date.now() - startedAt };
  } catch (error) {
    return {
      index,
      ok: false,
      stage,
      elapsed_ms: Date.now() - startedAt,
      error: String((error as Error)?.message || error)
    };
  }
}

async function main() {
  let next = 0;
  const results: LoadResult[] = [];
  async function worker() {
    while (next < total) {
      const index = next++;
      const result = await runCycle(index);
      results.push(result);
      if (!result.ok) console.error(`FAIL ${index} ${result.stage} ${result.elapsed_ms}ms ${result.error}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  const passed = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);
  const timings = results.map((result) => result.elapsed_ms).sort((left, right) => left - right);
  const summary = {
    origin,
    total,
    passed: passed.length,
    failed: failed.length,
    average_ms: Math.round(timings.reduce((sum, value) => sum + value, 0) / timings.length),
    p95_ms: timings[Math.min(timings.length - 1, Math.floor(timings.length * 0.95))],
    maximum_ms: timings.at(-1),
    failures: failed
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
