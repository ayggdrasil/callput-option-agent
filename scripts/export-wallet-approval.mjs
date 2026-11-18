// Export only new approval assets into the selected app's static public folder.
// No credentials, chain writes, uploads or deployment are performed here.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('../frontend-v1/',import.meta.url));
const target=process.argv[2];if(!target||!path.isAbsolute(target))throw Error('Provide an absolute destination public directory');
await fs.mkdir(target,{recursive:true});const root=await fs.lstat(target);if(!root.isDirectory()||root.isSymbolicLink())throw Error('Destination must be a real directory');
const files=[['wallet.html','mcp-wallet.html'],...['wallet.js','wallet.css','vendor/ethers.umd.min.js','vendor/ethers.LICENSE.md'].map(file=>[file,'mcp-wallet-assets/'+file])];
for(const [from,to]of files){
 const bytes=await fs.readFile(path.join(source,from)),destination=path.join(target,to);
 await fs.mkdir(path.dirname(destination),{recursive:true});
 try{const stat=await fs.lstat(destination);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unsafe existing export target');const previous=await fs.readFile(destination);if(previous.equals(bytes))continue;throw Error('Existing approval asset differs; use a clean build staging directory');}catch(error){if(error.code!=='ENOENT')throw error;}
 await fs.writeFile(destination,bytes,{flag:'wx',mode:0o644});
}
console.log(JSON.stringify({exported:files.length,directory:target,uploaded:false}));
