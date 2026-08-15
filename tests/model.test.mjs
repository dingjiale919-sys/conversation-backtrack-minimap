// 纯模型层单元测试：在 node 里用 React 桩加载 bundle，测试导出的 __model。
import { readFileSync } from "node:fs";
import assert from "node:assert";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (init) => [init, () => {}],
  useEffect: () => {},
  useRef: (init) => ({ current: init }),
  useMemo: (fn) => fn(),
  useSyncExternalStore: (_sub, get) => get(),
};

let captured = null;
globalThis.window = {
  __ModuleLoader__: { load: (r) => (captured = r) },
  localStorage: {
    getItem: () => null,
    setItem: () => {},
  },
};
globalThis.document = undefined;

const mod = { exports: {} };
const fn = new Function("require", "module", "exports", source + "\n//# sourceURL=client.js");
fn((id) => ({ react: React }[id]), mod, mod.exports);
assert.ok(captured, "__ModuleLoader__.load 未被调用");
const api = captured.factory((id) => ({ react: React }[id]));
const model = api.__model;

function chatSnapshot(nodes) {
  const order = [];
  const map = new Map();
  for (const n of nodes) {
    order.push(n.key);
    map.set(n.key, n);
  }
  return { chat: { order, nodes: map } };
}

function node(key, kind, data, extra) {
  return { key, kind, anchorSeq: extra && extra.anchorSeq, data, ...(extra || {}) };
}

// ── entriesOf：kind → 角色、预览提取、轮次归属、工具过滤 ──
{
  const snap = chatSnapshot([
    node("u1", "user", { content: [{ type: "text", text: " 你好 \n 世界" }] }),
    node("a1", "assistant-step", { turn: 1, time: 1000, blocks: [{ kind: "text", text: "回答一" }, { kind: "reasoning", text: "思考" }] }),
    node("t1", "tool-call", { root: { name: "bash" } }),
    node("u2", "user", { content: [{ type: "text", text: "第二问" }] }),
    node("a2", "assistant-step", { turn: 2, time: 2000, blocks: [{ kind: "text", text: "回答二" }] }),
    node("tail2", "turn-tail", { turn: 2, time: 2100 }),
  ]);
  const all = model.entriesOf(snap);
  assert.equal(all.length, 6);
  assert.equal(all[0].role, "user");
  assert.equal(all[0].preview, "你好 世界");
  assert.equal(all[0].turn, 1, "用户消息应归属其后第一条已知 turn");
  assert.equal(all[1].role, "assistant");
  assert.equal(all[1].preview, "回答一 思考");
  assert.equal(all[1].turn, 1);
  assert.equal(all[2].role, "tool");
  assert.equal(all[4].turn, 2);
  assert.equal(all[5].role, "system", "turn-tail 是系统角色");

  // 索引对齐约定：entriesOf 不过滤任何节点，工具显隐由渲染层处理
  assert.ok(all.some((e) => e.role === "tool"), "条目列表必须保留工具节点以保证索引与 DOM 对齐");

  const empty = model.entriesOf({ chat: null });
  assert.deepEqual(empty, []);
}

// ── 末尾用户消息（无后续 turn）回退规则 ──
{
  const snap = chatSnapshot([
    node("a1", "assistant-step", { turn: 3 }),
    node("u9", "user", { content: [{ type: "text", text: "尾巴" }] }),
  ]);
  const entries = model.entriesOf(snap);
  assert.equal(entries[1].turn, 4, "无后续 turn 时应回退为 lastKnown+1");
}

// ── lengthPct：回答越长线越长、封顶 ──
{
  assert.equal(model.lengthPct({ role: "user", chars: 9999 }), 100);
  const s = model.lengthPct({ role: "assistant", chars: 10 });
  const l = model.lengthPct({ role: "assistant", chars: 10000 });
  assert.ok(l > s, "长回答的线应更长");
  assert.ok(l <= 100);
}

// ── displayRows：密度合并 ──
{
  const entries = Array.from({ length: 10 }, (_, i) => ({ key: "k" + i, role: i % 2 ? "assistant" : "user", chars: 5 }));
  const tops = [0, 4, 8, 12, 16, 20, 24, 28, 32, 36];
  const rows = model.displayRows(entries, tops, 100, 40, 3);
  assert.ok(rows.length < 10, "间距 1.6px < 3px 应发生合并");
  assert.ok(rows.some((r) => r.count > 1), "应存在合并组");
  const rowsOff = model.displayRows(entries, tops, 100, 40, 0);
  assert.equal(rowsOff.length, 10, "gap=0 不合并");
  const rowsAgg = model.displayRows(entries, tops, 100, 40, 6);
  assert.ok(rowsAgg.length <= rows.length, "aggressive 合并不少于 adaptive");
}

// ── indexAt：二分查找视口锚点 ──
{
  const tops = [0, 100, 200, 300, 400];
  assert.equal(model.indexAt(tops, 0, 0), 0);
  assert.equal(model.indexAt(tops, 150, 100), 1);
  assert.equal(model.indexAt(tops, 1000, 100), 4);
}

// ── scrollTopForFraction：比例跳转与钳制 ──
{
  assert.equal(model.scrollTopForFraction(0.5, 1000, 200), 400);
  assert.equal(model.scrollTopForFraction(-1, 1000, 200), 0);
  assert.equal(model.scrollTopForFraction(2, 1000, 200), 800);
}

// ── turnNavigation：上一轮/下一轮边界 ──
{
  const entries = [
    { turn: 1 }, { turn: 1 }, { turn: 2 }, { turn: 2 }, { turn: 3 },
  ].map((e, i) => ({ ...e, key: "k" + i }));
  assert.equal(model.turnNavigation(entries, 1, 1), 2, "下一轮起点");
  assert.equal(model.turnNavigation(entries, 3, 1), 4);
  assert.equal(model.turnNavigation(entries, 0, -1), 0);
  assert.equal(model.turnNavigation(entries, 3, -1), 2);
  assert.equal(model.turnNavigation(entries, 4, 1), 4, "末尾应停在最后一轮");
  assert.equal(model.turnNavigation([], 0, 1), -1);
}

// ── parseKey / matchKey ──
{
  const p = model.parseKey("Alt+ArrowUp");
  assert.ok(p && p.altKey && p.key === "ArrowUp");
  assert.ok(model.matchKey(p, { key: "ArrowUp", altKey: true, ctrlKey: false, shiftKey: false, metaKey: false }));
  assert.ok(!model.matchKey(p, { key: "ArrowUp", altKey: false, ctrlKey: false, shiftKey: false, metaKey: false }));
  assert.equal(model.parseKey(""), null);
  const letter = model.parseKey("Ctrl+j");
  assert.ok(letter && letter.ctrlKey && letter.key === "j");
}

// ── createScrollGuard：程序滚动守卫状态机 ──
{
  const g = model.createScrollGuard();
  assert.equal(g.consume(0), false, "未开始时不拦截");
  g.begin(500);
  assert.equal(g.consume(10), true, "滚动中应拦截");
  assert.equal(g.consume(499), false, "到达目标 ±8 应放行");
  g.begin(0);
  assert.equal(g.consume(5000), true, "远离目标仍拦截");
  g.until = Date.now() - 1;
  assert.equal(g.consume(5000), false, "超时应放行");
}

console.log("model tests passed");
