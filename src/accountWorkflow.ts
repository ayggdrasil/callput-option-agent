import { randomUUID } from "node:crypto";
import {
  getAddress,
  Interface,
  TypedDataEncoder,
  verifyMessage,
  verifyTypedData,
  parseUnits,
  toBeHex,
} from "ethers";
import type { WorkflowStore } from "./accountStore.js";
import {
  accountDomain,
  accountManifest,
  accountOpenStrategies,
  accountTradeSelection,
  accountTypes,
} from "./accountManifest.js";
import { AccountChain } from "./accountChain.js";
import { withNetwork } from "./config.js";
import {
  scanSpreads,
  getPortfolioSummary,
  parseOptionTokenId,
} from "./core.js";

function check(ok: unknown, reason: string): asserts ok {
  if (!ok) throw Error(reason);
}
const integer = (x: any, max = 2n ** 256n - 1n) => {
  check(
    typeof x === "string" &&
      /^(0|[1-9][0-9]{0,77})$/.test(x) &&
      BigInt(x) <= max,
    "invalid_amount_or_input",
  );
  return x as string;
};
// /v1/trades accepts client-assigned nonces in the high half; the relay's
// legacy trade reservation allocator owns [0, 2^128).
const TRADE_NONCE_MIN = 1n << 128n;
const UINT256_MAX = (1n << 256n) - 1n;
const tradeStep = (step: string) => step === "open" || step === "close";
const isTerminal = (state: string) =>
  ["confirmed", "executed", "cancelled"].includes(state);
const canSignTrade = (a: any) =>
  !tradeStep(a.step) || BigInt(integer(a.envelope?.intent?.nonce)) >= TRADE_NONCE_MIN;
const relayNotFound = "relay_404_not_found";
const definitiveTradeRejections = new Set(["relay_400_trade_nonce_range_invalid"]);
const orderIdentity = (a: any) => a.envelope?.intent && {
  digest: a.digest,
  relay_request_id: a.id,
  grant_request_id: a.tradeGrantId ?? null,
  session_id: a.envelope.intent.sessionId,
  nonce: a.envelope.intent.nonce,
  deadline: a.envelope.intent.deadline,
  request_key: a.evidence?.request_key ?? null,
};
type ExpiringOrder = { nonce: string; deadline: string };
const exact = (value: any, keys: string[]) =>
  check(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).every((k) => keys.includes(k)),
    "invalid_action_input",
  );
const hash = (s: any) => typeof s === "string" && /^0x[0-9a-fA-F]{64}$/.test(s);
const equal = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
const hasOwnerLogin = (s: any, relayBase: string) =>
  s.authRelayBase === relayBase && Date.parse(s.authUntil) > Date.now();
const receiptAbi = new Interface([
  "function transfer(address,uint256) returns(bool)",
]);
export type WorkflowStep =
  | "login"
  | "create"
  | "deposit"
  | "register"
  | "open"
  | "close"
  | "settle"
  | "revoke";
