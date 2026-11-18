import { randomBytes, createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { SealedState, type WorkflowStore } from "./accountStore.js";

export type WorkflowQuery = (
  text: string,
  params?: any[],
) => Promise<{ rows: any[] }>;
const identifier = (token: string) => {
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error("workflow_not_found");
  return createHash("sha256").update(token).digest("hex");
};
export class PostgresWorkflowStore implements WorkflowStore {
  private seal: SealedState;
  constructor(
    private query: WorkflowQuery,
    key: string,
  ) {
    this.seal = new SealedState(key);
  }
  private async sql(text: string, params: any[] = []) {
    try {
      return await this.query(text, params);
    } catch {
      throw Error("workflow_store_unavailable");
    }
  }
  async create(value: any) {
    const token = randomBytes(32).toString("hex"),
      id = identifier(token);
    await this.sql("INSERT INTO callput_workflows(id,value) VALUES($1,$2)", [
      id,
      this.seal.seal(id, value),
    ]);
    return token;
  }
  async read(token: string) {
    const id = identifier(token);
    const { rows } = await this.sql(
      "SELECT value FROM callput_workflows WHERE id=$1",
      [id],
    );
    if (!rows.length) throw Error("workflow_not_found");
    return this.seal.open(id, rows[0].value);
  }
  async update<T>(
    token: string,
    fn: (state: any, checkpoint: () => Promise<void>) => Promise<T>,
  ) {
    const id = identifier(token),
      lease = randomBytes(32).toString("hex");
    // One atomic UPDATE claims the durable row; different serverless invocations
    // cannot both acquire it. Expiry uses database time, not the caller's clock.
    const { rows } = await this.sql(
      "UPDATE callput_workflows SET lease=$2,lease_expires=clock_timestamp()+interval '120 seconds' WHERE id=$1 AND (lease IS NULL OR lease_expires<=clock_timestamp()) RETURNING value",
      [id, lease],
    );
    if (!rows.length) {
      await this.read(token);
      throw Error("workflow_busy");
    }
    try {
      const state = this.seal.open(id, rows[0].value);
      const checkpoint = async () => {
        const saved = await this.sql(
          "UPDATE callput_workflows SET value=$3,lease_expires=clock_timestamp()+interval '120 seconds' WHERE id=$1 AND lease=$2 AND lease_expires>clock_timestamp() RETURNING id",
          [id, lease, this.seal.seal(id, state)],
        );
        if (!saved.rows.length) throw Error("workflow_lease_lost");
      };
      const result = await fn(state, checkpoint);
      await checkpoint();
      return result;
    } finally {
      // An old invocation can neither overwrite nor unlock a replacement lease.
      await this.sql(
        "UPDATE callput_workflows SET lease=NULL,lease_expires=NULL WHERE id=$1 AND lease=$2",
        [id, lease],
      ).catch(() => {});
    }
  }
}
export function neonWorkflowStore(url: string, key: string) {
  if (!/^postgres(?:ql)?:\/\//.test(url))
    throw Error("workflow_store_url_invalid");
  const sql = neon(url);
  return new PostgresWorkflowStore(
    async (text, params) => ({ rows: await sql.query(text, params ?? []) }),
    key,
  );
}
