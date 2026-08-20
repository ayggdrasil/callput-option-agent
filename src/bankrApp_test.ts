import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(path, "utf8");

function main() {
  const manifest = JSON.parse(read("bankr-app/manifest.json"));
  assert.match(manifest.title, /Crypto/, "the Bankr app title must advertise crypto support");
  assert.deepEqual(manifest.permissions, ["read:wallet", "fetch:http", "prepare:transaction"]);
  assert.equal(manifest.frontendIdentity, "viewer");
  assert.deepEqual(manifest.scripts, ["assets", "scan", "prepare", "reconcile", "positions", "close", "settle", "close-all", "settle-all", "track"]);
  assert.match(manifest.description, /synthetic on-chain/i);
  assert.match(manifest.description, /not broker-listed/i);
  assert.ok(manifest.tags.includes("crypto"));

  const html = read("bankr-app/index.html");
  const prepareScript = read("bankr-app/scripts/prepare.ts");
  const trackScript = read("bankr-app/scripts/track.ts");
  assert.match(html, /Bankr chat execution unavailable/i, "the public App must disclose the verified Bankr simulator limitation");
  assert.match(html, /const BANKR_CHAT_EXECUTION_AVAILABLE=false;/, "chat execution must remain behind an explicit disabled availability boundary");
  assert.match(html, /id="confirm"[^>]*disabled/, "the order handoff must be disabled while Bankr chat execution is unavailable");
  assert.match(html, /id="closeAll"[^>]*disabled/, "close-all handoffs must be disabled while Bankr chat execution is unavailable");
  assert.match(html, /id="settleAll"[^>]*disabled/, "settle-all handoffs must be disabled while Bankr chat execution is unavailable");
  assert.match(html, /authorized external signer, Bankr Wallet API, or Bankr CLI/i, "reconciliation must accept hashes from supported external signing paths");
  assert.match(html, /id="size" type="number" value="0\.01"/, "the first-trade size must default to a small onboarding amount");
  assert.match(html, /Synthetic on-chain options only; they are not broker-listed securities or ownership\./i, "the app must disclose the synthetic, non-ownership product boundary");
  assert.match(html, /id="scanStatus" class="status" role="status" aria-live="polite"/, "scan progress must be announced");
  assert.match(html, /id="tradeStatus" class="status" role="status" aria-live="polite"/, "trade progress must be announced");
  assert.match(html, /id="reconcileStatus" class="status" role="status" aria-live="polite"/, "reconciliation progress must be announced");
  assert.match(html, /id="positionsStatus" class="status" role="status" aria-live="polite"/, "position lifecycle progress must be announced");
  assert.match(html, /id="refreshPositions"/, "the Bankr app must expose portfolio refresh");
  assert.match(html, /id="closeAll"/, "the Bankr app must expose close all");
  assert.match(html, /id="settleAll"/, "the Bankr app must expose settle all");
  assert.match(html, /id="refreshApproval"/, "the Bankr app must expose an explicit post-approval allowance refresh");
  assert.match(html, /id="reviewNextLifecycle"/, "batch lifecycle actions must require a separate user gesture for each Bankr review");
  assert.match(html, /function setStatus\(id, text, cls=""\) \{[\s\S]*?el\.setAttribute\("role","alert"\);[\s\S]*?el\.focus\(\);/, "errors must be announced urgently and receive focus");
  assert.match(html, /function validSize\(\) \{ return Number\.isFinite\(Number\(\$\("size"\)\.value\)\) && Number\(\$\("size"\)\.value\) > 0; \}/, "size must be strictly positive before preparing");
  for (const [id, label] of [["asset", "Underlying"], ["bias", "Market view"], ["size", "Size"]]) {
    assert.match(html, new RegExp(`<label for="${id}">${label}`), `${label} must be explicitly associated with its control`);
  }
  assert.match(html, /Enter a positive size before choosing a spread\./, "invalid size must give clear guidance");
  assert.match(html, /No live spreads found\. Try another asset or market view, then scan again\./, "empty scans must give recovery guidance");
  assert.match(html, /candidate\.estimated_amount_in_per_unit != null \? candidate\.estimated_amount_in_per_unit : candidate\.spread_cost/, "buy candidate pricing must prefer the RP-and-fee-aware amount-in estimate");
  assert.match(html, /candidate\.spread_cost != null \? buyEstimate : candidate\.spread_credit/, "candidate pricing must distinguish buy cost from sell credit");
  assert.match(html, /Number\(unitValue\) \* size/, "candidate pricing must scale the numeric unit quote by the selected size");
  assert.match(html, /estimated (?:cost|credit)/, "candidate pricing must identify the scaled value as an estimate");
  assert.match(html, /per 1 unit/, "candidate pricing must retain the unit quote for context");
  assert.match(html, /function refreshCandidatePricing\(\)/, "candidate pricing must be refreshable after a size edit");
  assert.match(html, /\$\("size"\)\.addEventListener\("input",\(\)=>\{ invalidatePrepared\(\); refreshCandidatePricing\(\); \}\);/, "size edits must immediately refresh candidate pricing");
  assert.doesNotMatch(html, /accept the Bankr Terms of Service/i, "the App must not send users into an unavailable chat execution path");
  assert.match(html, /official Bankr Wallet API or Bankr CLI/i, "advanced Bankr signing must be separated from the public App");
  for (const [label, address] of [
    ["Base USDC", "0x833589fCD6eDb6E08f4C7C32D4f71b54bdA02913"],
    ["Callput Router", "0xfc61ba50AE7B9C4260C9f04631Ff28D5A2Fa4EB2"],
    ["Callput PositionManager", "0x83B04701B227B045CBBAF921377137fF595a54af"]
  ]) {
    assert.match(html, new RegExp(`href="https:\\/\\/basescan\\.org\\/address\\/${address}"[^>]*>${label}`, "i"), `${label} must link to its canonical BaseScan address`);
  }
  assert.match(html, /reviewField\("Network fee",`\$\{money\(weiToEth\(r\.execution_fee_wei\)\)\} ETH \(\$\{r\.execution_fee_wei\} wei\)`\)/, "network fee must display ETH and exact wei");
  assert.match(prepareScript, /const approvalTx = prepared\.usdc_approval && !prepared\.usdc_approval\.sufficient \? prepared\.usdc_approval\.approve_tx : null;/, "approval review must retain the actual approval transaction");
  assert.match(prepareScript, /spender:`0x\$\{approvalTx\.data\.slice\(34,74\)\}`/, "approval spender must come from the approval calldata address argument");
  assert.match(prepareScript, /token_address:approvalTx\.to/, "approval preview must expose the canonical token address");
  assert.match(prepareScript, /to: approvalTx\.to\.toLowerCase\(\)/, "Bankr approval destinations must be normalized for Wallet API compatibility");
  assert.match(prepareScript, /to: tx\.to\.toLowerCase\(\)/, "Callput order destinations must be normalized for Wallet API compatibility");
  assert.match(html, /addressField\(prepared\.approval_preview\.token,prepared\.approval_preview\.token_address\)/, "approval token address must be reviewed before confirmation");
  assert.match(html, /addressField\("Callput Router",prepared\.approval_preview\.spender\)/, "approval spender must be reviewed before confirmation");
  assert.match(html, /reviewField\("Approval amount",`\$\{money\(prepared\.approval_preview\.amount_usdc\)\} USDC`\)/, "approval amount must be reviewed before confirmation");
  assert.doesNotMatch(html, /approvalConfirmedIntentFingerprint/, "the void SDK handoff must not be treated as a confirmed approval");
  assert.doesNotMatch(html, /bankr\.confirmTransaction/, "the disabled public App must contain no transaction-confirmation call");
  assert.match(html, /const MAX_ALLOWANCE_REFRESH_ATTEMPTS=4;/, "allowance propagation checks must be bounded");
  assert.match(html, /async function refreshAllowance\(\)/, "the app must support an explicit allowance refresh after approval");
  assert.match(html, /for \(let attempt=1; attempt<=MAX_ALLOWANCE_REFRESH_ATTEMPTS; attempt\+=1\)[\s\S]*?bankr\.scripts\.run\("prepare"/, "allowance refresh must re-read canonical preparation state with a bounded retry loop");
  assert.match(prepareScript, /allowance_preview:[\s\S]*?current_raw:prepared\.usdc_approval\.current_allowance[\s\S]*?required_raw:prepared\.usdc_approval\.required/, "prepare must expose raw allowance state for exact post-approval verification");
  assert.match(html, /const reviewedIntent=prepared;/, "allowance refresh must retain the exact order the user reviewed before approval");
  assert.match(html, /BigInt\(result\.allowance_preview\.current_raw\) >= BigInt\(reviewedIntent\.quote\.amount_in_raw\)/, "allowance refresh must compare confirmed allowance against the reviewed order, not a moving quote");
  assert.match(html, /showPrepared\(\{ \.\.\.reviewedIntent, approval:null, approval_preview:null \}/, "confirmed allowance must restore the exact reviewed order without requesting a moving-price reapproval");
  assert.match(html, /Allowance confirmed\. Review the refreshed unsigned Callput order before external signing\./, "a confirmed allowance must lead to a fresh unsigned order review");
  assert.match(html, /Allowance is still insufficient/, "a delayed or price-moved allowance must give an explicit recovery state");
  assert.doesNotMatch(html, /refreshAllowance[\s\S]{0,1200}confirmTransaction\(confirmationIntent\.transaction\)/, "allowance refresh must never auto-open or submit the order review");
  assert.match(html, /async function confirmTrade\(\) \{[\s\S]*?Bankr chat execution is unavailable\.[\s\S]*?authorized external signer/, "the disabled confirmation action must explain the supported boundary");
  assert.match(html, /let preparationVersion = 0;/, "preparation must use an intent version");
  assert.match(html, /function invalidatePrepared\(\)/, "input changes must invalidate a prepared confirmation");
  assert.match(html, /const currentPreparationVersion=\+\+preparationVersion;/, "each prepare request must bind its version");
  assert.match(html, /if \(currentPreparationVersion !== preparationVersion\) return;/, "late prepare results must be ignored");
  assert.match(html, /\["asset","bias","size"\]\.forEach\(id=>\$\(id\)\.addEventListener\("change",invalidatePrepared\)\);/);
  for (const label of ["Asset", "Size", "Expiry", "Strikes", "Chain", "Wallet", "Maximum at risk", "Network fee", "Intent fingerprint"]) {
    assert.match(html, new RegExp(`reviewField\\("${label}"`), `review must display ${label}`);
  }
  assert.match(html, /addressField\("Callput PositionManager",txPreview\.destination\)/, "review must link the Callput destination");
  assert.doesNotMatch(html, /Transaction submitted\./, "opening Bankr chat must never be described as transaction submission");
  assert.doesNotMatch(html, /wallet_confirmed/, "opening Bankr chat must never emit a wallet-confirmed event");
  assert.doesNotMatch(html, /lastHandoffIntentFingerprint/, "reconciliation must not depend on an unavailable chat handoff");
  assert.doesNotMatch(html, /sessionStorage|appKV|persistTradeSession|restoreTradeSession/, "handoff recovery must not depend on iframe or Bankr app persistence");
  assert.doesNotMatch(trackScript, /appKV|bankr\.files/, "telemetry must not request storage permissions");
  assert.match(html, /id="txHash"[^>]*placeholder="0x… successful Base transaction hash"/, "reconciliation must accept the successful Base transaction hash from an external signer");
  assert.match(html, /const txHash=\$\("txHash"\)\.value\.trim\(\);/, "reconciliation must read the pasted Bankr transaction hash");
  assert.match(html, /\^0x\[0-9a-fA-F\]\{64\}\$/, "reconciliation must validate the pasted transaction hash locally");
  assert.match(html, /const reconcileArgs=\{ tx_hash:txHash \};/, "reconciliation must use the explicitly pasted successful Base transaction hash");
  assert.match(html, /Checking the exact Base transaction/, "reconciliation loading copy must describe the canonical lookup path");
  assert.match(html, /No matching on-chain Callput request was found\. Unsigned preparation did not prove submission\./, "not-found reconciliation must preserve the unsigned boundary");
  assert.match(html, /This does not prove failure\.[\s\S]*Check the external signer or BaseScan[\s\S]*before preparing another order/, "not-found reconciliation must prevent blind resubmission");
  assert.match(html, /Pending[\s\S]*USDC may already be committed[\s\S]*Do not resubmit/, "pending reconciliation must warn against duplicate submission");
  assert.match(html, /Cancelled[\s\S]*verify the returned USDC[\s\S]*before preparing another order/, "cancelled reconciliation must require a funds check before retrying");
  assert.match(html, /Last checked/, "reconciliation must show when status was checked");
  assert.doesNotMatch(html, /Reading the Callput request created by/, "reconciliation must not claim an unsent handoff created a request");
  assert.match(html, /bankr\.scripts\.run\("reconcile",reconcileArgs\)/, "reconciliation must be explicitly scoped");
  assert.match(html, /const result=await bankr\.scripts\.run\("reconcile",reconcileArgs\);\s*if \(result\?\.error\) throw new Error\(result\.error\);\s*const checkedAt=/, "reconciliation must surface backend provenance failures instead of rendering an undefined status");
  assert.doesNotMatch(html, /bankr\.scripts\.run\("reconcile",\{\}\)/, "a trade must not reconcile against an arbitrary latest request");
  assert.match(html, /maximum_usdc_at_risk/);
  assert.match(html, /function syncAuthUi\(\)/);
  assert.doesNotMatch(html, /bankr\.ctx\.walletAddress\.slice/, "the public app validator rejects nullable walletAddress slicing");
  assert.match(html, /function currentWalletAddress\(\) \{ return String\(bankr\.ctx\.walletAddress \|\| bankr\.wallet\.evmAddress \|\| bankr\.wallet\.address \|\| ""\); \}/, "wallet display must safely normalize every supported SDK address source");
  assert.match(html, /\$\("scan"\)\.disabled=!authenticated/);
  assert.match(html, /\$\("reconcile"\)\.disabled=!authenticated/);
  assert.match(html, /\$\("refreshPositions"\)\.disabled=!authenticated/);
  assert.match(html, /bankr\.scripts\.run\("positions"/);
  assert.match(html, /if \(result\?\.error\) throw new Error\(result\.error\)/, "position refresh must surface backend errors instead of rendering a false empty state");
  assert.match(html, /result\.position_data_warning/, "partial position reads must be disclosed and disable batch actions");
  assert.doesNotMatch(html, /bankr\.scripts\.run\("(?:close|settle|close-all|settle-all)"/, "the public frontend must not open lifecycle handoffs while execution is unavailable");
  assert.match(html, /Close, settle, close-all, and settle-all chat handoffs are unavailable/i, "lifecycle UX must disclose the same Bankr chat limitation");
  assert.doesNotMatch(html, /for\s*\([^)]*\)\s*\{[^}]*confirmTransaction/s, "batch reviews must not auto-loop through wallet confirmations");
  assert.doesNotMatch(html, /fetch\(["']https?:\/\//, "frontend must route external HTTP through backend scripts");

  for (const script of manifest.scripts) {
    const source = read(`bankr-app/scripts/${script}.ts`);
    assert.doesNotMatch(source, /^\s*(import|export)\s/m, `${script} must remain a top-level Bankr script`);
    assert.match(source, /return\s/, `${script} must return a result`);
  }

  const prepare = prepareScript;
  const reconcileScript = read("bankr-app/scripts/reconcile.ts");
  const positionsScript = read("bankr-app/scripts/positions.ts");
  const closeScript = read("bankr-app/scripts/close.ts");
  const settleScript = read("bankr-app/scripts/settle.ts");
  const closeAllScript = read("bankr-app/scripts/close-all.ts");
  const settleAllScript = read("bankr-app/scripts/settle-all.ts");
  const core = read("src/core.ts");
  const toolReference = read("callput/references/TOOL_REFERENCE.md");
  assert.match(prepare, /bankr\.tx\.prepare/);
  assert.match(prepare, /const DEFAULT_MIN_FILL_RATIO = 0\.78/);
  assert.match(prepare, /min_fill_ratio: DEFAULT_MIN_FILL_RATIO/);
  assert.match(core, /export const DEFAULT_MIN_FILL_RATIO = 0\.78/);
  assert.match(core, /params\.minFillRatio \?\? DEFAULT_MIN_FILL_RATIO/);
  assert.match(toolReference, /default 0\.78/);
  assert.doesNotMatch(prepare, /privateKey|secret|signTransaction/i);
  assert.match(reconcileScript, /intent_fingerprint: args\.intent_fingerprint \? String\(args\.intent_fingerprint\) : undefined/, "reconcile must forward the explicit intent fingerprint");
  assert.match(positionsScript, /\/api\/bankr\/positions/);
  assert.match(closeScript, /\/api\/bankr\/close/);
  assert.match(settleScript, /\/api\/bankr\/settle/);
  assert.match(closeAllScript, /\/api\/bankr\/close-all/);
  assert.match(settleAllScript, /\/api\/bankr\/settle-all/);
  assert.match(closeAllScript, /plan_only: true/, "Bankr close-all must request a non-privileged staged plan");
  assert.match(settleAllScript, /plan_only: true/, "Bankr settle-all must request a non-privileged staged plan");
  for (const source of [closeScript, settleScript]) {
    assert.match(source, /bankr\.tx\.prepare/, "every lifecycle builder must pass canonical calldata through Bankr transaction preparation");
    assert.match(source, /to: tx\.to\.toLowerCase\(\)/, "every lifecycle builder must normalize destinations for Bankr Wallet API compatibility");
    assert.match(source, /position_token_approval/, "every lifecycle builder must handle the required ERC-1155 controller approval");
    assert.doesNotMatch(source, /confirmTransaction|signTransaction|privateKey/i, "backend scripts must not confirm or sign");
  }
  for (const source of [closeAllScript, settleAllScript]) {
    assert.doesNotMatch(source, /bankr\.tx\.prepare/, "batch planners must not perform repeated privileged transaction preparation");
    assert.doesNotMatch(source, /confirmTransaction|signTransaction|privateKey/i, "batch planners must not confirm or sign");
    assert.match(source, /return prepared/, "batch planners must return the canonical lifecycle plan for staged review");
  }
  assert.match(html, /async function prepareLifecycle\(action,position\) \{[\s\S]*?Bankr chat execution is unavailable/, "single-position actions must stop at the disabled boundary");
  assert.match(html, /async function prepareLifecycleBatch\(action\) \{[\s\S]*?Bankr chat execution is unavailable/, "batch actions must stop at the disabled boundary");
  assert.match(html, /authenticated \? "Refresh positions to load this wallet\. Chat execution is unavailable\." : "Sign in to Bankr to load positions\."/, "position guidance must follow authentication and execution availability");
  assert.doesNotMatch(html, /Sign in, then refresh your wallet positions\./, "the viewer app must not retain ambiguous sign-in guidance");
  assert.match(html, /minimum_fill_ratio/);

  const installPrompt = read("bankr-app/INSTALL_PROMPT.md");
  assert.match(installPrompt, /tree\/v0\.5\.29\/bankr-app/);
  assert.match(installPrompt, /Run only `assets`, `scan`, and `positions`/);
  assert.match(installPrompt, /Do not run `prepare`, `close`, `settle`, `close-all`, `settle-all`, or `track`/);
  assert.doesNotMatch(installPrompt, /each read-only script/i);

  const bankrGuide = read("BANKR_GUIDE.md");
  assert.match(bankrGuide, /Transport: HTTP/);
  assert.match(bankrGuide, /Authentication: None/);

  const skill = read("callput/SKILL.md");
  assert.match(skill, /^visibility: public$/m);
  assert.match(skill, /^tags: \[options, crypto, stocks, etf, base, trading\]$/m);

  console.log("Bankr App package tests passed.");
}

main();
