// Export only an explicit public runtime allowlist. Never pack the workspace or private state.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = fileURLToPath(new URL("..", import.meta.url));
const staging = await fs.mkdtemp(
  path.join(os.tmpdir(), "callput-public-signer-"),
);
const target = path.join(root, "frontend-v1/downloads");
async function copy(relative) {
  const source = path.join(root, relative),
    stat = await fs.lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw Error("runtime_export_regular_files_only");
  await fs.mkdir(path.dirname(path.join(staging, relative)), {
    recursive: true,
  });
  await fs.copyFile(source, path.join(staging, relative));
}
try {
  const source = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  );
  const lock = JSON.parse(
    await fs.readFile(path.join(root, "package-lock.json"), "utf8"),
  );
  const dependencies = Object.fromEntries(
    Object.keys(source.dependencies).map((name) => [
      name,
      lock.packages["node_modules/" + name].version,
    ]),
  );
  const manifest = {
    name: "callput-account-signer",
    version: source.version,
    private: true,
    type: "module",
    engines: { node: ">=22" },
    scripts: {
      check: "node scripts/run-account-workflow.mjs --check",
      trade: "node scripts/run-account-workflow.mjs",
    },
    dependencies,
  };
  lock.name = manifest.name;
  lock.packages[""].name = manifest.name;
  lock.packages[""].dependencies = dependencies;
  delete lock.packages[""].devDependencies;
  await fs.writeFile(
    path.join(staging, "package.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await fs.writeFile(
    path.join(staging, "package-lock.json"),
    JSON.stringify(lock, null, 2) + "\n",
  );
  for (const file of await fs.readdir(path.join(root, "build/src"))) {
    if (file.endsWith(".js") && !/test|Fixture|smoke|load/i.test(file))
      await copy("build/src/" + file);
  }
  for (const file of [
    "scripts/run-account-workflow.mjs",
    "scripts/account-signer-policy.mjs",
    "scripts/run-account-workflow.command",
  ])
    await copy(file);
  await fs.copyFile(
    path.join(root, "docs/account-local-signer.md"),
    path.join(staging, "README.md"),
  );
  await fs.mkdir(target, { recursive: true });
  const name = `callput-account-signer-${source.version}.tgz`,
    archive = path.join(target, name);
  execFileSync("tar", ["-czf", archive, "-C", staging, "."]);
  const names = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
    .trim()
    .split("\n");
  if (
    names.some(
      (n) =>
        !/^\.\/(?:$|package(?:-lock)?\.json$|README\.md$|scripts\/(?:$|run-account-workflow\.(?:mjs|command)$|account-signer-policy\.mjs$)|build\/(?:$|src\/(?:$|[A-Za-z0-9_-]+\.js$)))/.test(
          n,
        ),
    )
  )
    throw Error("unexpected_public_runtime_file");
  const sha256 = createHash("sha256")
    .update(await fs.readFile(archive))
    .digest("hex");
  await fs.writeFile(archive + ".sha256", sha256 + "  " + name + "\n");
  console.log(
    JSON.stringify({
      archive: path.relative(root, archive),
      sha256,
      files: names.length,
      private_state_included: false,
    }),
  );
} finally {
  await fs.rm(staging, { recursive: true, force: true });
}
