import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Wallet} from 'ethers';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';

test('local sponsored MCP exposes bounded account operations and never accepts private keys',async()=>{
  const url=new URL('../scripts/sponsored-account-mcp.mjs',import.meta.url);
  await assert.doesNotReject(fs.access(url),'local account MCP must exist');
  const {createSponsoredMcp}=await import(url);
  const server=createSponsoredMcp({info:()=>({signer_available:false,max_user_collateral_raw:'100000'}),context:async()=>({balance:'2070000'}),login:async()=>{throw Error('Local owner signer is not unlocked');}});
  const [a,b]=InMemoryTransport.createLinkedPair();const c=new Client({name:'account-test',version:'1'});
  try{await server.connect(a);await c.connect(b);const list=await c.listTools();assert.equal(list.tools.length,8);assert.ok(!JSON.stringify(list.tools).includes('private_key'));const r=await c.callTool({name:'callput_account_info',arguments:{}});assert.equal(r.structuredContent.max_user_collateral_raw,'100000');const privateInput=await c.callTool({name:'callput_account_info',arguments:{private_key:'not-a-real-key'}});assert.equal(privateInput.isError,true,'unknown secret arguments must reject');const auth=await c.callTool({name:'callput_account_login',arguments:{}});assert.equal(auth.isError,true);assert.match(auth.content[0].text,/not unlocked/);}finally{await c.close();await server.close();}
});

test('only finalized expired zero-use proof can release a reserved budget, preserving encrypted history',async()=>{
  const {sponsoredStorage}=await import('../scripts/sponsored-storage.mjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'callput-expired-budget-'));
  const store=sponsoredStorage(root,'robinhood'),wallet=Wallet.createRandom(),password='test-only-expired-session-password';
  const id='12345678-1234-4234-8234-123456789012',digest='0x'+'a'.repeat(64),record={owner:wallet.address.toLowerCase(),network:'robinhood',id,digest,maxAmount:'100000'};
  try{
    await store.reserve(record);await store.save({devicePrivateKey:wallet.privateKey,id,grant:{maxAmount:'100000'}},password);
    const publicState=await store.loadPublic();assert.ok(!JSON.stringify(publicState).includes(wallet.privateKey.slice(2)));assert.ok(!publicState.encryptedDevice);
    const proof={kind:'finalized_unused_expired',owner:record.owner,network:'robinhood',previousId:id,digest,validUntil:'100',blockTimestamp:'101',opens:'0',closes:'0',amountSpent:'0',feesSpent:'0',blockHash:'0x'+'b'.repeat(64)};
    await assert.rejects(store.releaseUnused({...proof,amountSpent:'1'}),/unused|proof/);
    await assert.rejects(store.releaseUnused({...proof,blockTimestamp:'99'}),/expired|proof/);
    assert.equal((await fs.readFile(path.join(root,'robinhood.budget.json'),'utf8')).includes(id),true);
    await store.releaseUnused(proof);
    await assert.rejects(fs.access(path.join(root,'robinhood.budget.json')));
    await assert.rejects(fs.access(path.join(root,'robinhood.session.json')));
    const history=JSON.parse(await fs.readFile(path.join(root,'history',`robinhood-${id}.json`),'utf8'));
    assert.equal(history.proof.blockHash,proof.blockHash);assert.ok(history.session.encryptedDevice);
    await store.reserve({...record,id:'abcdefab-1234-4234-8234-123456789012',digest:'0x'+'c'.repeat(64)});
    await assert.rejects(store.save({devicePrivateKey:wallet.privateKey,id,grant:{}},password),/budget/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('durable budget prevents new grants and device key is encrypted on disk',async()=>{
  const url=new URL('../scripts/sponsored-storage.mjs',import.meta.url);
  await assert.doesNotReject(fs.access(url),'private storage must exist');
  const {sponsoredStorage}=await import(url);const root=await fs.mkdtemp(path.join(os.tmpdir(),'callput-account-storage-'));
  try{const store=sponsoredStorage(root,'robinhood'),wallet=Wallet.createRandom(),password='test-only-strong-password',record={owner:wallet.address.toLowerCase(),network:'robinhood',id:'request1',digest:'digest1',maxAmount:'100000'};
  await store.reserve(record);await store.reserve(record);await assert.rejects(store.reserve({...record,id:'request2'}),/reserved/);
  await store.save({devicePrivateKey:wallet.privateKey,id:'request1',grant:{maxAmount:'100000'}},password);
  const raw=await fs.readFile(path.join(root,'robinhood.session.json'),'utf8');assert.ok(!raw.includes(wallet.privateKey.slice(2)));assert.ok(!raw.includes(password));
  assert.equal((await store.load(password)).devicePrivateKey,wallet.privateKey);assert.equal((await fs.stat(path.join(root,'robinhood.session.json'))).mode&0o777,0o600);
  const ordered={devicePrivateKey:wallet.privateKey,id:'request1',grant:{maxAmount:'100000'},order:{fingerprint:'first',envelope:{reservation:'original',nonce:'0'}}};
  await store.save(ordered,password);
  const durable=await fs.readFile(path.join(root,'robinhood.session.json'),'utf8');
  await assert.rejects(store.save({...ordered,order:undefined},password),/order/);
  await assert.rejects(store.save({...ordered,order:{fingerprint:'second',envelope:{reservation:'replacement',nonce:'0'}}},password),/order/);
  assert.equal(await fs.readFile(path.join(root,'robinhood.session.json'),'utf8'),durable);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
