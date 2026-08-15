#!/usr/bin/env node
// 冒烟验证：语法检查 → 单元测试 → 接线测试 → 性能微基准。
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const steps = [
  ["node --check client.js", ["--check", "client.js"]],
  ["node --check index.js", ["--check", "index.js"]],
  ["tests/model.test.mjs", ["tests/model.test.mjs"]],
  ["tests/client-wiring.test.mjs", ["tests/client-wiring.test.mjs"]],
  ["tests/bench.mjs", ["tests/bench.mjs"]],
];

let failed = false;
for (const [label, args] of steps) {
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  process.stdout.write(`[${r.status === 0 ? "PASS" : "FAIL"}] ${label}\n`);
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) failed = true;
}
if (failed) {
  console.error("SMOKE FAILED");
  process.exit(1);
}
console.log("SMOKE OK");
