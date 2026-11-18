import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyTypedData } from "ethers";
import { flowFixture } from "../build/src/accountFlowFixtures.js";
import {
  signAccountAction,
  driveAccountWorkflow,
} from "../scripts/account-signer-policy.mjs";
test("local signer completes bounded account Grant and Open through exact prepared MCP actions", async () => {
  const f = await flowFixture("SellPutSpread", "TSLA");
  try {
    const identity = {
      network: "robinhood",
      owner: f.owner.address.toLowerCase(),
      account: f.account,
      workflow_id: f.token,
      device: f.device.address.toLowerCase(),
      max_user_amount_raw: "100000",
      underlying_asset: "TSLA",
      strategy: "SellPutSpread",
    };
    const grant = await f.engine.prepare(f.token, "register", {});
    const signed = await signAccountAction(grant, identity, {
      owner: f.owner,
      device: f.device,
    });
    const t = JSON.parse(grant.wallet_request.params[1]);
    assert.equal(
      verifyTypedData(
        t.domain,
        t.types,
        t.message,
        signed.signature,
      ).toLowerCase(),
      identity.owner,
    );
    await f.engine.submit(f.token, grant.action_id, signed);
    await f.engine.status(f.token);
    const open = await f.engine.prepare(f.token, "open", {});
    const result = await signAccountAction(open, identity, {
      owner: f.owner,
      device: f.device,
    });
    await f.engine.submit(f.token, open.action_id, result);
    assert.equal((await f.engine.status(f.token)).state, "trade_executed");
  } finally {
    await f.cleanup();
  }
});
test("MCP-only local driver observes verified execution and checks the existing budget before preparing Grant", async () => {
  const f = await flowFixture();
  try {
    const identity = {
      network: "robinhood",
      owner: f.owner.address.toLowerCase(),
      account: f.account,
      workflow_id: f.token,
      device: f.device.address.toLowerCase(),
      max_user_amount_raw: "100000",
    };
    const call = async (name, a) => {
      if (name === "callput_wallet_connect")
        return f.engine.connect(a.workflow_id, {
          owner: a.owner,
          chain_id: a.chain_id,
          device_signer: a.device_signer,
        });
      if (name === "callput_workflow_status")
        return f.engine.status(a.workflow_id);
      if (name === "callput_action_prepare")
        return f.engine.prepare(a.workflow_id, a.step, a.input);
      if (name === "callput_action_begin")
        return f.engine.begin(a.workflow_id, a.action_id);
      if (name === "callput_action_submit")
        return f.engine.submit(a.workflow_id, a.action_id, a.result);
      if (name === "callput_action_status") {
        await f.engine.status(a.workflow_id);
        return f.engine.action(a.workflow_id, a.action_id);
      }
      throw Error("unexpected tool");
    };
    const journal = { results: {}, started: {} };
    let checked = 0;
    await assert.rejects(
      driveAccountWorkflow(
        call,
        identity,
        { owner: f.owner, device: f.device },
        journal,
        async () => {},
        {
          checkBudget: async () => {
            throw Error("legacy_budget_reserved");
          },
          sleep: async () => {},
        },
      ),
      /legacy_budget_reserved/,
    );
    assert.equal(
      f.requests.filter((r) => r.path === "/v1/reservations").length,
      0,
    );
    const result = await driveAccountWorkflow(
      call,
      identity,
      { owner: f.owner, device: f.device },
      journal,
      async () => {},
      {
        checkBudget: async () => {
          checked++;
        },
        sleep: async () => {},
      },
    );
    assert.equal(result.state, "trade_executed");
    assert.ok(checked >= 1);
    assert.equal(f.requests.filter((r) => r.path === "/v1/trades").length, 1);
    assert.equal(Object.keys(journal.results).length, 2);
  } finally {
    await f.cleanup();
  }
});
test("local signer rejects changed identity, cap, domain, permission types and any owner transaction", async () => {
  const f = await flowFixture();
  try {
    const identity = {
      network: "robinhood",
      owner: f.owner.address.toLowerCase(),
      account: f.account,
      workflow_id: f.token,
      device: f.device.address.toLowerCase(),
      max_user_amount_raw: "100000",
    };
    const a = await f.engine.prepare(f.token, "register", {}),
      wallets = { owner: f.owner, device: f.device };
    for (const mutate of [
      (x) => (x.owner = "0x" + "1".repeat(40)),
      (x) => (x.policy.max_user_amount_raw = "100001"),
      (x) => {
        const t = JSON.parse(x.wallet_request.params[1]);
        t.domain.chainId = 1;
        x.wallet_request.params[1] = JSON.stringify(t);
      },
      (x) => {
        const t = JSON.parse(x.wallet_request.params[1]);
        t.types.Grant.push({ type: "address", name: "withdrawTo" });
        t.message.withdrawTo = f.owner.address;
        x.wallet_request.params[1] = JSON.stringify(t);
      },
      (x) =>
        (x.wallet_request = { method: "eth_sendTransaction", params: [{}] }),
    ]) {
      const bad = structuredClone(a);
      mutate(bad);
      await assert.rejects(signAccountAction(bad, identity, wallets));
    }
  } finally {
    await f.cleanup();
  }
});
test("an already prepared hosted Grant cannot bypass the local legacy budget guard", async () => {
  const f = await flowFixture();
  try {
    const grant = await f.engine.prepare(f.token, "register", {});
    const identity = {
      network: "robinhood",
      owner: f.owner.address.toLowerCase(),
      account: f.account,
      workflow_id: f.token,
      device: f.device.address.toLowerCase(),
      max_user_amount_raw: "100000",
    };
    const call = async (name, a) => {
      if (name === "callput_wallet_connect")
        return f.engine.connect(a.workflow_id, {
          owner: a.owner,
          chain_id: a.chain_id,
          device_signer: a.device_signer,
        });
      if (name === "callput_workflow_status")
        return f.engine.status(a.workflow_id);
      if (name === "callput_action_prepare")
        return f.engine.prepare(a.workflow_id, a.step, a.input);
      if (name === "callput_action_begin")
        return f.engine.begin(a.workflow_id, a.action_id);
      if (name === "callput_action_submit")
        return f.engine.submit(a.workflow_id, a.action_id, a.result);
      if (name === "callput_action_status") {
        await f.engine.status(a.workflow_id);
        return f.engine.action(a.workflow_id, a.action_id);
      }
      throw Error("unexpected tool");
    };
    const journal = { results: {}, started: {} };
    await assert.rejects(
      driveAccountWorkflow(
        call,
        identity,
        { owner: f.owner, device: f.device },
        journal,
        async () => {},
        {
          checkBudget: async () => {
            throw Error("legacy_budget_reserved");
          },
          sleep: async () => {},
        },
      ),
      /legacy_budget_reserved/,
    );
    assert.equal(
      (await f.engine.action(f.token, grant.action_id)).action_state,
      "prepared",
    );
    assert.equal(Object.keys(journal.results).length, 0);
  } finally {
    await f.cleanup();
  }
});
