// Run locally in Terminal. All service operations use only the public MCP tools.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { Wallet } from "ethers";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FileWorkflowStore } from "../build/src/accountStore.js";
import { accountTradeSelection } from "../build/src/accountManifest.js";
import { driveAccountWorkflow } from "./account-signer-policy.mjs";
const root = fileURLToPath(new URL("..", import.meta.url)),
  privateRoot = path.join(root, ".account-workflows");
const workflowFile = path.join(privateRoot, "robinhood-live-workflow.json"),
  pointerFile = path.join(privateRoot, "robinhood-live-signer-pointer.json");
const ownerFile = path.join(
  os.homedir(),
  "Library/Application Support/CallputSigner/owner.json",
);
const oldBudget = path.join(
  os.homedir(),
  "Library/Application Support/CallputSigner/robinhood.budget.json",
);
const check = (v, code) => {
  if (!v) throw Error(code);
};
async function privateJson(file) {
  const s = await fs.lstat(file);
  check(
    s.isFile() &&
      !s.isSymbolicLink() &&
      s.uid === process.getuid() &&
      !(s.mode & 0o077),
    "unsafe_private_file",
  );
  return JSON.parse(await fs.readFile(file, "utf8"));
}
async function writeProgress(status) {
  const publicValue = {
    checked_at: new Date().toISOString(),
    state: status.state,
    account: status.account,
    actions: status.actions,
    blocked_reason: status.blocked_reason,
  };
  await fs.writeFile(
    path.join(privateRoot, "robinhood-live-status.json"),
    JSON.stringify(publicValue, null, 2),
    { mode: 0o600 },
  );
  console.log(`State: ${status.state}`);
}
process.umask(0o077);
const client = new Client({
  name: "callput-local-account-signer",
  version: "1",
});
let phase = "preflight";
try {
  const workflow = await privateJson(workflowFile);
  const trade = accountTradeSelection("robinhood", workflow.policy);
  check(
    workflow.network === "robinhood" &&
      workflow.chain_id === 4663 &&
      workflow.policy.deposit_amount_raw === "0" &&
      workflow.policy.max_user_amount_raw === "100000" &&
      workflow.policy.max_deposit_gas_wei === "0",
    "workflow_policy_mismatch",
  );
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL("https://mcp.callput.app/api/mcp?network=robinhood"),
    ),
  );
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args }, undefined, {
      timeout: 45000,
    });
    check(!r.isError, "mcp_request_failed");
    const value = r.structuredContent ?? JSON.parse(r.content[0].text);
    if (value.state === "blocked" && value.blocked_reason)
      throw Error(
        /^[a-z0-9_]{1,120}$/.test(value.blocked_reason)
          ? value.blocked_reason
          : "mcp_action_blocked",
      );
    return value;
  };
  const info = await call("callput_get_network_info", {});
  check(
    info.chain_id === 4663 && info.account_workflow?.configured,
    "hosted_workflow_unavailable",
  );
  const status = await call("callput_workflow_status", {
    workflow_id: workflow.workflow_id,
  });
  check(
    status.owner === workflow.owner && status.account === workflow.account &&
      (status.policy.underlying_asset ?? "ETH") === trade.asset &&
      (status.policy.strategy ?? "BuyCallSpread") === trade.strategy,
    "workflow_identity_changed",
  );
  if (process.argv.includes("--check")) {
    console.log(
      JSON.stringify({
        server: client.getServerVersion(),
        tools: (await client.listTools()).tools.length,
        state: status.state,
        account: status.account,
        local_keystore_required: true,
        deposit_authorized: false,
        max_user_amount_raw: "100000",
        underlying_asset: trade.asset,
        strategy: trade.strategy,
      }),
    );
  } else {
    check(
      process.stdin.isTTY && process.stdout.isTTY,
      "interactive_terminal_required",
    );
    console.log(
      `Robinhood account ${workflow.account}. One ${trade.asset} ${trade.strategy}, total cap 0.1 USDG. Deposit disabled; native trading fees sponsored.`,
    );
    console.log(
      "Only the encrypted owner keystore password is read locally. No password, private key or device key goes to MCP.",
    );
    phase = "unlock";
    const stat = await fs.lstat(ownerFile);
    check(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.uid === process.getuid() &&
        !(stat.mode & 0o077),
      "unsafe_owner_keystore",
    );
    const child = spawnSync(
      "python3",
      [
        "-c",
        "import getpass,sys,warnings; warnings.simplefilter('error',getpass.GetPassWarning); sys.stdout.write(getpass.getpass('Keystore password (hidden, local only): '))",
      ],
      { stdio: ["inherit", "pipe", "inherit"], maxBuffer: 16384 },
    );
    check(child.status === 0, "local_unlock_cancelled");
    let password = child.stdout.toString();
    child.stdout.fill(0);
    const owner = await Wallet.fromEncryptedJson(
      await fs.readFile(ownerFile, "utf8"),
      password,
    );
    check(
      owner.address.toLowerCase() === workflow.owner,
      "keystore_owner_mismatch",
    );
    phase = "local_journal";
    let pointer;
    try {
      pointer = await privateJson(pointerFile);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const salt = pointer?.salt ?? randomBytes(32).toString("hex");
    check(/^[a-f0-9]{64}$/.test(salt), "invalid_local_journal");
    const key = scryptSync(password, salt, 32).toString("hex");
    password = "";
    const store = new FileWorkflowStore(
      path.join(privateRoot, "local-signer"),
      key,
    );
    if (!pointer) {
      const token = await store.create({
        workflow_id: workflow.workflow_id,
        device_private_key: Wallet.createRandom().privateKey,
        results: {},
        started: {},
      });
      pointer = { salt, token };
      const h = await fs.open(pointerFile, "wx", 0o600);
      try {
        await h.writeFile(JSON.stringify(pointer));
        await h.sync();
      } finally {
        await h.close();
      }
    }
    await store.update(pointer.token, async (journal, save) => {
      check(
        journal.workflow_id === workflow.workflow_id,
        "local_workflow_binding_mismatch",
      );
      const device = new Wallet(journal.device_private_key);
      const identity = {
        network: "robinhood",
        owner: workflow.owner,
        account: workflow.account,
        workflow_id: workflow.workflow_id,
        device: device.address.toLowerCase(),
        max_user_amount_raw: "100000",
        underlying_asset: trade.asset,
        strategy: trade.strategy,
      };
      phase = "account_execution";
      const result = await driveAccountWorkflow(
        call,
        identity,
        { owner, device },
        journal,
        save,
        {
          checkBudget: async () => {
            try {
              await fs.lstat(oldBudget);
              throw Error("legacy_budget_reserved_requires_approved_recovery");
            } catch (e) {
              if (e.code !== "ENOENT") throw e;
            }
          },
          onState: writeProgress,
        },
      );
      await writeProgress(result);
      console.log(
        "Verified canonical receipt, keeper execution and position increase.",
      );
    });
  }
} catch (e) {
  const reason = /^[a-z0-9_]{1,120}$/.test(e.message)
    ? e.message
    : "local_workflow_failed";
  await fs
    .writeFile(
      path.join(privateRoot, "robinhood-live-error.json"),
      JSON.stringify({ checked_at: new Date().toISOString(), phase, reason }),
      { mode: 0o600 },
    )
    .catch(() => {});
  console.error(
    `Stopped at ${phase}: ${reason}. Original action/results are preserved. Do not create another grant.`,
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
