import fs from "node:fs/promises";
import path from "node:path";
import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { hostname } from "node:os";
import { threadId } from "node:worker_threads";
import { neonWorkflowStore } from "./accountPostgresStore.js";
const storageInstance = randomBytes(32).toString("hex"),
  activeFileLeases = new Set<string>();
export interface WorkflowStore {
  create(value: any): Promise<string>;
  read(token: string): Promise<any>;
  update<T>(
    token: string,
    fn: (state: any, checkpoint: () => Promise<void>) => Promise<T>,
  ): Promise<T>;
}
const identifier = (token: string) => {
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error("workflow_not_found");
  return createHash("sha256").update(token).digest("hex");
};
export class SealedState {
  private key: Buffer;
  constructor(key: string) {
    if (!/^[0-9a-f]{64}$/i.test(key))
      throw Error("workflow_encryption_key_required");
    this.key = Buffer.from(key, "hex");
  }
  seal(id: string, value: any) {
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", this.key, iv);
    c.setAAD(Buffer.from(id));
    return JSON.stringify({
      iv: iv.toString("hex"),
      data: Buffer.concat([
        c.update(JSON.stringify(value)),
        c.final(),
      ]).toString("base64"),
      tag: c.getAuthTag().toString("hex"),
    });
  }
  open(id: string, raw: string) {
    try {
      const x = JSON.parse(raw),
        d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(x.iv, "hex"));
      d.setAAD(Buffer.from(id));
      d.setAuthTag(Buffer.from(x.tag, "hex"));
      return JSON.parse(
        Buffer.concat([
          d.update(Buffer.from(x.data, "base64")),
          d.final(),
        ]).toString(),
      );
    } catch {
      throw Error("workflow_unavailable");
    }
  }
}
export class FileWorkflowStore implements WorkflowStore {
  protected releaseWaitMs = 2000;
  private seal: SealedState;
  constructor(
    private directory: string,
    key: string,
  ) {
    this.seal = new SealedState(key);
  }
  private async root() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const s = await fs.lstat(this.directory);
    if (
      !s.isDirectory() ||
      s.isSymbolicLink() ||
      s.mode & 0o077 ||
      s.uid !== process.getuid?.()
    )
      throw Error("unsafe_workflow_directory");
  }
  private async database() {
    await this.root();
    const file = path.join(this.directory, "workflows.sqlite");
    try {
      const h = await fs.open(file, "wx", 0o600);
      await h.close();
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e;
    }
    const s = await fs.lstat(file);
    if (
      !s.isFile() ||
      s.isSymbolicLink() ||
      s.mode & 0o077 ||
      s.uid !== process.getuid?.()
    )
      throw Error("unsafe_workflow_storage");
    const { DatabaseSync } = await import("node:sqlite"),
      db = new DatabaseSync(file);
    try {
      db.exec(
        "PRAGMA busy_timeout=0; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS workflows(id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS locks(id TEXT PRIMARY KEY,pid INTEGER NOT NULL,host TEXT NOT NULL,token TEXT NOT NULL,instance TEXT NOT NULL DEFAULT '',thread INTEGER NOT NULL DEFAULT -1);",
      );
      const columns = db
        .prepare("PRAGMA table_info(locks)")
        .all()
        .map((r: any) => r.name);
      if (!columns.includes("instance"))
        db.exec(
          "ALTER TABLE locks ADD COLUMN instance TEXT NOT NULL DEFAULT ''",
        );
      if (!columns.includes("thread"))
        db.exec(
          "ALTER TABLE locks ADD COLUMN thread INTEGER NOT NULL DEFAULT -1",
        );
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }
  private transaction<T>(db: any, fn: () => T): T {
    try {
      db.exec("BEGIN IMMEDIATE");
      const value = fn();
      db.exec("COMMIT");
      return value;
    } catch (e: any) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      if (/locked|busy/i.test(e.message ?? "")) throw Error("workflow_busy");
      throw e;
    }
  }
  protected releaseLock(db: any, id: string, lease: string) {
    this.transaction(db, () =>
      db.prepare("DELETE FROM locks WHERE id=? AND token=?").run(id, lease),
    );
  }
  async create(value: any) {
    const db = await this.database();
    try {
      const token = randomBytes(32).toString("hex"),
        id = identifier(token);
      db.prepare("INSERT INTO workflows(id,value) VALUES(?,?)").run(
        id,
        this.seal.seal(id, value),
      );
      return token;
    } finally {
      db.close();
    }
  }
  async read(token: string) {
    const db = await this.database();
    try {
      const id = identifier(token),
        row = db.prepare("SELECT value FROM workflows WHERE id=?").get(id);
      if (!row) throw Error("workflow_not_found");
      return this.seal.open(id, row.value);
    } finally {
      db.close();
    }
  }
  async update<T>(
    token: string,
    fn: (state: any, checkpoint: () => Promise<void>) => Promise<T>,
  ) {
    const id = identifier(token),
      db = await this.database(),
      lease = randomBytes(32).toString("hex");
    let acquired = false;
    try {
      this.transaction(db, () => {
        const old = db
          .prepare(
            "SELECT pid,host,token,instance,thread FROM locks WHERE id=?",
          )
          .get(id);
        if (old) {
          let dead = false;
          if (
            old.host === hostname() &&
            Number.isInteger(old.pid) &&
            old.pid > 0
          ) {
            if (
              old.pid === process.pid &&
              old.instance === storageInstance &&
              old.thread === threadId &&
              !activeFileLeases.has(old.token)
            )
              dead = true;
            else
              try {
                process.kill(old.pid, 0);
              } catch (e: any) {
                dead = e.code === "ESRCH";
              }
          }
          if (!dead) throw Error("workflow_busy");
        }
        db.prepare(
          "INSERT OR REPLACE INTO locks(id,pid,host,token,instance,thread) VALUES(?,?,?,?,?,?)",
        ).run(id, process.pid, hostname(), lease, storageInstance, threadId);
      });
      acquired = true;
      activeFileLeases.add(lease);
      const row = db.prepare("SELECT value FROM workflows WHERE id=?").get(id);
      if (!row) throw Error("workflow_not_found");
      const state = this.seal.open(id, row.value);
      const checkpoint = async () => {
        this.transaction(db, () => {
          const lock = db.prepare("SELECT token FROM locks WHERE id=?").get(id);
          if (lock?.token !== lease) throw Error("workflow_lease_lost");
          db.prepare("UPDATE workflows SET value=? WHERE id=?").run(
            this.seal.seal(id, state),
            id,
          );
        });
      };
      const result = await fn(state, checkpoint);
      await checkpoint();
      return result;
    } finally {
      try {
        if (acquired) {
          const end = Date.now() + this.releaseWaitMs;
          for (let attempt = 0; ; attempt++) {
            try {
              this.releaseLock(db, id, lease);
              break;
            } catch (error: any) {
              if (error.message !== "workflow_busy") throw error;
              if (Date.now() >= end || attempt >= 200)
                throw Error("workflow_cleanup_pending");
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
          }
        }
      } finally {
        activeFileLeases.delete(lease);
        db.close();
      }
    }
  }
}
/** REST Redis with atomic lease checks; encrypted values are not stored in /tmp.
 * Configure a persistent Redis database with persistence enabled. Never evict active workflows. */
