// Run in your own Terminal after setup-local-keystore.command. No secrets in args/env.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {Wallet,parseUnits} from 'ethers';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {SponsoredRelay} from './sponsored-relay.mjs';
import {sponsoredStorage} from './sponsored-storage.mjs';
import {createSponsoredMcp} from './sponsored-account-mcp.mjs';
import {recoverSponsoredOrder} from './sponsored-recovery.mjs';
import {normalizeOptionId,safeDiagnostic} from './sponsored-inputs.mjs';

const check=(ok,message)=>{if(!ok)throw Error(message);};
const owner='0x84B67bB8b023fc6640C37619cAe28447103b61a8';
const network=process.argv[2]??'robinhood';
check(['giwa','robinhood'].includes(network),'Choose giwa or robinhood');
const directory=path.join(os.homedir(),'Library','Application Support','CallputSigner');
const filename=path.join(directory,'owner.json');
const remote=new Client({name:'external-developer-real-trade',version:'1'});
const local=new Client({name:'external-developer-sponsored-trade',version:'1'});
let server;
let phase='startup';
async function call(client,name,args={}){
  const r=await client.callTool({name,arguments:args});check(!r.isError,r.content?.[0]?.text??'MCP tool error');
  return r.structuredContent??JSON.parse(r.content[0].text);
}
const sleep=()=>new Promise(resolve=>setTimeout(resolve,2000));
async function poll(fn,label,attempts=90){for(let i=0;i<attempts;i++){const result=await fn();if(result)return result;await sleep();}throw Error(`${label}: observation timed out; inspect saved request before retrying`);}

