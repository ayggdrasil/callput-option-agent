import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { ethers } from "ethers";
import { CONFIG, ERC20_ABI, OPTIONS_TOKEN_ABI, POSITION_MANAGER_ABI } from "./config.js";
import {
  closePosition,
  findRequestKeyByIntentFingerprint,
  getMarketSnapshot,
  getPortfolioSummary,
  getRequestKeyFromTx,
  getSettledPnl,
  listPositionsByWallet,
  transactionIntentFingerprint
} from "./core.js";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const FOREIGN_ACCOUNT = "0x2222222222222222222222222222222222222222";
const NOW_SEC = Math.floor(Date.now() / 1000);

function requestKey(byte: string): string {
  return `0x${byte.repeat(64)}`;
}

function spreadTokenId(assetIndex: number, expirySec: number): string {
  const nakedStrike = 100 * 8 + 4;
  const pairStrike = 110 * 8 + 4;
  return (
    (BigInt(assetIndex) << 240n) |
    (BigInt(expirySec) << 200n) |
    (0x56n << 192n) |
    (BigInt(nakedStrike) << 144n) |
    (BigInt(pairStrike) << 96n)
  ).toString();
}

function freshMarketPayload() {
  return {
    lastUpdatedAt: new Date().toISOString(),
    timestamp: Date.now(),
    data: { market: {}, spotIndices: {} }
  };
}

type RpcState = {
  eventFromBlocks: number[];
  eventLogs: any[];
  openRequestCalls: string[];
  maxOpenRequestsPerBatch: number;
  executionFee: bigint;
  receipts: Record<string, any>;
  transactions: Record<string, any>;
};

