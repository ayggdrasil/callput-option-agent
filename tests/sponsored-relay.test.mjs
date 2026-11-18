import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import {Wallet, verifyTypedData, Interface} from 'ethers';

test('sponsored adapter pins identity, authenticates privately, bounds grant and retries exact signed open', async()=>{
  const file=new URL('../scripts/sponsored-relay.mjs',import.meta.url);
  await assert.doesNotReject(fs.access(file),'sponsored adapter must exist');
  const {SponsoredRelay}=await import(file);
  const owner=Wallet.createRandom(), requests=[], budget=[],saved=[];
  let failTrade=true,savedOrderAttempts=0;
  let adapter;
  const fetchImpl=async(url,init)=>{
    requests.push({url,init}); const p=new URL(url).pathname, body=init.body&&JSON.parse(init.body);
    const identity=adapter.identity;
    if(p==='/v1/auth/challenge'){
      const issued=new Date().toISOString(), expires=new Date(Date.parse(issued)+300000).toISOString();
      const sessionExpires=new Date(Date.parse(issued)+600000).toISOString(),id='12345678-1234-4234-8234-123456789012';
      return Response.json({id,expiresAt:expires,sessionExpiresAt:sessionExpires,message:`https://robin.callput.app wants you to sign in with your Ethereum account:\n${owner.address}\n\nSign in to CallPut's sponsored trading service. This signature does not authorize moving funds.\n\nURI: https://robin.callput.app/v1/auth/session\nVersion: 1\nChain ID: 4663\nNonce: ${'a'.repeat(32)}\nIssued At: ${issued}\nExpiration Time: ${sessionExpires}\nRequest ID: ${id}`},{headers:{'set-cookie':'__Host-callput-owner-challenge=test-challenge; Path=/; Secure; HttpOnly'}});
    }
    if(p==='/v1/auth/verify')return Response.json({owner:owner.address.toLowerCase(),chainId:'4663',expiresAt:/Expiration Time: ([^\n]+)/.exec(body.message)[1]},{headers:{'set-cookie':'__Host-callput-owner=test-session; Path=/; Secure; HttpOnly'}});
    if(p.startsWith('/v1/account-state/'))return Response.json({...identity,created:true,context:{...identity,epoch:'0',blockTimestamp:String(Math.floor(Date.now()/1000)),sessions:[]}});
    if(p.startsWith('/v1/session-context/'))return Response.json({...identity,epoch:'0',blockTimestamp:String(Math.floor(Date.now()/1000)),sessions:new URL(url).searchParams.has('sessionId')?[{sessionId:new URL(url).searchParams.get('sessionId'),installed:true,revoked:false,opens:'0'}]:[]});
    if(p==='/v1/reservations')return Response.json({id:body.requestId,...identity,nonce:'0',epoch:'0',epochKnown:true,scope:'grant:0'});
    if(p==='/v1/grant-preparations')return Response.json({grant:body.grant});
    if(p==='/v1/operations')return Response.json({id:body.reservation,account:identity.account,state:'queued'});
    if(p==='/v1/trades'){if(failTrade){failTrade=false;throw Error('do not expose transport credentials');}return Response.json({id:body.order.reservation,account:identity.account,state:'queued'});}
    throw Error('unexpected path');
  };
  adapter=new SponsoredRelay({network:'robinhood',owner:owner.address,ownerSigner:owner,fetchImpl,verifyContext:async()=>{},persistSession:async r=>{if(r.order&&++savedOrderAttempts===1)throw Error('storage failure');saved.push(structuredClone(r));},reserveBudget:async record=>budget.push(record)});
  assert.notEqual(adapter.identity.account,owner.address.toLowerCase());
  await adapter.login();
  assert.ok(!JSON.stringify(adapter.info()).includes('test-session'));
  const grant=await adapter.registerSession();
  assert.equal(grant.grant.maxAmount,'100000');
  assert.equal(grant.grant.maxOpens,'1');
  assert.equal(grant.grant.maxCloses,'0');
  assert.deepEqual(grant.grant.underlyings,['2']);
  assert.equal(budget.length,1);
  assert.ok(requests.find(r=>new URL(r.url).pathname==='/v1/reservations').init.headers.cookie.includes('test-session'));
  const leg=strike=>'0x'+((2n<<240n)|(BigInt(Math.floor(Date.now()/1000)+86400)<<200n)|(BigInt(strike)<<152n)).toString(16).padStart(64,'0');
  const params={underlyingAssetIndex:'2',length:'2',isBuys:[true,false,false,false],optionIds:[leg(2000),leg(2100),'0x'+'0'.repeat(64),'0x'+'0'.repeat(64)],isCalls:[true,true,false,false],minSize:'1',amountIn:'3000'};
  await assert.rejects(adapter.open({...params,amountIn:'100001'}),/budget/);
  const pending=adapter.open(params);
  await assert.rejects(adapter.open({...params,amountIn:'3001'}),/different|already/);
  await assert.rejects(pending,/storage failure/);
  assert.equal(requests.filter(r=>new URL(r.url).pathname==='/v1/trades').length,0);
  await assert.rejects(adapter.open(params),/outcome may be unknown/);
  assert.equal(savedOrderAttempts,2,'retry must persist before submitting');
  await adapter.open(params);await adapter.open(params);
  const sent=requests.filter(r=>new URL(r.url).pathname==='/v1/trades').map(r=>JSON.parse(r.init.body));
  assert.equal(sent[0].order.intent.nonce,(1n<<128n).toString());
  assert.equal(sent.length,3);assert.deepEqual(sent[0],sent[1]);assert.deepEqual(sent[1],sent[2]);
  assert.equal(verifyTypedData(adapter.domain,adapter.openTypes,{...sent[0].order.intent,params},sent[0].order.signature).toLowerCase(),grant.grant.signer.toLowerCase());
  await assert.rejects(adapter.open({...params,amountIn:'3001'}),/different|already/);
  const recovered=new SponsoredRelay({network:'robinhood',owner:owner.address,fetchImpl,verifyContext:async()=>{},persistSession:async()=>{},resumeSession:saved.at(-1)});
  assert.ok(!JSON.stringify(recovered.info()).includes(saved.at(-1).devicePrivateKey));
  await recovered.open(params);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body),sent[0]);
  const legacy=structuredClone(saved.at(-1));
  legacy.order.envelope.intent.nonce='0';
  legacy.order.envelope.signature=await new Wallet(legacy.devicePrivateKey).signTypedData(
    adapter.domain,adapter.openTypes,{...legacy.order.envelope.intent,params});
  const legacyAdapter=new SponsoredRelay({network:'robinhood',owner:owner.address,
    fetchImpl,verifyContext:async()=>{},resumeSession:legacy});
  const before=requests.length;
  await assert.rejects(legacyAdapter.open(params),/Legacy signed order requires status reconciliation/);
  assert.equal(requests.length,before);
  assert.throws(()=>new SponsoredRelay({network:'evil',owner:owner.address}),/network/);
});

test('no signer cannot authorize and errors do not expose relay payloads or cookies',async()=>{
  const {SponsoredRelay}=await import('../scripts/sponsored-relay.mjs');
  const owner=Wallet.createRandom().address;
  const a=new SponsoredRelay({network:'robinhood',owner,fetchImpl:async()=>Response.json({error:'secret-token-private-key'},{status:503})});
  await assert.rejects(a.login(),/not unlocked/);
  await assert.rejects(a.context(),error=>error.message==='Relay HTTP 503: request_rejected');
  const b=new SponsoredRelay({network:'giwa',owner,fetchImpl:async()=>Response.json({owner,account:owner,chainId:'4663'})});
  await assert.rejects(b.context(),/identity mismatch/);
});
