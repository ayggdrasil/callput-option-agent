// Dedicated schema + disposable real-DB smoke. Never prints connection strings or capabilities.
import fs from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { neon } from "@neondatabase/serverless";
import { PostgresWorkflowStore } from "../build/src/accountPostgresStore.js";
const project = process.env.CALLPUT_WORKFLOW_NEON_PROJECT_ID;
if (project !== process.argv[2])
  throw Error("dedicated_project_confirmation_required");
const url = process.env.CALLPUT_WORKFLOW_DATABASE_URL;
if (!url) throw Error("dedicated_database_url_required");
const sql = neon(url);
const migration = await fs.readFile(
  new URL("../deploy/account-workflow.sql", import.meta.url),
  "utf8",
);
for (const statement of migration.split(";").filter((s) => s.trim()))
  await sql.query(statement);
const store = new PostgresWorkflowStore(
  async (text, params) => ({ rows: await sql.query(text, params ?? []) }),
  randomBytes(32).toString("hex"),
);
const token = await store.create({
  test: true,
  count: 0,
  private_marker: "must-be-encrypted",
});
const id = createHash("sha256").update(token).digest("hex");
try {
  await store.update(token, async (s, save) => {
    s.count = 1;
    await save();
  });
  assert.equal((await store.read(token)).count, 1);
  const row = await sql.query(
    "SELECT value,lease FROM callput_workflows WHERE id=$1",
    [id],
  );
  assert.equal(row.length, 1);
  assert.ok(!row[0].value.includes("must-be-encrypted"));
  assert.equal(row[0].lease, null);
  let enter, release;
  const entered = new Promise((r) => (enter = r)),
    wait = new Promise((r) => (release = r));
  const pending = store.update(token, async (s) => {
    enter();
    await wait;
    s.count = 2;
  });
  await entered;
  try {
    await assert.rejects(
      store.update(token, async () => {}),
      /workflow_busy/,
    );
  } finally {
    release();
    await pending;
  }
  assert.equal((await store.read(token)).count, 2);
  console.log(
    JSON.stringify({
      project,
      schema: "ready",
      encrypted_checkpoint: "pass",
      concurrency: "pass",
      disposable_data_only: true,
    }),
  );
} finally {
  await sql.query("DELETE FROM callput_workflows WHERE id=$1", [id]);
}
