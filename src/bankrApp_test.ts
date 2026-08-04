import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(path, "utf8");

function main() {
  const manifest = JSON.parse(read("bankr-app/manifest.json"));
  assert.deepEqual(manifest.permissions, ["read:wallet", "fetch:http", "prepare:transaction"]);
  assert.equal(manifest.frontendIdentity, "viewer");
  assert.deepEqual(manifest.scripts, ["assets", "scan", "prepare", "reconcile", "track"]);

  const html = read("bankr-app/index.html");
  assert.match(html, /bankr\.confirmTransaction\(prepared\.transaction\)/);
  assert.match(html, /maximum_usdc_at_risk/);
  assert.doesNotMatch(html, /fetch\(["']https?:\/\//, "frontend must route external HTTP through backend scripts");

  for (const script of manifest.scripts) {
    const source = read(`bankr-app/scripts/${script}.ts`);
    assert.doesNotMatch(source, /^\s*(import|export)\s/m, `${script} must remain a top-level Bankr script`);
    assert.match(source, /return\s/, `${script} must return a result`);
  }

  const prepare = read("bankr-app/scripts/prepare.ts");
  assert.match(prepare, /bankr\.tx\.prepare/);
  assert.doesNotMatch(prepare, /privateKey|secret|signTransaction/i);

  console.log("Bankr App package tests passed.");
}

main();
