import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { PostgresWorkflowStore } from "./accountPostgresStore.js";
import { configuredWorkflowStore } from "./accountStore.js";
import { workflowAvailability } from "./accountManifest.js";

test("dedicated Postgres credentials configure hosted readiness without exposing secrets", () => {
  const names = [
    "CALLPUT_WORKFLOW_DATABASE_URL",
    "CALLPUT_WORKFLOW_ENCRYPTION_KEY",
    "VERCEL",
  ];
  const previous = names.map((n) => process.env[n]);
  try {
    process.env[names[0]] =
      "postgresql://user:private-password@example.neon.tech/db?sslmode=require";
    process.env[names[1]] = "12".repeat(32);
    process.env[names[2]] = "1";
    assert.ok(configuredWorkflowStore() instanceof PostgresWorkflowStore);
    assert.equal(workflowAvailability().configured, true);
    assert.ok(
      !JSON.stringify(workflowAvailability()).includes("private-password"),
    );
  } finally {
    names.forEach((n, i) =>
      previous[i] === undefined
        ? delete process.env[n]
        : (process.env[n] = previous[i]),
    );
  }
});

async function fixture() {
  const db = new PGlite();
  await db.exec(
    await readFile(
      new URL("../../deploy/account-workflow.sql", import.meta.url),
      "utf8",
    ),
  );
  const query = async (text: string, params: any[] = []) =>
    db.query(text, params);
  return {
    db,
    store: new PostgresWorkflowStore(query, "12".repeat(32)),
    query,
  };
}
test("Postgres workflow persists encrypted checkpoints across store restart and rejects foreign capability/key", async () => {
  const { db, store, query } = await fixture();
  try {
    const token = await store.create({ cookies: "private-cookie", count: 0 });
    const again = new PostgresWorkflowStore(query, "12".repeat(32));
    await again
      .update(token, async (s: any, save: () => Promise<void>) => {
        s.count = 1;
        await save();
        s.count = 2;
        throw Error("reply lost");
      })
      .then(
        () => assert.fail("must reject"),
        (e: Error) => assert.equal(e.message, "reply lost"),
      );
    assert.equal((await store.read(token)).count, 1);
    const rows = await db.query("SELECT value,lease FROM callput_workflows");
    assert.ok(!JSON.stringify(rows.rows).includes("private-cookie"));
    assert.equal((rows.rows[0] as any).lease, null);
    await assert.rejects(store.read("ff".repeat(32)), /workflow_not_found/);
    await assert.rejects(
      new PostgresWorkflowStore(query, "34".repeat(32)).read(token),
      /workflow_unavailable/,
    );
  } finally {
    await db.close();
  }
});
test("Postgres lease denies simultaneous mutation and fences a stale writer after takeover", async () => {
  const { db, store } = await fixture();
  try {
    const token = await store.create({ count: 0 });
    let entered!: () => void, release!: () => void;
    const active = new Promise<void>((r) => (entered = r)),
      wait = new Promise<void>((r) => (release = r));
    const first = store.update(token, async (s: any) => {
      entered();
      await wait;
      s.count = 99;
    });
    await active;
    await assert.rejects(
      store.update(token, async () => {}),
      /workflow_busy/,
    );
    await db.exec(
      "UPDATE callput_workflows SET lease_expires=clock_timestamp()-interval '1 second'",
    );
    await store.update(token, async (s: any) => {
      s.count = 1;
    });
    release();
    await assert.rejects(first, /workflow_lease_lost/);
    assert.equal((await store.read(token)).count, 1);
  } finally {
    await db.close();
  }
});
