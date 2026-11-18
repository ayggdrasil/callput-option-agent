// Run directly in your own Terminal. Never pass secrets as command arguments.
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { importKeystore } from './local-keystore.mjs';

process.umask(0o077);
const expectedAddress = '0x84B67bB8b023fc6640C37619cAe28447103b61a8';
const target = path.join(os.homedir(),'Library','Application Support','CallputSigner','owner.json');
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Run this command in your own interactive Terminal. No secrets accepted through logs or automation.');
  process.exit(1);
}
console.log(`Import signer for ${expectedAddress}. No transaction will be signed or sent.`);
console.log('Input is hidden. The encrypted keystore will be stored outside the repository.');
const python = `import sys, json, getpass, warnings
warnings.simplefilter('error', getpass.GetPassWarning)
try:
 key = getpass.getpass('Private key (hidden): ')
 password = getpass.getpass('New keystore password, at least 12 characters (hidden): ')
 confirmation = getpass.getpass('Confirm password (hidden): ')
 if password != confirmation or len(password) < 12: raise ValueError()
 sys.stdout.write(json.dumps({'privateKey':key,'password':password}))
except (Exception, KeyboardInterrupt):
 sys.exit(1)
`;
// Secrets travel only through the private child pipe; never print child stdout.
const child = spawnSync('python3',['-c',python],{stdio:['inherit','pipe','inherit'],maxBuffer:16384});
try {
  if (child.status !== 0) throw new Error('input');
  const secrets = JSON.parse(child.stdout.toString());
  child.stdout.fill(0);
  const result = await importKeystore({...secrets,expectedAddress,target});
  secrets.privateKey = ''; secrets.password = '';
  console.log(`Encrypted keystore ready: ${result.target}`);
  console.log(`Verified public address: ${result.address}`);
  console.log('Tell Codex only that setup is complete. Keep the password local.');
} catch {
  child.stdout?.fill(0);
  console.error('Import failed or cancelled. Check address, password confirmation and private destination permissions. Existing files are never overwritten.');
  process.exitCode = 1;
}
