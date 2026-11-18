import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers';

test('local keystore encrypts the expected wallet, preserves exclusive files and private permissions', async () => {
  const module = new URL('../scripts/local-keystore.mjs', import.meta.url);
  await assert.doesNotReject(fs.access(module), 'keystore implementation must exist');
  const { importKeystore } = await import(module);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'callput-keystore-test-'));
  const wallet = Wallet.createRandom();
  const password = 'test-only-random-wallet-password';
  const target = path.join(root, 'private', 'owner.json');
  try {
    await assert.rejects(importKeystore({privateKey:wallet.privateKey,password,expectedAddress:Wallet.createRandom().address,target}), /address/i);
    await assert.rejects(fs.access(target));
    await assert.rejects(importKeystore({privateKey:wallet.privateKey,password:'short',expectedAddress:wallet.address,target}), /password/i);
    await importKeystore({privateKey:wallet.privateKey.slice(2),password,expectedAddress:wallet.address,target});
    const encrypted = await fs.readFile(target, 'utf8');
    assert.ok(!encrypted.includes(wallet.privateKey.slice(2)));
    assert.ok(!encrypted.includes(password));
    assert.equal((await Wallet.fromEncryptedJson(encrypted,password)).address, wallet.address);
    assert.equal((await fs.stat(target)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.dirname(target))).mode & 0o777, 0o700);
    await assert.rejects(importKeystore({privateKey:wallet.privateKey,password,expectedAddress:wallet.address,target}), /exist/i);
    assert.equal(await fs.readFile(target,'utf8'),encrypted);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
