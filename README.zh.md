# dsh-session-pin

把 DeepSeek Harness 的会话「置顶」到侧边栏顶部独立分组，形态对齐 Codex 的置顶分组：位于 **新会话按钮之下、工作区列表之上**，与工作区里的原生列表互不干扰。

[English](README.md)

## 交互

| 动作 | 入口 |
| --- | --- |
| 置顶一个会话 | 在任意原生会话行上 **右键** → 「置顶会话」 |
| 取消置顶 | 置顶行上的 **✕**，或在置顶行右键 → 「取消置顶」 |
| 打开会话 | 点击置顶行（走 `uiWorkspace.openSession`，与原生行同一导航入口） |
| 收起 / 展开分组 | 点击分组表头；状态存在 `localStorage` |

文案跟随文档语言：界面语言为中文时用中文，否则用英文。

### 状态点

每个置顶行带与原生会话行一致的主状态指示，被置顶的会话不会「看不出在忙」：

| 指示 | 含义 |
| --- | --- |
| 转圈 | 智能体正在跑一轮任务 |
| 琥珀色圆点 | 在等你 —— 审批、计划评审或提问 |
| 绿色圆点 | 你不在时它跑完了 |
| *（无）* | 空闲 |

优先级与原生行一致：待交互压过活动状态。会话列表（`running` 位）与待交互 store 两处都会触发重绘，所以指示会自己出现、自己清除。

转圈是照着 shell 自带状态点重建的（同一套 `data-state` 契约、同样的轨道/圆弧几何、同样 1.5s 旋转，并在 `prefers-reduced-motion` 下停止）：原语包对第三方插件不是运行时可解析依赖，因此本地重建而不是 import。

置顶集合持久化在 `<DSH_HOME>/dsh-session-pin.json`（默认 `~/.dsh/dsh-session-pin.json`），重启与切换 profile 重载后都保留。

## 原理

DSH 侧边栏 shell 只声明六个插槽 —— `sidebar.brand.mark`、`sidebar.brand.name`、`sidebar.panellist`、`sidebar.workspaces`、`sidebar.settings`、`sidebar.footer.action` —— **没有本插件需要的位置**。`sidebar.workspaces` 还是已被 `ui-workspace` 独占的单占位洞，抢占它等于重写整个工作区浏览器（搜索、拖拽、工作区管理）。

因此本插件采用侧边栏家族插件的既有手法：一个普通 DOM 节点插到 sidebar 根内「工作区区域之前」，由 `MutationObserver` 在 React 重渲染后自愈，不进入 React 协调树。

- **host 半**（`lib/index.js`）：置顶集合的唯一真源 + `/dsh-session-pin/{state,pin,unpin,reorder}` JSON 路由，写入走 temp file + rename。
- **client 半**（`client/client.js`）：分组渲染与交互。行标题/时间读运行时 `sessions.list` 快照（不自行缓存标题），打开会话走 `uiWorkspace.openSession`。

已删除会话的 id 会留在文件里、渲染时跳过，因此删会话不会破坏置顶集合。

## 安装

本包同时声明 `dsh.bundle.patch` 与 `dsh.client`，因此走 **bundle 依赖** 这条官方路径即可：装成 profile 的 dependency，它自带的 patch 会作为一层 bundle layer 插进插件树。**不要再手写 profile `cordis.patch.yml` 的 `insert` 行** —— 两个相同 `dsh-session-pin` id 的 insert 会让 boot 直接失败（`duplicate loader entry id`）。

```bash
dsh plugin --profile <name> add link:/path/to/dsh-session-pin
```

或者手改 profile 清单：

```json
{
  "dependencies": { "dsh-session-pin": "link:/path/to/dsh-session-pin" },
  "dsh": { "profile": { "bundles": ["…", "dsh-session-pin"] } }
}
```

然后：

```bash
cd ~/.dsh/profiles/<name> && pnpm install --ignore-scripts
```

两条都要写：`dependencies` 决定包能被解析，`dsh.profile.bundles` 决定它的 patch 层被加载（`dsh plugin add` 会自动补两者）。

插件只依赖 `webServer` 与 `uiWorkspace` 两个服务，任何能起 Web 界面的 profile 都适用。

装完重启应用（或宿主）：`/dsh-session-pin/state` 返回 200，侧边栏渲染后出现置顶分组。

> `desktop` profile 由 Electron 应用独占管理（`dsh --profile desktop` 直接报 `managed exclusively by the Electron application`）。在应用内插件页安装，或手改上面两个文件。刷新页面不够 —— 运行中的宿主不会重读 `dsh.profile.bundles` 与 `node_modules`。

## 已知边界

- 只有原生会话行能取到 session id，靠 React fiber 的 `memoizedProps.node.id` 读取，属未公开接口。上游改掉行结构时，右键菜单会静默失效（不抛错），置顶行本身仍可用。
- 收起态（窄图标栏）下分组隐藏。
- 不支持拖动排序；`/reorder` 路由已就绪但没有 UI 调它。

## License

[MIT](LICENSE)