try{
  process.umask(0o077);
  check(process.stdin.isTTY&&process.stdout.isTTY,'Run in your own interactive Terminal');
  phase='unlock';
  const stat=await fs.lstat(filename);
  check(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o077)===0,'Unsafe owner keystore permissions');
  const child=spawnSync('python3',['-c',"import getpass,sys,warnings; warnings.simplefilter('error',getpass.GetPassWarning); sys.stdout.write(getpass.getpass('Keystore password (hidden): '))"],{stdio:['inherit','pipe','inherit'],maxBuffer:16384});
  check(child.status===0,'Local unlock cancelled');let password=child.stdout.toString();child.stdout.fill(0);
  const wallet=await Wallet.fromEncryptedJson(await fs.readFile(filename,'utf8'),password);
  check(wallet.address.toLowerCase()===owner.toLowerCase(),'Keystore is not the authorized owner');
  const storage=sponsoredStorage(directory,network);let resumeSession=await storage.load(password);
  let portfolioBefore=resumeSession?.portfolioBefore;
  const relay=new SponsoredRelay({network,owner,ownerSigner:wallet,resumeSession,reserveBudget:r=>storage.reserve(r),persistSession:r=>storage.save({...r,portfolioBefore},password)});
  server=createSponsoredMcp(relay);const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await local.connect(b);
  await remote.connect(new StreamableHTTPClientTransport(new URL(`https://mcp.callput.app/api/mcp?network=${network}`)));
  phase='account_preflight';
  const info=await call(local,'callput_account_info');let context=await call(local,'callput_account_context');
  check(context.created&&BigInt(context.context?.balance??'0')>0n,'CallPut Account is not funded. No owner-wallet fallback or automatic deposit.');
  if(resumeSession&&!resumeSession.order&&BigInt(context.context.blockTimestamp)>BigInt(resumeSession.grant.validUntil)){
    phase='expired_session_recovery';
    console.log('Waiting for finalized proof of zero use before replacing an expired authorization. The user cap remains0.1.');
    const proof=await poll(async()=>{try{return await call(local,'callput_account_unused_expiry_proof');}catch(error){if(error.message==='Session is not expired at a finalized block')return null;throw error;}},'Finalized unused grant proof',600);
    await storage.releaseUnused(proof);relay.clearExpiredSession(proof);resumeSession=undefined;portfolioBefore=undefined;
    context=await call(local,'callput_account_context');
  }
  check(!resumeSession?.order||portfolioBefore,'Recovery baseline missing; inspect original order without creating another authorization');
  phase='portfolio_baseline';
  const before=portfolioBefore??await call(remote,'callput_portfolio_summary',{address:info.account});portfolioBefore=before;
  console.log(JSON.stringify({network,account:info.account,max_user_loss:'0.1 collateral units',native_fees:'protocol sponsor',action:resumeSession?'resume original bounded authorization':'one ETH buy-call-spread'}));
  if(!resumeSession?.order){
    phase='owner_login';
    await call(local,'callput_account_login');
    phase='session_registration';
    const grant=await call(local,'callput_account_register_session');
    phase='session_installation';
    await poll(async()=>{const s=await call(local,'callput_account_context');const device=s.context?.sessions?.find(v=>v.sessionId===grant.sessionId);return device?.installed&&!device.revoked?s:null;},'Session installation');
  }
  let params=resumeSession?.order?.envelope?.params;
  let candidate;
  if(!params){
    phase='market_scan';
    const scan=await call(remote,'callput_scan_spreads',{underlying_asset:'ETH',bias:'bullish',max_results:1});candidate=scan.candidates?.[0];check(candidate,'No fresh ETH spread candidate');
    phase='quote_validation';
    check(Number.isFinite(candidate.estimated_amount_in_per_unit)&&candidate.estimated_amount_in_per_unit>0,'Invalid spread quote');
    const sizeRaw=parseUnits('0.0001',18),perUnit=parseUnits(candidate.estimated_amount_in_per_unit.toFixed(12),12),scale=10n**30n;
    const amount=(perUnit*sizeRaw*1000000n+scale-1n)/scale;
    check(amount>0n&&amount<=100000n&&amount<=BigInt(context.context.balance),'Quote exceeds user risk or account balance');
    params={underlyingAssetIndex:'2',length:'2',isBuys:[true,false,false,false],optionIds:[normalizeOptionId(candidate.long_leg_id),normalizeOptionId(candidate.short_leg_id),'0x'+'0'.repeat(64),'0x'+'0'.repeat(64)],isCalls:[true,true,false,false],minSize:(sizeRaw*78n/100n).toString(),amountIn:amount.toString()};
  }
  phase='order_submission';
  const order=resumeSession?.order?await recoverSponsoredOrder({
    status:()=>call(local,'callput_account_order_status',{id:resumeSession.order.envelope.reservation}),
    submit:()=>call(local,'callput_account_open',params)
  }):await call(local,'callput_account_open',params);
  console.log(JSON.stringify({request_id:order.id,submitted:true,user_amount_raw:params.amountIn}));
  phase='receipt_inclusion';
  const included=await poll(async()=>{const s=await call(local,'callput_account_order_status',{id:order.id});check(!['reverted','transport_cancelled','resolved'].includes(s.state),'Order ended without a verified fill');return s.hash&&s.requestKey?s:null;},'Sponsored transaction inclusion');
  phase='receipt_verification';
  const request=await poll(async()=>{try{return await call(local,'callput_account_verify_receipt',{hash:included.hash});}catch(error){if(error.message==='Sponsored transaction has no receipt yet')return null;throw error;}},'Canonical sponsored receipt');
  check(request.is_open===true&&request.request_key===included.requestKey,'MCP receipt/request provenance mismatch');
  phase='keeper_execution';
  const fill=await poll(async()=>{const s=await call(remote,'callput_check_request_status',{request_key:request.request_key,is_open:true});check(s.status!=='cancelled','Keeper cancelled order');return s.status==='executed'?s:null;},'Keeper execution');
  check(fill.account?.toLowerCase()===info.account&&BigInt(fill.size_out)>0n,'Executed request owner or size mismatch');
  phase='position_verification';
  const after=await call(remote,'callput_portfolio_summary',{address:info.account});
  const leg=BigInt(params.optionIds[0]),expiry=Number((leg>>200n)&((1n<<40n)-1n)),low=Number((leg>>152n)&((1n<<48n)-1n));
  const high=Number((BigInt(params.optionIds[1])>>152n)&((1n<<48n)-1n));
  const match=p=>p.underlying==='ETH'&&p.option_type==='Call'&&p.side==='long'&&p.expiry_sec===expiry&&p.naked_strike===low&&p.pair_strike===high;
  const previous=before.positions.filter(match).reduce((sum,p)=>sum+p.size,0),current=after.positions.filter(match).reduce((sum,p)=>sum+p.size,0);
  check(current>previous,'Expected filled position delta not visible yet; retain request evidence');
  const evidence={network,account:info.account,transaction_hash:included.hash,request_key:request.request_key,fill,position_size_before:previous,position_size_after:current,user_amount_raw:params.amountIn,max_user_amount_raw:'100000',native_payer:'protocol_sponsor',checked_at:new Date().toISOString()};
  phase='write_evidence';
  await fs.writeFile(path.join(directory,`${network}.fill-evidence.json`),JSON.stringify(evidence,null,2),{mode:0o600});
  console.log(JSON.stringify({result:'VERIFIED_KEEPER_FILL_AND_POSITION',...evidence}));
  password='';
}catch(error){
  // Library errors can contain key material or proofs: print no raw exception.
  const diagnostic={...safeDiagnostic(error,phase),network,checked_at:new Date().toISOString()};
  console.error(JSON.stringify(diagnostic));
  try{const d=await fs.lstat(directory);if(d.isDirectory()&&!d.isSymbolicLink()&&d.uid===process.getuid()&&(d.mode&0o077)===0)await fs.writeFile(path.join(directory,`${network}.failure-${Date.now()}-${process.pid}.json`),JSON.stringify(diagnostic,null,2),{flag:'wx',mode:0o600});}catch{}
  console.error('Trade run did not prove completion. Keep the encrypted session and budget files; do not delete them or start a new authorization to bypass an unresolved order.');
  if(error.code==='ENOENT')console.error('Owner keystore is missing. Run setup-local-keystore.command locally first.');
  process.exitCode=1;
}finally{await local.close();await remote.close();await server?.close();}
