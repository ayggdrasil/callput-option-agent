import {Interface,TypedDataEncoder} from 'ethers';

const grant='address signer,uint256 nonce,uint256 epoch,uint48 validAfter,uint48 validUntil,uint16[] underlyings,uint16 strategies,uint256 maxAmountPerOpen,uint256 maxAmount,uint32 maxOpens,uint32 maxCloses,uint256 maxFeePerTrade,uint256 maxFees';
const intent='bytes32 sessionId,uint256 epoch,uint256 nonce,uint48 deadline,uint8 source';
const open='uint16 underlyingAssetIndex,uint8 length,bool[4] isBuys,bytes32[4] optionIds,bool[4] isCalls,uint256 minSize,uint256 amountIn';
const fields=s=>s.split(',').map(v=>{const[type,name]=v.split(' ');return {name,type};});
export const openTypes={Open:fields(open),OpenIntent:fields(intent+',Open params')};
export const accountOpenAbi=[`function openWithSession((${grant}) grant,(${intent}) intent,(${open}) params,bytes signature) payable returns(bytes32)`,
  'event SessionRequest(bytes32 indexed sessionId,uint256 indexed nonce,bytes32 indexed digest,bytes32 requestKey,bool isOpen,uint256 executionFee)'];
const accountAbi=new Interface(accountOpenAbi),managerAbi=new Interface(['event GenerateRequestKey(address indexed account,bytes32 indexed key,bool indexed isOpen)']);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const check=(ok,message)=>{if(!ok)throw Error(message);};

// Requires the caller to independently verify canonical account/factory code at the mined block.
export function verifySponsoredReceipt({transaction:t,receipt:r,expected:e,account,profile,domain}){
  check(r?.status===1,'Sponsored transaction did not succeed');
  check(t&&same(t.hash,r.hash)&&t.blockNumber===r.blockNumber&&same(t.blockHash,r.blockHash),'Receipt inclusion mismatch');
  check(t.chainId===BigInt(profile.chainId),'Sponsored transaction chain mismatch');
  check(same(t.to,account)&&same(r.to,account),'Sponsored destination is not the expected account');
  check(same(t.from,profile.sponsor)&&same(r.from,profile.sponsor),'Sponsored transaction sender is not the pinned sponsor');
  check(t.data.toLowerCase()===accountAbi.encodeFunctionData('openWithSession',[e.grant,e.intent,e.params,e.signature]).toLowerCase(),'Sponsored calldata differs from the saved signed intent');
  check(t.value>=0n&&t.value<=BigInt(e.grant.maxFeePerTrade),'Sponsored native fee exceeds signed cap');
  const digest=TypedDataEncoder.hash(domain,openTypes,{...e.intent,params:e.params});
  const sessionEvents=[],managerEvents=[];
  for(const log of r.logs){
    if(log.removed)continue;
    if(same(log.address,account)){
      try{const p=accountAbi.parseLog(log);if(p?.name==='SessionRequest'&&same(p.args.sessionId,e.intent.sessionId)&&p.args.nonce===BigInt(e.intent.nonce)&&same(p.args.digest,digest)&&p.args.isOpen===true&&p.args.executionFee===t.value)sessionEvents.push(p.args.requestKey);}catch{}
    }
    if(same(log.address,profile.positionManager)){
      try{const p=managerAbi.parseLog(log);if(p?.name==='GenerateRequestKey'&&same(p.args.account,account)&&p.args.isOpen===true)managerEvents.push(p.args.key);}catch{}
    }
  }
  check(sessionEvents.length===1&&managerEvents.length===1&&same(sessionEvents[0],managerEvents[0]),'Matching sponsored account and manager request events not found');
  return {request_key:sessionEvents[0],is_open:true,account,transaction_hash:t.hash,block_number:r.blockNumber,block_hash:r.blockHash,sponsor:profile.sponsor};
}
