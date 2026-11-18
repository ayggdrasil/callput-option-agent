import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('recovery only resubmits the original signed order after explicit not-found',async()=>{
  const file=new URL('../scripts/sponsored-recovery.mjs',import.meta.url);
  await assert.doesNotReject(fs.access(file),'recovery helper must exist');
  const {recoverSponsoredOrder}=await import(file);
  let submissions=0;
  const submit=async()=>{submissions++;return {id:'original-uuid',state:'queued'};};
  const found=await recoverSponsoredOrder({status:async()=>({id:'original-uuid',state:'included'}),submit});
  assert.equal(found.state,'included');assert.equal(submissions,0);
  await assert.rejects(recoverSponsoredOrder({status:async()=>{throw Error('Relay HTTP 503: dependency_unavailable');},submit}),/503/);
  await assert.rejects(recoverSponsoredOrder({status:async()=>{throw Error('transport timed out');},submit}),/timed out/);
  assert.equal(submissions,0);
  const recovered=await recoverSponsoredOrder({status:async()=>{throw Error('Relay HTTP 404: not_found');},submit});
  assert.equal(recovered.id,'original-uuid');assert.equal(submissions,1);
});
