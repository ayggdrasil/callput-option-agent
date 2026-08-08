import assert from "node:assert/strict";
import { runVercelHandler } from "./vercelAdapter.js";

async function main() {
  let chunksRead = 0;
  const req = {
    method: "POST",
    url: "/api/mcp",
    headers: { host: "mcp.callput.app", "content-type": "application/json" },
    async *[Symbol.asyncIterator]() {
      for (let index = 0; index < 100; index += 1) {
        chunksRead += 1;
        yield new Uint8Array(1024);
      }
    }
  };
  const result: { status?: number; body?: string } = {};
  const res = {
    statusCode: 0,
    setHeader() {},
    end(body?: Uint8Array | string) {
      result.status = this.statusCode;
      result.body = body ? Buffer.from(body).toString("utf8") : "";
    }
  };

  await runVercelHandler(req, res, async () => Response.json({ ok: true }));
  assert.equal(result.status, 413);
  assert.ok(chunksRead <= 65, `oversized stream read ${chunksRead} chunks before aborting`);
  assert.match(result.body ?? "", /too large/i);

  console.log("Vercel adapter tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
