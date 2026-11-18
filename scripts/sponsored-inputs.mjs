import {toBeHex} from 'ethers';

export function normalizeOptionId(value){
  if(typeof value!=='string'||!(/^[0-9]{1,78}$/.test(value)||/^0x[0-9a-fA-F]{1,64}$/.test(value)))throw Error('Invalid market option ID');
  const id=BigInt(value);if(id<=0n||id>=1n<<256n)throw Error('Invalid market option ID');
  return toBeHex(id,32);
}
const phases=new Set(['startup','unlock','account_preflight','portfolio_baseline','expired_session_recovery','owner_login','session_registration','session_installation','market_scan','quote_validation','order_submission','receipt_inclusion','receipt_verification','keeper_execution','position_verification','write_evidence']);
const codes=new Set(['ENOENT','EACCES','EPERM','CALL_EXCEPTION','TIMEOUT','NETWORK_ERROR','INVALID_ARGUMENT','UNKNOWN_ERROR']);
export function safeDiagnostic(error,phase){
  let reason='local_verification_failed';
  if(/^Relay HTTP [1-5][0-9]{2}: [a-z_]{1,64}$/.test(error?.message??''))reason=error.message;
  if(error?.message==='Recovered session expired or invalidated; budget remains reserved')reason='expired_session_budget_remains_reserved';
  if(error?.message==='Session expiring')reason='session_window_too_short';
  return {phase:phases.has(phase)?phase:'unknown',code:codes.has(error?.code)?error.code:'VERIFICATION_FAILED',reason};
}
