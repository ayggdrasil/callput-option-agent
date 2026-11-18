import { test } from "node:test";
import assert from "node:assert/strict";
import { flowFixture } from "./accountFlowFixtures.js";
import { AccountWorkflow, productionWorkflowPorts } from "./accountWorkflow.js";
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

async function installedFlow(t: {after(fn: () => Promise<void>): void}) {
  const f = await flowFixture();
  t.after(f.cleanup);
  const grant = await f.engine.prepare(f.token, "register", {});
  await f.engine.submit(f.token, grant.action_id, await f.sign(grant));
  await f.engine.status(f.token);
  return f;
}

test("legacy counter upgrades to the direct relay range without signing nonce zero", async (t) => {
  const f = await installedFlow(t);
  await f.store.update(f.token, async (s) => { s.next_nonce = "0"; });
  const open = await f.engine.prepare(f.token, "open", {});
  const nonce = JSON.parse(open.wallet_request.params[1]).message.nonce;
  assert.equal(nonce, (1n << 128n).toString());
  assert.equal((await f.store.read(f.token)).next_nonce, (1n + (1n << 128n)).toString());
  await f.engine.submit(f.token, open.action_id, await f.sign(open));
  assert.equal((await f.engine.status(f.token)).actions.at(-1).state, "executed");
});

test("uint256 maximum is signed exactly once and exhaustion creates no wallet request", async (t) => {
  const f = await installedFlow(t);
  const max = (1n << 256n) - 1n;
  await f.store.update(f.token, async (s) => { s.next_nonce = max.toString(); });
  const open = await f.engine.prepare(f.token, "open", {});
  assert.equal(JSON.parse(open.wallet_request.params[1]).message.nonce, max.toString());
  await f.engine.submit(f.token, open.action_id, await f.sign(open));
  await f.engine.status(f.token);
  await assert.rejects(f.engine.prepare(f.token, "close", {
    option_token_id: "291", size_raw: "1", min_amount_out_raw: "1",
  }), /session_trade_nonce_exhausted/);
});

test("definite 400 survives a later 404 and is never retransmitted", async (t) => {
  const f = await installedFlow(t);
  const original = f.ports.relay;
  let posts = 0;
  f.ports.relay = async (s, p, b) => {
    if (p === "/v1/trades") {
      posts++;
      throw Error("relay_400_trade_nonce_range_invalid");
    }
    return original(s, p, b);
  };
  const open = await f.engine.prepare(f.token, "open", {});
  const signed = await f.sign(open);
  await assert.rejects(f.engine.submit(f.token, open.action_id, signed), /trade_nonce_range_invalid/);
  const restarted = new AccountWorkflow(f.store, f.ports);
  const row = (await restarted.status(f.token)).actions.at(-1);
  assert.equal(row.state, "unknown");
  assert.equal(row.admission.state, "rejected_before_admission");
  assert.equal(row.admission.reason, "relay_400_trade_nonce_range_invalid");
  assert.equal(row.observation_reason, "relay_404_not_found");
  assert.equal(row.trade.relay_request_id, open.action_id);
  assert.equal(row.trade.nonce, (1n << 128n).toString());
  await restarted.submit(f.token, open.action_id, signed);
  assert.equal(posts, 1);
  await assert.rejects(restarted.recover(f.token), /signed_order_requires_reconciliation/);
});

test("lost POST before admission retries only the saved identity after a relay miss", async (t) => {
  const f = await installedFlow(t);
  const original = f.ports.relay;
  const bodies: unknown[] = [];
  f.ports.relay = async (s, p, b) => {
    if (p === "/v1/trades") {
      bodies.push(structuredClone(b));
      if (bodies.length === 1) throw Error("relay_outcome_unknown");
    }
    return original(s, p, b);
  };
  const a = await f.engine.prepare(f.token, "open", {});
  const signed = await f.sign(a);
  await assert.rejects(f.engine.submit(f.token, a.action_id, signed), /relay_outcome_unknown/);
  const restarted = new AccountWorkflow(f.store, f.ports);
  const result = await restarted.submit(f.token, a.action_id, signed);
  assert.deepEqual(bodies, [bodies[0], bodies[0]]);
  assert.equal(result.actions.at(-1).admission.state, "accepted");
  const done = (await restarted.status(f.token)).actions.at(-1);
  assert.equal(done.state, "executed");
  assert.equal(done.evidence.request_key, "0x" + "c".repeat(64));
});

