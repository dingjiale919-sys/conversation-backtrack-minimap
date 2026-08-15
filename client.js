// conversation-backtrack-minimap —— client 半边。
// 手写浏览器 bundle（lazy-CJS 格式）：只注册工厂，材质化时才执行。
//
// 架构说明：
// - 数据：走官方槽位标准 props 的 useSession 选择器读 ChatSnapshot（增量发布，
//   不解析消息正文 DOM，不在每个 token 时重建索引）。
// - 几何：集中式 DOM 适配器。全部易变选择器集中在 SELECTORS 常量里；
//   滚动容器用 harness 自己依赖的 [data-conversation-scroll]，
//   消息行用 [data-chat-anchor-key]，输入栏用 [data-composer-seat]。
//   探测失败时在输入栏显示黄色警示点并停用。
// - 渲染：时间轴是命令式 DOM（position:fixed，挂在 body），行位置用
//   ResizeObserver + 增量前缀和更新，滚动同步走 passive scroll + rAF 节流；
//   React 只负责把快照派生的条目列表送进命令式手柄。
// - 无网络、无遥测、不改消息数据、不拦截模型请求。
window.__ModuleLoader__.load({
  id: "conversation-backtrack-minimap",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");

    const NS = "conversationBacktrackMinimap";
    const inject = ["slots", "locale"];
    const STORE_KEY = "conversation-backtrack-minimap.settings.v1";
    const PREVIEW_CHARS = 150;
    const FLASH_MS = 1500;
    const GUARD_MS = 1200;
    const RAIL_Z = 30;
    const PREVIEW_Z = 50;

    const DEFAULTS = Object.freeze({
      enabled: true,
      side: "left",
      width: 10,
      showToolCalls: true,
      smoothScroll: true,
      showHoverPreview: true,
      density: "adaptive",
      prevKey: "Alt+ArrowUp",
      nextKey: "Alt+ArrowDown",
    });

    // 集中式 DOM 适配器：本插件依赖的全部易变选择器。
    const SELECTORS = Object.freeze({
      scroll: "[data-conversation-scroll]",
      row: "[data-chat-anchor-key]",
      composer: "[data-composer-seat]",
    });

    const zh = {
      settingsNav: "对话时间轴",
      railLabel: "对话时间轴",
      settingsTitle: "对话时间轴设置",
      enabled: "启用时间轴",
      side: "显示位置",
      sideLeft: "左侧",
      sideRight: "右侧",
      width: "时间轴宽度（px）",
      showToolCalls: "显示工具调用",
      smoothScroll: "平滑滚动",
      showHoverPreview: "悬停预览",
      density: "节点密度",
      densityAdaptive: "自适应合并",
      densityOff: "不合并",
      densityAggressive: "激进合并",
      prevKey: "上一轮快捷键",
      nextKey: "下一轮快捷键",
      resetDefaults: "恢复默认",
      roleUser: "用户",
      roleAssistant: "助手",
      roleTool: "工具",
      roleContext: "上下文",
      roleSystem: "系统",
      turnLabel: "第 {turn} 轮",
      mergedCount: "合并节点（{count} 条）",
      unsupportedHint: "未找到 DSH 对话滚动容器锚点（data-conversation-scroll），时间轴不可用；请检查 DeepSeek Harness 版本兼容性。",
      savedHint: "设置即时生效",
    };

    const en = {
      settingsNav: "Conversation timeline",
      railLabel: "Conversation timeline",
      settingsTitle: "Conversation timeline settings",
      enabled: "Enable timeline",
      side: "Side",
      sideLeft: "Left",
      sideRight: "Right",
      width: "Timeline width (px)",
      showToolCalls: "Show tool calls",
      smoothScroll: "Smooth scrolling",
      showHoverPreview: "Hover preview",
      density: "Node density",
      densityAdaptive: "Adaptive merge",
      densityOff: "No merge",
      densityAggressive: "Aggressive merge",
      prevKey: "Previous turn key",
      nextKey: "Next turn key",
      resetDefaults: "Reset defaults",
      roleUser: "User",
      roleAssistant: "Assistant",
      roleTool: "Tool",
      roleContext: "Context",
      roleSystem: "System",
      turnLabel: "Turn {turn}",
      mergedCount: "Merged nodes ({count})",
      unsupportedHint: "DSH conversation scroll anchor (data-conversation-scroll) not found — the timeline is unavailable; check the DeepSeek Harness version.",
      savedHint: "Changes apply immediately",
    };

    // ═══════════════════════════ 纯模型层（可测试） ═══════════════════════════

    function clamp(v, lo, hi) {
      return v < lo ? lo : v > hi ? hi : v;
    }

    function truncate(s, n) {
      if (typeof s !== "string") return "";
      return s.length > n ? s.slice(0, n - 1) + "…" : s;
    }

    function roleOfKind(kind) {
      switch (kind) {
        case "user":
        case "steering":
          return "user";
        case "assistant-step":
          return "assistant";
        case "tool-call":
          return "tool";
        case "context":
          return "context";
        default:
          return "system";
      }
    }

    function textOfBlocks(content) {
      let out = "";
      for (const b of content || []) {
        if (!b || typeof b !== "object") continue;
        if ((b.type === "text" || b.kind === "text") && typeof b.text === "string") out += " " + b.text;
      }
      return out.replace(/\s+/g, " ").trim();
    }

    function assistantTextOf(data) {
      let out = "";
      for (const b of (data && data.blocks) || []) {
        if (b && (b.kind === "text" || b.kind === "reasoning") && typeof b.text === "string") out += " " + b.text;
      }
      return out.replace(/\s+/g, " ").trim();
    }

    function previewOf(node) {
      const d = node && node.data;
      switch (node && node.kind) {
        case "user":
        case "steering":
        case "context":
          return textOfBlocks(d && d.content);
        case "assistant-step":
          return assistantTextOf(d);
        case "tool-call":
          return (d && d.root && d.root.name) || "tool";
        case "command":
          return textOfBlocks(d && d.content) || "command";
        case "compaction":
        case "manual-compaction":
          return "compaction";
        case "turn-error":
          return "error";
        case "turn-max-tokens":
          return "max-tokens";
        case "model-retry":
          return "retry";
        default:
          return "";
      }
    }

    /** 把用户/上下文消息归入其后第一条已知 turn（即它开启的那一轮）。 */
    function fillTurns(entries) {
      let lastKnown = null;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (e.turn != null) {
          lastKnown = e.turn;
          continue;
        }
        let next = null;
        for (let j = i + 1; j < entries.length; j++) {
          if (entries[j].turn != null) {
            next = entries[j].turn;
            break;
          }
        }
        e.turn = next != null ? next : lastKnown != null ? lastKnown + 1 : 1;
      }
    }

    /**
     * 从 ChatSnapshot 派生线性条目列表。O(n)，只在 order 签名变化时重算。
     * 注意：不按设置过滤（工具节点也保留），保证条目索引与 DOM 行顺序一一对应；
     * 工具显隐由渲染层在保留索引的前提下跳过。
     * 返回 [{ key, kind, role, turn, seq, time, preview, chars }]
     */
    function entriesOf(snapshot) {
      const chat = snapshot && snapshot.chat;
      const order = chat && chat.order;
      if (!order || !chat || typeof chat.nodes.get !== "function") return [];
      const out = [];
      for (const key of order) {
        const node = chat.nodes.get(key);
        if (!node || !node.kind) continue;
        const role = roleOfKind(node.kind);
        const data = node.data || {};
        const preview = previewOf(node);
        out.push({
          key,
          kind: node.kind,
          role,
          turn: typeof data.turn === "number" ? data.turn : undefined,
          seq: typeof node.anchorSeq === "number" ? node.anchorSeq : typeof node.seq === "number" ? node.seq : 0,
          time: typeof data.time === "number" ? data.time : typeof node.time === "number" ? node.time : undefined,
          preview,
          chars: preview.length,
        });
      }
      fillTurns(out);
      return out;
    }

    /** 线长百分比：回答越长线越长。 */
    function lengthPct(entry) {
      switch (entry.role) {
        case "user":
          return 40;
        case "assistant":
          return clamp(62 + Math.round(10 * Math.log10(1 + (entry.chars || 0))), 62, 100);
        case "context":
          return 45;
        case "tool":
          return 0;
        default:
          return 35;
      }
    }

    /** 在 rail 空间按 gapPx 合并过密节点，返回显示行（含组）。 */
    function displayRows(entries, tops, extent, railHeight, gapPx) {
      const rows = [];
      let cur = null;
      for (let i = 0; i < entries.length; i++) {
        const y = extent > 0 ? ((tops[i] || 0) / extent) * railHeight : i * 2;
        if (cur && gapPx > 0 && y - cur.y < gapPx) {
          cur.count++;
          cur.end = i;
          cur.y = (cur.y + y) / 2;
          cur.members.push(i);
        } else {
          if (cur) rows.push(cur);
          cur = { start: i, end: i, count: 1, y, members: [i] };
        }
      }
      if (cur) rows.push(cur);
      return rows;
    }

    /** 二分查找：视口锚点（40% 高度处）所在条目下标。 */
    function indexAt(tops, scrollTop, viewportH) {
      if (!tops.length) return 0;
      const x = scrollTop + viewportH * 0.4;
      let lo = 0;
      let hi = tops.length - 1;
      let ans = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (tops[mid] <= x) {
          ans = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return ans;
    }

    /** 按比例跳转：rail 位置比例 → scrollTop。 */
    function scrollTopForFraction(frac, scrollHeight, clientHeight) {
      return clamp(frac, 0, 1) * Math.max(0, scrollHeight - clientHeight);
    }

    /** 上一轮/下一轮：返回目标条目下标；找不到返回 -1。 */
    function turnNavigation(entries, currentIndex, dir) {
      const bounds = [];
      let cur = null;
      for (let i = 0; i < entries.length; i++) {
        const t = entries[i].turn;
        if (t == null || t === cur) continue;
        bounds.push(i);
        cur = t;
      }
      if (!bounds.length) return -1;
      if (dir < 0) {
        for (let k = bounds.length - 1; k >= 0; k--) {
          if (bounds[k] < currentIndex) return bounds[k];
        }
        return bounds[0];
      }
      for (const b of bounds) {
        if (b > currentIndex) return b;
      }
      return bounds[bounds.length - 1];
    }

    /** 解析快捷键字符串，如 "Alt+ArrowUp"。 */
    function parseKey(spec) {
      if (typeof spec !== "string") return null;
      const parts = spec.split("+").map((s) => s.trim()).filter(Boolean);
      const key = parts.pop();
      if (!key) return null;
      return {
        key: key.length === 1 ? key.toLowerCase() : key,
        altKey: parts.includes("Alt"),
        ctrlKey: parts.includes("Ctrl") || parts.includes("Control"),
        shiftKey: parts.includes("Shift"),
        metaKey: parts.includes("Meta") || parts.includes("Cmd"),
      };
    }

    function matchKey(parsed, ev) {
      if (!parsed) return false;
      const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
      return (
        k === parsed.key &&
        ev.altKey === parsed.altKey &&
        ev.ctrlKey === parsed.ctrlKey &&
        ev.shiftKey === parsed.shiftKey &&
        ev.metaKey === parsed.metaKey
      );
    }

    /** 程序滚动守卫：标记一次程序化滚动，防反馈环。 */
    function createScrollGuard() {
      return {
        active: false,
        target: null,
        until: 0,
        begin(target) {
          this.active = true;
          this.target = target;
          this.until = Date.now() + GUARD_MS;
        },
        consume(scrollTop) {
          if (!this.active) return false;
          if (Date.now() > this.until || (this.target != null && Math.abs(scrollTop - this.target) <= 8)) {
            this.active = false;
            this.target = null;
            return false;
          }
          return true;
        },
      };
    }

    const model = {
      clamp,
      truncate,
      roleOfKind,
      previewOf,
      fillTurns,
      entriesOf,
      lengthPct,
      displayRows,
      indexAt,
      scrollTopForFraction,
      turnNavigation,
      parseKey,
      matchKey,
      createScrollGuard,
    };

    // ═══════════════════════════ 设置存储 ═══════════════════════════

    const settingsStore = (() => {
      let cached = null;
      const listeners = new Set();
      function load() {
        if (cached) return cached;
        let parsed = null;
        try {
          const raw = window.localStorage.getItem(STORE_KEY);
          if (raw) parsed = JSON.parse(raw);
        } catch {
          /* 忽略损坏值 */
        }
        cached = { ...DEFAULTS, ...(parsed && typeof parsed === "object" ? parsed : {}) };
        return cached;
      }
      return {
        get: load,
        update(patch) {
          cached = { ...load(), ...patch };
          try {
            window.localStorage.setItem(STORE_KEY, JSON.stringify(cached));
          } catch {
            /* 私有模式等场景忽略 */
          }
          for (const fn of listeners) fn(cached);
        },
        subscribe(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      };
    })();

    // ═══════════════════════════ 几何适配器 ═══════════════════════════

    /**
     * 增量几何跟踪：一个 ResizeObserver 观察所有消息行（MutationObserver 懒注册
     * 新行），行高进前缀和 tops；行高不变的行完全不参与重算。
     */
    class GeometryTracker {
      constructor(scrollport) {
        this.scrollport = scrollport;
        this.heights = new Map(); // key → height
        this.rowEls = new Map(); // key → element
        this.order = []; // DOM 顺序的 key 列表
        this.tops = [];
        this.total = 0;
        this.raf = null;
        this.mo = null;
        this.ro = null;
        this.column = null;
        this.onChange = null;
      }

      start(onChange) {
        this.onChange = onChange;
        this.refreshColumn();
        // 单个 subtree MutationObserver 兜底：列容器尚未挂载（空会话）、
        // loadOlder 头部追加、新消息尾部插入都能被发现；只对"与消息行相关"
        // 的 childList 变更做 O(行数) 重扫，流式文本更新不触发重扫。
        this.mo = new MutationObserver((list) => {
          for (const rec of list) {
            if (rec.type !== "childList") continue;
            for (const added of rec.addedNodes) {
              if (added.nodeType !== 1) continue;
              if (added.matches(SELECTORS.row) || added.querySelector(SELECTORS.row)) {
                this.rescan();
                return;
              }
            }
          }
        });
        this.mo.observe(this.scrollport, { childList: true, subtree: true });
        this.ro = new ResizeObserver((entries) => this.applyRO(entries));
        this.rescan();
      }

      refreshColumn() {
        const first = this.scrollport.querySelector(SELECTORS.row);
        this.column = first ? first.parentElement : null;
      }

      rescan() {
        this.refreshColumn();
        if (!this.column) return;
        const rows = this.column.querySelectorAll(SELECTORS.row);
        const seen = new Set();
        for (const row of rows) {
          const key = row.getAttribute("data-chat-anchor-key");
          if (key == null) continue;
          seen.add(key);
          if (!this.rowEls.has(key)) {
            this.rowEls.set(key, row);
            this.ro.observe(row);
            this.heights.set(key, row.getBoundingClientRect().height);
          }
        }
        for (const [key, el] of [...this.rowEls]) {
          if (!seen.has(key)) {
            this.ro.unobserve(el);
            this.rowEls.delete(key);
            this.heights.delete(key);
          }
        }
        this.order = Array.from(rows, (r) => r.getAttribute("data-chat-anchor-key")).filter((k) => k != null);
        this.schedule();
      }

      applyRO(entries) {
        let dirty = false;
        for (const e of entries) {
          const key = e.target.getAttribute && e.target.getAttribute("data-chat-anchor-key");
          if (key == null) continue;
          const h = e.borderBoxSize && e.borderBoxSize[0] ? e.borderBoxSize[0].blockSize : e.contentRect.height;
          if (this.heights.get(key) !== h) {
            this.heights.set(key, h);
            dirty = true;
          }
        }
        if (dirty) this.schedule();
      }

      schedule() {
        if (this.raf) return;
        this.raf = requestAnimationFrame(() => {
          this.raf = null;
          this.recompute();
          if (this.onChange) this.onChange();
        });
      }

      recompute() {
        const tops = new Array(this.order.length);
        let top = 0;
        for (let i = 0; i < this.order.length; i++) {
          tops[i] = top;
          top += this.heights.get(this.order[i]) || 0;
        }
        this.tops = tops;
        this.total = top;
      }

      stop() {
        if (this.mo) this.mo.disconnect();
        if (this.ro) this.ro.disconnect();
        this.mo = this.ro = null;
        this.rowEls.clear();
      }
    }

    // ═══════════════════════════ 命令式时间轴 ═══════════════════════════

    function fmtTime(ts) {
      if (typeof ts !== "number") return "";
      try {
        const d = new Date(ts);
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      } catch {
        return "";
      }
    }

    function roleName(role, t) {
      switch (role) {
        case "user":
          return t("roleUser");
        case "assistant":
          return t("roleAssistant");
        case "tool":
          return t("roleTool");
        case "context":
          return t("roleContext");
        default:
          return t("roleSystem");
      }
    }

    function colorFor(role, group) {
      if (group) return "var(--dsw-alias-label-caption)";
      switch (role) {
        case "user":
          return "var(--dsw-alias-label-primary)";
        case "assistant":
          return "var(--dsw-alias-state-business-primary)";
        case "tool":
          return "var(--dsw-alias-state-warn-label)";
        case "context":
          return "var(--dsw-alias-label-tertiary)";
        default:
          return "var(--dsw-alias-label-caption)";
      }
    }

    /** 测量当前"粘在顶部"的 sticky 元素高度，跳转定位时补偿（500ms 缓存）。 */
    let stickyCache = { at: 0, value: 0 };
    function measureStickyOffset(scrollport) {
      const now = Date.now();
      if (now - stickyCache.at < 500) return stickyCache.value;
      let offset = 0;
      const rect = scrollport.getBoundingClientRect();
      for (const el of scrollport.querySelectorAll("*")) {
        let pos;
        try {
          pos = getComputedStyle(el).position;
        } catch {
          continue;
        }
        if (pos === "sticky") {
          const r = el.getBoundingClientRect();
          if (r.top <= rect.top + 8 && r.bottom > rect.top) {
            offset = Math.max(offset, r.height);
          }
        }
      }
      stickyCache = { at: now, value: offset };
      return offset;
    }

    /**
     * 命令式时间轴手柄：创建 fixed rail、视口亮带、悬停预览，绑定全部事件，
     * dispose() 一次性清理（监听器/观察器/DOM），不留残留。
     */
    function createRail(opts) {
      const st = {
        disposed: false,
        entries: [],
        tops: [],
        heights: new Map(),
        display: [],
        scrollport: opts.scrollport,
        settings: opts.settings,
        t: opts.t,
        getSnapshot: opts.getSnapshot || (() => null),
        tracker: new GeometryTracker(opts.scrollport),
        guard: createScrollGuard(),
        scrollRaf: null,
        pointerRaf: null,
        lastRange: [-1, -1],
        rail: null,
        band: null,
        preview: null,
        rowEls: new Map(),
        resizeObserver: null,
        railW: opts.settings.width || 10,
      };

      const rail = (st.rail = document.createElement("div"));
      rail.setAttribute("data-conversation-backtrack-minimap", "");
      Object.assign(rail.style, {
        position: "fixed",
        zIndex: String(RAIL_Z),
        pointerEvents: "auto",
        cursor: "pointer",
        userSelect: "none",
      });
      const band = (st.band = document.createElement("div"));
      Object.assign(band.style, {
        position: "absolute",
        left: "0",
        right: "0",
        borderRadius: "4px",
        background: "var(--dsw-alias-interactive-bg-hover-solid)",
        opacity: "0.85",
        pointerEvents: "none",
      });
      rail.appendChild(band);
      const preview = (st.preview = document.createElement("div"));
      Object.assign(preview.style, {
        position: "fixed",
        display: "none",
        zIndex: String(PREVIEW_Z),
        maxWidth: "320px",
        background: "var(--dsw-alias-bg-layer-3)",
        border: "1px solid var(--dsw-alias-border-l2)",
        borderRadius: "10px",
        boxShadow: "var(--dsw-shadow-lv2)",
        padding: "10px 12px",
        color: "var(--dsw-alias-label-primary)",
        fontSize: "13px",
        lineHeight: "1.5",
        pointerEvents: "none",
      });
      document.body.appendChild(rail);
      document.body.appendChild(preview);

      // ── 行渲染（命令式，只重建结构，位置直接写 style） ──
      function rowStyleFor(row) {
        const entry = st.entries[row.start];
        const group = row.count > 1;
        const isTool = !group && entry && entry.role === "tool";
        const widthPct = group ? 80 : lengthPct(entry || { role: "system", chars: 0 });
        const h = isTool ? 4 : group ? 4 : 2;
        const style = {
          position: "absolute",
          height: h + "px",
          borderRadius: isTool ? "50%" : "2px",
          background: colorFor(entry ? entry.role : "system", group),
          pointerEvents: "none",
        };
        if (isTool) {
          style.width = "4px";
          style.left = ((st.railW - 4) / 2).toFixed(1) + "px";
        } else if (st.settings.side === "right") {
          style.right = "2px";
          style.width = Math.max(4, Math.round((st.railW - 4) * widthPct / 100)) + "px";
        } else {
          style.left = "2px";
          style.width = Math.max(4, Math.round((st.railW - 4) * widthPct / 100)) + "px";
        }
        return style;
      }

      function rebuildRows() {
        for (const el of st.rowEls.values()) el.remove();
        st.rowEls.clear();
        const gap = st.settings.density === "aggressive" ? 6 : st.settings.density === "adaptive" ? 3 : 0;
        const railH = rail.clientHeight || 1;
        const extent = Math.max(1, st.scrollport.scrollHeight - st.scrollport.clientHeight);
        // 工具显隐在渲染层处理：保留原始条目索引，只跳过显示。
        const vis = [];
        for (let i = 0; i < st.entries.length; i++) {
          const e = st.entries[i];
          if (e.role === "tool" && st.settings.showToolCalls === false) continue;
          vis.push(i);
        }
        const visEntries = vis.map((i) => st.entries[i]);
        const visTops = vis.map((i) => st.tops[i] || 0);
        const raw = displayRows(visEntries, visTops, extent, railH, gap);
        st.display = raw.map((r) => ({
          ...r,
          start: vis[r.start],
          end: vis[r.end],
          members: r.members.map((m) => vis[m]),
        }));
        for (const row of st.display) {
          const el = document.createElement("div");
          Object.assign(el.style, rowStyleFor(row));
          el.style.top = row.y.toFixed(1) + "px";
          st.rowEls.set(row.start, el);
          rail.appendChild(el);
        }
        band.style.top = "0px";
        updateBand();
      }

      function layout() {
        if (st.disposed) return;
        const sr = st.scrollport.getBoundingClientRect();
        const composer = st.scrollport.querySelector(SELECTORS.composer);
        const cr = composer ? composer.getBoundingClientRect() : null;
        const top = sr.top;
        const bottom = cr && cr.top > sr.top ? cr.top : sr.bottom;
        const railW = Math.max(6, Math.min(20, Number(st.settings.width) || 10));
        st.railW = railW;
        const narrow = sr.width < 480;
        const hidden = narrow || !st.tracker.rowEls.size;
        rail.style.display = hidden ? "none" : "block";
        if (hidden) return;
        // 内容列左缘：以第一条可见消息行的实际左缘为准（版本无关）。
        let contentLeft = sr.left;
        let contentRight = sr.right;
        const firstRowEl = st.tracker.rowEls.values().next().value;
        if (firstRowEl) {
          const r = firstRowEl.getBoundingClientRect();
          contentLeft = Math.min(contentLeft, r.left);
          contentRight = Math.max(contentRight, r.right);
        }
        const side = st.settings.side === "right" ? "right" : "left";
        let left;
        if (side === "left") {
          left = clamp(contentLeft - railW - 8, sr.left + 2, Math.max(sr.left + 2, sr.right - railW - 2));
        } else {
          left = clamp(contentRight + 8, sr.left + 2, sr.right - railW - 2);
        }
        Object.assign(rail.style, {
          top: top.toFixed(1) + "px",
          left: left.toFixed(1) + "px",
          height: Math.max(0, bottom - top).toFixed(1) + "px",
          width: railW + "px",
        });
        st.tops = st.tracker.tops;
        st.heights = st.tracker.heights;
        rebuildRows();
      }

      function updateBand() {
        if (st.disposed) return;
        const sp = st.scrollport;
        const scrollable = sp.scrollHeight - sp.clientHeight;
        if (scrollable <= 0) {
          band.style.display = "none";
          return;
        }
        band.style.display = "block";
        const extent = Math.max(1, scrollable);
        const railH = rail.clientHeight || 1;
        const frac = clamp(sp.scrollTop / extent, 0, 1);
        const bandTop = frac * railH;
        const bandH = Math.max(14, (sp.clientHeight / extent) * railH);
        band.style.top = bandTop.toFixed(1) + "px";
        band.style.height = bandH.toFixed(1) + "px";
        // 当前视口内的消息行提亮
        const lo = indexAt(st.tops, sp.scrollTop, 0);
        const hi = indexAt(st.tops, sp.scrollTop + sp.clientHeight + 1, 0);
        const [plo, phi] = st.lastRange;
        if (plo !== lo || phi !== hi) {
          for (let i = plo; i <= phi; i++) {
            const el = st.rowEls.get(i);
            if (el) el.style.filter = "";
          }
          for (let i = lo; i <= hi; i++) {
            const el = st.rowEls.get(i);
            if (el) el.style.filter = "brightness(1.5)";
          }
          st.lastRange = [lo, hi];
        }
      }

      function onScroll() {
        if (st.scrollRaf) return;
        st.scrollRaf = requestAnimationFrame(() => {
          st.scrollRaf = null;
          updateBand();
          hidePreview();
        });
      }

      function hidePreview() {
        st.preview.style.display = "none";
      }

      function flashRow(index) {
        if (index < 0 || index >= st.entries.length) return;
        const key = st.entries[index].key;
        const el = st.tracker.rowEls.get(key);
        if (!el) return;
        const prev = el.style.boxShadow;
        el.style.transition = "box-shadow .15s ease";
        el.style.boxShadow = "0 0 0 3px var(--dsw-alias-state-business-primary)";
        window.setTimeout(() => {
          el.style.boxShadow = prev;
        }, FLASH_MS);
      }

      function jumpTo(index) {
        if (index < 0 || index >= st.tops.length) return;
        const sp = st.scrollport;
        const h = st.heights.get(st.entries[index].key) || 0;
        const sticky = measureStickyOffset(sp);
        const target = clamp(
          st.tops[index] - (sp.clientHeight - h) / 2 + sticky,
          0,
          Math.max(0, sp.scrollHeight - sp.clientHeight)
        );
        st.guard.begin(target);
        sp.scrollTo({ top: target, behavior: st.settings.smoothScroll ? "smooth" : "auto" });
        flashRow(index);
        updateBand();
      }

      function entryOfY(clientY) {
        const rect = rail.getBoundingClientRect();
        const frac = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
        const extent = Math.max(1, st.scrollport.scrollHeight - st.scrollport.clientHeight);
        return { frac, idx: indexAt(st.tops, frac * extent, 0) };
      }

      function rowAt(clientY) {
        const rect = rail.getBoundingClientRect();
        for (const row of st.display) {
          if (Math.abs(clientY - (rect.top + row.y)) <= 4) return row;
        }
        return null;
      }

      function renderPreview(clientX, clientY, row) {
        if (st.settings.showHoverPreview === false) return;
        const p = st.preview;
        let html = "";
        if (row.count > 1) {
          html += '<div style="font-weight:600;margin-bottom:4px">' + st.t("mergedCount").replace("{count}", String(row.count)) + "</div>";
          const snap = st.getSnapshot();
          const chat = snap && snap.chat;
          const list = [];
          for (let i = row.start; i <= row.end; i++) {
            const e = st.entries[i];
            if (!e) continue;
            let text = "";
            if (chat) {
              const node = chat.nodes.get(e.key);
              text = truncate(previewOf(node), 40);
            } else {
              text = truncate(e.preview, 40);
            }
            list.push(
              '<div style="color:var(--dsw-alias-label-secondary);font-size:12px">' +
                roleName(e.role, st.t) + " · " + text.replace(/</g, "&lt;") + "</div>"
            );
            if (list.length >= 8) break;
          }
          html += list.join("");
        } else {
          const e = st.entries[row.start];
          if (!e) return;
          let text = e.preview;
          const snap = st.getSnapshot();
          if (snap && snap.chat) {
            const node = snap.chat.nodes.get(e.key);
            if (node) text = previewOf(node);
          }
          const head =
            '<div style="font-weight:600;margin-bottom:4px">' +
            roleName(e.role, st.t) +
            (e.turn != null ? " · " + st.t("turnLabel").replace("{turn}", String(e.turn)) : "") +
            (e.time ? " · " + fmtTime(e.time) : "") +
            "</div>";
          html += head;
          html += '<div style="color:var(--dsw-alias-label-secondary)">' + truncate(text, PREVIEW_CHARS).replace(/</g, "&lt;") + "</div>";
        }
        p.innerHTML = html;
        p.style.display = "block";
        // 浮层定位：避开窗口边缘，必要时翻转到另一侧
        const pw = p.offsetWidth;
        const ph = p.offsetHeight;
        let x = clientX + 12;
        if (x + pw > window.innerWidth - 8) x = clientX - pw - 12;
        x = clamp(x, 8, Math.max(8, window.innerWidth - pw - 8));
        const y = clamp(clientY - ph / 2, 8, Math.max(8, window.innerHeight - ph - 8));
        p.style.left = x.toFixed(0) + "px";
        p.style.top = y.toFixed(0) + "px";
      }

      function onPointerMove(e) {
        if (st.pointerRaf) return;
        st.pointerRaf = requestAnimationFrame(() => {
          st.pointerRaf = null;
          const row = rowAt(e.clientY);
          if (row) renderPreview(e.clientX, e.clientY, row);
          else hidePreview();
        });
      }

      function onClick(e) {
        const row = rowAt(e.clientY);
        if (row) {
          jumpTo(row.start);
          return;
        }
        const { frac } = entryOfY(e.clientY);
        const sp = st.scrollport;
        const target = scrollTopForFraction(frac, sp.scrollHeight, sp.clientHeight);
        st.guard.begin(target);
        sp.scrollTo({ top: target, behavior: st.settings.smoothScroll ? "smooth" : "auto" });
      }

      function onKeyDown(e) {
        if (rail.style.display === "none") return;
        const target = e.target;
        if (
          target &&
          (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || (target.isContentEditable === true))
        ) {
          return;
        }
        const prev = parseKey(st.settings.prevKey);
        const next = parseKey(st.settings.nextKey);
        if (matchKey(prev, e)) {
          e.preventDefault();
          const cur = indexAt(st.tops, st.scrollport.scrollTop, st.scrollport.clientHeight);
          const t = turnNavigation(st.entries, cur, -1);
          if (t >= 0) jumpTo(t);
        } else if (matchKey(next, e)) {
          e.preventDefault();
          const cur = indexAt(st.tops, st.scrollport.scrollTop, st.scrollport.clientHeight);
          const t = turnNavigation(st.entries, cur, 1);
          if (t >= 0) jumpTo(t);
        }
      }

      // ── 事件绑定 ──
      st.scrollport.addEventListener("scroll", onScroll, { passive: true });
      rail.addEventListener("pointermove", onPointerMove);
      rail.addEventListener("pointerleave", hidePreview);
      rail.addEventListener("click", onClick);
      window.addEventListener("keydown", onKeyDown);
      st.resizeObserver = new ResizeObserver(() => layout());
      st.resizeObserver.observe(st.scrollport);
      st.tracker.start(() => layout());

      st.setEntries = (entries) => {
        st.entries = entries;
        st.tops = st.tracker.tops;
        st.heights = st.tracker.heights;
        layout();
      };

      layout();

      st.dispose = () => {
        if (st.disposed) return;
        st.disposed = true;
        st.scrollport.removeEventListener("scroll", onScroll);
        rail.removeEventListener("pointermove", onPointerMove);
        rail.removeEventListener("pointerleave", hidePreview);
        rail.removeEventListener("click", onClick);
        window.removeEventListener("keydown", onKeyDown);
        st.resizeObserver.disconnect();
        st.tracker.stop();
        rail.remove();
        preview.remove();
      };

      return st;
    }

    // ═══════════════════════════ React 组件 ═══════════════════════════

    /** 输入栏槽位条目：本身不渲染可见内容，只负责创建/销毁命令式时间轴。 */
    function RailEntry(props) {
      const { sessionId, useSession, t, settings } = props;
      const snapshot = typeof useSession === "function" ? useSession((s) => (s ? s.chat : null)) : null;
      // 用 order 签名（长度+首尾 key）作 memo 依赖：流式期间内容变化不重算索引，
      // 只有节点增删（含 loadOlder 在头部追加）才重建条目列表。
      const order = snapshot ? snapshot.order : null;
      const orderSig = order
        ? order.length + ":" + order[0] + ":" + order[order.length - 1]
        : "0";
      const snapshotRef = React.useRef(snapshot);
      snapshotRef.current = snapshot;
      const entries = React.useMemo(() => entriesOf(snapshotRef.current), [orderSig]);
      const rootRef = React.useRef(null);
      const railRef = React.useRef(null);
      const [unsupported, setUnsupported] = React.useState(false);

      React.useEffect(() => {
        if (settings.enabled === false) return;
        const host = rootRef.current;
        if (!host) return;
        const scrollport = host.closest(SELECTORS.scroll);
        if (!scrollport) {
          setUnsupported(true);
          return;
        }
        setUnsupported(false);
        const rail = createRail({
          scrollport,
          settings,
          t,
          getSnapshot: () => snapshotRef.current,
        });
        rail.setEntries(entries);
        railRef.current = rail;
        return () => {
          railRef.current = null;
          rail.dispose();
        };
      }, [
        sessionId,
        settings.enabled,
        settings.side,
        settings.width,
        settings.showToolCalls,
        settings.smoothScroll,
        settings.showHoverPreview,
        settings.density,
        settings.prevKey,
        settings.nextKey,
      ]);

      React.useEffect(() => {
        const rail = railRef.current;
        if (rail) rail.setEntries(entries);
      }, [entries]);

      if (unsupported) {
        return React.createElement("span", {
          title: t("unsupportedHint"),
          style: {
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--dsw-alias-state-warn-label)",
            alignSelf: "center",
          },
        });
      }
      return React.createElement("span", { ref: rootRef, style: { display: "none" } });
    }

    /** 设置页（settings.section）。 */
    function SettingsPage({ t, settings }) {
      const value = React.useSyncExternalStore(settings.subscribe, settings.get);
      const set = (patch) => settings.update(patch);

      const row = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 0" };
      const labelStyle = { fontSize: 13, color: "var(--dsw-alias-label-primary)" };
      const inputStyle = {
        font: "inherit",
        background: "var(--dsw-alias-bg-layer-3)",
        color: "var(--dsw-alias-label-primary)",
        border: "1px solid var(--dsw-alias-border-l2)",
        borderRadius: 6,
        padding: "4px 8px",
      };

      return React.createElement(
        "div",
        { style: { maxWidth: 560, display: "flex", flexDirection: "column", gap: 4, padding: "8px 0" } },
        React.createElement("h2", { style: { fontSize: 16, fontWeight: 600, margin: "0 0 8px" } }, t("settingsTitle")),
        React.createElement(
          "div",
          { style: row },
          React.createElement("span", { style: labelStyle }, t("enabled")),
          React.createElement("input", {
            type: "checkbox",
            checked: value.enabled !== false,
            onChange: (e) => set({ enabled: e.target.checked }),
          })
        ),
        React.createElement(
          "div",
          { style: row },
          React.createElement("span", { style: labelStyle }, t("side")),
          React.createElement(
            "select",
            { value: value.side, style: inputStyle, onChange: (e) => set({ side: e.target.value }) },
            React.createElement("option", { value: "left" }, t("sideLeft")),
            React.createElement("option", { value: "right" }, t("sideRight"))
          )
        ),
        React.createElement(
          "div",
          { style: row },
          React.createElement("span", { style: labelStyle }, t("width")),
          React.createElement("input", {
            type: "number",
            min: 6,
            max: 20,
            value: value.width,
            style: inputStyle,
            onChange: (e) => set({ width: Number(e.target.value) || 10 }),
          })
        ),
        React.createElement(
          "div",
          { style: row },
          React.createElement("span", { style: labelStyle }, t("showToolCalls")),
          React.createElement("input", {
            type: "checkbox",
            checked: value.showToolCalls !== false,
            onChange: (e) => set({ showToolCalls: e.target.checked }),
          })
        ),
        React.createElement(
          "div",
          { style: row },
          React.createElement("span", { style: labelStyle }, t("smoothScroll")),
          React.createElement("input", {
            type: "checkbox",
            checked: value.smoothScroll !== false,
            onChange: (e) => set({ smoothScroll: e.target.checked }),
          })
        ),
        React.createElement(
          "div",
          { style: row },
          React.createElement("span", { style: labelStyle }, t("showHoverPreview")),
          React.createElement("input", {
            type: "checkbox",
            checked: value.showHoverPreview !== false,
            onChange: (e) => set({ showHoverPreview: e.target.checked }),
          })
        ),
        React.createElement(
          "div",
          { style: row },
          React.createElement("span", { style: labelStyle }, t("density")),
          React.createElement(
            "select",
            { value: value.density, style: inputStyle, onChange: (e) => set({ density: e.target.value }) },
            React.createElement("option", { value: "adaptive" }, t("densityAdaptive")),
            React.createElement("option", { value: "off" }, t("densityOff")),
            React.createElement("option", { value: "aggressive" }, t("densityAggressive"))
          )
        ),
        React.createElement(
          "div",
          { style: row },
          React.createElement("span", { style: labelStyle }, t("prevKey")),
          React.createElement("input", { value: value.prevKey, style: inputStyle, onChange: (e) => set({ prevKey: e.target.value }) })
        ),
        React.createElement(
          "div",
          { style: row },
          React.createElement("span", { style: labelStyle }, t("nextKey")),
          React.createElement("input", { value: value.nextKey, style: inputStyle, onChange: (e) => set({ nextKey: e.target.value }) })
        ),
        React.createElement(
          "div",
          { style: { ...row, justifyContent: "flex-start", gap: 12 } },
          React.createElement(
            "button",
            {
              type: "button",
              style: { ...inputStyle, cursor: "pointer", padding: "5px 12px" },
              onClick: () => settings.update({ ...DEFAULTS }),
            },
            t("resetDefaults")
          ),
          React.createElement("span", { style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)" } }, t("savedHint"))
        )
      );
    }

    // ═══════════════════════════ 注册 ═══════════════════════════

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "conversation-backtrack-minimap: dictionaries");
      const t = ctx.locale.bind(NS);
      const injected = () => ({ t, settings: settingsStore });

      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          {
            name: "settings.section",
            id: "conversation-backtrack-minimap",
            order: 50,
            label: () => t("settingsNav"),
            locale: NS,
            inject: injected,
          },
          SettingsPage
        )
      );

      ctx.slots.inject("conversation.input.right", () =>
        ctx.slots.register(
          {
            name: "conversation.input.right",
            id: "conversation-backtrack-minimap-rail",
            order: 10,
            label: () => t("railLabel"),
            locale: NS,
            inject: injected,
          },
          RailEntry
        )
      );
    }

    exports.NS = NS;
    exports.inject = inject;
    exports.apply = apply;
    exports.__model = model;
    exports.__selectors = SELECTORS;
    exports.__defaults = DEFAULTS;
    exports.__settingsStore = settingsStore;
    return module.exports;
  }
});
