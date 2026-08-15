# conversation-backtrack-minimap

[English](README.md) | 中文

DeepSeek Harness 插件：**长对话左侧回溯时间轴（minimap）**。在正文左缘（可切右侧）显示一条纵向缩略时间轴，每条横线代表一条消息，按消息在对话中的真实位置排列；悬停预览内容、点击跳转定位、随滚动同步高亮当前位置。

它不是长期记忆、RAG、摘要或分支功能——只做导航。

## 功能

- **消息分布导轨**：用户消息=白色满宽粗线（3px）；助手消息=蓝色长线（回答越长线越长）；工具调用=橙色圆点；密集消息自动合并为灰色短粗组（悬停展开）；系统角色（压缩/命令/错误/轮尾）不显示；当前视口对应区域由亮带标出
- **悬停预览**：深色圆角浮层显示角色、轮次、时间与前 150 字符；自动避开窗口边缘
- **点击跳转**：点击横线平滑滚动到对应消息并精确居中（补偿滚动容器内容原点与 sticky 头部），消息短暂高亮 1.5 秒；点击空白区域按比例跳转
- **滚动同步**：passive scroll + rAF 节流，视口内消息行提亮；程序滚动与用户滚动不会互相触发
- **轮次快捷键**：默认 `Alt+ArrowUp` / `Alt+ArrowDown` 跳转上一轮/下一轮（可改）
- **动态更新**：流式生成、新消息、工具开始/结束、代码折叠、图片加载、切换会话、刷新、"加载更早"全部增量处理，不重建整条时间轴
- **性能**：1000 条消息下索引派生约 1.5 ms（仅节点增删时重算）；几何更新走 ResizeObserver + 增量前缀和，只重算变化行后缀
- **隐私**：全部索引在本地生成，无网络、无遥测、不改消息数据、不拦截模型请求

## 验收记录（v0.2.0，2026-08-15）

- 环境：DSH 0.1.0-rc.6，默认 web profile，实测会话 110+ 条消息
- 已逐项验收：导轨渲染（白/蓝/橙/灰组）、悬停预览、点击居中跳转+1.5s 高亮、空白比例跳转、滚动同步亮带、`Alt+↑/↓` 轮次导航、流式追加、切会话清理、刷新恢复、设置页即时生效
- 沙箱合规：动态插件禁用浏览器 `setTimeout/setInterval/fetch`，本插件声明 `inject: ['timer']` 使用 `ctx` 计时器；会话数据走 `sessions` 服务订阅（Slot prop `useSession` 回退）；条目按 DOM 行顺序对齐，快照缺失行以隐藏占位补齐
- 性能实测（node 微基准，1000 条消息）：entriesOf 1.49 ms、displayRows 0.02 ms、indexAt ~0 ms、前缀和全量 0.004 ms

## 安装

```sh
dsh plugin --profile web add github:<owner>/conversation-backtrack-minimap
```

或在 profile patch 层（`$DSH_HOME/profiles/web/cordis.patch.yml`）手动加：

```yaml
- insert:
    - id: conversation-backtrack-minimap
      name: 'conversation-backtrack-minimap'
```

重启 `dsh web`。插件需要默认 web 组合的 `conversation.input.right` 与 `settings.section` 槽位（默认 profile 均具备）。

## 配置

设置页（设置 → 对话时间轴）即时生效，保存在浏览器 localStorage（`conversation-backtrack-minimap.settings.v1`）：

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| 启用时间轴 | 开 | 关闭后彻底不渲染 |
| 显示位置 | 左 | left / right |
| 时间轴宽度 | 10 px | 6–20 px |
| 显示工具调用 | 开 | 关闭后工具节点不出现 |
| 平滑滚动 | 开 | 点击跳转动画 |
| 悬停预览 | 开 | 关闭后只跳转不预览 |
| 节点密度 | 自适应合并 | adaptive / off / aggressive |
| 上一轮/下一轮快捷键 | `Alt+ArrowUp` / `Alt+ArrowDown` | 形如 `Ctrl+[` |

宿主 `cordis.yml` 里可写同样的键作为文档化默认值（当前版本实际生效值以 localStorage 为准）。

## 兼容性

- 依赖的事实稳定锚点（harness 自身滚动逻辑也在用）：`[data-conversation-scroll]`（滚动容器）、`[data-chat-anchor-key]`（消息行稳定 key）、`[data-composer-seat]`（输入栏）
- 全部选择器集中在 `client.js` 的 `SELECTORS` 常量中；锚点缺失时时间轴自动停用，并在输入栏显示黄色警示点
- 已核实：DSH 主聊天列表无虚拟滚动，每条消息全量渲染；若未来引入虚拟滚动，本插件将降级为只显示已渲染消息
- 窄窗口（正文区 < 480px）自动折叠隐藏

## 开发与验证

```sh
node verify.mjs              # 语法 + 单元测试 + 接线测试 + 性能基准
node tests/model.test.mjs    # 纯模型层
node tests/bench.mjs         # 1000 条消息微基准
```

手工验收清单：

1. 打开一个长会话（>50 条消息），左缘出现时间轴，用户短亮线/助手长线/工具圆点
2. 滚动正文，亮带与行提亮跟随移动；悬停任意横线出现预览浮层（角色/轮次/时间/前 150 字）
3. 点击一条横线，正文平滑滚动到该消息中部且不被 sticky 头部遮挡，消息高亮约 1.5 秒
4. 点击时间轴空白处，按比例跳转
5. 按 `Alt+ArrowDown` 两次，逐轮跳转
6. 发送新消息（流式生成）：时间轴底部实时增长，无整轴闪烁
7. 展开/折叠一个代码块、等图片加载：只有对应行位移，其余不动
8. 切换到另一个会话再切回：观察器与缓存被清理，无报错、无残留 DOM（`document.querySelectorAll('[data-conversation-backtrack-minimap]')` 数量正常）
9. 刷新页面：时间轴恢复
10. 设置页改宽度/位置/密度：即时生效

## 卸载与回滚

```sh
dsh plugin --profile web remove conversation-backtrack-minimap   # 或从 cordis.patch.yml 删除该行
```

删除后重启 `dsh web` 即完全移除；可再清掉 localStorage 键 `conversation-backtrack-minimap.settings.v1`（可选）。插件不修改任何消息数据，卸载不影响原有功能。

## 已知限制

- `data-*` 锚点与槽位名是当前 DSH 版本的事实稳定接口而非契约，升级 DSH 后若失效，时间轴会以警示点提示并停用（不崩溃）
- 多窗格（子代理等）各渲染各的时间轴，互不干扰；快捷键作用于可见窗格
- 悬停预览文本来自官方 `ChatSnapshot` 数据，不含图片/附件内容

## 许可证

MIT