export class RedisWorkflowStore implements WorkflowStore {
  private seal: SealedState;
  constructor(
    private url: string,
    private bearer: string,
    key: string,
  ) {
    if (!/^https:\/\//.test(url)) throw Error("workflow_store_https_required");
    this.seal = new SealedState(key);
  }
  private async command(...args: any[]): Promise<any> {
    const r = await fetch(this.url, {
      method: "POST",
      headers: {
        authorization: "Bearer " + this.bearer,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw Error("workflow_store_unavailable");
    const x = (await r.json()) as any;
    if (x.error) throw Error("workflow_store_unavailable");
    return x.result;
  }
  private name(token: string) {
    return "callput:workflow:v1:" + identifier(token);
  }
  async create(value: any) {
    const token = randomBytes(32).toString("hex");
    if (
      (await this.command(
        "SET",
        this.name(token),
        this.seal.seal(identifier(token), value),
        "NX",
      )) !== "OK"
    )
      throw Error("workflow_store_unavailable");
    return token;
  }
  async read(token: string) {
    const raw = await this.command("GET", this.name(token));
    if (!raw) throw Error("workflow_not_found");
    return this.seal.open(identifier(token), raw);
  }
  async update<T>(
    token: string,
    fn: (state: any, checkpoint: () => Promise<void>) => Promise<T>,
  ) {
    const name = this.name(token),
      lock = name + ":lock",
      lease = randomBytes(32).toString("hex");
    if ((await this.command("SET", lock, lease, "NX", "PX", 120000)) !== "OK")
      throw Error("workflow_busy");
    try {
      const state = await this.read(token),
        checkpoint = async () => {
          const ok = await this.command(
            "EVAL",
            "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end redis.call('SET',KEYS[2],ARGV[2]);redis.call('PEXPIRE',KEYS[1],120000);return 1",
            2,
            lock,
            name,
            lease,
            this.seal.seal(identifier(token), state),
          );
          if (ok !== 1) throw Error("workflow_lease_lost");
        };
      const result = await fn(state, checkpoint);
      await checkpoint();
      return result;
    } finally {
      await this.command(
        "EVAL",
        "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",
        1,
        lock,
        lease,
      ).catch(() => {});
    }
  }
}
export function configuredWorkflowStore(): WorkflowStore | undefined {
  const key = process.env.CALLPUT_WORKFLOW_ENCRYPTION_KEY;
  if (!key) return;
  const postgres = process.env.CALLPUT_WORKFLOW_DATABASE_URL ?? process.env.CALLPUT_WORKFLOW_POSTGRES_URL;
  if (postgres) return neonWorkflowStore(postgres, key);
  const url =
    process.env.CALLPUT_WORKFLOW_REDIS_URL ??
    process.env.CALLPUT_WORKFLOW_KV_REST_API_URL ??
    process.env.CALLPUT_WORKFLOW_UPSTASH_REDIS_REST_URL;
  const token =
    process.env.CALLPUT_WORKFLOW_REDIS_TOKEN ??
    process.env.CALLPUT_WORKFLOW_KV_REST_API_TOKEN ??
    process.env.CALLPUT_WORKFLOW_UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new RedisWorkflowStore(url, token, key);
  if (process.env.CALLPUT_WORKFLOW_DIRECTORY && !process.env.VERCEL)
    return new FileWorkflowStore(process.env.CALLPUT_WORKFLOW_DIRECTORY, key);
}
