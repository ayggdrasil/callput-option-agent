import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ACCOUNT_APP_ORIGIN, accountManifest, accountOpenStrategyNames, workflowAvailability } from "./accountManifest.js";
import { AccountChain } from "./accountChain.js";
import { OpenInputError } from "./accountOpenInput.js";
import { AccountWorkflow, safeWorkflowError } from "./accountWorkflow.js";
import { configuredWorkflowStore, type WorkflowStore } from "./accountStore.js";
import {
  bodyWithinLimit,
  isAllowedHttpHost,
  rateLimitRequest,
} from "./httpSecurity.js";
const token = z.string().regex(/^[0-9a-f]{64}$/),
  address = z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  uint = z.string().regex(/^(0|[1-9][0-9]{0,77})$/);
const actionId = z.string().uuid(),
  step = z.enum([
    "login",
    "create",
    "deposit",
    "register",
    "open",
    "close",
    "settle",
    "revoke",
    "withdraw",
  ]);
export { workflowAvailability };
function engine(network?: string) {
  const store = configuredWorkflowStore();
  if (!store) throw Error("persistent_workflow_store_required");
  const check = (s: any) => {
    if (network && s.network !== network)
      throw Error("workflow_network_mismatch");
  };
  const scoped: WorkflowStore = {
    create: (v) => store.create(v),
    read: async (t) => {
      const s = await store.read(t);
      check(s);
      return s;
    },
    update: (t, fn) =>
      store.update(t, async (s, save) => {
        check(s);
        return fn(s, save);
      }),
  };
  return new AccountWorkflow(scoped);
}
const result = (value: any) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  structuredContent: value,
});
export function registerAccountTools(server: McpServer, network: string,
  deps: { workflow?: () => AccountWorkflow; resolve?: AccountChain["resolve"] } = {}) {
  const workflow = deps.workflow ?? (() => engine(network));
  const chain = new AccountChain();
  const resolve = deps.resolve ?? chain.resolve.bind(chain);
  server.registerResource(
    "account-workflow",
    "callput://account/workflow",
    {
      description:
        "Machine-readable Robinhood/GIWA account creation, signer handoff, funding, trading, position management and withdrawal guide.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({
            network,
            capabilities: workflowAvailability(accountManifest(network).network),
            steps: [
              "get_network_info: verify chain, collateral, manifest, configured storage and supported strategy",
              "account_resolve: owner/sub_index and existing account before any funding",
              "workflow_start: select underlying_asset and strategy before Grant; set deposit raw amount, total trade collateral cap and owner native gas cap",
              "wallet_connect: use a separate external device public address and confirm the owner and chain. Never pass a private key.",
              "action_prepare: follow next_actions through login, create, deposit and register; open, close, settle and withdraw use the fields below",
              "action_begin: only wallet_request_may_execute=true permits starting the exact wallet request",
              "wallet approval: existing wallet personal_sign/typed Grant or eth_sendTransaction; separate local device typed order",
              "action_submit: signature, existing transfer hash, or empty result for sponsored creation; preserve same original action",
              "action_status: track relay admission, canonical receipt and request key; finalized keeper execution/cancellation is separate from inclusion",
              "session_revoke: owner signature remains available alongside an unresolved order",
              "workflow_recover: expires only with finalized zero use; a signed open/close also requires a finalized unused nonce and matching relay lookup. Unknown remains reserved without proof",
            ],
            signer_handoff: {
              owner: "Existing owner EOA or protocol-supported delegated EOA. Use the owner to sign login, Grant and withdrawals.",
              device: "Create or select a separate local EOA and pass only device_signer (address), owner and chain_id to callput_wallet_connect.",
              protocol: [
                "callput_action_prepare returns the exact wallet_request and signer.",
                "callput_action_begin must return wallet_request_may_execute=true before the external signer acts.",
                "personal_sign: sign the exact hex message bytes; eth_signTypedData_v4: sign the exact typed-data object; eth_sendTransaction: broadcast the exact owner transaction once.",
                "callput_action_submit uses signature or transaction_hash as returned by the external signer. Keep these private. For a null wallet_request and empty_object result_kind, submit result {} without asking the wallet.",
                "Observe the same action with callput_action_status. A timeout or 404 alone cannot authorize a replacement.",
              ],
              browser_handoff_required: false,
              private_keys_accepted: false,
            },
            open_input: { size: "0.0001", min_fill_ratio: 0.78, long_leg_id: "from callput_scan_spreads or the option chain", short_leg_id: "same asset/expiry/type", max_amount_in_raw: "explicit USDG ceiling as a decimal integer" },
            open_input_types: {
              size: 'Positive decimal string or JSON number in underlying units, e.g. "0.02" or 0.02.',
              min_fill_ratio: "JSON number from 0.5 to 1 inclusive. Defaults to 0.78.",
              max_amount_in_raw: "Decimal integer string, e.g. 500000 for 0.5 USDG.",
            },
            unsigned_preparation_repair: "For input_required or legacy preparing/invalid_open_input, read status, then repeat callput_action_prepare for the same workflow, step and action_id with corrected input. A repair is offered only before typed data, signatures, or relay identity exist. Grant expiry still requires the documented recovery proof.",
            create_input: {},
            deposit_input: {},
            close_only_workflow: { session_mode: "close_only", max_user_amount_raw: "0", deposit_amount_raw: "0", select: "Use a fresh owner-approved grant for the held position's underlying and strategy. No open permitted." },
            positions: { tool: "callput_portfolio_summary", input: { address: "CallPut Account address" }, close_fields: ["token_id", "size_raw", "strategy", "underlying", "lifecycle"] },
            close_input_fields: [
              "option_token_id",
              "size_raw",
              "min_amount_out_raw",
            ],
            settle_input_fields: ["option_token_id"],
            withdraw_input_fields: ["amount_raw", "recipient"],
            notes: {
              deposit: "Robinhood direct token transfer spends native gas from the owner wallet. Set an explicit max_deposit_gas_wei before preparing the deposit.",
              settle: "An expired owned lot can settle through an eligible saved device binding or fresh owner login. The recipient is fixed to the account.",
              cancel: "Users cannot cancel a submitted PositionManager request on Robinhood. Observe keeper cancellation and never treat relay transport cancellation as keeper cancellation.",
            },
            units:
              "Collateral raw integers use 6 decimals; native gas caps use wei.",
            signing_boundary:
              "Keys remain in existing wallet/local device. SIWE login is not deposit authorization or a trading Grant.",
            local_keystore_runtime: {
              download:
                "https://mcp.callput.app/frontend-v1/downloads/callput-account-signer-0.8.0.tgz",
              checksum:
                "https://mcp.callput.app/frontend-v1/downloads/callput-account-signer-0.8.0.tgz.sha256",
              guide: "https://mcp.callput.app/account-workflow#local-signer",
              scope:
                "Optional Node22+ local encrypted-keystore client; funded Robinhood account, one selected spread, total cap 0.1 USDG, no deposit or owner transaction. Service operations use only these MCP tools. Existing budget reservations block new permissions until explicitly reconciled.",
            },
          }),
        },
      ],
    }),
  );
  const output = z
    .object({
      state: z.string().optional(),
      workflow_id: token.optional(),
      blocked_reason: z.string().nullable().optional(),
      next_actions: z
        .array(
          z
            .object({
              tool: z.string(),
              arguments: z.record(z.string(), z.unknown()),
            })
            .passthrough(),
        )
        .optional(),
      wallet_request: z
        .object({
          method: z.enum([
            "personal_sign",
            "eth_signTypedData_v4",
            "eth_sendTransaction",
          ]),
          params: z.array(z.unknown()),
        })
        .nullable()
        .optional(),
      wallet_approval_url: z.string().optional(),
      wallet_request_may_execute: z.boolean().optional(),
    })
    .passthrough();
  const register = (
    name: string,
    description: string,
    schema: any,
    fn: (args: any) => Promise<any>,
    readOnly = false,
  ) =>
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema,
        outputSchema: output,
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: !readOnly,
          idempotentHint: readOnly,
        },
      },
      async (args: any) => {
        try {
          return result(await fn(args));
        } catch (error) {
          if (error instanceof OpenInputError) {
            const failure = error as OpenInputError & { actionId?: string; preparationRecovery?: unknown };
            return result({
              state: "input_required",
              blocked_reason: error.message,
              action_id: failure.actionId,
              input_errors: error.fieldErrors,
              preparation_recovery: failure.preparationRecovery,
              next_actions: [{
                tool: "callput_action_prepare",
                arguments: { workflow_id: args.workflow_id, step: args.step,
                  ...(failure.actionId ? { action_id: failure.actionId } : {}) },
                required_external_input: ["input"],
              }],
              retry_after_ms: null,
            });
          }
          return result({
            state: "blocked",
            blocked_reason: safeWorkflowError(error),
            next_actions: [],
            retry_after_ms: 3000,
          });
        }
      },
    );
  const base = z.object({ workflow_id: token }).strict(),
    action = base.extend({ action_id: actionId }).strict();
  register(
    "callput_account_resolve",
    "Discover and independently verify existing or new sub-account for an owner/sub-index. Checks current and legacy factory code, account ownership and collateral. Never creates or deposits.",
    z
      .object({
        owner: address,
        sub_index: uint.optional(),
        account: address.optional(),
      })
      .strict(),
    (a) => resolve(network, a.owner, a.sub_index, a.account),
    true,
  );
  register(
    "callput_workflow_start",
    "Start a durable account workflow using an existing Web3 wallet. Select one configured underlying_asset and one spread strategy before the owner approves the Grant (defaults ETH/BuyCallSpread). Specify deposit amount and gas cap and the total trade collateral cap. Use session_mode=close_only for a held unexpired position after the original grant ends; no open allowance. Returns signer-oriented next_actions. No keys, deposit or signature is performed by this call.",
    z
      .object({
        owner: address,
        sub_index: uint.optional(),
        account: address.optional(),
        underlying_asset: z.string().regex(/^[A-Z][A-Z0-9]{0,11}$/).optional(),
        strategy: z.enum(accountOpenStrategyNames).optional(),
        deposit_amount_raw: uint.default("0"),
        max_user_amount_raw: uint.optional(),
        session_mode: z.enum(["open_close", "close_only"]).optional(),
        max_deposit_gas_wei: uint.default("0"),
      })
      .strict(),
    (a) => workflow().start(network, a),
  );
  register(
    "callput_wallet_connect",
    "Connect a local/external signer by passing the separate device public address, owner and confirmed chain ID. See callput://account/workflow for the exact signing sequence. Never pass a private key. No signer=owner grants are allowed.",
    base
      .extend({
        owner: address.optional(),
        chain_id: z.number().int().positive().optional(),
        device_signer: address.optional(),
      })
      .strict(),
    (a) =>
      a.device_signer
        ? workflow().connect(a.workflow_id, {
            owner: a.owner,
            chain_id: a.chain_id,
            device_signer: a.device_signer,
          })
        : workflow().pending(a.workflow_id),
  );
  register(
    "callput_workflow_status",
    "Observe only: current account, action and grant state, next_actions and evidence. Does not allocate nonces, sign, submit, renew grants or resend transfers.",
    base,
    (a) => workflow().status(a.workflow_id),
    true,
  );
  register(
    "callput_action_prepare",
    "Prepare the next explicit login/create/deposit/register/open/close/settle/revoke/withdraw action. Returns exact wallet RPC request, signer, digest, fees and human summary. May reserve UUID/nonce/budget. Sponsored open uses the selected underlying and strategy and accepts size (positive decimal string or JSON number such as 0.02), min_fill_ratio (JSON number 0.5 to 1, default 0.78), paired long_leg_id and short_leg_id, and max_amount_in_raw. Close on the granted underlying accepts option_token_id,size_raw,min_amount_out_raw. Settle accepts option_token_id. Withdraw accepts amount_raw and optional recipient (defaults to owner) and always requires the owner signature. Other steps take empty input. Never submit a wallet transaction twice after an unknown result.",
    base
      .extend({
        step,
        action_id: actionId.optional().describe("Resume this exact action when repairing an unsigned preparation."),
        input: z.object({
          size: z.union([z.string(), z.number()]).optional()
            .describe('Open quantity in underlying units. Positive decimal string or JSON number, e.g. "0.02" or 0.02. A decimal string preserves full precision.'),
          min_fill_ratio: z.number().min(0.5).max(1).optional()
            .describe("Open minimum fill ratio from 0.5 to 1, e.g. 0.78. Defaults to 0.78."),
          long_leg_id: z.string().optional().describe("Open option leg ID, paired with short_leg_id."),
          short_leg_id: z.string().optional().describe("Open option leg ID, paired with long_leg_id."),
          max_amount_in_raw: uint.optional().describe("Open collateral ceiling in raw units. USDG has 6 decimals."),
          option_token_id: z.string().optional().describe("Owned position ID for close or settle."),
          size_raw: uint.optional().describe("Close quantity in raw underlying units."),
          min_amount_out_raw: uint.optional().describe("Explicit positive close output floor in raw collateral units."),
          amount_raw: uint.optional().describe("Withdrawal amount in raw collateral units."),
          recipient: address.optional().describe("Withdrawal recipient, defaults to the owner."),
        }).strict().default({}).describe("Only fields belonging to the selected step are accepted. Login, create, deposit, register and revoke use {}."),
      })
      .strict(),
    (a) => workflow().prepare(a.workflow_id, a.step, a.input, a.action_id),
  );
  register(
    "callput_action_submit",
    "Submit only the result of the exact prepared action: signature for SIWE/typed data, transaction_hash for owner-sent deposit, or empty result when result_kind=empty_object (sponsored creation or owner-login settlement). Enforces signer/identity/digest. If an unacknowledged trade is eligible for retry, reuses only the original UUID, nonce and signed result. Private keys/passwords are forbidden.",
    action
      .extend({
        result: z
          .object({
            signature: z
              .string()
              .regex(/^0x[0-9a-fA-F]{130}$/)
              .optional(),
            transaction_hash: z
              .string()
              .regex(/^0x[0-9a-fA-F]{64}$/)
              .optional(),
          })
          .strict(),
      })
      .strict(),
    (a) => workflow().submit(a.workflow_id, a.action_id, a.result),
  );
  register(
    "callput_action_begin",
    "Durably mark the exact action before a wallet prompt. Only the first call returns wallet_request_may_execute=true. If false, recover the original wallet result instead of sending another transaction.",
    action,
    (a) => workflow().begin(a.workflow_id, a.action_id),
  );
  register(
    "callput_action_retry_wallet",
    "Explicitly review the same interrupted/rejected wallet request again. Preserves exact action, digest and deposit nonce/gas. Never creates another transfer nonce, grant or order. Prefer submitting an already returned wallet result.",
    action,
    (a) => workflow().retryWallet(a.workflow_id, a.action_id),
  );
  register(
    "callput_action_status",
    "Observe the durable action: admission, relay status, nonce/digest/session/deadline, transaction hash, and request key. Included is not executed. Check finalized keeper outcome and position change; a missing relay record is inconclusive. Never submits a replacement.",
    action,
    async (a) => {
      await workflow().status(a.workflow_id);
      return workflow().action(a.workflow_id, a.action_id);
    },
    true,
  );
  register(
    "callput_session_status",
    "Observe the selected installed session, expiry, revocation, chain counters and reserved policy. This is separate from owner login.",
    base,
    (a) => workflow().status(a.workflow_id),
    true,
  );
  register(
    "callput_session_revoke",
    "Prepare an owner-signed request to revoke this exact session. The returned wallet request must be approved and submitted; this call does not revoke by itself.",
    base,
    (a) => workflow().prepare(a.workflow_id, "revoke", {}),
  );
  register(
    "callput_workflow_recover",
    "Release an expired unused grant only with independent finalized code, ownership and zero-use proof. Signed opens/closes additionally require a finalized unused nonce and no known relay admission or transaction, plus a fresh relay lookup. Missing proof preserves the original reservation.",
    base,
    (a) => workflow().recover(a.workflow_id),
  );
}
const origins = new Set([
  "https://mcp.callput.app",
  ACCOUNT_APP_ORIGIN,
  "http://localhost:4187",
  "http://127.0.0.1:4187",
]);
export async function handleWalletRequest(request: Request): Promise<Response> {
  const origin = request.headers.get("origin"),
    headers: Record<string, string> = {
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      vary: "Origin",
    };
  if (!isAllowedHttpHost(request) || !origin || !origins.has(origin))
    return Response.json(
      { error: "wallet_origin_denied" },
      { status: 403, headers },
    );
  headers["access-control-allow-origin"] = origin;
  headers["access-control-allow-methods"] = "POST, OPTIONS";
  headers["access-control-allow-headers"] = "content-type";
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (
    request.method !== "POST" ||
    request.headers.get("content-type")?.split(";")[0] !== "application/json" ||
    !(await bodyWithinLimit(request, 65536))
  )
    return Response.json(
      { error: "invalid_wallet_request" },
      { status: 400, headers },
    );
  if (!rateLimitRequest(request, "wallet").allowed)
    return Response.json(
      { error: "wallet_rate_limit" },
      { status: 429, headers },
    );
  try {
    const input = z
      .object({
        operation: z.enum([
          "read",
          "status",
          "connect",
          "begin",
          "retry_wallet",
          "submit",
        ]),
        workflow_id: token,
        action_id: actionId.optional(),
        connection: z
          .object({
            owner: address,
            chain_id: z.number().int().positive(),
            device_signer: address,
          })
          .strict()
          .optional(),
        result: z
          .object({
            signature: z
              .string()
              .regex(/^0x[0-9a-fA-F]{130}$/)
              .optional(),
            transaction_hash: z
              .string()
              .regex(/^0x[0-9a-fA-F]{64}$/)
              .optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .parse(await request.json());
    const e = engine(),
      current = await e.pending(input.workflow_id),
      expected = accountManifest(current.network).origin;
    // The approval page shares the SIWE origin of the consolidated app.
    if (
      origin !== expected &&
      !origin.startsWith("http://localhost:") &&
      !origin.startsWith("http://127.0.0.1:")
    )
      return Response.json(
        {
          error: "wallet_domain_required",
          wallet_approval_url: current.wallet_approval_url,
        },
        { status: 409, headers },
      );
    let value: any;
    if (input.operation === "read") value = current;
    if (input.operation === "status") value = await e.status(input.workflow_id);
    if (input.operation === "begin") {
      if (!input.action_id) throw Error("action_id_required");
      value = await e.begin(input.workflow_id, input.action_id);
    }
    if (input.operation === "retry_wallet") {
      if (!input.action_id) throw Error("action_id_required");
      value = await e.retryWallet(input.workflow_id, input.action_id);
    }
    if (input.operation === "connect") {
      if (!input.connection) throw Error("wallet_connection_required");
      value = await e.connect(input.workflow_id, input.connection);
    }
    if (input.operation === "submit") {
      if (!input.action_id || !input.result)
        throw Error("action_result_required");
      value = await e.submit(input.workflow_id, input.action_id, input.result);
    }
    return Response.json(value, { headers });
  } catch (error) {
    return Response.json(
      { state: "blocked", blocked_reason: safeWorkflowError(error) },
      { status: 400, headers },
    );
  }
}
