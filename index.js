// conversation-backtrack-minimap —— 宿主半边。
// 本插件是纯 client 插件：宿主只声明默认配置（供 cordis.yml 校验/覆盖），
// 不做任何网络、遥测或数据访问。实际生效的设置保存在浏览器 localStorage，
// 由设置页读写；宿主 Config 只用于文档化默认值与将来可能的服务端覆盖。
import z from "@deepseek-ai/schemastery";

export const Config = z.object({
  /** 是否启用时间轴。 */
  enabled: z.boolean().default(true),
  /** 时间轴所在侧：left | right。 */
  side: z.string().default("left"),
  /** 时间轴宽度（px）。 */
  width: z.number().default(10),
  /** 是否显示工具调用节点。 */
  showToolCalls: z.boolean().default(true),
  /** 点击跳转是否平滑滚动。 */
  smoothScroll: z.boolean().default(true),
  /** 是否显示悬停预览浮层。 */
  showHoverPreview: z.boolean().default(true),
  /** 节点密度：adaptive | off | aggressive。 */
  density: z.string().default("adaptive"),
  /** 上一轮快捷键，形如 Alt+ArrowUp。 */
  prevKey: z.string().default("Alt+ArrowUp"),
  /** 下一轮快捷键，形如 Alt+ArrowDown。 */
  nextKey: z.string().default("Alt+ArrowDown"),
});

export function apply() {
  // 宿主侧无逻辑。
}

export default apply;
