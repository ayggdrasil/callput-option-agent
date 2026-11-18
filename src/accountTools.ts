import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ACCOUNT_APP_ORIGIN, accountManifest, accountOpenStrategyNames, workflowAvailability } from "./accountManifest.js";
import { AccountChain } from "./accountChain.js";
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
export function registerAccountTools(server: McpServer, network: string) {
  server.registerResource(
    "account-workflow",
    "callput://account/workflow",
    {
      description:
        "Complete existing-wallet account/deposit/session/order runbook and explicit execution capabilities.",
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
              "wallet_connect: returned app-origin URL or external signer with separate device public address; never a private key",
              "action_prepare: follow next_actions through login, create, deposit, register; empty input except open/close/settle",
              "action_begin: only wallet_request_may_execute=true permits starting the exact wallet request",
              "wallet approval: existing wallet personal_sign/typed Grant or eth_sendTransaction; separate local device typed order",
              "action_submit: signature, existing transfer hash, or empty result for sponsored creation; preserve same original action",
              "action_status: prove canonical receipt, request key, keeper executed, position delta; included is not executed",
              "session_revoke: owner signature remains available alongside an unresolved order",
              "workflow_recover: finalized expired zero-use proof only, archive tracking RPC required; unknown orders keep budget reserved",
            ],
            open_input: { size: "0.0001", min_fill_ratio: 0.78 },
            close_input_fields: [
              "option_token_id",
              "size_raw",
              "min_amount_out_raw",
            ],
            settle_input_fields: ["option_token_id"],
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
    (a) => new AccountChain().resolve(network, a.owner, a.sub_index, a.account),
    true,
  );
  register(
    "callput_workflow_start",
    "Start a durable account workflow using an existing Web3 wallet. Select one configured underlying_asset and one spread strategy before the owner approves the Grant (defaults ETH/BuyCallSpread). Specify authorized deposit raw amount, maximum total collateral at risk and owner deposit gas cap. Returns wallet approval URL and next_actions. No keys, deposit or signature is performed by this call.",
    z
      .object({
        owner: address,
        sub_index: uint.optional(),
        account: address.optional(),
        underlying_asset: z.string().regex(/^[A-Z][A-Z0-9]{0,11}$/).optional(),
        strategy: z.enum(accountOpenStrategyNames).optional(),
        deposit_amount_raw: uint.default("0"),
        max_user_amount_raw: uint.default("100000"),
        max_deposit_gas_wei: uint.default("0"),
      })
      .strict(),
    (a) => engine(network).start(network, a),
  );
  register(
    "callput_wallet_connect",
    "Connect the existing owner wallet using returned approval URL. External signer runtimes may provide the separate device public address, owner and confirmed chain ID. Never pass a private key. No signer=owner grants are allowed.",
    base
      .extend({
        owner: address.optional(),
        chain_id: z.number().int().positive().optional(),
        device_signer: address.optional(),
      })
      .strict(),
    (a) =>
      a.device_signer
        ? engine(network).connect(a.workflow_id, {
            owner: a.owner,
            chain_id: a.chain_id,
            device_signer: a.device_signer,
          })
        : engine(network).pending(a.workflow_id),
  );
  register(
    "callput_workflow_status",
    "Observe only: current account, action and grant state, next_actions and evidence. Does not allocate nonces, sign, submit, renew grants or resend transfers.",
    base,
    (a) => engine(network).status(a.workflow_id),
    true,
  );
  register(
    "callput_action_prepare",
    "Prepare the next explicit login/create/deposit/register/open/close/settle/revoke action. Returns exact wallet RPC request, signer, digest, fees and human summary. May reserve UUID/nonce/budget. Sponsored open uses the selected underlying and strategy and accepts size decimal string in underlying units and min_fill_ratio. Close on the granted underlying accepts option_token_id,size_raw,min_amount_out_raw. Settle accepts option_token_id. Other steps take empty input. Never submit a wallet transaction twice after an unknown result.",
    base
      .extend({ step, input: z.record(z.string(), z.unknown()).default({}) })
      .strict(),
    (a) => engine(network).prepare(a.workflow_id, a.step, a.input),
  );
  register(
    "callput_action_submit",
    "Submit only the result of the exact prepared action: signature for SIWE/typed data, transaction_hash for owner-sent deposit, or empty result for sponsored creation. Enforces signer/identity/digest and preserves original signed result on retry. Private keys/passwords are forbidden.",
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
    (a) => engine(network).submit(a.workflow_id, a.action_id, a.result),
  );
  register(
    "callput_action_begin",
    "Durably mark the exact action before a wallet prompt. Only the first call returns wallet_request_may_execute=true. If false, recover the original wallet result instead of sending another transaction.",
    action,
    (a) => engine(network).begin(a.workflow_id, a.action_id),
  );
  register(
    "callput_action_retry_wallet",
    "Explicitly review the same interrupted/rejected wallet request again. Preserves exact action, digest and deposit nonce/gas. Never creates another transfer nonce, grant or order. Prefer submitting an already returned wallet result.",
    action,
    (a) => engine(network).retryWallet(a.workflow_id, a.action_id),
  );
  register(
    "callput_action_status",
    "Observe the durable action and independently reconcile receipt, keeper and position evidence. Included is not executed. Never creates a replacement action.",
    action,
    async (a) => {
      await engine(network).status(a.workflow_id);
      return engine(network).action(a.workflow_id, a.action_id);
    },
    true,
  );
  register(
    "callput_session_status",
    "Observe the selected installed session, expiry, revocation, chain counters and reserved policy. This is separate from owner login.",
    base,
    (a) => engine(network).status(a.workflow_id),
    true,
  );
  register(
    "callput_session_revoke",
    "Prepare an owner-signed request to revoke this exact session. The returned wallet request must be approved and submitted; this call does not revoke by itself.",
    base,
    (a) => engine(network).prepare(a.workflow_id, "revoke", {}),
  );
  register(
    "callput_workflow_recover",
    "Recover an expired unused grant only with independent finalized code/ownership/zero-use proof and no saved signed order. Archives proof and preserves the original user cap. Missing historical state or unknown orders keep the budget reserved.",
    base,
    (a) => engine(network).recover(a.workflow_id),
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
