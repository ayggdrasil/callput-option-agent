import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Wallet} from 'ethers';

export function sponsoredStorage(directory,network){
  if(!['giwa','robinhood'].includes(network))throw Error('Invalid network');
  const budget=path.join(directory,`${network}.budget.json`),session=path.join(directory,`${network}.session.json`);
  const lock=path.join(directory,`${network}.budget.lock`),history=path.join(directory,'history');
  async function privateDirectory(){await fs.mkdir(directory,{recursive:true,mode:0o700});const s=await fs.lstat(directory);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077))throw Error('Private owner-only directory required');}
  async function read(file){const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077))throw Error('Unsafe private storage');return JSON.parse(await fs.readFile(file,'utf8'));}
  async function syncDirectory(name){const h=await fs.open(name,'r');try{await h.sync();}finally{await h.close();}}
  async function writeExclusive(file,value){const h=await fs.open(file,'wx',0o600);try{await h.writeFile(value);await h.sync();}finally{await h.close();}await syncDirectory(path.dirname(file));}
  async function locked(fn){
    await privateDirectory();let handle;
    try{handle=await fs.open(lock,'wx',0o600);}catch{throw Error('User budget is locked; inspect the existing process before retrying');}
    try{return await fn();}finally{await handle.close();await fs.unlink(lock);await syncDirectory(directory);}
  }
  const archive=id=>{if(!/^[0-9a-f-]{36}$/.test(id))throw Error('Invalid archive identity');return path.join(history,`${network}-${id}.json`);};
  async function storedSession(){
    try{return await read(session);}catch(error){if(error.code!=='ENOENT')throw error;}
    // A crash after archiving/removing the session but before releasing its budget
    // remains recoverable, with the original encrypted key and proof preserved.
    try{const b=await read(budget),a=await read(archive(b.id));if(JSON.stringify(a.budget)!==JSON.stringify(b))throw Error('Archive budget mismatch');return a.session;}
    catch(error){if(error.code==='ENOENT')return undefined;throw error;}
  }
  return {
    async reserve(record){
      if(record.network!==network||!/^\d+$/.test(record.maxAmount)||BigInt(record.maxAmount)>100000n||BigInt(record.maxAmount)<=0n)throw Error('User budget exceeded');
      return locked(async()=>{
        try{await writeExclusive(budget,JSON.stringify(record));}
        catch(error){if(error.code!=='EEXIST')throw error;const old=await read(budget);if(JSON.stringify(old)!==JSON.stringify(record))throw Error('User budget is already reserved; do not authorize another grant');}
      });
    },
    async save(value,password){
      await privateDirectory();
      const {devicePrivateKey,...publicState}=value;
      const encrypted=await new Wallet(devicePrivateKey).encrypt(password);
      return locked(async()=>{
        const b=await read(budget);if(b.id!==value.id)throw Error('Saved session does not match active user budget');
        let existing;
        try{existing=await read(session);}catch(error){if(error.code!=='ENOENT')throw error;}
        if(existing){
          for(const key of ['id','grant','ownerSignature','sessionId'])if(JSON.stringify(existing[key])!==JSON.stringify(publicState[key]))throw Error('Existing session identity must be preserved');
          if(existing.order&&JSON.stringify(existing.order)!==JSON.stringify(publicState.order))throw Error('Existing signed order must be preserved');
        }
        const temporary=session+'.'+randomUUID();
        try{await writeExclusive(temporary,JSON.stringify({...publicState,encryptedDevice:JSON.parse(encrypted)}));await fs.rename(temporary,session);await syncDirectory(directory);}
        finally{await fs.rm(temporary,{force:true});}
      });
    },
    async load(password){
      await privateDirectory();
      const value=await storedSession();if(!value)return undefined;
      const {encryptedDevice,...rest}=value;const wallet=await Wallet.fromEncryptedJson(JSON.stringify(encryptedDevice),password);
      return {...rest,devicePrivateKey:wallet.privateKey};
    },
    async loadPublic(){
      await privateDirectory();const value=await storedSession();if(!value)return undefined;
      return Object.fromEntries(['id','grant','ownerSignature','sessionId','order','portfolioBefore'].filter(k=>k in value).map(k=>[k,value[k]]));
    },
    async releaseUnused(proof){
      if(proof?.kind!=='finalized_unused_expired'||proof.network!==network||!['opens','closes','amountSpent','feesSpent'].every(k=>proof[k]==='0')||!/^\d+$/.test(proof.validUntil)||!/^\d+$/.test(proof.blockTimestamp)||BigInt(proof.blockTimestamp)<=BigInt(proof.validUntil))throw Error('A finalized expired unused-session proof is required');
      return locked(async()=>{
        const b=await read(budget);
        if(b.id!==proof.previousId||b.digest!==proof.digest||b.owner!==proof.owner||b.network!==proof.network)throw Error('Unused-session proof does not match reserved budget');
        const state=await storedSession();if(!state||state.id!==b.id)throw Error('Original encrypted session is required for budget recovery');
        await fs.mkdir(history,{mode:0o700,recursive:true});
        const h=await fs.lstat(history);if(!h.isDirectory()||h.isSymbolicLink()||h.uid!==process.getuid()||(h.mode&0o077))throw Error('Unsafe history directory');
        await syncDirectory(directory);
        const target=archive(b.id);
        try{await writeExclusive(target,JSON.stringify({budget:b,proof,session:state}));}
        catch(error){if(error.code!=='EEXIST')throw error;const old=await read(target);if(JSON.stringify(old.budget)!==JSON.stringify(b)||old.session?.id!==b.id)throw Error('Expired-session archive mismatch');}
        try{await fs.unlink(session);}catch(error){if(error.code!=='ENOENT')throw error;}
        await fs.unlink(budget);
        await syncDirectory(directory);
        return {released:true,archived_grant_id:b.id};
      });
    }
  };
}
