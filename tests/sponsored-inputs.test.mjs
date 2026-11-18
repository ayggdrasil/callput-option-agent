import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('decimal and short hex market IDs become exact uint256 bytes32 without losing precision',async()=>{
 const file=new URL('../scripts/sponsored-inputs.mjs',import.meta.url);await assert.doesNotReject(fs.access(file));
 const {normalizeOptionId}=await import(file);
 const id=(2n<<240n)|(1794000000n<<200n)|(2400n<<152n);
 assert.equal(normalizeOptionId(id.toString()),'0x'+id.toString(16).padStart(64,'0'));
 assert.equal(normalizeOptionId('0x1'),'0x'+'0'.repeat(63)+'1');
 for(const invalid of ['0','-1','not-an-id',(1n<<256n).toString(),1e70])assert.throws(()=>normalizeOptionId(invalid));
});

test('diagnostics retain a safe phase and HTTP category without error values or secrets',async()=>{
 const {safeDiagnostic}=await import('../scripts/sponsored-inputs.mjs');
 const secret='private-key-password-do-not-record';
 const d=safeDiagnostic(Object.assign(Error(secret),{code:secret}),'order_submission');
 assert.equal(d.phase,'order_submission');assert.ok(!JSON.stringify(d).includes(secret));
 assert.equal(safeDiagnostic(Error('Relay HTTP 503: dependency_unavailable'),'market_scan').reason,'Relay HTTP 503: dependency_unavailable');
 assert.equal(safeDiagnostic(Error('anything'),secret).phase,'unknown');
});
