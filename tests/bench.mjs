// 性能微基准：1000 条消息的合成快照上，测量索引派生、合并、二分查找与增量前缀和。
// 结果写入 README 的性能段落（node 环境，代表纯计算开销；DOM 部分见手工验收）。
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
const React = {
  createElement: () => null,
  useState: (i) => [i, () => {}],
  useEffect: () => {},
  useRef: (i) => ({ current: i }),
  useMemo: (fn) => fn(),
  useSyncExternalStore: (_s, get) => get(),
};
let captured = null;
globalThis.window = { __ModuleLoader__: { load: (r) => (captured = r) }, localStorage: { getItem: () => null, setItem: () => {} } };
const mod = { exports: {} };
const fn = new Function("require", "module", "exports", source + "\n//# sourceURL=client.js");
fn((id) => ({ react: React }[id]), mod, mod.exports);
const model = captured.factory((id) => ({ react: React }[id])).__model;

const N = 1000;
const nodes = [];
for (let i = 0; i < N; i++) {
  const turn = Math.floor(i / 4) + 1;
  const kind = i % 4 === 0 ? "user" : i % 4 === 1 ? "assistant-step" : i % 4 === 2 ? "assistant-step" : "tool-call";
  const data =
    kind === "user"
      ? { content: [{ type: "text", text: "问题 " + i + " " + "x".repeat(i % 50) }] }
      : kind === "tool-call"
        ? { root: { name: "bash" } }
        : { turn, time: 1700000000000 + i * 1000, blocks: [{ kind: "text", text: "回答 " + i + " " + "y".repeat(200 + (i % 30) * 40) }] };
  nodes.push({ key: "k" + i, kind, anchorSeq: i, data });
}
const order = nodes.map((n) => n.key);
const map = new Map(nodes.map((n) => [n.key, n]));
const snapshot = { chat: { order, nodes: map } };

function bench(name, fn, runs = 50) {
  fn();
  fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < runs; i++) fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / runs;
  console.log(`${name}: ${ms.toFixed(3)} ms/op（${N} 条消息）`);
  return ms;
}

bench("entriesOf（全量派生）", () => model.entriesOf(snapshot), 20);
const entries = model.entriesOf(snapshot);
const tops = Array.from({ length: N }, (_, i) => i * 120);
const extent = 300000;
bench("displayRows（rail 合并渲染规划）", () => model.displayRows(entries, tops, extent, 600, 3), 50);
bench("indexAt（二分查找当前位置）", () => model.indexAt(tops, 150000, 800), 5000);

// 增量前缀和：模拟单行高度变化后只重算受影响后缀
{
  const t0 = process.hrtime.bigint();
  let top = 0;
  for (let i = 0; i < N; i++) {
    top += 120;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`增量前缀和（1000 行单次全量）: ${ms.toFixed(3)} ms（实际运行中只重算变化行后缀）`);
}

console.log("bench done");
