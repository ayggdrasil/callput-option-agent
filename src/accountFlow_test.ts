import { test } from "node:test";
import assert from "node:assert/strict";
import { flowFixture } from "./accountFlowFixtures.js";
import { productionWorkflowPorts } from "./accountWorkflow.js";
for (const [strategy, mask, isBuy, isCall, asset, assetIndex, minSize] of [
  ["BuyCallSpread", "32", true, true, "ETH", "2", "78000000000000"],
  ["SellCallSpread", "64", false, true, "TSLA", "3", "78000000000000"],
  ["BuyPutSpread", "128", true, false, "BTC", "1", "7800"],
  ["SellPutSpread", "256", false, false, "TSLA", "3", "78000000000000"],
] as const) {
  test(`sponsored ${strategy} uses the selected grant, order and position`, async (t) => {
    const f = await flowFixture(strategy, asset);
    t.after(f.cleanup);
    const grant = await f.engine.prepare(f.token, "register", {});
    const { message } = JSON.parse(grant.wallet_request.params[1]);
    assert.equal(message.strategies, mask);
    assert.deepEqual(message.underlyings, [assetIndex]);
    assert.equal(message.maxOpens, "1");
    assert.match(grant.summary, new RegExp(strategy));
    await f.engine.submit(f.token, grant.action_id, await f.sign(grant));
    assert.equal((await f.engine.status(f.token)).state, "session_ready");

    const quote = f.ports.quote!;
    f.ports.quote = async (...args) => ({
      ...await quote(...args),
      strategy: isCall ? "BuyPutSpread" : "BuyCallSpread",
    });
    await assert.rejects(f.engine.prepare(f.token, "open", {}), /invalid_quote/);
    f.ports.quote = quote;
    const open = await f.engine.prepare(f.token, "open", {});
    const { params } = JSON.parse(open.wallet_request.params[1]).message;
    assert.deepEqual(params.isBuys, [isBuy, !isBuy, false, false]);
    assert.deepEqual(params.isCalls, [isCall, isCall, false, false]);
    assert.equal(params.underlyingAssetIndex, assetIndex);
    assert.equal(params.minSize, minSize);
    assert.equal(params.amountIn, "1600");
    assert.equal(open.fee_payer, "protocol_sponsor");
    assert.match(open.summary, new RegExp(strategy));
    await f.engine.submit(f.token, open.action_id, await f.sign(open));
    const completed = await f.engine.status(f.token);
    assert.equal(completed.state, "trade_executed");
    assert.equal(completed.actions.at(-1).evidence.position_verified, true);
    const close = await f.engine.prepare(f.token, "close", {
      option_token_id: "291", size_raw: "1", min_amount_out_raw: "1",
    });
    assert.equal(JSON.parse(close.wallet_request.params[1]).message.params.underlyingAssetIndex, assetIndex);
  });
}
test("a lost login challenge resumes the same preparing action without submitting anything", async (t) => {
  const f = await flowFixture();
  t.after(f.cleanup);
  f.requests.length = 0;
  f.flags.failLoginChallenge = true;
  await assert.rejects(f.engine.prepare(f.token, "login", {}), /relay_outcome_unknown/);
  const interrupted = await f.engine.status(f.token);
  const action = interrupted.actions.at(-1);
  assert.equal(action.state, "preparing");
  assert.deepEqual(interrupted.next_actions[0].arguments, {
    workflow_id: f.token, step: "login", input: {},
  });
  f.flags.failLoginChallenge = false;
  const resumed = await f.engine.prepare(f.token, "login", {});
  assert.equal(resumed.action_id, action.action_id);
  assert.equal(resumed.wallet_request.method, "personal_sign");
  assert.equal(resumed.blocked_reason, null);
  assert.deepEqual(f.requests.map((request) => request.path), [
    "/v1/auth/challenge", "/v1/auth/challenge",
  ]);
});
test("login preparation identifies a DNS failure when the relay connection never starts", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
  });
  await assert.rejects(
    productionWorkflowPorts().relay({ network: "robinhood" }, "/v1/auth/challenge", {}),
    /relay_dns_unavailable/,
  );
});
test("relay transport uses the consolidated host and sends only its own chain cookies", async (t) => {
  const calls: [string, RequestInit][] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("set-cookie", "__Host-callput-owner-challenge-4663=fresh; Secure; Path=/");
    headers.append("set-cookie", "__Host-callput-owner-challenge-91342=foreign; Secure; Path=/");
    return new Response("{}", { headers });
  });
  const state = { network: "robinhood", cookies: {
    "__Host-callput-owner": "legacy",
    "__Host-callput-owner-91342": "foreign",
    "__Host-callput-owner-4663": "valid",
  } };
  const relay = productionWorkflowPorts().relay;
  await relay(state, "/v1/auth/challenge", {});
  await relay(state, "/v1/auth/verify", {});
  assert.equal(calls[0][0], "https://app.callput.app/relay/robinhoodchain/v1/auth/challenge");
  const headers = new Headers(calls[1][1].headers);
  assert.equal(headers.get("origin"), "https://app.callput.app");
  assert.equal(headers.get("cookie"), "__Host-callput-owner-4663=valid; __Host-callput-owner-challenge-4663=fresh");
  assert.equal(Object.hasOwn(state.cookies, "__Host-callput-owner-challenge-91342"), false);
});
test("a workflow authenticated on a retired relay prepares a fresh app-origin login", async (t) => {
  const f = await flowFixture();
  t.after(f.cleanup);
  await f.store.update(f.token, async (s) => {
    delete s.authRelayBase;
    const action = s.actions[0];
    action.state = "prepared";
    action.challenge.message = action.challenge.message.replaceAll("app.callput.app", "robin.callput.app");
  });
  await assert.rejects(f.engine.prepare(f.token, "register", {}), /unresolved_action/);
  const login = await f.engine.prepare(f.token, "login", {});
  assert.match(login.message, /^https:\/\/app\.callput\.app /);
  assert.notEqual(login.action_id, login.actions[0].action_id);
  assert.equal(login.actions[0].state, "cancelled");
});
test("existing wallet signs bounded grant, device opens, keeper and position confirm, and close uses canonical token_id", async () => {
  const f = await flowFixture();
  try {
    const grant = await f.engine.prepare(f.token, "register", {}),
      typed = JSON.parse(grant.wallet_request.params[1]);
    assert.equal(typed.message.maxAmount, "100000");
    assert.equal(typed.message.signer, f.device.address.toLowerCase());
    await f.engine.submit(f.token, grant.action_id, await f.sign(grant));
    assert.equal((await f.engine.status(f.token)).state, "session_ready");
    const open = await f.engine.prepare(f.token, "open", {}),
      result = await f.sign(open);
    await f.engine.submit(f.token, open.action_id, result);
    const completed = await f.engine.status(f.token);
    assert.equal(completed.state, "trade_executed");
    assert.equal(completed.actions.at(-1).evidence.position_verified, true);
    await f.engine.submit(f.token, open.action_id, result);
    assert.equal(f.requests.filter((r) => r.path === "/v1/trades").length, 1);
    await assert.rejects(
      f.engine.submit(f.token, open.action_id, {
        signature: "0x" + "1".repeat(130),
      }),
      /preserved/,
    );
    const close = await f.engine.prepare(f.token, "close", {
      option_token_id: "291",
      size_raw: "100000000000000",
      min_amount_out_raw: "1",
    });
    await f.engine.submit(f.token, close.action_id, await f.sign(close));
    assert.equal(
      (await f.engine.status(f.token)).actions.at(-1).state,
      "executed",
    );
    const publicState = JSON.stringify(await f.engine.status(f.token));
    assert.ok(!publicState.includes(result.signature));
    assert.ok(!publicState.includes(f.device.privateKey));
  } finally {
    await f.cleanup();
  }
});
test("lost grant preparation resumes exactly the same reserved grant and expiry", async () => {
  const f = await flowFixture();
  try {
    f.flags.failPreparation = true;
    await assert.rejects(f.engine.prepare(f.token, "register", {}), /unknown/);
    const saved = await f.store.read(f.token);
    const resumed = await f.engine.prepare(f.token, "register", {});
    assert.deepEqual(
      JSON.parse(resumed.wallet_request.params[1]).message,
      saved.grant,
    );
    assert.equal(resumed.action_id, saved.grantId);
    assert.equal(
      f.requests.filter((r) => r.path === "/v1/reservations")[0].body.requestId,
      f.requests.filter((r) => r.path === "/v1/reservations")[1].body.requestId,
    );
  } finally {
    await f.cleanup();
  }
});
test("lost sponsored submit response observes existing order without creating another authorization", async () => {
  const f = await flowFixture();
  try {
    const g = await f.engine.prepare(f.token, "register", {});
    await f.engine.submit(f.token, g.action_id, await f.sign(g));
    await f.engine.status(f.token);
    const a = await f.engine.prepare(f.token, "open", {});
    f.flags.dropTrade = true;
    await assert.rejects(
      f.engine.submit(f.token, a.action_id, await f.sign(a)),
      /unknown/,
    );
    f.flags.unavailableStatus = true;
    assert.equal((await f.engine.status(f.token)).state, "observing");
    await assert.rejects(
      f.engine.prepare(f.token, "open", { size: "0.01" }),
      /unresolved/,
    );
    f.flags.unavailableStatus = false;
    assert.equal((await f.engine.status(f.token)).state, "trade_executed");
    assert.equal(f.requests.filter((r) => r.path === "/v1/trades").length, 1);
    await assert.rejects(f.engine.recover(f.token), /signed_order/);
  } finally {
    await f.cleanup();
  }
});
test("wallet prompt begins once and explicit retry preserves the original request", async () => {
  const f = await flowFixture();
  try {
    const a = await f.engine.prepare(f.token, "register", {});
    assert.equal(
      (await f.engine.begin(f.token, a.action_id)).wallet_request_may_execute,
      true,
    );
    assert.equal(
      (await f.engine.begin(f.token, a.action_id)).wallet_request_may_execute,
      false,
    );
    const retry = await f.engine.retryWallet(f.token, a.action_id);
    assert.deepEqual(retry.wallet_request, a.wallet_request);
    assert.equal(
      (await f.engine.pending(f.token)).pending_action!.action_id,
      a.action_id,
    );
  } finally {
    await f.cleanup();
  }
});
test("workflow locks deny concurrent mutation and unknown storage never resets a budget", async () => {
  const f = await flowFixture();
  try {
    let release!: () => void, entered!: () => void;
    const ready = new Promise<void>((r) => {
        entered = r;
      }),
      wait = new Promise<void>((r) => {
        release = r;
      });
    const first = f.store.update(f.token, async () => {
      entered();
      await wait;
    });
    await ready;
    await assert.rejects(
      f.store.update(f.token, async () => {}),
      /busy/,
    );
    release();
    await first;
  } finally {
    await f.cleanup();
  }
});
test("unknown login can obtain a fresh SIWE challenge without changing a saved trading action", async () => {
  const f = await flowFixture();
  try {
    await f.store.update(f.token, async (s) => {
      s.authUntil = "2000-01-01T00:00:00Z";
      const old = s.actions[0];
      old.state = "unknown";
    });
    await f.engine.status(f.token);
    const action = await f.engine.prepare(f.token, "login", {}),
      saved = await f.store.read(f.token);
    assert.notEqual(action.action_id, saved.actions[0].id);
    assert.equal(saved.actions[0].state, "cancelled");
    assert.equal(action.wallet_request.method, "personal_sign");
  } finally {
    await f.cleanup();
  }
});
test("owner revoke is selected before a prepared trade so emergency exit stays accessible", async () => {
  const f = await flowFixture();
  try {
    const g = await f.engine.prepare(f.token, "register", {});
    await f.engine.submit(f.token, g.action_id, await f.sign(g));
    await f.engine.status(f.token);
    await f.engine.prepare(f.token, "open", {});
    await f.store.update(f.token, async (s) => {
      s.actions.push({
        id: "12345678-1234-4234-8234-123456789abc",
        step: "revoke",
        input: {},
        state: "prepared",
        wallet_request: null,
      });
    });
    assert.equal(
      (await f.engine.pending(f.token)).pending_action!.step,
      "revoke",
    );
  } finally {
    await f.cleanup();
  }
});
test("other unresolved grants block a replacement before reserving or signing another cap", async () => {
  const f = await flowFixture();
  try {
    const request = f.ports.relay;
    f.ports.relay = async (s, p, b) =>
      p.startsWith("/v1/grant-recovery/")
        ? {
            chainId: "4663",
            owner: s.owner,
            account: s.account,
            pending: [{ id: "other-authorization" }],
            hasMore: false,
          }
        : request(s, p, b);
    await assert.rejects(
      f.engine.prepare(f.token, "register", {}),
      /existing_grant_reconciliation/,
    );
    assert.equal(
      f.requests.filter((r) => r.path === "/v1/reservations").length,
      0,
    );
  } finally {
    await f.cleanup();
  }
});
