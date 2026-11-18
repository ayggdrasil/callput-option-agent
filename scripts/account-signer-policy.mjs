// Local-only signer. Prepared MCP actions are data, never arbitrary signing authority.
import { TypedDataEncoder, getBytes, toUtf8String } from "ethers";
import {
  accountManifest,
  accountOpenStrategies,
  accountTradeSelection,
  accountDomain,
  accountTypes,
} from "../build/src/accountManifest.js";
import { validateLogin } from "../build/src/accountWorkflow.js";
const check = (value, code) => {
  if (!value) throw Error(code);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export async function signAccountAction(a, identity, wallets) {
  const m = accountManifest(identity.network),
    trade = accountTradeSelection(m.network, identity),
    assetIndex = String(trade.index),
    owner = wallets.owner.address.toLowerCase(),
    device = wallets.device.address.toLowerCase();
  check(
    owner === identity.owner && device === identity.device && owner !== device,
    "local_signer_identity_mismatch",
  );
  check(
    a.workflow_id === identity.workflow_id &&
      a.owner === owner &&
      a.account === identity.account &&
      a.network === identity.network &&
      a.chain_id === m.chainId,
    "prepared_identity_mismatch",
  );
  check(
    a.action_state === "prepared" &&
      a.policy.deposit_amount_raw === "0" &&
      a.policy.max_deposit_gas_wei === "0" &&
      (a.policy.underlying_asset ?? "ETH") === trade.asset &&
      (a.policy.strategy ?? "BuyCallSpread") === trade.strategy &&
      (a.policy.underlying_asset_index ?? "2") === assetIndex &&
      a.policy.max_user_amount_raw === identity.max_user_amount_raw &&
      BigInt(identity.max_user_amount_raw) <= 100000n,
    "prepared_policy_mismatch",
  );
  if (a.step === "create") {
    check(!a.wallet_request, "unexpected_create_signature");
    return {};
  }
  const r = a.wallet_request;
  check(
    r && r.method !== "eth_sendTransaction",
    "owner_transactions_not_authorized",
  );
  if (a.step === "login") {
    check(
      r.method === "personal_sign" && r.params[1] === owner,
      "invalid_login_signer",
    );
    const message = toUtf8String(r.params[0]);
    check(message === a.message, "login_message_changed");
    validateLogin(
      { network: identity.network, owner },
      {
        message,
        expiresAt: a.expires_at,
        sessionExpiresAt: /\nExpiration Time: ([^\n]+)/.exec(message)?.[1],
        id: /\nRequest ID: ([^\n]+)/.exec(message)?.[1],
      },
    );
    return {
      signature: await wallets.owner.signMessage(getBytes(r.params[0])),
    };
  }
  check(r.method === "eth_signTypedData_v4", "unsupported_signing_method");
  const t = JSON.parse(r.params[1]),
    expected = {
      Grant: { Grant: accountTypes.Grant },
      OpenIntent: {
        Open: accountTypes.Open,
        OpenIntent: accountTypes.OpenIntent,
      },
      RevokeSession: { RevokeSession: accountTypes.RevokeSession },
    }[t.primaryType];
  check(
    expected &&
      same(Object.keys(t.types).sort(), Object.keys(expected).sort()) &&
      Object.keys(expected).every((k) => same(expected[k], t.types[k])),
    "unsupported_permission_types",
  );
  check(
    same(t.domain, accountDomain(m.chainId, identity.account)) &&
      TypedDataEncoder.hash(t.domain, t.types, t.message) === a.digest,
    "invalid_signature_domain_or_digest",
  );
  const x = t.message,
    now = BigInt(Math.floor(Date.now() / 1000));
  if (t.primaryType === "Grant") {
    check(
      a.step === "register" && a.signer === owner && r.params[0] === owner,
      "invalid_owner_signer",
    );
    check(
      x.signer === device &&
        BigInt(x.maxAmount) > 0n &&
        BigInt(x.maxAmount) <= BigInt(identity.max_user_amount_raw) &&
        BigInt(x.maxAmountPerOpen) <= BigInt(x.maxAmount) &&
        BigInt(x.validUntil) > now + 30n &&
        BigInt(x.validAfter) <= now + 30n &&
        BigInt(x.validUntil) - BigInt(x.validAfter) <= 600n &&
        same(x.underlyings, [assetIndex]) &&
        x.strategies === accountOpenStrategies[trade.strategy].bit &&
        x.maxOpens === "1" &&
        x.maxCloses === "1" &&
        BigInt(x.maxFeePerTrade) <= BigInt(m.maxFeePerTrade) &&
        BigInt(x.maxFees) <= BigInt(m.maxFeePerTrade) * 2n,
      "invalid_grant_limits",
    );
    return {
      signature: await wallets.owner.signTypedData(t.domain, t.types, x),
    };
  }
  check(
    x.sessionId === a.session?.id &&
      BigInt(x.deadline) > now &&
      BigInt(x.deadline) <= BigInt(a.session.valid_until),
    "invalid_order_session",
  );
  if (t.primaryType === "RevokeSession") {
    check(
      a.step === "revoke" && a.signer === owner && r.params[0] === owner,
      "invalid_owner_signer",
    );
    return {
      signature: await wallets.owner.signTypedData(t.domain, t.types, x),
    };
  }
  const p = x.params;
  const isBuy = trade.strategy.startsWith("Buy"),
    isCall = trade.strategy.includes("Call");
  check(
    a.step === "open" &&
      a.signer === device &&
      r.params[0] === device &&
      BigInt(x.source) === 0n,
    "invalid_device_signer",
  );
  check(
    p.underlyingAssetIndex === assetIndex &&
      p.length === "2" &&
      same(p.isBuys, [isBuy, !isBuy, false, false]) &&
      same(p.isCalls, [isCall, isCall, false, false]) &&
      BigInt(p.optionIds[2]) === 0n &&
      BigInt(p.optionIds[3]) === 0n &&
      BigInt(p.amountIn) > 0n &&
      BigInt(p.amountIn) <= BigInt(identity.max_user_amount_raw) &&
      BigInt(p.minSize) > 0n,
    "invalid_open_limits",
  );
  const first = BigInt(p.optionIds[0]),
    second = BigInt(p.optionIds[1]),
    mask = (1n << 40n) - 1n,
    strikeMask = (1n << 48n) - 1n,
    firstStrike = (first >> 152n) & strikeMask,
    secondStrike = (second >> 152n) & strikeMask;
  check(
    first >> 240n === BigInt(assetIndex) &&
      second >> 240n === BigInt(assetIndex) &&
      ((first >> 200n) & mask) === ((second >> 200n) & mask) &&
      ((first >> 200n) & mask) > now + 60n &&
      firstStrike > 0n && secondStrike > 0n &&
      (isCall ? firstStrike < secondStrike : firstStrike > secondStrike),
    "invalid_spread_identity",
  );
  return {
    signature: await wallets.device.signTypedData(t.domain, t.types, x),
  };
}

export async function driveAccountWorkflow(
  call,
  identity,
  wallets,
  journal,
  save,
  options,
) {
  check(typeof options?.checkBudget === "function", "budget_check_required");
  const sleep =
    options.sleep ?? (() => new Promise((r) => setTimeout(r, 2000)));
  const bind = { workflow_id: identity.workflow_id };
  await call("callput_wallet_connect", {
    ...bind,
    owner: identity.owner,
    chain_id: accountManifest(identity.network).chainId,
    device_signer: identity.device,
  });
  for (let attempt = 0; attempt < 180; attempt++) {
    const status = await call("callput_workflow_status", bind);
    await options.onState?.(status);
    if (status.state === "trade_executed") {
      check(
        status.actions.some(
          (a) =>
            a.step === "open" &&
            a.state === "executed" &&
            a.evidence?.position_verified,
        ),
        "execution_evidence_missing",
      );
      return status;
    }
    const next = status.next_actions?.[0];
    check(next, "no_executable_next_action");
    let action;
    if (next.tool === "callput_action_prepare") {
      const step = next.arguments.step;
      check(
        ["login", "create", "register", "open"].includes(step),
        "unsupported_local_step",
      );
      if (step === "register") await options.checkBudget();
      action = await call(next.tool, {
        ...bind,
        step,
        input: step === "open" ? { size: "0.0001", min_fill_ratio: 0.78 } : {},
      });
    } else {
      check(
        [
          "callput_action_begin",
          "callput_action_submit",
          "callput_action_status",
        ].includes(next.tool),
        "unexpected_next_tool",
      );
      action = await call("callput_action_status", {
        ...bind,
        action_id: next.arguments.action_id,
      });
    }
    const id = action.action_id;
    check(id, "action_id_required");
    // Prepared/cached hosted actions can predate this local runner. They must
    // pass the same legacy-budget guard as freshly prepared financial actions.
    if (["register", "open"].includes(action.step)) await options.checkBudget();
    const cached = journal.results[id];
    if (
      cached &&
      ["prepared", "wallet_pending"].includes(action.action_state)
    ) {
      await call("callput_action_submit", {
        ...bind,
        action_id: id,
        result: cached,
      });
      continue;
    }
    if (action.action_state === "prepared") {
      if (action.step === "create") {
        await signAccountAction(action, identity, wallets);
        await call("callput_action_submit", {
          ...bind,
          action_id: id,
          result: {},
        });
        continue;
      }
      check(
        !journal.started[id],
        "local_wallet_result_requires_reconciliation",
      );
      journal.started[id] = true;
      await save();
      const begin = await call("callput_action_begin", {
        ...bind,
        action_id: id,
      });
      check(begin.wallet_request_may_execute, "wallet_request_already_started");
      const result = await signAccountAction(action, identity, wallets);
      journal.results[id] = result;
      await save();
      if (["register", "open"].includes(action.step))
        await options.checkBudget();
      await call("callput_action_submit", { ...bind, action_id: id, result });
    } else {
      check(
        action.action_state !== "wallet_pending",
        "local_wallet_result_requires_reconciliation",
      );
      check(
        !["blocked", "cancelled"].includes(action.action_state),
        action.blocked_reason ?? "action_blocked",
      );
      await sleep();
    }
  }
  throw Error("observation_timeout_preserve_original_action");
}
