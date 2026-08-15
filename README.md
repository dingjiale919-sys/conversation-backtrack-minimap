# conversation-backtrack-minimap

English | [中文](README.zh.md)

A DeepSeek Harness plugin: a **conversation minimap** on the left edge (switchable to the right) of long chats. Every message becomes a short horizontal line placed at its true vertical position in the conversation; hover to preview, click to jump, and the rail tracks your reading position while you scroll.

It is a navigation tool only — not long-term memory, RAG, summarization, or branching.

## Features

- **Message rail**: user = full-width bright 3px bars; assistant = longer blue lines (longer for longer answers); tool calls = orange dots; dense nodes merge into muted thick groups (hover to expand); system roles (compaction/command/error/turn-tail) are hidden; the current viewport is marked with a bright band
- **Hover preview**: dark rounded popover with role, turn, time, and the first 150 characters; clamped to the window edges
- **Click to jump**: smooth-scrolls the target message to the exact viewport center (content-origin offset and sticky headers compensated), flashes it for 1.5 s; clicking empty rail space jumps proportionally
- **Scroll sync**: passive scroll + rAF throttling; in-view rows brighten; programmatic and user scrolling never feed back into each other
- **Turn shortcuts**: `Alt+ArrowUp` / `Alt+ArrowDown` for previous/next turn (configurable)
- **Live updates**: streaming, new messages, tool start/end, code folding, image loads, session switches, reloads, and "load older" are all handled incrementally — the rail is never rebuilt per token
- **Performance**: ~1.5 ms to derive the 1000-message index (recomputed only when nodes are added/removed); geometry updates use ResizeObserver plus incremental prefix sums, only affected rows shift
- **Privacy**: all indexing is local; no network, no telemetry, no message mutation, no request interception

## Acceptance record (v0.2.0, 2026-08-15)

- Environment: DSH 0.1.0-rc.6, default web profile, verified on a live session with 110+ messages
- Verified item by item: rail rendering (user/assistant/tool/merged groups), hover preview, centered click-jump with 1.5 s flash, proportional blank-click jump, scroll-sync band, `Alt+↑/↓` turn navigation, streaming append, session-switch cleanup, reload restore, settings page live-apply
- Sandbox compliance: dynamic packages cannot use browser `setTimeout/setInterval/fetch`; this plugin declares `inject: ['timer']` and uses the `ctx` timer service. Session data comes from the `sessions` service (`Slot` prop `useSession` fallback); entries are aligned to DOM row order, with hidden placeholders for keys missing from the snapshot
- Performance measured (node micro-benchmark, 1000 messages): entriesOf 1.49 ms, displayRows 0.02 ms, indexAt ~0 ms, full prefix sum 0.004 ms

## Install

```sh
dsh plugin --profile web add github:<owner>/conversation-backtrack-minimap
```

Or add to your profile patch layer (`$DSH_HOME/profiles/web/cordis.patch.yml`):

```yaml
- insert:
    - id: conversation-backtrack-minimap
      name: 'conversation-backtrack-minimap'
```

Restart `dsh web`. The plugin needs the default web bundle's `conversation.input.right` and `settings.section` slots (both present in the default profile).

## Configuration

Settings live in the settings page (Settings → Conversation timeline) and apply immediately; they persist in `localStorage` (`conversation-backtrack-minimap.settings.v1`):

| Setting | Default | Notes |
| --- | --- | --- |
| Enable timeline | on | fully stops rendering when off |
| Side | left | left / right |
| Timeline width | 10 px | 6–20 px |
| Show tool calls | on | hides tool nodes when off |
| Smooth scrolling | on | jump animation |
| Hover preview | on | jump-only when off |
| Node density | adaptive merge | adaptive / off / aggressive |
| Prev/next turn keys | `Alt+ArrowUp` / `Alt+ArrowDown` | e.g. `Ctrl+[` |

The host `cordis.yml` accepts the same keys as documented defaults (the effective values currently come from localStorage).

## Compatibility

- Depends on the de-facto stable anchors the harness itself uses for scrolling: `[data-conversation-scroll]` (scroll container), `[data-chat-anchor-key]` (stable per-message key), `[data-composer-seat]` (composer seat)
- All selectors are centralized in the `SELECTORS` constant of `client.js`; if an anchor goes missing the timeline disables itself and shows a small amber warning dot in the composer instead of crashing
- Verified: the DSH main chat list has no virtual scrolling — every message renders fully. If virtualization is introduced later, this plugin degrades to showing rendered messages only
- Auto-collapses on narrow panes (< 480 px)

## Development & verification

```sh
node verify.mjs              # syntax + unit + wiring tests + benchmark
node tests/model.test.mjs    # pure model layer
node tests/bench.mjs         # 1000-message micro benchmark
```

Manual acceptance checklist:

1. Open a long session (>50 messages); the rail appears on the left edge with short bright user lines, longer assistant lines, tool dots
2. Scroll the chat; the bright band and row highlighting follow; hovering any line shows the preview popover (role/turn/time/first 150 chars)
3. Click a line: the chat smooth-scrolls to center that message, sticky headers do not occlude it, the message flashes for ~1.5 s
4. Click empty rail space: proportional jump
5. Press `Alt+ArrowDown` twice: turn-by-turn navigation
6. Send a message (streaming): the rail grows at the bottom without flickering
7. Fold/unfold a code block, wait for an image: only the affected rows move
8. Switch sessions back and forth: observers and caches are cleaned, no errors, no leftover DOM (`document.querySelectorAll('[data-conversation-backtrack-minimap]')` count is sane)
9. Reload the page: the rail restores
10. Change width/side/density in settings: applies immediately

## Uninstall & rollback

```sh
dsh plugin --profile web remove conversation-backtrack-minimap   # or delete the row in cordis.patch.yml
```

Restart `dsh web`; optionally clear the localStorage key `conversation-backtrack-minimap.settings.v1`. The plugin never mutates message data, so removing it cannot affect original behavior.

## Known limitations

- The `data-*` anchors and slot names are de-facto stable in the current DSH version rather than contractual; after a DSH upgrade, if they change the timeline shows the warning dot and disables itself (never crashes)
- Each pane (e.g. subagent panes) renders its own rail; keyboard shortcuts act on the visible pane
- Hover previews come from the official `ChatSnapshot` data and do not include image/attachment content

## License

MIT