async function startRpcServer(): Promise<{ server: http.Server; url: string; state: RpcState }> {
  const pm = new ethers.Interface(POSITION_MANAGER_ABI);
  const erc20 = new ethers.Interface(ERC20_ABI);
  const optionToken = new ethers.Interface(OPTIONS_TOKEN_ABI);
  const state: RpcState = {
    eventFromBlocks: [],
    eventLogs: [],
    openRequestCalls: [],
    maxOpenRequestsPerBatch: 0,
    executionFee: CONFIG.EXECUTION_FEE_FALLBACK,
    receipts: {},
    transactions: {}
  };

  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const incoming = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const requests = Array.isArray(incoming) ? incoming : [incoming];
    const openCallsInBatch = requests.filter((rpc: any) => {
      const data = String(rpc.params?.[0]?.data ?? "");
      return data.startsWith(pm.getFunction("openPositionRequests")!.selector);
    }).length;
    state.maxOpenRequestsPerBatch = Math.max(state.maxOpenRequestsPerBatch, openCallsInBatch);

    const replies = requests.map((rpc: any) => {
      let result: unknown;
      if (rpc.method === "eth_chainId") {
        result = ethers.toQuantity(CONFIG.CHAIN_ID);
      } else if (rpc.method === "eth_blockNumber") {
        result = ethers.toQuantity(100_000);
      } else if (rpc.method === "eth_getLogs") {
        state.eventFromBlocks.push(Number(rpc.params?.[0]?.fromBlock));
        result = state.eventLogs;
      } else if (rpc.method === "eth_getTransactionReceipt") {
        result = state.receipts[String(rpc.params?.[0]).toLowerCase()] ?? null;
      } else if (rpc.method === "eth_getTransactionByHash") {
        result = state.transactions[String(rpc.params?.[0]).toLowerCase()] ?? null;
      } else if (rpc.method === "eth_call") {
        const data = String(rpc.params?.[0]?.data ?? "");
        if (data.startsWith(optionToken.getFunction("tokensByAccount")!.selector)) {
          result = optionToken.encodeFunctionResult("tokensByAccount", [[]]);
        } else if (data.startsWith(optionToken.getFunction("balanceOfBatch")!.selector)) {
          result = optionToken.encodeFunctionResult("balanceOfBatch", [[100_000_000n]]);
        } else if (data.startsWith(erc20.getFunction("balanceOf")!.selector)) {
          result = erc20.encodeFunctionResult("balanceOf", [1_000_000n]);
        } else if (data.startsWith(pm.getFunction("executionFee")!.selector)) {
          result = pm.encodeFunctionResult("executionFee", [state.executionFee]);
        } else if (data.startsWith(pm.getFunction("openPositionRequests")!.selector)) {
          const key = String(pm.decodeFunctionData("openPositionRequests", data)[0]).toLowerCase();
          state.openRequestCalls.push(key);
          const owner = key === requestKey("c") ? FOREIGN_ACCOUNT : ACCOUNT;
          result = pm.encodeFunctionResult("openPositionRequests", [
            owner,
            1,
            NOW_SEC + 3_600,
            0,
            1,
            1_000_000,
            1,
            false,
            NOW_SEC,
            2,
            1,
            1,
            NOW_SEC,
            0
          ]);
        } else {
          throw new Error(`Unexpected eth_call selector: ${data.slice(0, 10)}`);
        }
      } else {
        throw new Error(`Unexpected RPC method: ${rpc.method}`);
      }
      return { jsonrpc: "2.0", id: rpc.id, result };
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(Array.isArray(incoming) ? replies : replies[0]));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("RPC test server did not bind");
  return { server, url: `http://127.0.0.1:${address.port}`, state };
}

function reconciliationArtifacts(input: {
  txHash: string;
  key: string;
  from?: string;
  to?: string;
  logAddress?: string;
  status?: number;
  data?: string;
  value?: bigint;
}) {
  const pm = new ethers.Interface(POSITION_MANAGER_ABI);
  const from = input.from ?? ACCOUNT;
  const to = input.to ?? CONFIG.CONTRACTS.POSITION_MANAGER;
  const data = input.data ?? "0x1234";
  const value = input.value ?? 60_000_000_000_000n;
  const blockHash = `0x${"44".repeat(32)}`;
  const encoded = pm.encodeEventLog(pm.getEvent("GenerateRequestKey")!, [ACCOUNT, input.key, true]);
  const eventLog = {
    address: input.logAddress ?? CONFIG.CONTRACTS.POSITION_MANAGER,
    topics: encoded.topics,
    data: encoded.data,
    blockNumber: ethers.toQuantity(100_000),
    transactionHash: input.txHash,
    transactionIndex: "0x0",
    blockHash,
    logIndex: "0x0",
    removed: false
  };
  const transaction = {
    hash: input.txHash,
    blockHash,
    blockNumber: ethers.toQuantity(100_000),
    transactionIndex: "0x0",
    from,
    to,
    gas: "0x5208",
    gasPrice: "0x1",
    input: data,
    nonce: "0x0",
    value: ethers.toQuantity(value),
    type: "0x0",
    chainId: ethers.toQuantity(CONFIG.CHAIN_ID),
    v: "0x1b",
    r: `0x${"11".repeat(32)}`,
    s: `0x${"22".repeat(32)}`
  };
  const receipt = {
    to,
    from,
    contractAddress: null,
    transactionIndex: "0x0",
    gasUsed: "0x5208",
    logsBloom: `0x${"00".repeat(256)}`,
    blockHash,
    transactionHash: input.txHash,
    logs: [eventLog],
    blockNumber: ethers.toQuantity(100_000),
    cumulativeGasUsed: "0x5208",
    effectiveGasPrice: "0x1",
    status: ethers.toQuantity(input.status ?? 1),
    type: "0x0"
  };
  return { eventLog, transaction, receipt, data, value };
}

async function startHangingServer(): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer((_request, _response) => {
    // Intentionally never respond; the RPC client must enforce its own deadline.
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("hanging RPC server did not bind");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

function guarded<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(message)), milliseconds))
  ]);
}