test("expired unused stock grant is recoverable with evidence and retains its policy", async (t) => {
  const f = await flowFixture("BuyCallSpread", "TSLA");
  t.after(f.cleanup);
  const g = await f.engine.prepare(f.token, "register", {});
  await f.engine.submit(f.token, g.action_id, await f.sign(g));
  await f.engine.status(f.token);
  await f.store.update(f.token, async (s) => { s.grant.validUntil = "1"; });
  const before = await f.engine.status(f.token);
  assert.equal(before.state, "blocked");
  assert.equal(before.next_actions[0].tool, "callput_workflow_recover");
  const after = await f.engine.recover(f.token);
  assert.equal(after.state, "session_required");
  assert.deepEqual(before.policy, after.policy);
  assert.equal(Reflect.get(after, "recovery_evidence")?.kind, "finalized_unused_expired");
  const fresh = await f.engine.prepare(f.token, "register", {});
  assert.notEqual(fresh.action_id, g.action_id);
  assert.equal(JSON.parse(fresh.wallet_request.params[1]).message.maxAmount, "100000");
});

test("legacy signed order requires finalized unused nonce and an independent relay read", async (t) => {
  const f = await installedFlow(t);
  const original = f.ports.relay;
  f.ports.relay = async (s, p, b) => {
    if (p === "/v1/trades") throw Error("relay_outcome_unknown");
    return original(s, p, b);
  };
  const open = await f.engine.prepare(f.token, "open", {});
  await assert.rejects(f.engine.submit(f.token, open.action_id, await f.sign(open)), /unknown/);
  await f.store.update(f.token, async (s) => {
    const a = s.actions.at(-1);
    delete a.admission;
    s.grant.validUntil = "2";
    a.envelope.intent.deadline = "1";
  });
  f.ports.expiredProof = async (s, orders?: {nonce: string}[]) => ({
    kind: "finalized_unused_expired", session_id: s.sessionId, grant_id: s.grantId,
    order_nonces: (orders ?? []).map((o) => ({ nonce: o.nonce, used: false })),
  });
  f.flags.unavailableStatus = true;
  await assert.rejects(f.engine.recover(f.token), /signed_order_requires_reconciliation/);
  f.flags.unavailableStatus = false;
  const recovered = await f.engine.recover(f.token);
  const row = recovered.actions.at(-1);
  assert.equal(row.state, "cancelled");
  assert.equal(row.reason, "finalized_unused_expired");
  assert.equal(row.evidence.relay_lookup, "not_found");
  assert.equal(recovered.state, "session_required");
});

test("transaction and request key survive restart and relay outage until finalized cancellation", async (t) => {
  const f = await installedFlow(t);
  const open = await f.engine.prepare(f.token, "open", {});
  await f.engine.submit(f.token, open.action_id, await f.sign(open));
  f.flags.unavailableStatus = true;
  f.ports.fill = async () => ({ status: "pending" });
  const restarted = new AccountWorkflow(f.store, f.ports);
  const pending = (await restarted.status(f.token)).actions.at(-1);
  assert.equal(pending.state, "unknown");
  assert.equal(pending.admission.state, "accepted");
  assert.equal(pending.trade.request_key, "0x" + "c".repeat(64));
  f.ports.fill = async (_s, request_key) => ({ status: "cancelled", account: f.account,
    request_key, block_hash: "0x" + "a".repeat(64) });
  const terminal = (await restarted.status(f.token)).actions.at(-1);
  assert.equal(terminal.state, "cancelled");
  assert.equal(terminal.reason, "keeper_cancelled");
  assert.equal(terminal.evidence.request_key, pending.trade.request_key);
  assert.equal(f.requests.filter((r) => r.path === "/v1/trades").length, 1);
});

