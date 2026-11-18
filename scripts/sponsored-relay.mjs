import {randomUUID} from 'node:crypto';
import {AbiCoder, getAddress, getCreate2Address, keccak256, Wallet, TypedDataEncoder, JsonRpcProvider, FetchRequest, verifyTypedData, Interface} from 'ethers';
import {openTypes,verifySponsoredReceipt} from './sponsored-receipt.mjs';

const profiles={
  giwa:{chainId:'91342',sponsor:'0x9c3285bb4f797e025b9436234ededcaa983d7a5f',positionManager:'0x8cB54E8df9146220a09cAa9a69fc4B303dD66E69',origin:'https://giwa.callput.app',rpc:'https://sepolia-rpc.giwa.io',factoryCodeHash:'0x38cfe08e398826e5c9a87232d6072dde73647fd25c32995e6b431e4e41775bfc',factory:'0xC2675B4E4C7a0535B6215703445B560c0B5Bfc5D',initCodeHash:'0x183842465f9da8abe81aa8a3fb73de2def866b4ce935e3e9117a0522738f669c',implementationHash:'0xdf811481871d69a2a754c420d56affa0eb7853a1fa399bbf83d67fe5bbd1cdc6'},
  robinhood:{chainId:'4663',sponsor:'0x11404d16d26262c3b6c3fcae7b3ff8a1c655d464',positionManager:'0x426a6b482893557E58cF38de635fEbB30Fd6a3C3',origin:'https://robin.callput.app',rpc:'https://rpc.mainnet.chain.robinhood.com',factoryCodeHash:'0xa4e7a212190833d7d36ac8d9a7b8a5e3700815cc517c3d733f330bf93af6bfbe',factory:'0xbcaC622Bb396B2f868b37D7C41F34695c9be1862',initCodeHash:'0x8df2f87f4305f451c1199b8b59d2e846f35b0bf0b63bdd6cefcdc9381ad13e68',implementationHash:'0xdb21c816880587927a283c494c83cfae60f3333ca9cdca504d8734aae0cc13f2'}
};
const fields=s=>s.split(',').map(v=>{const[type,name]=v.split(' ');return {name,type};});
const grantTypes={Grant:fields('address signer,uint256 nonce,uint256 epoch,uint48 validAfter,uint48 validUntil,uint16[] underlyings,uint16 strategies,uint256 maxAmountPerOpen,uint256 maxAmount,uint32 maxOpens,uint32 maxCloses,uint256 maxFeePerTrade,uint256 maxFees')};
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const uint=v=>{check(typeof v==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(v),'Invalid unsigned integer');return BigInt(v);};
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export class SponsoredRelay {
  #cookies=new Map(); #ownerSigner; #device; #grant; #registering; #order; #opening; #pendingFingerprint; #expiryProof;
  constructor({network,owner,ownerSigner,fetchImpl=fetch,reserveBudget,persistSession,verifyContext,resumeSession}={}){
    check(Object.hasOwn(profiles,network),'Unknown sponsored network');
    this.profile=Object.freeze({...profiles[network]}); this.network=network;
    const address=getAddress(owner).toLowerCase();
    const account=getCreate2Address(this.profile.factory,keccak256(AbiCoder.defaultAbiCoder().encode(['address','uint96'],[address,0])),this.profile.initCodeHash).toLowerCase();
    this.identity=Object.freeze({owner:address,account,chainId:this.profile.chainId,factory:this.profile.factory.toLowerCase(),implementationHash:this.profile.implementationHash});
    this.domain=Object.freeze({name:'CallPut Trading Account',version:'1',chainId:this.profile.chainId,verifyingContract:account});
    this.openTypes=openTypes;this.fetchImpl=fetchImpl;this.reserveBudget=reserveBudget;this.persistSession=persistSession;this.verifyContext=verifyContext??(c=>this.verifyOnChain(c));
    this.#ownerSigner=ownerSigner;
    if(resumeSession){
      const {grant,id,ownerSignature,devicePrivateKey,order}=resumeSession;
      if(devicePrivateKey)this.#device=new Wallet(devicePrivateKey);
      check((!this.#device||grant.signer===this.#device.address.toLowerCase())&&grant.maxAmount==='100000'&&grant.maxAmountPerOpen==='100000'&&grant.maxOpens==='1'&&grant.maxCloses==='0'&&grant.strategies==='32'&&eq(grant.underlyings,['2'])&&uint(grant.validUntil)>uint(grant.validAfter)&&uint(grant.validUntil)-uint(grant.validAfter)<=600n,'Invalid recovered grant');
      check(verifyTypedData(this.domain,grantTypes,grant,ownerSignature).toLowerCase()===address,'Recovered owner signature mismatch');
      this.#grant={id,grant,ownerSignature,sessionId:TypedDataEncoder.hashStruct('Grant',grantTypes,grant)};
      if(order){this.validateOpen(order.envelope.params);check(order.envelope.account===account&&order.envelope.chainId===this.identity.chainId&&eq(order.envelope.grant,grant)&&order.envelope.intent.nonce==='0'&&order.envelope.intent.sessionId===this.#grant.sessionId&&verifyTypedData(this.domain,openTypes,{...order.envelope.intent,params:order.envelope.params},order.envelope.signature).toLowerCase()===grant.signer,'Recovered order mismatch');this.#order=order;}
    }
  }
  info(){return {...this.identity,network:this.network,sponsored:true,max_user_collateral_raw:'100000',signer_available:!!this.#ownerSigner,session:this.#grant?{id:this.#grant.id,sessionId:this.#grant.sessionId,grant:this.#grant.grant}:null};}
  async request(path,body){
    check(/^\/v1\/[a-z0-9/?=&-]+$/i.test(path),'Invalid relay path');
    let response;
    try{response=await this.fetchImpl(this.profile.origin+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{origin:this.profile.origin,'content-type':'application/json',...(this.#cookies.size?{cookie:[...this.#cookies].map(([k,v])=>`${k}=${v}`).join('; ')}:{})},...(body?{body:JSON.stringify(body)}:{})});}
    catch{throw new Error('Relay transport unavailable; submission outcome may be unknown. Retry the same request only.');}
    check(response.headers.get('content-type')?.split(';')[0]==='application/json','Relay returned non-JSON response');
    const reader=response.body.getReader();const chunks=[];let bytes=0;
    try{for(;;){const p=await reader.read();if(p.done)break;bytes+=p.value.length;check(bytes<=32768,'Relay response too large');chunks.push(p.value);}}finally{await reader.cancel();}
    let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('Invalid relay JSON');}
    if(!response.ok)throw new Error(`Relay HTTP ${response.status}: ${/^[a-z_]+$/.test(data.error??'')?data.error:'request_rejected'}`);
    for(const cookie of response.headers.getSetCookie()){
      const pair=cookie.split(';')[0],i=pair.indexOf('='),name=pair.slice(0,i),value=pair.slice(i+1);
      if(['__Host-callput-owner','__Host-callput-owner-challenge'].includes(name)){
        check(value.length<=256&&!/[\r\n;]/.test(value),'Invalid relay credential');
        if(value)this.#cookies.set(name,value);else this.#cookies.delete(name);
      }
    }
    return data;
  }
  validateIdentity(value){check(value?.owner?.toLowerCase()===this.identity.owner&&value?.account?.toLowerCase()===this.identity.account&&String(value.chainId)===this.identity.chainId,'Relay identity mismatch');return value;}
  async context(sessionId){
    const selected=sessionId??this.#grant?.sessionId;
    check(selected===undefined||/^0x[0-9a-f]{64}$/.test(selected),'Invalid selected session');
    const q=await this.request(`/v1/account-state/${this.identity.account}?owner=${this.identity.owner}${selected?'&sessionId='+selected:''}`);
    this.validateIdentity(q);if(q.created)await this.verifyContext(q.context);return q;
  }
  async verifyOnChain(context,{historical=false}={}){
    check(context.factory?.toLowerCase()===this.identity.factory&&context.implementationHash===this.identity.implementationHash,'Account implementation pin mismatch');
    const req=new FetchRequest(this.profile.rpc);req.timeout=10000;const provider=new JsonRpcProvider(req);
    try{
      const chain=await provider.send('eth_chainId',[]);check(BigInt(chain)===BigInt(this.identity.chainId),'Wrong chain');
      this.validateIdentity(context);
      const height=uint(context.blockNumber),tag={blockHash:context.blockHash,requireCanonical:true};
      const iface=new Interface(['function BEACON() view returns(address)','function implementation() view returns(address)','function isCreated(address) view returns(bool)','function accountInfo(address) view returns(address,uint96)','function FACTORY() view returns(address)','function owner() view returns(address)','function epoch() view returns(uint256)','function version() view returns(uint256)','function sessionState(bytes32) view returns((bool installed,bool revoked,uint32 opens,uint32 closes,uint256 amountSpent,uint256 feesSpent))','function sessionNonceUsed(bytes32,uint256) view returns(bool)']);
      const read=async(target,name,args=[])=>iface.decodeFunctionResult(name,await provider.send('eth_call',[{to:target,data:iface.encodeFunctionData(name,args)},tag]));
      const [block,factoryCode,created,accountInfo]=await Promise.all([provider.send('eth_getBlockByNumber',['0x'+height.toString(16),false]),provider.send('eth_getCode',[this.identity.factory,tag]),read(this.identity.factory,'isCreated',[this.identity.account]),read(this.identity.factory,'accountInfo',[this.identity.account])]);
      check(block?.hash===context.blockHash&&BigInt(block.number)===height&&BigInt(block.timestamp)===uint(context.blockTimestamp)&&keccak256(factoryCode)===this.profile.factoryCodeHash,'Canonical factory context mismatch');
      check(created[0]&&accountInfo[0].toLowerCase()===this.identity.owner&&accountInfo[1]===0n,'Factory account ownership mismatch');
      check(historical||Math.abs(Date.now()/1000-Number(context.blockTimestamp))<60,'Stale account context');
      const [beacon]=await read(this.identity.factory,'BEACON');const [implementation]=await read(beacon,'implementation');
      check(implementation.toLowerCase()===context.implementation?.toLowerCase()&&keccak256(await provider.send('eth_getCode',[implementation,tag]))===this.identity.implementationHash,'Account implementation mismatch');
      const [factory,owner,epoch,version]=await Promise.all(['FACTORY','owner','epoch','version'].map(name=>read(this.identity.account,name)));
      check(factory[0].toLowerCase()===this.identity.factory&&owner[0].toLowerCase()===this.identity.owner&&epoch[0]===uint(context.epoch)&&version[0]===6n,'Account owner or version mismatch');
      for(const state of context.sessions??[]){
        const [actual]=await read(this.identity.account,'sessionState',[state.sessionId]);
        check(['installed','revoked'].every(k=>actual[k]===state[k])&&['opens','closes','amountSpent','feesSpent'].every(k=>actual[k]===uint(state[k])),'Session state mismatch');
        if(actual.installed&&!actual.revoked&&actual.opens===0n){const [used]=await read(this.identity.account,'sessionNonceUsed',[state.sessionId,0]);check(!used,'Session nonce already used');}
      }
    }finally{provider.destroy();}
  }
  async login(){
    check(this.#ownerSigner,'Local owner signer is not unlocked');
    check((await this.#ownerSigner.getAddress()).toLowerCase()===this.identity.owner,'Wrong owner signer');
    const c=await this.request('/v1/auth/challenge',{owner:this.identity.owner});
    const nonce=/\nNonce: ([a-f0-9]{32})\n/.exec(c.message)?.[1],issued=/\nIssued At: ([^\n]+)\n/.exec(c.message)?.[1];
    check(nonce&&issued&&/^[0-9a-f-]{36}$/.test(c.id),'Invalid owner challenge');
    const t=Date.parse(issued),e=Date.parse(c.expiresAt),s=Date.parse(c.sessionExpiresAt);
    check(Number.isFinite(t)&&t<=Date.now()+5000&&e===t+300000&&e>Date.now()&&s>=t+300000&&s<=t+691200000,'Expired or invalid owner challenge');
    const expected=`${this.profile.origin} wants you to sign in with your Ethereum account:\n${getAddress(this.identity.owner)}\n\nSign in to CallPut's sponsored trading service. This signature does not authorize moving funds.\n\nURI: ${this.profile.origin}/v1/auth/session\nVersion: 1\nChain ID: ${this.identity.chainId}\nNonce: ${nonce}\nIssued At: ${issued}\nExpiration Time: ${c.sessionExpiresAt}\nRequest ID: ${c.id}`;
    check(c.message===expected,'Owner challenge domain or identity mismatch');
    const signature=await this.#ownerSigner.signMessage(c.message);
    const principal=await this.request('/v1/auth/verify',{id:c.id,message:c.message,signature});
    check(principal.owner?.toLowerCase()===this.identity.owner&&principal.chainId===this.identity.chainId&&principal.expiresAt===c.sessionExpiresAt,'Login principal mismatch');
    return {owner:principal.owner,chainId:principal.chainId,expiresAt:principal.expiresAt};
  }
  async registerSession(){
    if(this.#registering)return this.#registering;
    this.#registering=this.registerOnce();return this.#registering;
  }
  async registerOnce(){
    check(this.#ownerSigner&&this.reserveBudget&&this.persistSession,'Unlocked signer, encrypted session storage and durable budget ledger required');
    const c=this.validateIdentity(await this.request(`/v1/session-context/${this.identity.account}`));
    await this.verifyContext(c);
    if(this.#grant){
      const g=this.#grant;
      check(c.epoch===g.grant.epoch&&uint(g.grant.validUntil)>BigInt(Math.floor(Date.now()/1000))+30n,'Recovered session expired or invalidated; budget remains reserved');
      await this.reserveBudget({owner:this.identity.owner,network:this.network,id:g.id,digest:TypedDataEncoder.hash(this.domain,grantTypes,g.grant),maxAmount:g.grant.maxAmount});
      const operation=await this.request('/v1/operations',{version:1,chainId:this.identity.chainId,account:this.identity.account,reservation:g.id,action:'register',grant:g.grant,signature:g.ownerSignature});
      return {id:g.id,grant:g.grant,sessionId:g.sessionId,operation};
    }
    const id=randomUUID(),r=this.validateIdentity(await this.request('/v1/reservations',{account:this.identity.account,kind:'grant',requestId:id}));
    check(r.id===id&&r.epoch===c.epoch&&r.epochKnown===true&&r.scope===`grant:${c.epoch}`,'Grant reservation mismatch');
    this.#device=Wallet.createRandom();
    const start=uint(c.blockTimestamp),grant={signer:this.#device.address.toLowerCase(),nonce:uint(r.nonce).toString(),epoch:uint(c.epoch).toString(),validAfter:start.toString(),validUntil:(start+600n).toString(),underlyings:['2'],strategies:'32',maxAmountPerOpen:'100000',maxAmount:'100000',maxOpens:'1',maxCloses:'0',maxFeePerTrade:'1000000000000000',maxFees:'1000000000000000'};
    const preparation=await this.request('/v1/grant-preparations',{account:this.identity.account,requestId:id,grant});
    check(eq(preparation.grant,grant),'Prepared grant changed');
    const digest=TypedDataEncoder.hash(this.domain,grantTypes,grant);
    // Reserve the full authorized user risk before owner signing. Never release on a lost HTTP response.
    await this.reserveBudget({owner:this.identity.owner,network:this.network,id,digest,maxAmount:grant.maxAmount});
    const signature=await this.#ownerSigner.signTypedData(this.domain,grantTypes,grant);
    this.#grant={id,grant,ownerSignature:signature,sessionId:TypedDataEncoder.hashStruct('Grant',grantTypes,grant)};
    await this.saveSession();
    const operation=await this.request('/v1/operations',{version:1,chainId:this.identity.chainId,account:this.identity.account,reservation:id,action:'register',grant,signature});
    check(operation.id===id&&operation.account===this.identity.account,'Grant submission identity mismatch');
    return {id,grant,sessionId:this.#grant.sessionId,operation};
  }
  validateOpen(p){
    check(p&&Object.keys(p).length===7&&p.underlyingAssetIndex==='2'&&p.length==='2','Only canonical ETH buy-call spreads supported');
    check(eq(p.isBuys,[true,false,false,false])&&eq(p.isCalls,[true,true,false,false]),'Only canonical ETH buy-call spreads supported');
    check(uint(p.amountIn)>0n&&uint(p.amountIn)<=100000n,'Open exceeds user budget');check(uint(p.minSize)>0n,'Minimum size required');
    check(Array.isArray(p.optionIds)&&p.optionIds.length===4&&p.optionIds.every(v=>/^0x[0-9a-fA-F]{64}$/.test(v))&&p.optionIds.slice(2).every(v=>BigInt(v)===0n),'Invalid option IDs');
    const [a,b]=p.optionIds.map(BigInt),mask=(1n<<40n)-1n,expiry=(a>>200n)&mask;
    check(a>>240n===2n&&b>>240n===2n&&expiry===((b>>200n)&mask)&&expiry>BigInt(Math.floor(Date.now()/1000))+60n&&((a>>152n)&((1n<<48n)-1n))<((b>>152n)&((1n<<48n)-1n)),'Invalid spread identity, strikes or expiry');
  }
  async open(params){
    this.validateOpen(params);const fingerprint=JSON.stringify(params);
    if(this.#order)check(this.#order.fingerprint===fingerprint,'A different order was already authorized');
    if(this.#opening){check(this.#pendingFingerprint===fingerprint,'A different order is already being authorized');return this.#opening;}
    this.#pendingFingerprint=fingerprint;
    this.#opening=this.openOnce(structuredClone(params),fingerprint);
    try{return await this.#opening;}finally{this.#opening=undefined;}
  }
  async openOnce(params,fingerprint){
    check(this.#grant&&this.#device,'Register a bounded session first');
    if(!this.#order){
      const c=this.validateIdentity(await this.request(`/v1/session-context/${this.identity.account}?sessionId=${this.#grant.sessionId}`));
      await this.verifyContext(c);
      const state=c.sessions?.find(v=>v.sessionId===this.#grant.sessionId);
      check(c.epoch===this.#grant.grant.epoch&&state?.installed&&!state.revoked&&uint(state.opens)===0n,'Session not installed or already consumed');
      const intent={sessionId:this.#grant.sessionId,epoch:this.#grant.grant.epoch,nonce:'0',deadline:((uint(c.blockTimestamp)+120n)<uint(this.#grant.grant.validUntil)?(uint(c.blockTimestamp)+120n):uint(this.#grant.grant.validUntil)).toString(),source:'0'};
      check(BigInt(intent.deadline)>=uint(c.blockTimestamp)+30n&&BigInt(intent.deadline)>=BigInt(Math.floor(Date.now()/1000))+30n,'Session expiring');
      const reservation=randomUUID(),signature=await this.#device.signTypedData(this.domain,openTypes,{...intent,params});
      this.#order={fingerprint,envelope:{version:1,chainId:this.identity.chainId,account:this.identity.account,reservation,action:'open',grant:this.#grant.grant,intent,params,signature}};
    }
    await this.saveSession();
    const result=await this.request('/v1/trades',{grantRequestId:this.#grant.id,order:this.#order.envelope});
    check(result.id===this.#order.envelope.reservation&&result.account===this.identity.account,'Order submission identity mismatch');
    return result;
  }
  async unusedExpiryProof(){
    check(this.#grant,'A saved owner-signed grant is required');
    const req=new FetchRequest(this.profile.rpc);req.timeout=10000;const provider=new JsonRpcProvider(req);
    try{
      const block=await provider.getBlock('finalized');
      check(block?.hash&&BigInt(block.timestamp)>uint(this.#grant.grant.validUntil),'Session is not expired at a finalized block');
      const tag={blockHash:block.hash,requireCanonical:true};
      const abi=new Interface(['function BEACON() view returns(address)','function implementation() view returns(address)','function epoch() view returns(uint256)','function sessionState(bytes32) view returns((bool installed,bool revoked,uint32 opens,uint32 closes,uint256 amountSpent,uint256 feesSpent))']);
      const read=async(to,name,args=[])=>abi.decodeFunctionResult(name,await provider.send('eth_call',[{to,data:abi.encodeFunctionData(name,args)},tag]))[0];
      const beacon=await read(this.identity.factory,'BEACON');
      const [implementation,epoch,state]=await Promise.all([read(beacon,'implementation'),read(this.identity.account,'epoch'),read(this.identity.account,'sessionState',[this.#grant.sessionId])]);
      const counters=Object.fromEntries(['opens','closes','amountSpent','feesSpent'].map(k=>[k,state[k].toString()]));
      check(Object.values(counters).every(v=>v==='0'),'Expired session was used; keep its budget reserved');
      const context={...this.identity,implementation,epoch:epoch.toString(),blockNumber:String(block.number),blockHash:block.hash,blockTimestamp:String(block.timestamp),sessions:[{sessionId:this.#grant.sessionId,installed:state.installed,revoked:state.revoked,...counters}]};
      await this.verifyOnChain(context,{historical:true});
      const proof={kind:'finalized_unused_expired',network:this.network,owner:this.identity.owner,account:this.identity.account,previousId:this.#grant.id,digest:TypedDataEncoder.hash(this.domain,grantTypes,this.#grant.grant),sessionId:this.#grant.sessionId,validUntil:this.#grant.grant.validUntil,blockNumber:context.blockNumber,blockHash:context.blockHash,blockTimestamp:context.blockTimestamp,...counters};
      this.#expiryProof=JSON.stringify(Object.keys(proof).sort().map(k=>[k,proof[k]]));return proof;
    }finally{provider.destroy();}
  }
  clearExpiredSession(proof){
    check(!this.#opening&&this.#expiryProof&&JSON.stringify(Object.keys(proof).sort().map(k=>[k,proof[k]]))===this.#expiryProof&&proof.previousId===this.#grant?.id,'Verified unused expiry proof required before resetting local state');
    this.#grant=undefined;this.#device=undefined;this.#registering=undefined;this.#order=undefined;this.#pendingFingerprint=undefined;this.#expiryProof=undefined;
  }
  async receipt(hash){
    check(/^0x[0-9a-fA-F]{64}$/.test(hash)&&this.#order,'A saved signed order and transaction hash are required');
    const req=new FetchRequest(this.profile.rpc);req.timeout=10000;const provider=new JsonRpcProvider(req);
    try{
      const [transaction,receipt]=await Promise.all([provider.getTransaction(hash),provider.getTransactionReceipt(hash)]);
      check(transaction&&receipt,'Sponsored transaction has no receipt yet');
      const result=verifySponsoredReceipt({transaction,receipt,expected:this.#order.envelope,account:this.identity.account,profile:this.profile,domain:this.domain});
      const block=await provider.getBlock(receipt.blockNumber);check(block?.hash===receipt.blockHash,'Receipt is not canonical');
      const tag={blockHash:receipt.blockHash,requireCanonical:true};
      const abi=new Interface(['function BEACON() view returns(address)','function implementation() view returns(address)','function epoch() view returns(uint256)','function POSITION_MANAGER() view returns(address)']);
      const read=async(to,name)=>abi.decodeFunctionResult(name,await provider.send('eth_call',[{to,data:abi.encodeFunctionData(name)},tag]))[0];
      const beacon=await read(this.identity.factory,'BEACON');
      const [implementation,epoch,manager]=await Promise.all([read(beacon,'implementation'),read(this.identity.account,'epoch'),read(this.identity.factory,'POSITION_MANAGER')]);
      check(manager.toLowerCase()===this.profile.positionManager.toLowerCase(),'Pinned PositionManager mismatch');
      await this.verifyOnChain({...this.identity,implementation,epoch:epoch.toString(),blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash,blockTimestamp:String(block.timestamp),sessions:[]},{historical:true});
      return {...result,canonical_block_verified:true};
    }finally{provider.destroy();}
  }
  async orderStatus(id){check(/^[0-9a-f-]{36}$/.test(id),'Invalid request ID');return this.request(`/v1/trades/${id}`);}
  async saveSession(){await this.persistSession({...this.#grant,devicePrivateKey:this.#device.privateKey,order:this.#order});}
}
