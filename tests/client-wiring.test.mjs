// 客户端接线冒烟测试：apply() 应注册设置页与输入栏两个槽位，注入份额含 t 与设置存储。
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
  localStorage: { getItem: () => null, setItem: () => {} },
};

const mod = { exports: {} };
const fn = new Function("require", "module", "exports", source + "\n//# sourceURL=client.js");
fn((id) => ({ react: React }[id]), mod, mod.exports);
assert.ok(captured);
const api = captured.factory((id) => ({ react: React }[id]));

assert.equal(api.NS, "conversationBacktrackMinimap");
assert.deepEqual(api.inject, ["slots", "locale", "timer"]);
assert.deepEqual(api.__selectors, {
  scroll: "[data-conversation-scroll]",
  row: "[data-chat-anchor-key]",
  composer: "[data-composer-seat]",
});
assert.equal(api.__defaults.enabled, true);

const registrations = [];
const mockCtx = {
  effect: (fn) => fn(),
  get: (key) => (key === "remote.opencodeUsage" ? {} : undefined),
  setTimeout: (cb) => cb(),
  setInterval: () => () => {},
  locale: { register: () => {}, bind: () => (k) => k },
  slots: {
    inject: (slotName, cb) => registrations.push([slotName, cb]),
    register: (opts, Comp) => ({ opts, Comp }),
  },
};

api.apply(mockCtx);

const names = registrations.map(([n]) => n);
assert.deepEqual(names, ["settings.section", "conversation.input.right"]);

const settingsReg = registrations[0][1]();
assert.equal(settingsReg.opts.name, "settings.section");
assert.equal(settingsReg.opts.id, "conversation-backtrack-minimap");
assert.equal(typeof settingsReg.Comp, "function");

const railReg = registrations[1][1]();
assert.equal(railReg.opts.name, "conversation.input.right");
assert.equal(railReg.opts.id, "conversation-backtrack-minimap-rail");
assert.equal(typeof railReg.Comp, "function");
const share = railReg.opts.inject({ session: null, input: null });
assert.equal(typeof share.t, "function");
assert.equal(typeof share.settings.get, "function");
assert.equal(typeof share.settings.update, "function");
assert.equal(typeof share.settings.subscribe, "function");
assert.equal(typeof share.timers.setTimeout, "function");
assert.equal(typeof share.timers.setInterval, "function");

console.log("client wiring tests passed");