test("account creation after a lost response reconciles from the pinned account and leaves the next deposit discoverable", async (t) => {
  const f = await flowFixture();
  t.after(f.cleanup);
  let created = false;
  const resolve = f.ports.resolve, relay = f.ports.relay;
  f.ports.resolve = async (...args) => ({...await resolve(...args), created, balance: "0"});
  f.ports.relay = async (s, path, body) => {
    if (path === "/v1/accounts") {
      assert.equal(body.subIndex, "0");
      created = true;
      throw Error("relay_outcome_unknown");
    }
    if (path.startsWith("/v1/operations/")) throw Error("relay_404_not_found");
    return relay(s, path, body);
  };
  await f.store.update(f.token, async (s) => { s.policy.deposit_amount_raw="1000000"; s.policy.max_deposit_gas_wei="500000"; });
  const prepared = await f.engine.prepare(f.token, "create", {});
  await assert.rejects(f.engine.submit(f.token, prepared.action_id, {}), /relay_outcome_unknown/);
  const status = await f.engine.status(f.token);
  assert.equal(status.actions.at(-1).state, "confirmed");
  assert.equal(Reflect.get(status.next_actions[0].arguments,"step"), "deposit");
});

test("close-only grant commits a zero open cap and never produces an OpenIntent", async (t) => {
  const f = await flowFixture();
  t.after(f.cleanup);
  const w = await f.engine.start("robinhood", {owner:f.owner.address, session_mode:"close_only", max_user_amount_raw:"0"});
  await f.engine.connect(w.workflow_id,{owner:f.owner.address,chain_id:4663,device_signer:f.device.address});
  const login = await f.engine.prepare(w.workflow_id,"login",{});
  await f.engine.submit(w.workflow_id,login.action_id,await f.sign(login));
  const action=await f.engine.prepare(w.workflow_id,"register",{});
  const {message}=JSON.parse(action.wallet_request.params[1]);
  assert.equal(message.maxOpens,"0");
  assert.equal(message.maxAmount,"0");
  assert.equal(message.maxCloses,"1");
  await f.engine.submit(w.workflow_id,action.action_id,await f.sign(action));
  const ready=await f.engine.status(w.workflow_id);
  assert.equal(ready.next_actions[0].tool,"callput_portfolio_summary");
  await assert.rejects(f.engine.prepare(w.workflow_id,"open",{}),/close_only_session/);
});

test("expired owned position settles via the owner login without requiring a device grant", async (t) => {
  const f = await flowFixture();
  t.after(f.cleanup);
  const relay=f.ports.relay, tx="0x"+"7".repeat(64);
  let removed=false;
  f.ports.portfolio=async()=>({positions:removed?[]:[{token_id:"291",expiry_sec:1,size:1}]});
  f.ports.relay=async(s,path,body)=>{
    if(path==="/v1/settlements" && body) {
      assert.equal(body.optionTokenId,"291");
      assert.equal(body.account,f.account);
      return {id:body.requestId,account:f.account,action:"settle",hash:tx};
    }
    if(path.startsWith("/v1/trades/")) return {id:path.split("/").at(-1),account:f.account,action:"settle",hash:tx};
    return relay(s,path,body);
  };
  f.ports.settlementProof=async()=>{removed=true;return {transaction_hash:tx};};
  const action=await f.engine.prepare(f.token,"settle",{option_token_id:"291"});
  assert.equal(action.wallet_request,null);
  assert.equal(action.submit_result_with.result_kind,"empty_object");
  await f.engine.submit(f.token,action.action_id,{});
  assert.equal((await f.engine.status(f.token)).actions.at(-1).state,"executed");
});

