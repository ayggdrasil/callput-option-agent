import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(path, "utf8");

function main() {
  const manifest = JSON.parse(read("bankr-app/manifest.json"));
  assert.deepEqual(manifest.permissions, ["read:wallet", "fetch:http", "prepare:transaction"]);
  assert.equal(manifest.frontendIdentity, "viewer");
  assert.deepEqual(manifest.scripts, ["assets", "scan", "prepare", "reconcile", "track"]);
  assert.match(manifest.description, /synthetic on-chain/i);
  assert.match(manifest.description, /not broker-listed/i);
  assert.ok(manifest.tags.includes("crypto"));

  const html = read("bankr-app/index.html");
  assert.match(html, /bankr\.confirmTransaction\(confirmationIntent\.transaction\)/, "the order confirmation must use the reviewed intent snapshot");
  assert.doesNotMatch(html, /bankr\.confirmTransaction\(prepared\.transaction\)/, "the mutable prepared state must not be confirmed");
  assert.match(html, /await bankr\.confirmTransaction\(confirmationIntent\.approval\);\s+if \(confirmationVersion !== preparationVersion \|\| confirmationIntent !== prepared\)/, "approval completion must revalidate the reviewed intent before opening the order confirmation");
  assert.match(html, /let preparationVersion = 0;/, "preparation must use an intent version");
  assert.match(html, /function invalidatePrepared\(\)/, "input changes must invalidate a prepared confirmation");
  assert.match(html, /const currentPreparationVersion=\+\+preparationVersion;/, "each prepare request must bind its version");
  assert.match(html, /if \(currentPreparationVersion !== preparationVersion\) return;/, "late prepare results must be ignored");
  assert.match(html, /\["asset","bias","size"\]\.forEach\(id=>\$\(id\)\.addEventListener\("change",invalidatePrepared\)\);/);
  for (const label of ["Asset", "Size", "Expiry", "Strikes", "Destination", "Chain", "Wallet", "Maximum at risk", "Network fee", "Intent fingerprint"]) {
    assert.match(html, new RegExp(`reviewField\\("${label}"`), `review must display ${label}`);
  }
  assert.match(html, /function transactionHash\(result\)/, "confirmation result must yield a transaction hash");
  assert.match(html, /const txHash=transactionHash\(confirmation\);/);
  assert.match(html, /let lastConfirmedIntentFingerprint = null;/, "the prepared fingerprint must survive a void confirmation result");
  assert.match(html, /lastConfirmedIntentFingerprint=confirmationIntent\.intent_fingerprint;/);
  assert.match(html, /lastConfirmedTxHash=\/\^0x\[0-9a-f\]\{64\}\$\/i\.test\(txHash \|\| ""\) \? txHash : null;/, "a confirmation hash is optional");
  assert.doesNotMatch(html, /did not return a usable transaction hash/, "void confirmation results must still succeed");
  assert.match(html, /const reconcileArgs=lastConfirmedTxHash \? \{ tx_hash:lastConfirmedTxHash \} : \{ intent_fingerprint:lastConfirmedIntentFingerprint \};/, "reconciliation must use the hash when available or the prepared fingerprint otherwise");
  assert.match(html, /bankr\.scripts\.run\("reconcile",reconcileArgs\)/, "reconciliation must be explicitly scoped");
  assert.doesNotMatch(html, /bankr\.scripts\.run\("reconcile",\{\}\)/, "a trade must not reconcile against an arbitrary latest request");
  assert.match(html, /maximum_usdc_at_risk/);
  assert.match(html, /function syncAuthUi\(\)/);
  assert.match(html, /\$\("scan"\)\.disabled=!authenticated/);
  assert.match(html, /\$\("reconcile"\)\.disabled=!authenticated/);
  assert.doesNotMatch(html, /fetch\(["']https?:\/\//, "frontend must route external HTTP through backend scripts");

  for (const script of manifest.scripts) {
    const source = read(`bankr-app/scripts/${script}.ts`);
    assert.doesNotMatch(source, /^\s*(import|export)\s/m, `${script} must remain a top-level Bankr script`);
    assert.match(source, /return\s/, `${script} must return a result`);
  }

  const prepare = read("bankr-app/scripts/prepare.ts");
  const reconcileScript = read("bankr-app/scripts/reconcile.ts");
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
  assert.match(html, /minimum_fill_ratio/);

  const installPrompt = read("bankr-app/INSTALL_PROMPT.md");
  assert.match(installPrompt, /tree\/v0\.4\.0\/bankr-app/);
  assert.match(installPrompt, /Run only `assets` and `scan`/);
  assert.match(installPrompt, /Do not run `prepare` or `track`/);
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