test("core public-launch abuse controls", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalRpcUrl = CONFIG.RPC_URL;
  const originalOptionsTokens = Object.fromEntries(
    Object.entries(CONFIG.UNDERLYINGS).map(([asset, config]) => [asset, config.optionsToken])
  );
  const envNames = [
    "CALLPUT_MAX_EVENT_LOOKBACK_BLOCKS",
    "CALLPUT_MAX_INTENT_RECONCILE_LOOKBACK_BLOCKS",
    "CALLPUT_MARKET_TIMEOUT_MS",
    "CALLPUT_RPC_TIMEOUT_MS",
    "CALLPUT_MAX_PORTFOLIO_REQUEST_KEYS",
    "CALLPUT_PORTFOLIO_REQUEST_CONCURRENCY",
    "CALLPUT_MAX_EXECUTION_FEE_WEI"
  ] as const;
  const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const rpc = await startRpcServer();
  (CONFIG as any).RPC_URL = rpc.url;
  for (const config of Object.values(CONFIG.UNDERLYINGS)) {
    (config as any).optionsToken = config.optionsToken.toLowerCase();
  }

  t.after(async () => {
    globalThis.fetch = originalFetch;
    (CONFIG as any).RPC_URL = originalRpcUrl;
    for (const [asset, optionsToken] of Object.entries(originalOptionsTokens)) {
      (CONFIG.UNDERLYINGS as any)[asset].optionsToken = optionsToken;
    }
    for (const name of envNames) {
      const value = originalEnv[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await new Promise<void>((resolve, reject) => rpc.server.close((error) => error ? reject(error) : resolve()));
  });

  await t.test("clamps caller-supplied event lookback for both history queries", async () => {
    process.env.CALLPUT_MAX_EVENT_LOOKBACK_BLOCKS = "100";
    await listPositionsByWallet({ address: ACCOUNT, fromBlock: 0 });
    await getSettledPnl({ address: ACCOUNT, fromBlock: 0 });
    assert.deepEqual(rpc.state.eventFromBlocks.slice(-2), [99_900, 99_900]);
  });

  await t.test("deduplicates, bounds, and wallet-scopes portfolio request keys", async () => {
    process.env.CALLPUT_MAX_PORTFOLIO_REQUEST_KEYS = "4";
    process.env.CALLPUT_PORTFOLIO_REQUEST_CONCURRENCY = "2";
    globalThis.fetch = async () => new Response(JSON.stringify(freshMarketPayload()));
    rpc.state.openRequestCalls.length = 0;
    rpc.state.maxOpenRequestsPerBatch = 0;

    const result = await getPortfolioSummary({
      address: ACCOUNT,
      requestKeys: [requestKey("a"), requestKey("a").toUpperCase().replace("0X", "0x"), requestKey("b"), requestKey("c")]
    });

    assert.equal(rpc.state.openRequestCalls.length, 3);
    assert.equal(new Set(rpc.state.openRequestCalls).size, 3);
    assert.ok(rpc.state.maxOpenRequestsPerBatch <= 2);
    assert.equal(result.tracked_request_keys, 3);
    assert.equal(result.ignored_foreign_request_keys, 1);

    process.env.CALLPUT_MAX_PORTFOLIO_REQUEST_KEYS = "2";
    await assert.rejects(() => getPortfolioSummary({
      address: ACCOUNT,
      requestKeys: [requestKey("a"), requestKey("b"), requestKey("c")]
    }), /maximum.*request keys/i);
  });

  await t.test("aborts market data fetches at the configured deadline", async () => {
    process.env.CALLPUT_MARKET_TIMEOUT_MS = "30";
    globalThis.fetch = async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
    await assert.rejects(
      () => guarded(getMarketSnapshot(true), 250, "market guard elapsed"),
      /MARKET_DATA_TIMEOUT/i
    );
  });

  await t.test("bounds stalled JSON-RPC requests", async () => {
    const hanging = await startHangingServer();
    process.env.CALLPUT_RPC_TIMEOUT_MS = "40";
    (CONFIG as any).RPC_URL = hanging.url;
    try {
      await assert.rejects(
        () => guarded(getRequestKeyFromTx(ethers.ZeroHash), 300, "RPC guard elapsed"),
        /timeout/i
      );
    } finally {
      (CONFIG as any).RPC_URL = rpc.url;
      hanging.server.closeAllConnections();
      await new Promise<void>((resolve) => hanging.server.close(() => resolve()));
    }
  });

  await t.test("matches only the exact successful PositionManager transaction intent", async () => {
    const exactHash = `0x${"aa".repeat(32)}`;
    const otherHash = `0x${"bb".repeat(32)}`;
    const exact = reconciliationArtifacts({ txHash: exactHash, key: requestKey("d"), data: "0x1234" });
    const other = reconciliationArtifacts({ txHash: otherHash, key: requestKey("e"), data: "0x5678" });
    rpc.state.eventLogs = [exact.eventLog, other.eventLog];
    rpc.state.transactions[exactHash] = exact.transaction;
    rpc.state.transactions[otherHash] = other.transaction;
    rpc.state.receipts[exactHash] = exact.receipt;
    rpc.state.receipts[otherHash] = other.receipt;

    const fingerprint = transactionIntentFingerprint({
      chainId: CONFIG.CHAIN_ID,
      from: ACCOUNT,
      to: CONFIG.CONTRACTS.POSITION_MANAGER,
      value: exact.value,
      data: exact.data
    });
    const matched = await findRequestKeyByIntentFingerprint({
      address: ACCOUNT,
      intentFingerprint: fingerprint
    });

    assert.equal(matched?.request_key, requestKey("d"));
    assert.equal(matched?.tx_hash, exactHash);
    assert.equal(rpc.state.eventFromBlocks.at(-1), 98_200, "default reconciliation scan must stay recent");
  });

  await t.test("rejects failed, foreign, wrong-destination, and spoofed-log candidates", async () => {
    const cases = [
      reconciliationArtifacts({ txHash: `0x${"c1".repeat(32)}`, key: requestKey("1"), status: 0 }),
      reconciliationArtifacts({ txHash: `0x${"c2".repeat(32)}`, key: requestKey("2"), from: FOREIGN_ACCOUNT }),
      reconciliationArtifacts({ txHash: `0x${"c3".repeat(32)}`, key: requestKey("3"), to: FOREIGN_ACCOUNT }),
      reconciliationArtifacts({ txHash: `0x${"c4".repeat(32)}`, key: requestKey("4"), logAddress: FOREIGN_ACCOUNT })
    ];
    for (const candidate of cases) {
      const hash = candidate.transaction.hash.toLowerCase();
      rpc.state.eventLogs = [candidate.eventLog];
      rpc.state.transactions = { [hash]: candidate.transaction };
      rpc.state.receipts = { [hash]: candidate.receipt };
      const fingerprint = transactionIntentFingerprint({
        chainId: CONFIG.CHAIN_ID,
        from: ACCOUNT,
        to: CONFIG.CONTRACTS.POSITION_MANAGER,
        value: candidate.value,
        data: candidate.data
      });
      assert.equal(await findRequestKeyByIntentFingerprint({ address: ACCOUNT, intentFingerprint: fingerprint }), null);
    }
  });

  await t.test("hardens tx-hash extraction against failed or non-PositionManager provenance", async () => {
    const bad = reconciliationArtifacts({
      txHash: `0x${"dd".repeat(32)}`,
      key: requestKey("f"),
      logAddress: FOREIGN_ACCOUNT
    });
    rpc.state.transactions[bad.transaction.hash.toLowerCase()] = bad.transaction;
    rpc.state.receipts[bad.transaction.hash.toLowerCase()] = bad.receipt;
    const result = await getRequestKeyFromTx(bad.transaction.hash, ACCOUNT);
    assert.ok("error" in result, "a spoofed GenerateRequestKey log must not be accepted");
  });

  await t.test("rejects a contract execution fee above the configured native-value ceiling", async () => {
    process.env.CALLPUT_MAX_EXECUTION_FEE_WEI = "100";
    rpc.state.executionFee = 101n;
    await assert.rejects(() => closePosition({
      underlyingAsset: "BTC",
      fromAddress: ACCOUNT,
      optionTokenId: spreadTokenId(1, NOW_SEC + 3_600),
      size: 1,
      minAmountOutRaw: "1",
      minOutWhenSwapRaw: "1"
    }), /EXECUTION_FEE_LIMIT/);
  });
});
