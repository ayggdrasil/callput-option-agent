import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet } from "ethers";
import { fork } from "node:child_process";
import { once } from "node:events";
import { workflowAvailability } from "./accountManifest.js";
import { configuredWorkflowStore, RedisWorkflowStore } from "./accountStore.js";

test("prefixed Marketplace credentials configure the dedicated store without public secret values", () => {
  const names = [
    "CALLPUT_WORKFLOW_ENCRYPTION_KEY",
    "CALLPUT_WORKFLOW_KV_REST_API_URL",
    "CALLPUT_WORKFLOW_KV_REST_API_TOKEN",
  ];
  const before = names.map((name) => process.env[name]);
  try {
    process.env[names[0]] = "11".repeat(32);
    process.env[names[1]] = "https://dedicated-store.example";
    process.env[names[2]] = "secret-dedicated-token";
    assert.ok(configuredWorkflowStore() instanceof RedisWorkflowStore);
    assert.equal(workflowAvailability().configured, true);
    assert.ok(
      !JSON.stringify(workflowAvailability()).includes(
        "secret-dedicated-token",
      ),
    );
  } finally {
    names.forEach((name, i) => {
      if (before[i] === undefined) delete process.env[name];
      else process.env[name] = before[i];
    });
  }
});

test("encrypted workflow survives restart, denies foreign capability and serializes writes", async () => {
  const { FileWorkflowStore } = await import("./accountStore.js");
  const dir = await mkdtemp(join(tmpdir(), "callput-flow-"));
  const key = "12".repeat(32);
  try {
    const store = new FileWorkflowStore(dir, key),
      token = await store.create({
        owner: "owner",
        cookies: "private-cookie",
        count: 0,
      });
    const again = new FileWorkflowStore(dir, key);
    await again.update(token, async (s) => {
      s.count++;
    });
    assert.equal((await store.read(token)).count, 1);
    await assert.rejects(
      store.read(token.slice(0, -1) + (token.endsWith("a") ? "b" : "a")),
    );
    const files = await readdir(dir);
    assert.ok(files.length);
    assert.ok(
      !(await readFile(join(dir, "workflows.sqlite"), "utf8")).includes(
        "private-cookie",
      ),
    );
    await assert.rejects(
      new FileWorkflowStore(dir, "34".repeat(32)).read(token),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("crashed writer preserves checkpoint and only its dead-process lock is reclaimed", async () => {
  const { FileWorkflowStore } = await import("./accountStore.js");
  const dir = await mkdtemp(join(tmpdir(), "callput-crash-")),
    key = "78".repeat(32),
    store = new FileWorkflowStore(dir, key);
  let child;
  try {
    const token = await store.create({ submissionOutcome: "not_sent" });
    child = fork(
      new URL("./accountStoreCrashFixture.js", import.meta.url),
      [dir, key, token],
      { stdio: ["ignore", "ignore", "ignore", "ipc"] },
    );
    await Promise.race([
      once(child, "message"),
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("fixture_timeout")), 10000).unref(),
      ),
    ]);
    await assert.rejects(
      store.update(token, async () => {}),
      /busy/,
    );
    const exit = once(child, "exit");
    child.kill("SIGKILL");
    await exit;
    assert.equal((await store.read(token)).submissionOutcome, "unknown");
    await store.update(token, async (s) => {
      assert.equal(s.submissionOutcome, "unknown");
      s.observed = true;
    });
    assert.equal((await store.read(token)).observed, true);
  } finally {
    child?.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

test("SQLite busy release retries, closes its connection and safely reclaims abandoned same-thread leases", async () => {
  const { FileWorkflowStore } = await import("./accountStore.js");
  const dir = await mkdtemp(join(tmpdir(), "callput-release-")),
    key = "90".repeat(32);
  class Busy extends FileWorkflowStore {
    override releaseWaitMs = 20;
    failures = 0;
    failAlways = false;
    override releaseLock(db: any, id: string, lease: string) {
      if (this.failAlways || this.failures-- > 0) throw Error("workflow_busy");
      super.releaseLock(db, id, lease);
    }
  }
  try {
    const store = new Busy(dir, key),
      token = await store.create({ count: 0 });
    store.failures = 1;
    await store.update(token, async (s) => {
      s.count++;
    });
    assert.equal((await store.read(token)).count, 1);
    store.failAlways = true;
    await assert.rejects(
      store.update(token, async (s) => {
        s.count++;
      }),
      /cleanup_pending/,
    );
    const restarted = new FileWorkflowStore(dir, key);
    await restarted.update(token, async (s) => {
      assert.equal(s.count, 2);
      s.count++;
    });
    assert.equal((await restarted.read(token)).count, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("account manifests keep legacy account origins and deposit gas separate from sponsor", async () => {
  const { accountManifest } = await import("./accountManifest.js");
  const robin = accountManifest("robinhood");
  assert.equal(robin.chainId, 4663);
  assert.equal(robin.origins.length, 2);
  assert.equal(robin.fees.deposit, "owner");
  assert.equal(robin.fees.open, "protocol_sponsor");
  assert.throws(() => accountManifest("base"));
});

test("public workflow never asks for owner keys; transfer is bounded and grant uses a separate device", async () => {
  const { AccountWorkflow } = await import("./accountWorkflow.js");
  const { FileWorkflowStore } = await import("./accountStore.js");
  const dir = await mkdtemp(join(tmpdir(), "callput-flow-"));
  const owner = Wallet.createRandom(),
    device = Wallet.createRandom(),
    account = Wallet.createRandom().address.toLowerCase();
  let balance = "0";
  const submits: any[] = [];
  const ports: any = {
    resolve: async () => ({
      account,
      owner: owner.address.toLowerCase(),
      subIndex: "0",
      created: true,
      balance,
      epoch: "0",
      blockTimestamp: String(Math.floor(Date.now() / 1000)),
      sessions: [],
      canOpen: true,
    }),
    relay: async (s: any, path: string, body: any) => {
      submits.push({ path, body });
      if (path === "/v1/auth/challenge")
        return {
          id: "aa",
          message: `${owner.address}`,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          sessionExpiresAt: "2030-01-01T00:00:00.000Z",
        };
      if (path === "/v1/auth/verify")
        return {
          owner: owner.address,
          chainId: "4663",
          expiresAt: "2030-01-01T00:00:00.000Z",
        };
      return {};
    },
    verifyLogin: () => {},
    verifyDeposit: async () => {
      balance = "100000";
      return { confirmed: true, block: 1 };
    },
    depositTransaction: async (s: any, data: string) => ({
      from: s.owner,
      to: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
      value: "0x0",
      chainId: "0x1237",
      data,
      gas: "0x10000",
      gasPrice: "0x1",
    }),
  };
  try {
    const engine = new AccountWorkflow(
      new FileWorkflowStore(dir, "56".repeat(32)),
      ports,
    );
    const started = await engine.start("robinhood", {
      owner: owner.address,
      deposit_amount_raw: "100000",
      max_user_amount_raw: "100000",
      max_deposit_gas_wei: "100000000000000",
    });
    const id = started.workflow_id;
    assert.equal(started.state, "wallet_required");
    await assert.rejects(
      engine.connect(id, {
        owner: owner.address,
        chain_id: 4663,
        device_signer: owner.address,
      }),
      /device/,
    );
    await engine.connect(id, {
      owner: owner.address,
      chain_id: 4663,
      device_signer: device.address,
    });
    const login = await engine.prepare(id, "login", {});
    assert.equal(login.wallet_request.method, "personal_sign");
    await engine.submit(id, login.action_id, {
      signature: await owner.signMessage(login.message),
    });
    const deposit = await engine.prepare(id, "deposit", {});
    assert.equal(deposit.wallet_request.method, "eth_sendTransaction");
    assert.equal(
      deposit.wallet_request.params[0].from,
      owner.address.toLowerCase(),
    );
    assert.equal(deposit.fee_payer, "owner");
    await assert.rejects(
      engine.prepare(id, "deposit", { amount_raw: "100001" }),
      /amount|input|unresolved/,
    );
    await engine.submit(id, deposit.action_id, {
      transaction_hash: "0x" + "1".repeat(64),
    });
    assert.equal((await engine.status(id)).state, "session_required");
    const raw = JSON.stringify(await engine.status(id));
    assert.ok(!raw.includes("privateKey"));
    assert.equal(submits.filter((x) => x.path === "/v1/trades").length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
