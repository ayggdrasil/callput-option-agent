import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';

test('network guide and copy prompt distinguish account custody and owner signing', async () => {
  const source = new URL('../frontend-v1/wallet-guide.js', import.meta.url);
  assert.ok(fs.existsSync(source), 'network wallet guide must exist');
  const { walletGuide } = await import(source);
  for (const network of ['base', 'robinhood', 'giwa']) {
    const guide = walletGuide(network);
    assert.match(guide.prompt, /read.only/i);
    assert.match(guide.prompt, /callput_get_network_info/);
    assert.match(guide.prompt, new RegExp(network));
    if (network !== 'base') {
      assert.match(guide.login, /email.*OTP.*Privy/i);
      assert.match(guide.custody, /owner.*CallPut Account/i);
      assert.match(guide.execution, /callput_workflow_start/i);
      assert.match(guide.prompt, /account address/i);
      assert.match(guide.directExample, /"execution_route": "direct_wallet"/);
    }
  }
  assert.throws(() => walletGuide('ethereum'), /network/i);
});

test('operator console exposes selected-network wallet guidance and source status', () => {
  for (const path of ['frontend-v1/index.html']) {
    const html = fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    for (const id of ['walletLogin', 'walletCustody', 'walletExecution', 'walletAppLink', 'firstPrompt']) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(html, /Source v0\.8\.0/);
    assert.doesNotMatch(html, /hosted endpoints provide v0\.8\.0 immediately/i);
  }
});

test('legacy redirect preserves selected network', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /target\.search = window\.location\.search/);
});