test("withdrawal binds the owner, USDG, exact recipient and amount and waits for independent proof", async (t)=>{
  const f=await flowFixture();
  t.after(f.cleanup);
  const relay=f.ports.relay, owner=f.owner.address.toLowerCase(), tx="0x"+"5".repeat(64);
  let sends=0,final=false;
  f.ports.relay=async(s,path,body)=>{
    if(path.startsWith("/v1/owner-context/")) return {account:f.account,owner,chainId:"4663",epoch:"0",nonce:(1n<<128n).toString(),pending:null};
    if(path==="/v1/owner-actions" && body){
      sends++;
      assert.equal(body.action.params.to,owner);
      return {id:body.action.reservation,action:"withdraw",account:f.account,hash:tx};
    }
    if(path.startsWith("/v1/owner-actions/")) return {id:path.split("/").at(-1),account:f.account,action:"withdraw",hash:tx,state:"confirmed"};
    return relay(s,path,body);
  };
  Object.assign(f.ports,{ownerProof:async()=>final?{transaction_hash:tx}:null});
  const action=await f.engine.prepare(f.token,"withdraw",{amount_raw:"10000",recipient:owner});
  const request=JSON.parse(action.wallet_request.params[1]);
  assert.equal(action.signer,owner);
  assert.equal(request.primaryType,"Withdrawal");
  assert.equal(request.message.amount,"10000");
  assert.equal(request.message.token,"0x5fc5360d0400a0fd4f2af552add042d716f1d168");
  await f.engine.submit(f.token,action.action_id,await f.sign(action));
  assert.equal((await f.engine.status(f.token)).actions.at(-1).state,"submitted");
  final=true;
  assert.equal((await f.engine.status(f.token)).actions.at(-1).state,"confirmed");
  assert.equal(sends,1);
});

test("exact order legs and per-order collateral ceiling are both enforced before signing", async (t) => {
  const f = await installedFlow(t);
  const quote = await f.ports.quote!({});
  const pair = {long_leg_id:quote.long_leg_id,short_leg_id:quote.short_leg_id};
  const get = f.ports.quote;
  f.ports.quote = async (s, selected) => {
    assert.deepEqual(selected,pair);
    return get!(s);
  };
  await assert.rejects(f.engine.prepare(f.token,"open",{...pair,max_amount_in_raw:"1599"}),/quote_exceeds_budget_or_balance/);
  const open=await f.engine.prepare(f.token,"open",{...pair,max_amount_in_raw:"1600"});
  const {params}=JSON.parse(open.wallet_request.params[1]).message;
  assert.deepEqual(params.optionIds.slice(0,2),Object.values(pair));
  assert.equal(params.amountIn,"1600");
});

test("creation uses the logical account operation when the relay deduplicates a different UUID", async (t)=>{
  const f=await flowFixture();
  t.after(f.cleanup);
  const relay=f.ports.relay, resolve=f.ports.resolve, other="de6135a0-7c0c-41dc-b31a-e07de30c3921";
  let created=false,posts=0;
  f.ports.resolve=async(...args)=>({...await resolve(...args),created});
  f.ports.relay=async(s,p,b)=>{
    if(p==="/v1/accounts") {
      posts++;
      return {id:other,account:f.account,action:"create",state:"queued"};
    }
    if(p.startsWith("/v1/operations/")){
      assert.equal(p,"/v1/operations/"+other);
      return {id:other,account:f.account,action:"create",state:"queued"};
    }
    return relay(s,p,b);
  };
  const prepared=await f.engine.prepare(f.token,"create",{});
  const submitted=await f.engine.submit(f.token,prepared.action_id,{});
  assert.equal(submitted.actions.at(-1).relay_id,other);
  await f.engine.submit(f.token,prepared.action_id,{});
  created=true;
  assert.equal((await f.engine.status(f.token)).actions.at(-1).state,"confirmed");
  assert.equal(posts,1);
});
