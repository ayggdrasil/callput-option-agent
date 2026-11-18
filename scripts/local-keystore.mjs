import fs from 'node:fs/promises';
import path from 'node:path';
import { Wallet, getAddress } from 'ethers';

export async function importKeystore({privateKey, password, expectedAddress, target}) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('Password must contain at least 12 characters');
  let wallet;
  try { wallet = new Wallet(privateKey.trim()); }
  catch { throw new Error('Invalid private key'); }
  if (wallet.address !== getAddress(expectedAddress)) throw new Error('Private key does not match expected wallet address');
  const directory = path.dirname(target);
  await fs.mkdir(directory, {recursive:true,mode:0o700});
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) {
    throw new Error('Keystore directory must be private and owned by the current user');
  }
  // Never overwrite an existing keystore, including a symlink at the target.
  const encrypted = await wallet.encrypt(password);
  await fs.writeFile(target, encrypted, {flag:'wx',mode:0o600});
  return {address:wallet.address,target};
}