export interface WorkflowPorts {
  resolve(
    network: string,
    owner: string,
    index: string,
    account?: string,
    sessionId?: string,
  ): Promise<any>;
  relay(state: any, path: string, body?: any): Promise<any>;
  verifyLogin(state: any, challenge: any): void;
  verifyDeposit(state: any, action: any, hash: string): Promise<any>;
  depositTransaction?(state: any, data: string): Promise<any>;
  quote?(state: any): Promise<any>;
  nonceUsed?(state: any, nonce: string): Promise<boolean>;
  requestProof?(state: any, action: any, hash: string): Promise<any>;
  portfolio?(state: any): Promise<any>;
  fill?(state: any, key: string, isOpen: boolean): Promise<any>;
  expiredProof?(state: any, orders: ExpiringOrder[]): Promise<any>;
  settlementProof?(state: any, action: any, hash: string): Promise<any>;
  positionBalance?(state: any, id: string): Promise<string>;
}
export function validateLogin(state: any, c: any) {
  const m = accountManifest(state.network),
    nonce = /\nNonce: ([a-f0-9]{32})\n/.exec(c.message)?.[1],
    issued = /\nIssued At: ([^\n]+)\n/.exec(c.message)?.[1];
  const time = Date.parse(issued ?? ""),
    expiry = Date.parse(c.expiresAt),
    session = Date.parse(c.sessionExpiresAt);
  check(
    nonce &&
      issued &&
      /^[a-f0-9-]{36}$/.test(c.id) &&
      time <= Date.now() + 5000 &&
      expiry === time + 300000 &&
      expiry > Date.now() &&
      session >= expiry &&
      session <= time + 691200000,
    "invalid_owner_challenge",
  );
  const expected = `${m.origin} wants you to sign in with your Ethereum account:\n${getAddress(state.owner)}\n\nSign in to CallPut's sponsored trading service. This signature does not authorize moving funds.\n\nURI: ${m.origin}/v1/auth/session\nVersion: 1\nChain ID: ${m.chainId}\nNonce: ${nonce}\nIssued At: ${issued}\nExpiration Time: ${c.sessionExpiresAt}\nRequest ID: ${c.id}`;
  check(c.message === expected, "owner_challenge_identity_mismatch");
}
export function productionWorkflowPorts(): WorkflowPorts {
  const chain = new AccountChain();
  return {
    resolve: (...args) => chain.resolve(...args),
    verifyLogin: validateLogin,
    verifyDeposit: (...args) => chain.deposit(...args),
    depositTransaction: (s, data) => chain.depositTransaction(s, data),
    nonceUsed: (s, n) => chain.sessionNonce(s, n),
    requestProof: (...args) => chain.requestProof(...args),
    expiredProof: (...args) => chain.expiredProof(...args),
    settlementProof: (...args) => chain.settlementProof(...args),
    positionBalance: (s, id) => chain.positionBalance(s, id),
    async relay(s, path, body) {
      check(/^\/v1\/[a-zA-Z0-9/?=&-]+$/.test(path), "invalid_relay_path");
      const m = accountManifest(s.network);
      const cookieNames = [
        `__Host-callput-owner-${m.chainId}`,
        `__Host-callput-owner-challenge-${m.chainId}`,
      ];
      const cookie = cookieNames
        .filter((name) => s.cookies?.[name])
        .map((name) => `${name}=${s.cookies[name]}`)
        .join("; ");
      let r: Response;
      try {
        r = await fetch(m.relayBase + path, {
          method: body ? "POST" : "GET",
          headers: {
            origin: m.origin,
            "content-type": "application/json",
            ...(cookie ? { cookie } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
      } catch (error) {
        const code = (error as { cause?: { code?: string } })?.cause?.code;
        if (path === "/v1/auth/challenge" && (code === "ENOTFOUND" || code === "EAI_AGAIN"))
          throw Error("relay_dns_unavailable");
        throw Error("relay_outcome_unknown");
      }
      check(
        r.headers.get("content-type")?.split(";")[0] === "application/json",
        "invalid_relay_response",
      );
      const reader = r.body!.getReader();
      let size = 0;
      const chunks = [];
      try {
        for (;;) {
          const x = await reader.read();
          if (x.done) break;
          size += x.value.length;
          check(size <= 65536, "relay_response_too_large");
          chunks.push(x.value);
        }
      } finally {
        await reader.cancel();
      }
      let data;
      try {
        data = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        throw Error("invalid_relay_response");
      }
      if (!r.ok)
        throw Error(
          `relay_${r.status}_${/^[a-z_]{1,80}$/.test(data.error) ? data.error : "rejected"}`,
        );
      s.cookies ??= {};
      for (const c of r.headers.getSetCookie()) {
        const [pair] = c.split(";"),
          i = pair.indexOf("="),
          name = pair.slice(0, i),
          value = pair.slice(i + 1);
        if (cookieNames.includes(name)) {
          check(
            value.length <= 256 && !/[;\r\n]/.test(value),
            "invalid_relay_cookie",
          );
          s.cookies[name] = value;
        }
      }
      return data;
    },
    quote: (s) =>
      withNetwork(s.network, async () => {
        const { asset, strategy } = accountTradeSelection(
          accountManifest(s.network).network, s.policy,
        );
        const scan = await scanSpreads({
          underlyingAsset: asset,
          bias: accountOpenStrategies[strategy].bias,
          maxResults: 1,
        });
        check(scan.candidates?.[0], "no_fresh_spread");
        return scan.candidates[0];
      }),
    portfolio: (s) =>
      withNetwork(s.network, () => getPortfolioSummary({ address: s.account })),
    fill: (...args) => chain.finalizedFill(...args),
  };
}
/** Server owns deterministic sequencing. Wallets own all owner/device keys. */
export class AccountWorkflow {
  constructor(
    private store: WorkflowStore,
    private ports: WorkflowPorts = productionWorkflowPorts(),
  ) {}
  async start(network: string, input: any) {
    exact(input, [
      "owner",
      "sub_index",
      "account",
      "deposit_amount_raw",
      "max_user_amount_raw",
      "max_deposit_gas_wei",
      "underlying_asset",
      "strategy",
    ]);
    const m = accountManifest(network),
      owner = getAddress(input.owner).toLowerCase();
    const trade = accountTradeSelection(m.network, input);
    const policy = {
      underlying_asset: trade.asset,
      strategy: trade.strategy,
      deposit_amount_raw: integer(input.deposit_amount_raw ?? "0", 100000000n),
      max_user_amount_raw: integer(
        input.max_user_amount_raw ?? "100000",
        100000000n,
      ),
      max_deposit_gas_wei: integer(input.max_deposit_gas_wei ?? "0"),
    };
    check(
      BigInt(policy.max_user_amount_raw) > 0n,
      "positive_trade_budget_required",
    );
    if (BigInt(policy.deposit_amount_raw) > 0n)
      check(
        BigInt(policy.max_deposit_gas_wei) > 0n,
        "explicit_deposit_gas_cap_required",
      );
    const sub_index = integer(input.sub_index ?? "0", 9n),
      context = await this.ports.resolve(
        network,
        owner,
        sub_index,
        input.account,
      );
    const s = {
      version: 1,
      network,
      owner,
      account: context.account,
      sub_index,
      policy,
      manifest_version: m.version,
      context,
      actions: [] as any[],
      created_at: new Date().toISOString(),
      next_nonce: TRADE_NONCE_MIN.toString(),
    };
    const token = await this.store.create(s);
    return this.view(s, token);
  }
  private view(s: any, token: string) {
    const unfinished = (a: any) => !isTerminal(a.state),
      m = accountManifest(s.network),
      trade = accountTradeSelection(m.network, s.policy),
      active =
        s.actions.find((a: any) => a.step === "revoke" && unfinished(a)) ??
        s.actions.find((a: any) => a.step === "login" && unfinished(a)) ??
        s.actions.find(unfinished);
    let state = "session_required";
    if (!s.device) state = "wallet_required";
    else if (active)
      state =
        active.state === "prepared"
          ? "awaiting_user"
          : active.state === "blocked"
            ? "blocked"
            : "observing";
    else if (
      s.actions.some((a: any) => a.step === "open" && a.state === "executed")
    )
      state = "trade_executed";
    else if (
      s.sessionInstalled &&
      BigInt(s.grant.validUntil) > BigInt(s.context.blockTimestamp) &&
      !s.sessionRevoked
    )
      state = "session_ready";
    else if (s.grant) state = "blocked";
    else if (!hasOwnerLogin(s, m.relayBase))
      state = "auth_required";
    else if (!s.context.created) state = "account_required";
    else if (BigInt(s.context.balance) === 0n && !s.depositConfirmed)
      state = "deposit_required";
    const step =
      state === "auth_required"
        ? "login"
        : state === "account_required"
          ? "create"
          : state === "deposit_required"
            ? "deposit"
            : state === "session_required"
              ? "register"
              : state === "session_ready"
                ? "open"
                : undefined;
    const grantExpired = s.grant &&
      BigInt(s.context.blockTimestamp) > BigInt(s.grant.validUntil);
    const signedTrade = s.actions.some((a: any) =>
      (tradeStep(a.step) || a.step === "settle") && !!a.result &&
      a.reason !== "finalized_unused_expired");
    const next_actions = active
      ? [
          {
            tool:
              active.state === "preparing"
                ? "callput_action_prepare"
                : active.state === "prepared"
                  ? active.step === "create"
                    ? "callput_action_submit"
                    : "callput_action_begin"
                  : "callput_action_status",
            arguments:
              active.state === "preparing"
                ? { workflow_id: token, step: active.step, input: active.input }
                : {
                    workflow_id: token,
                    action_id: active.id,
                    ...(active.step === "create" && active.state === "prepared"
                      ? { result: {} }
                      : {}),
                  },
            wallet_approval_url: `${m.origin}/mcp-wallet.html#${token}`,
          },
        ]
      : step
        ? [
            {
              tool: "callput_action_prepare",
              arguments: { workflow_id: token, step, input: {} },
            },
          ]
        : grantExpired && state === "blocked" && !signedTrade
          ? [{ tool: "callput_workflow_recover", arguments: { workflow_id: token } }]
        : state === "wallet_required"
          ? [
              {
                tool: "callput_wallet_connect",
                arguments: { workflow_id: token },
                wallet_approval_url: `${m.origin}/mcp-wallet.html#${token}`,
              },
            ]
          : [];
    return {
      workflow_id: token,
      state,
      network: s.network,
      chain_id: m.chainId,
      owner: s.owner,
      account: s.account,
      sub_index: s.sub_index,
      device_signer: s.device ?? null,
      policy: { ...s.policy, underlying_asset: trade.asset, strategy: trade.strategy,
        underlying_asset_index: String(trade.index) },
      policy_version: s.manifest_version,
      context: s.context,
      session: s.sessionId
        ? {
            id: s.sessionId,
            signer: s.device,
            installed: !!s.sessionInstalled,
            revoked: !!s.sessionRevoked,
            valid_until: s.grant.validUntil,
          }
        : null,
      wallet_approval_url: `${m.origin}/mcp-wallet.html#${token}`,
      next_actions,
      recovery_evidence: s.history?.at(-1)?.proof ?? null,
      recovery: grantExpired ? {
        tool: "callput_workflow_recover",
        requires: "finalized_expired_zero_use_and_signed_order_reconciliation",
      } : null,
      blocked_reason:
        active?.reason ??
        (s.grant && state === "blocked"
          ? "session_expired_or_revoked_budget_reserved"
          : null),
      retry_after_ms: active && active.state !== "prepared" ? 3000 : null,
      actions: s.actions.map((a: any) => ({
        action_id: a.id,
        step: a.step,
        state: a.state,
        relay_id: a.relayId,
        transaction_hash: a.hash,
        evidence: a.evidence,
        reason: a.reason,
        admission: a.admission ?? null,
        observation_reason: a.observationReason ?? null,
        relay_state: a.relayState ?? null,
        trade: orderIdentity(a) ?? null,
      })),
      wallet_capabilities_required: [
        "personal_sign",
        "eth_signTypedData_v4",
        "eth_sendTransaction",
      ],
      fees: m.fees,
    };
  }
  async connect(token: string, input: any) {
    return this.store.update(token, async (s) => {
      exact(input, ["owner", "chain_id", "device_signer"]);
      check(
        getAddress(input.owner).toLowerCase() === s.owner &&
          input.chain_id === accountManifest(s.network).chainId,
        "wallet_identity_changed",
      );
      const device = getAddress(input.device_signer).toLowerCase();
      check(
        device !== s.owner && device !== "0x" + "0".repeat(40),
        "separate_device_signer_required",
      );
      check(!s.device || s.device === device, "device_signer_changed");
      s.device = device;
      return this.view(s, token);
    });
  }
  async status(token: string) {
    return this.store.update(token, async (s, checkpoint) => {
      s.context = await this.ports.resolve(
        s.network,
        s.owner,
        s.sub_index,
        s.account,
        s.sessionId,
      );
      for (const active of s.actions.filter(
        (a: any) => a.state === "submitted" || a.state === "unknown" ||
          (tradeStep(a.step) && a.state === "blocked" && a.result),
      )) {
        try {
          await this.observe(s, active, checkpoint);
        } catch (error) {
          active.state = "unknown";
          active.reason = active.observationReason = safeWorkflowError(error);
        }
      }
      return this.view(s, token);
    });
  }
  async action(token: string, id: string) {
    const s = await this.store.read(token),
      a = s.actions.find((a: any) => a.id === id);
    check(a, "action_not_found");
    return this.publicAction(s, a, token);
  }
  private publicAction(s: any, a: any, token: string) {
    return {
      ...this.view(s, token),
      action_id: a.id,
      step: a.step,
      action_state: a.state,
      wallet_request: a.wallet_request,
      message: a.message,
      digest: a.digest,
      signer: a.signer,
      expires_at: a.expires_at,
      summary: a.summary,
      fee_payer: a.fee_payer,
      submit_result_with: {
        tool: "callput_action_submit",
        arguments: { workflow_id: token, action_id: a.id },
        result_field: "result",
        result_kind:
          a.step === "deposit"
            ? "transaction_hash"
            : a.step === "create"
              ? "empty_object"
              : "signature",
      },
    };
  }
  async pending(token: string) {
    const s = await this.store.read(token),
      ready = (a: any) => ["prepared", "wallet_pending"].includes(a.state),
      a =
        s.actions.find((a: any) => a.step === "revoke" && ready(a)) ??
        s.actions.find((a: any) => a.step === "login" && ready(a)) ??
        s.actions.find(ready);
    return {
      ...this.view(s, token),
      pending_action: a ? this.publicAction(s, a, token) : null,
    };
  }
  async begin(token: string, id: string) {
    return this.store.update(token, async (s) => {
      const a = s.actions.find((x: any) => x.id === id);
      check(a, "action_not_found");
      check(canSignTrade(a), "legacy_trade_nonce_requires_reconciliation");
      const mayExecute = a.state === "prepared";
      check(mayExecute || a.state === "wallet_pending", "action_not_ready");
      if (mayExecute) {
        s.context = await this.ports.resolve(
          s.network,
          s.owner,
          s.sub_index,
          s.account,
          s.sessionId,
        );
        check(
          !a.expires_at || Date.parse(a.expires_at) > Date.now(),
          "action_expired_budget_reserved",
        );
        a.state = "wallet_pending";
      }
      return {
        ...this.publicAction(s, a, token),
        wallet_request_may_execute: mayExecute,
      };
    });
  }
  async retryWallet(token: string, id: string) {
    return this.store.update(token, async (s) => {
      const a = s.actions.find((x: any) => x.id === id);
      check(
        a?.state === "wallet_pending" && !a.result,
        "original_wallet_result_requires_reconciliation",
      );
      check(
        a.step !== "deposit" ||
          a.wallet_request?.params?.[0]?.nonce !== undefined,
        "deposit_nonce_not_fixed",
      );
      check(canSignTrade(a), "legacy_trade_nonce_requires_reconciliation");
      a.state = "prepared";
      return this.publicAction(s, a, token);
    });
  }
  async prepare(token: string, step: WorkflowStep, input: any) {
    return this.store.update(token, async (s, checkpoint) => {
      try {
        check(s.device, "wallet_connection_required");
        check(
          s.manifest_version === accountManifest(s.network).version,
          "deployment_policy_changed",
        );
        let existing = s.actions.find(
          (a: any) =>
            (!["revoke", "login"].includes(step) || a.step === step) &&
            !["confirmed", "executed", "cancelled"].includes(a.state),
        );
        if (
          existing?.state === "preparing" &&
          ["open", "close", "deposit", "settle"].includes(existing.step) &&
          !existing.result &&
          !existing.envelope &&
          !existing.grant &&
          (!equal(existing.input, input) || existing.step !== step)
        ) {
          existing.state = "cancelled";
          existing.reason = "unsigned_preparation_replaced";
          existing = undefined;
        }
        if (
          step === "login" &&
          existing?.step === "login" &&
          (["blocked", "unknown"].includes(existing.state) ||
            (!existing.result && existing.expires_at && Date.parse(existing.expires_at) <= Date.now()) ||
            (existing.challenge &&
              !existing.challenge.message.startsWith(accountManifest(s.network).origin + " ")))
        ) {
          existing.state = "cancelled";
          existing.reason = "owner_login_restarted";
          existing = undefined;
        }
        if (existing) {
          check(
            existing.step === step && equal(existing.input, input),
            "unresolved_action_must_be_preserved",
          );
          if (existing.state !== "preparing")
            return this.publicAction(s, existing, token);
        }
        s.context = await this.ports.resolve(
          s.network,
          s.owner,
          s.sub_index,
          s.account,
          s.sessionId,
        );
        const c = s.context,
          m = accountManifest(s.network),
          trade = accountTradeSelection(m.network, s.policy),
          strategy = accountOpenStrategies[trade.strategy],
          assetIndex = String(trade.index);
        if (["create", "register"].includes(step))
          check(
            hasOwnerLogin(s, m.relayBase),
            "owner_login_required",
          );
        if (step !== "login" && step !== "create")
          check(c.created, "account_creation_required");
        if (["login", "create", "deposit", "register"].includes(step))
          exact(input, []);
        const a = existing ?? {
          id: randomUUID(),
          step,
          input,
          state: "preparing",
          signer: s.owner,
          fee_payer: m.fees[step as keyof typeof m.fees] ?? "none",
        };
        if (!existing) s.actions.push(a);
        await checkpoint();
        if (step === "login") {
          const challenge = await this.ports.relay(s, "/v1/auth/challenge", {
            owner: s.owner,
          });
          this.ports.verifyLogin(s, challenge);
          a.challenge = challenge;
          a.message = challenge.message;
          a.expires_at = challenge.expiresAt;
          a.wallet_request = {
            method: "personal_sign",
            params: [
              "0x" + Buffer.from(challenge.message).toString("hex"),
              s.owner,
            ],
          };
          a.summary =
            "Sign in to the selected CallPut relay. No funds or trading permission.";
        } else if (step === "create") {
          check(!c.created, "account_already_created");
          a.summary =
            "Create the verified sub-account. Protocol sponsors this operation.";
          a.wallet_request = null;
        } else if (step === "deposit") {
          check(
            !s.depositConfirmed && BigInt(s.policy.deposit_amount_raw) > 0n,
            "deposit_amount_not_authorized",
          );
          const transaction = await this.ports.depositTransaction!(
            s,
            receiptAbi.encodeFunctionData("transfer", [
              s.account,
              s.policy.deposit_amount_raw,
            ]),
          );
          a.wallet_request = {
            method: "eth_sendTransaction",
            params: [transaction],
          };
          a.summary = `Transfer exactly ${s.policy.deposit_amount_raw} raw ${m.symbol} to ${s.account}. Owner pays gas capped at ${s.policy.max_deposit_gas_wei} wei.`;
        } else if (step === "register") {
          check(
            !s.grant || (a.grant && equal(s.grant, a.grant)),
            "existing_grant_budget_reserved",
          );
          check(BigInt(c.balance) > 0n, "account_not_funded");
          const recovery = await this.ports.relay(
            s,
            `/v1/grant-recovery/${s.account}`,
          );
          check(
            recovery.owner === s.owner &&
              recovery.account === s.account &&
              recovery.chainId === String(m.chainId) &&
              recovery.hasMore === false &&
              Array.isArray(recovery.pending) &&
              recovery.pending.every((p: any) => p.id === a.id),
            "existing_grant_reconciliation_required",
          );
          const reservation = await this.ports.relay(s, "/v1/reservations", {
            account: s.account,
            kind: "grant",
            requestId: a.id,
          });
          check(
            reservation.id === a.id &&
              reservation.account === s.account &&
              reservation.owner === s.owner &&
              reservation.chainId === String(m.chainId) &&
              reservation.epoch === c.epoch &&
              reservation.scope === `grant:${c.epoch}` &&
              reservation.epochKnown === true,
            "grant_reservation_mismatch",
          );
          const grant = a.grant ?? {
            signer: s.device,
            nonce: integer(reservation.nonce),
            epoch: c.epoch,
            validAfter: c.blockTimestamp,
            validUntil: (BigInt(c.blockTimestamp) + 600n).toString(),
            underlyings: [assetIndex],
            strategies: strategy.bit,
            maxAmountPerOpen: s.policy.max_user_amount_raw,
            maxAmount: s.policy.max_user_amount_raw,
            maxOpens: "1",
            maxCloses: "1",
            maxFeePerTrade: m.maxFeePerTrade,
            maxFees: (BigInt(m.maxFeePerTrade) * 2n).toString(),
          };
          check(
            grant.nonce === reservation.nonce &&
              grant.epoch === c.epoch &&
              BigInt(grant.validUntil) > BigInt(c.blockTimestamp) + 30n,
            "saved_grant_expired_or_changed",
          );
          // The full cap is reserved locally before the owner may sign, even on HTTP loss.
          a.grant = grant;
          s.grant = grant;
          s.grantId = a.id;
          s.sessionId = TypedDataEncoder.hashStruct(
            "Grant",
            { Grant: accountTypes.Grant },
            grant,
          );
          await checkpoint();
          const prepared = await this.ports.relay(s, "/v1/grant-preparations", {
            account: s.account,
            requestId: a.id,
            grant,
          });
          check(equal(prepared.grant, grant), "prepared_grant_changed");
          this.typed(
            s,
            a,
            "Grant",
            { Grant: accountTypes.Grant },
            grant,
            s.owner,
          );
          a.summary = `Authorize device ${s.device} for one ${trade.asset} ${trade.strategy}, one close, maximum ${grant.maxAmount} raw ${m.symbol}, for 10 minutes. No withdrawals.`;
        } else if (step === "open" || step === "close") {
          check(
            s.sessionInstalled &&
              !s.sessionRevoked &&
              BigInt(s.grant.validUntil) > BigInt(c.blockTimestamp) + 30n,
            "session_expired_or_not_installed",
          );
          check(c.epoch === s.grant.epoch, "session_epoch_changed");
          check(
            s.grant.strategies === strategy.bit && equal(s.grant.underlyings, [assetIndex]),
            "session_trade_policy_mismatch",
          );
          check(
            !s.actions.some(
              (x: any) =>
                x.step === step && x.id !== a.id && x.state === "executed",
            ),
            "session_action_limit_reached",
          );
          let params: any;
          if (step === "open") {
            exact(input, ["size", "min_fill_ratio"]);
            const size = input.size ?? "0.0001",
              ratio = input.min_fill_ratio ?? 0.78,
              isBuy = trade.strategy.startsWith("Buy"),
              isCall = trade.strategy.includes("Call");
            check(
              typeof size === "string" &&
                /^(0|[1-9]\d{0,17})(\.\d{1,18})?$/.test(size) &&
                (size.split(".")[1]?.length ?? 0) <= trade.decimals &&
                typeof ratio === "number" &&
                ratio >= 0.5 &&
                ratio <= 1,
              "invalid_open_input",
            );
            const candidate = await this.ports.quote!(s);
            check(
              candidate.strategy === trade.strategy &&
                Number.isFinite(candidate.estimated_amount_in_per_unit) &&
                candidate.estimated_amount_in_per_unit > 0,
              "invalid_quote",
            );
            const sizeRaw = parseUnits(size, trade.decimals);
            check(sizeRaw > 0n, "invalid_open_size");
            const quoteScale = 10n ** BigInt(12 + trade.decimals);
            const amount =
              (parseUnits(
                candidate.estimated_amount_in_per_unit.toFixed(12),
                12,
              ) *
                sizeRaw *
                1000000n +
                quoteScale -
                1n) /
              quoteScale;
            check(
              amount > 0n &&
                amount <= BigInt(s.policy.max_user_amount_raw) &&
                amount <= BigInt(c.balance),
              "quote_exceeds_budget_or_balance",
            );
            const ids = [candidate.long_leg_id, candidate.short_leg_id].map(
              (x: string) => toBeHex(BigInt(x), 32),
            );
            const first = parseOptionTokenId(ids[0]),
              second = parseOptionTokenId(ids[1]);
            check(
              first.underlyingAssetIndex === trade.index &&
                second.underlyingAssetIndex === trade.index &&
                first.expirySec === second.expirySec &&
                first.expirySec > Number(c.blockTimestamp) + 60 &&
                first.strikePrice > 0 && second.strikePrice > 0 &&
                (isCall ? first.strikePrice < second.strikePrice : first.strikePrice > second.strikePrice),
              "invalid_spread_identity",
            );
            const minSize =
              (sizeRaw * BigInt(Math.floor(ratio * 1000000))) / 1000000n;
            check(minSize > 0n, "invalid_minimum_size");
            params = {
              underlyingAssetIndex: assetIndex,
              length: "2",
              isBuys: [isBuy, !isBuy, false, false],
              optionIds: [...ids, toBeHex(0, 32), toBeHex(0, 32)],
              isCalls: [isCall, isCall, false, false],
              minSize: minSize.toString(),
              amountIn: amount.toString(),
            };
          } else {
            exact(input, ["option_token_id", "size_raw", "min_amount_out_raw"]);
            params = {
              underlyingAssetIndex: assetIndex,
              optionTokenId: integer(input.option_token_id),
              size: integer(input.size_raw),
              minAmountOut: integer(input.min_amount_out_raw),
            };
            check(
              BigInt(params.size) > 0n && BigInt(params.minAmountOut) > 0n,
              "positive_close_floor_required",
            );
          }
          // Upgrade only the allocator, never an existing envelope. Old counters
          // were in the relay-reserved range; the chain bitmap scopes this per session.
          check(s.next_nonce !== null, "session_trade_nonce_exhausted");
          const next = BigInt(integer(s.next_nonce));
          const nonce = (next < TRADE_NONCE_MIN ? TRADE_NONCE_MIN : next).toString();
          check(this.ports.nonceUsed && !(await this.ports.nonceUsed(s, nonce)),
            "session_nonce_already_used_or_unverified");
          s.next_nonce = BigInt(nonce) === UINT256_MAX ? null : (BigInt(nonce) + 1n).toString();
          const intent = {
            sessionId: s.sessionId,
            epoch: s.grant.epoch,
            nonce,
            deadline: (BigInt(c.blockTimestamp) + 120n <
            BigInt(s.grant.validUntil)
              ? BigInt(c.blockTimestamp) + 120n
              : BigInt(s.grant.validUntil)
            ).toString(),
            source: "0",
          };
          const types =
            step === "open"
              ? { Open: accountTypes.Open, OpenIntent: accountTypes.OpenIntent }
              : {
                  Close: accountTypes.Close,
                  CloseIntent: accountTypes.CloseIntent,
                };
          this.typed(
            s,
            a,
            step === "open" ? "OpenIntent" : "CloseIntent",
            types,
            { ...intent, params },
            s.device,
          );
          a.tradeGrantId = s.grantId;
          a.envelope = {
            version: 1,
            chainId: String(m.chainId),
            account: s.account,
            reservation: a.id,
            action: step,
            grant: s.grant,
            intent,
            params,
          };
          a.before = await this.ports.portfolio!(s);
          if (step === "close") {
            check(
              a.before.positions.some(
                (p: any) =>
                  BigInt(p.token_id) === BigInt(params.optionTokenId) &&
                  p.underlying === trade.asset &&
                  p.expiry_sec > Number(c.blockTimestamp),
              ),
              "unexpired_owned_position_required",
            );
            check(
              BigInt(
                await this.ports.positionBalance!(s, params.optionTokenId),
              ) >= BigInt(params.size),
              "close_size_exceeds_owned_balance",
            );
          }
          a.summary = `${step === "open" ? `Open one ${trade.asset} ${trade.strategy}` : `Close one ${trade.asset} position`} within the installed grant. Protocol sponsors native execution; no owner-wallet transaction.`;
        } else if (step === "settle") {
          exact(input, ["option_token_id"]);
          check(s.sessionInstalled && !s.sessionRevoked, "session_required");
          const value = {
            optionTokenId: integer(input.option_token_id),
            requestId: a.id,
            retryOf: "",
          };
          a.before = await this.ports.portfolio!(s);
          check(
            a.before.positions.some(
              (p: any) =>
                BigInt(p.token_id) === BigInt(value.optionTokenId) &&
                p.expiry_sec <= Number(c.blockTimestamp) &&
                p.size > 0,
            ),
            "expired_owned_position_required",
          );
          this.typed(
            s,
            a,
            "SponsoredSettlement",
            { SponsoredSettlement: accountTypes.SponsoredSettlement },
            value,
            s.device,
          );
          a.summary =
            "Ask the protocol sponsor to settle this expired account position. Recipient is fixed by the protocol.";
        } else if (step === "revoke") {
          exact(input, []);
          check(s.sessionId, "session_required");
          const control = await this.ports.relay(
            s,
            `/v1/owner-context/${s.account}`,
          );
          check(
            control.owner === s.owner &&
              control.account === s.account &&
              control.chainId === String(m.chainId) &&
              control.epoch === c.epoch &&
              !control.pending,
            "owner_context_mismatch_or_pending",
          );
          const params = {
            sessionId: s.sessionId,
            epoch: c.epoch,
            nonce: integer(control.nonce),
            deadline: (BigInt(c.blockTimestamp) + 120n).toString(),
          };
          this.typed(
            s,
            a,
            "RevokeSession",
            { RevokeSession: accountTypes.RevokeSession },
            params,
            s.owner,
          );
          a.envelope = {
            version: 1,
            chainId: String(m.chainId),
            account: s.account,
            reservation: a.id,
            action: "revoke",
            params,
          };
          a.summary =
            "Revoke only this device session using the owner signature. No withdrawal.";
        } else throw Error("unsupported_workflow_step");
        a.state = "prepared";
        delete a.reason;
        return this.publicAction(s, a, token);
      } catch (error) {
        const failed = s.actions.find((a: any) => a.state === "preparing");
        if (failed) failed.reason = safeWorkflowError(error);
        await checkpoint();
        throw error;
      }
    });
  }
  private typed(
    s: any,
    a: any,
    primaryType: string,
    types: any,
    message: any,
    signer: string,
  ) {
    const domain = accountDomain(accountManifest(s.network).chainId, s.account);
    a.typed = { domain, types, primaryType, message };
    a.digest = TypedDataEncoder.hash(domain, types, message);
    a.signer = signer;
    a.wallet_request = {
      method: "eth_signTypedData_v4",
      params: [signer, JSON.stringify(a.typed)],
    };
    a.expires_at = new Date(
      Number(
        message.deadline ?? message.validUntil ?? s.grant?.validUntil ?? 0,
      ) * 1000,
    ).toISOString();
  }
  async submit(token: string, id: string, result: any) {
    return this.store.update(token, async (s, checkpoint) => {
      exact(result, ["signature", "transaction_hash"]);
      const a = s.actions.find((x: any) => x.id === id);
      check(a && a.state !== "preparing", "action_not_ready");
      if (a.result) {
        check(equal(a.result, result), "signed_result_must_be_preserved");
        if (isTerminal(a.state)) return this.publicAction(s, a, token);
        await this.observe(s, a, checkpoint);
        if (a.state !== "unknown") return this.publicAction(s, a, token);
        if (tradeStep(a.step)) {
          if (a.admission?.state === "rejected_before_admission" ||
              a.admission?.state === "accepted" || a.hash || !canSignTrade(a) ||
              Date.parse(a.expires_at) <= Date.now())
            return this.publicAction(s, a, token);
          check(a.observationReason === relayNotFound, "submission_outcome_unknown_observe_only");
        } else {
          check(a.retry404, "submission_outcome_unknown_observe_only");
        }
      } else {
        check(canSignTrade(a), "legacy_trade_nonce_requires_reconciliation");
        check(
          a.state === "prepared" || a.state === "wallet_pending",
          "action_not_prepared",
        );
        check(
          !a.expires_at || Date.parse(a.expires_at) > Date.now(),
          "action_expired_budget_reserved",
        );
        if (a.step === "deposit")
          check(
            hash(result.transaction_hash) && !result.signature,
            "deposit_transaction_hash_required",
          );
        else if (a.step !== "create") {
          check(
            typeof result.signature === "string" &&
              /^0x[0-9a-fA-F]{130}$/.test(result.signature) &&
              !result.transaction_hash,
            "signature_required",
          );
          const signer =
            a.step === "login"
              ? verifyMessage(a.message, result.signature)
              : verifyTypedData(
                  a.typed.domain,
                  a.typed.types,
                  a.typed.message,
                  result.signature,
                );
          check(signer.toLowerCase() === a.signer, "signature_signer_mismatch");
        } else
          check(
            Object.keys(result).length === 0,
            "creation_has_no_wallet_transaction",
          );
        a.result = result;
        if (tradeStep(a.step)) a.tradeGrantId ??= s.grantId;
        a.state = "submitted";
        if (result.transaction_hash) a.hash = result.transaction_hash;
        if (a.envelope && result.signature)
          a.envelope.signature = result.signature;
        await checkpoint();
      }
      try {
        let response: any;
        if (a.step !== "login" && a.step !== "deposit") {
          s.context = await this.ports.resolve(
            s.network,
            s.owner,
            s.sub_index,
            s.account,
            s.sessionId,
          );
          if (a.typed?.message?.epoch !== undefined)
            check(
              a.typed.message.epoch === s.context.epoch,
              "authorization_epoch_changed",
            );
        }
        if (a.step === "login") {
          response = await this.ports.relay(s, "/v1/auth/verify", {
            id: a.challenge.id,
            message: a.message,
            signature: result.signature,
          });
          check(
            response.owner?.toLowerCase() === s.owner &&
              String(response.chainId) ===
                String(accountManifest(s.network).chainId) &&
              response.expiresAt === a.challenge.sessionExpiresAt,
            "login_principal_mismatch",
          );
          s.authUntil = response.expiresAt;
          s.authRelayBase = accountManifest(s.network).relayBase;
          a.state = "confirmed";
        } else if (a.step === "deposit") {
          await this.observe(s, a, checkpoint);
        } else {
          if (a.step === "create")
            response = await this.ports.relay(s, "/v1/accounts", {
              subIndex: s.sub_index,
              requestId: a.id,
            });
          if (a.step === "register")
            response = await this.ports.relay(s, "/v1/operations", {
              version: 1,
              chainId: String(accountManifest(s.network).chainId),
              account: s.account,
              reservation: a.id,
              action: "register",
              grant: a.grant,
              signature: result.signature,
            });
          if (tradeStep(a.step)) {
            check(a.envelope.intent.sessionId === s.sessionId &&
              (!a.tradeGrantId || a.tradeGrantId === s.grantId), "trade_session_changed");
            check(BigInt(a.envelope.intent.deadline) >= BigInt(s.context.blockTimestamp),
              "action_expired_budget_reserved");
            // A crash immediately before/after POST is indistinguishable on restart.
            a.admission = { state: "outcome_unknown", reason: "awaiting_relay_ack" };
            await checkpoint();
            response = await this.ports.relay(s, "/v1/trades", {
              grantRequestId: a.tradeGrantId ?? s.grantId,
              order: a.envelope,
            });
          }
          if (a.step === "settle")
            response = await this.ports.relay(s, "/v1/session-settlements", {
              grantRequestId: s.grantId,
              settlement: {
                account: s.account,
                optionTokenId: a.input.option_token_id,
                requestId: a.id,
                retryOf: null,
                signature: result.signature,
              },
            });
          if (a.step === "revoke")
            response = await this.ports.relay(s, "/v1/owner-actions", {
              owner: s.owner,
              action: a.envelope,
            });
          check(
            response?.account === s.account &&
              typeof response.id === "string" &&
              /^[a-f0-9-]{36}$/.test(response.id),
            "relay_submission_identity_mismatch",
          );
          check(
            a.step === "settle" || response.id === a.id,
            "relay_request_id_mismatch",
          );
          check(!response.hash || hash(response.hash), "invalid_relay_transaction_hash");
          if (tradeStep(a.step)) {
            check((!response.action || response.action === a.step) &&
              (!response.digest || response.digest === a.digest), "relay_trade_digest_mismatch");
            a.admission = { state: "accepted" };
            a.relayState = response.state;
            a.state = "submitted";
            delete a.reason;
            delete a.observationReason;
          }
          a.relayId = response.id;
          a.hash = response.hash ?? a.hash ?? null;
        }
      } catch (error) {
        a.state = "unknown";
        a.reason = safeWorkflowError(error);
        if (tradeStep(a.step) && a.admission?.state === "outcome_unknown") {
          a.admission = {
            state: definitiveTradeRejections.has(a.reason) ? "rejected_before_admission" : "outcome_unknown",
            reason: a.reason,
          };
        }
        await checkpoint();
        throw Error(a.reason);
      }
      return this.publicAction(s, a, token);
    });
  }
  private async observe(s: any, a: any, checkpoint: () => Promise<void>) {
    if (a.step === "deposit") {
      const proof = await this.ports.verifyDeposit(s, a, a.hash);
      if (proof.confirmed) {
        a.state = "confirmed";
        a.evidence = proof;
        s.depositConfirmed = true;
        s.context = await this.ports.resolve(
          s.network,
          s.owner,
          s.sub_index,
          s.account,
          s.sessionId,
        );
      }
      return;
    }
    if (a.step === "login") {
      a.state = "blocked";
      a.reason = "login_outcome_unknown_reconnect_required";
      return;
    }
    if (a.step === "register") {
      const selected = s.context.sessions.find(
        (x: any) => x.sessionId === s.sessionId,
      );
      if (selected?.installed && !selected.revoked) {
        a.state = "confirmed";
        s.sessionInstalled = true;
        a.evidence = {
          session_id: s.sessionId,
          block_hash: s.context.blockHash,
        };
        return;
      }
    }
    if (
      a.step === "revoke" &&
      s.context.sessions.find((x: any) => x.sessionId === s.sessionId)?.revoked
    ) {
      a.state = "confirmed";
      s.sessionRevoked = true;
      return;
    }
    if (tradeStep(a.step) && !a.admission && definitiveTradeRejections.has(a.reason))
      a.admission = { state: "rejected_before_admission", reason: a.reason };
    const id = a.relayId ?? a.id,
      path = ["open", "close", "settle"].includes(a.step)
        ? `/v1/trades/${id}`
        : a.step === "revoke"
          ? `/v1/owner-actions/${id}`
          : `/v1/operations/${id}`;
    let r: any;
    try {
      r = await this.ports.relay(s, path);
    } catch (error) {
      a.state = "unknown";
      a.reason = a.observationReason = safeWorkflowError(error);
      a.retry404 = a.observationReason === relayNotFound;
      // A status outage cannot discard a transaction hash already observed.
      if (!tradeStep(a.step) || !a.hash) return;
    }
    if (r) {
      check(r.account === s.account && r.id === id, "relay_status_identity_mismatch");
      check(!r.hash || hash(r.hash), "invalid_relay_transaction_hash");
      if (tradeStep(a.step)) {
        check((!r.action || r.action === a.step) && (!r.digest || r.digest === a.digest),
          "relay_trade_digest_mismatch");
        a.admission = { state: "accepted" };
        a.relayState = r.state;
      }
      delete a.observationReason;
      delete a.reason;
      a.state = "submitted";
      a.retry404 = false;
      a.relayId = id;
      a.hash = r.hash ?? a.hash;
      if (["reverted", "transport_cancelled", "blocked", "resolved"].includes(r.state)) {
        a.state = "blocked";
        a.reason = "relay_" + r.state;
        // Transport cancellation/revert conveys no PositionManager outcome.
        return;
      }
    }
    if (a.step === "create" && s.context.created) {
      a.state = "confirmed";
      a.evidence = { account: s.account, block_hash: s.context.blockHash };
      return;
    }
    if (tradeStep(a.step) && a.hash) {
      const proof = await this.ports.requestProof!(s, a, a.hash);
      if (!proof) return;
      a.evidence = proof;
      await checkpoint();
      const fill = await this.ports.fill!(s, proof.request_key, a.step === "open");
      if (fill.status !== "executed" && fill.status !== "cancelled") return;
      check(fill.account?.toLowerCase() === s.account &&
        fill.request_key === proof.request_key, "keeper_request_identity_mismatch");
      if (fill.status === "cancelled") {
        a.state = "cancelled";
        a.evidence = { ...proof, keeper: fill };
        a.reason = "keeper_cancelled";
        return;
      }
      const after = await this.ports.portfolio!(s);
      if (a.step === "open") {
        check(BigInt(fill.size_out) > 0n, "empty_keeper_fill");
        const params = a.envelope.params,
          first = parseOptionTokenId(params.optionIds[0]),
          second = parseOptionTokenId(params.optionIds[1]),
          { asset } = accountTradeSelection(accountManifest(s.network).network, s.policy),
          optionType = params.isCalls[0] ? "Call" : "Put",
          side = params.isBuys[0] ? "long" : "short";
        const total = (p: any) =>
          p.positions
            .filter(
              (x: any) =>
                x.underlying === asset &&
                x.option_type === optionType &&
                x.side === side &&
                x.expiry_sec === first.expirySec &&
                x.naked_strike === Math.min(first.strikePrice, second.strikePrice) &&
                x.pair_strike === Math.max(first.strikePrice, second.strikePrice),
            )
            .reduce((v: number, x: any) => v + x.size, 0);
        check(total(after) > total(a.before), "position_delta_not_observed");
      } else {
        const params = a.envelope.params,
          total = (p: any) =>
            p.positions
              .filter(
                (x: any) => BigInt(x.token_id) === BigInt(params.optionTokenId),
              )
              .reduce((v: number, x: any) => v + x.size, 0);
        check(
          total(after) < total(a.before),
          "close_position_delta_not_observed",
        );
      }
      a.evidence = { ...proof, keeper: fill, position_verified: true };
      a.state = "executed";
      delete a.reason;
    }
    if (a.step === "settle" && a.hash) {
      const proof = await this.ports.settlementProof!(s, a, a.hash);
      if (!proof) return;
      const after = await this.ports.portfolio!(s),
        total = (p: any) =>
          p.positions
            .filter(
              (x: any) =>
                BigInt(x.token_id) === BigInt(a.input.option_token_id),
            )
            .reduce((n: number, x: any) => n + x.size, 0);
      check(
        total(after) < total(a.before),
        "settlement_position_delta_not_observed",
      );
      a.state = "executed";
      a.evidence = { ...proof, position_verified: true };
    }
  }
  async recover(token: string) {
    return this.store.update(token, async (s, checkpoint) => {
      check(s.grant, "no_reserved_grant");
      const signed = s.actions.filter((a: any) =>
        (tradeStep(a.step) || a.step === "settle") && a.result &&
        a.reason !== "finalized_unused_expired");
      const orders: ExpiringOrder[] = [];
      for (const a of signed) {
        const intent = a.envelope?.intent;
        check(tradeStep(a.step) && intent?.sessionId === s.sessionId &&
          (!a.tradeGrantId || a.tradeGrantId === s.grantId) &&
          hash(a.digest) && intent.epoch === s.grant.epoch &&
          !a.hash && !a.evidence?.request_key && a.admission?.state !== "accepted" &&
          (!a.relayId || a.relayId === a.id), "signed_order_requires_reconciliation");
        const deadline = integer(intent.deadline);
        check(BigInt(deadline) <= BigInt(s.grant.validUntil) &&
          BigInt(s.context.blockTimestamp) > BigInt(s.grant.validUntil),
          "signed_order_requires_reconciliation");
        // Absence is only supporting evidence; the chain proof below is mandatory.
        let absent = false;
        try { await this.ports.relay(s, `/v1/trades/${a.id}`); }
        catch (error) { absent = safeWorkflowError(error) === relayNotFound; }
        check(absent, "signed_order_requires_reconciliation");
        orders.push({ nonce: integer(intent.nonce), deadline });
      }
      let proof: any;
      try { proof = await this.ports.expiredProof!(s, orders); }
      catch (error) {
        const reason = safeWorkflowError(error);
        throw Error(reason === "workflow_verification_failed" ? "finalized_recovery_rpc_unavailable" : reason);
      }
      check(
        proof.kind === "finalized_unused_expired" &&
          proof.session_id === s.sessionId &&
          proof.grant_id === s.grantId &&
          orders.every(({ nonce }) => proof.order_nonces?.some(
            (entry: any) => entry.nonce === nonce && entry.used === false)),
        "recovery_proof_mismatch",
      );
      s.history ??= [];
      s.history.push({
        grant: s.grant,
        grantId: s.grantId,
        sessionId: s.sessionId,
        proof,
      });
      for (const a of s.actions)
        if (["register", "revoke", "open", "close", "settle"].includes(a.step) &&
            !isTerminal(a.state)) {
          a.state = "cancelled";
          a.reason = "finalized_unused_expired";
          if (signed.includes(a)) a.evidence = { ...proof, relay_lookup: "not_found" };
        }
      delete s.grant;
      delete s.grantId;
      delete s.sessionId;
      s.sessionInstalled = false;
      s.sessionRevoked = false;
      s.next_nonce = TRADE_NONCE_MIN.toString();
      await checkpoint();
      s.context = await this.ports.resolve(
        s.network,
        s.owner,
        s.sub_index,
        s.account,
      );
      return this.view(s, token);
    });
  }
}
export function safeWorkflowError(error: any) {
  const m = String(error?.message ?? "");
  return /^[a-z][a-z0-9_]{0,100}$/.test(m) ? m : "workflow_verification_failed";
}
