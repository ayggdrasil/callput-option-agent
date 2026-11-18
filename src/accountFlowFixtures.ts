// Disposable wallets and fake chain/relay only. Never reads user keystores.
import { Wallet, TypedDataEncoder, toBeHex } from "ethers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileWorkflowStore } from "./accountStore.js";
import {
  AccountWorkflow,
  validateLogin,
  type WorkflowPorts,
} from "./accountWorkflow.js";
import { accountTypes } from "./accountManifest.js";
import { decodeSpreadTokenId, type SpreadStrategy } from "./core.js";
export async function flowFixture(strategy?: SpreadStrategy, underlying?: "ETH" | "BTC" | "TSLA") {
  const owner = Wallet.createRandom(),
    device = Wallet.createRandom(),
    account = Wallet.createRandom().address.toLowerCase(),
    dir = await mkdtemp(join(tmpdir(), "callput-flow-test-"));
  const store = new FileWorkflowStore(dir, "ab".repeat(32));
  let grant: any,
    installed = false,
    opened = false,
    closed = false,
    until = "";
  const rows = new Map<string, any>(),
    requests: any[] = [],
    flags = {
      failPreparation: false,
      failLoginChallenge: false,
      dropTrade: false,
      unavailableStatus: false,
    };
  const underlyingIndex = { BTC: 1n, ETH: 2n, TSLA: 3n }[underlying ?? "ETH"];
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400),
    id = (strike: bigint) =>
      toBeHex((underlyingIndex << 240n) | (expiry << 200n) | (strike << 152n), 32);
  const selected = strategy ?? "BuyCallSpread",
    isCall = selected.includes("Call"),
    positionFlag = {
      BuyCallSpread: 0x56n,
      SellCallSpread: 0x64n,
      BuyPutSpread: 0x74n,
      SellPutSpread: 0x86n,
    }[selected],
    position = decodeSpreadTokenId(String(BigInt(id(0n)) |
      (positionFlag << 192n) | (2400n << 147n) | (2600n << 99n) |
      (isCall ? 1n << 146n : 0n)));
  const positions = () =>
    opened && !closed
      ? [
          {
            underlying: underlying ?? "ETH",
            option_type: position.optionType,
            side: position.isLong ? "long" : "short",
            expiry_sec: Number(expiry),
            naked_strike: position.nakedStrike,
            pair_strike: position.pairStrike,
            token_id: "0x123",
            size: 0.0001,
          },
        ]
      : [];
  const ports: WorkflowPorts = {
    resolve: async () => ({
      account,
      owner: owner.address.toLowerCase(),
      subIndex: "0",
      created: true,
      balance: "1000000",
      epoch: "0",
      blockTimestamp: String(Math.floor(Date.now() / 1000)),
      blockHash: "0x" + "a".repeat(64),
      sessions: grant
        ? [
            {
              sessionId: TypedDataEncoder.hashStruct(
                "Grant",
                { Grant: accountTypes.Grant },
                grant,
              ),
              installed,
              revoked: false,
              opens: opened ? "1" : "0",
              closes: closed ? "1" : "0",
              amountSpent: opened ? "1600" : "0",
              feesSpent: "0",
            },
          ]
        : [],
    }),
    verifyLogin: validateLogin,
    relay: async (s, path, body) => {
      requests.push({ path, body: body ? structuredClone(body) : null });
      if (path === "/v1/auth/challenge") {
        if (flags.failLoginChallenge) throw Error("relay_outcome_unknown");
        const issued = new Date().toISOString(),
          expiresAt = new Date(Date.parse(issued) + 300000).toISOString();
        until = new Date(Date.parse(issued) + 3600000).toISOString();
        const request = "12345678-1234-4234-8234-123456789abc";
        return {
          id: request,
          expiresAt,
          sessionExpiresAt: until,
          message: `https://app.callput.app wants you to sign in with your Ethereum account:\n${owner.address}\n\nSign in to CallPut's sponsored trading service. This signature does not authorize moving funds.\n\nURI: https://app.callput.app/v1/auth/session\nVersion: 1\nChain ID: 4663\nNonce: ${"ab".repeat(16)}\nIssued At: ${issued}\nExpiration Time: ${until}\nRequest ID: ${request}`,
        };
      }
      if (path === "/v1/auth/verify")
        return { owner: s.owner, chainId: "4663", expiresAt: until };
      if (path.startsWith("/v1/grant-recovery/"))
        return {
          chainId: "4663",
          owner: s.owner,
          account,
          pending: [],
          hasMore: false,
        };
      if (path === "/v1/reservations")
        return {
          id: body.requestId,
          owner: s.owner,
          account,
          chainId: "4663",
          epoch: "0",
          epochKnown: true,
          nonce: "0",
          scope: "grant:0",
        };
      if (path === "/v1/grant-preparations") {
        if (flags.failPreparation) {
          flags.failPreparation = false;
          throw Error("relay_outcome_unknown");
        }
        return { grant: body.grant };
      }
      if (path === "/v1/operations") {
        grant = body.grant;
        installed = true;
        return { id: body.reservation, account, state: "queued" };
      }
      if (path === "/v1/trades") {
        const id = body.order.reservation;
        rows.set(id, {
          id,
          account,
          hash: "0x" + "b".repeat(64),
          state: "included",
        });
        if (body.order.action === "open") opened = true;
        else closed = true;
        if (flags.dropTrade) {
          flags.dropTrade = false;
          throw Error("relay_outcome_unknown");
        }
        return rows.get(id);
      }
      if (path.startsWith("/v1/trades/")) {
        if (flags.unavailableStatus)
          throw Error("relay_503_dependency_unavailable");
        const r = rows.get(path.split("/").at(-1)!);
        if (!r) throw Error("relay_404_not_found");
        return r;
      }
      throw Error("unexpected_fixture_route");
    },
    verifyDeposit: async () => ({ confirmed: true }),
    nonceUsed: async () => false,
    positionBalance: async () => (opened && !closed ? "100000000000000" : "0"),
    quote: async () => ({
      strategy: selected,
      estimated_amount_in_per_unit: 16,
      long_leg_id: id(isCall ? 2400n : 2600n),
      short_leg_id: id(isCall ? 2600n : 2400n),
    }),
    portfolio: async () => ({ positions: positions() }),
    requestProof: async (s, a, hash) => ({
      request_key: "0x" + "c".repeat(64),
      transaction_hash: hash,
      account,
      is_open: a.step === "open",
    }),
    fill: async (_s, key) => ({
      request_key: key,
      status: "executed",
      account,
      size_out: "100000000000000",
    }),
    expiredProof: async (s) => ({
      kind: "finalized_unused_expired",
      session_id: s.sessionId,
      grant_id: s.grantId,
    }),
  };
  const engine = new AccountWorkflow(store, ports),
    start = await engine.start("robinhood", {
      owner: owner.address,
      max_user_amount_raw: "100000",
      ...(strategy ? { strategy } : {}),
      ...(underlying ? { underlying_asset: underlying } : {}),
    }),
    token = start.workflow_id;
  await engine.connect(token, {
    owner: owner.address,
    chain_id: 4663,
    device_signer: device.address,
  });
  const sign = async (a: any) => {
    if (a.wallet_request.method === "personal_sign")
      return { signature: await owner.signMessage(a.message) };
    const t = JSON.parse(a.wallet_request.params[1]);
    return {
      signature: await (
        a.signer === owner.address.toLowerCase() ? owner : device
      ).signTypedData(t.domain, t.types, t.message),
    };
  };
  const login = await engine.prepare(token, "login", {});
  await engine.submit(token, login.action_id, await sign(login));
  return {
    engine,
    store,
    token,
    owner,
    device,
    account,
    ports,
    requests,
    flags,
    sign,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
