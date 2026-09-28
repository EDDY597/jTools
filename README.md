# jTools — 无广告的 uTools 风格启动器

一个用 Electron 实现的极简、无广告的效率启动器（复刻 uTools 核心体验）：

- **无广告、无插件市场、无账号、无追踪**——装完即用，数据全部存在本地
- **一个输入框搜一切**：程序名 / 应用名（含 UWP 商店应用）/ 文件名 / 插件名，支持拼音与拼音首字母（如输入 `jsq` 找到「计算器」）
- **文件搜索自动接入 Everything**（若本机装有 Everything 且在运行，通过其官方 es.exe CLI 全盘实时搜索；未装则回退内置的桌面/文档/下载索引）
- **内置快速翻译插件**：输入 `fy`（或 `翻译` / `translate`）回车进入，输入文本即时翻译，中英自动互译，Google → MyMemory → 百度多引擎自动回退（无需任何 API Key 即可使用）
- 智能动作：输入网址直接打开、输入本地路径直接打开文件/文件夹
- 呼出全局快捷键、失焦自动隐藏、托盘常驻、开机自启、最近使用记录

## 快捷键

| 按键 | 作用 |
|---|---|
| `Alt+Space`（可在设置中修改） | 全局呼出 / 隐藏窗口 |
| 输入 `fy` + 空格 + 文本 + 回车 | 直接进入翻译并翻译该文本 |
| `↑` / `↓` / `Tab` | 在结果间移动 |
| `Enter` | 执行选中项 |
| `Ctrl+P` 或右键 | 固定 / 取消固定选中项（固定后永远显示在输入框下方首位） |
| `Esc` | 清空输入 → 退出插件 → 隐藏窗口（分步退出） |
| `Ctrl+,` / 托盘菜单 | 打开设置 |

> 注：若 `Alt+Space` 被其他程序占用（如同时运行着原版 uTools），应用会自动回退到下一个可用快捷键（Alt+Q → Alt+T → …），可在 设置 → 通用 中查看当前生效的键。

## 运行

```bash
pnpm install      # 或 npm install（electron 二进制走本地缓存）
pnpm start        # 开发运行
pnpm dist         # 打包 Windows 安装包（输出到 dist/）
```

## 使用方法

1. 启动后窗口隐藏在托盘，按 `Alt+T` 呼出（建议在 设置 → 通用 中开启开机自启）
2. 直接输入即可搜索：应用（开始菜单 + UWP）、桌面/文档/下载中的文件、内置插件
3. 右键或 `Ctrl+P` 固定常用应用/文件——固定项永远排在输入框下方第一位，右键「取消固定」可移除
4. 输入 `fy` 回车进入翻译插件，继续输入即实时翻译；`Esc` 分步返回
5. 托盘右键可打开设置、切换开机自启、退出

## 翻译引擎

- 默认使用免 Key 的 Google(gtx) 与 MyMemory 公共接口，二者以竞速方式取最快成功者，并记住本次成功的引擎（粘性优先）
- 网络受限时自动回退；也可在 设置 → 翻译 中填入自己的百度翻译 APPID/密钥 获得国内直连稳定通道
- 所有请求在主进程发起，无广告、无统计

## 文件搜索

- **Everything 模式（推荐）**：本机装有 Everything（voidtools）且正在运行时，文件搜索通过 Everything 官方命令行 `es.exe` 全盘实时完成——任意目录、实时变化、毫秒级响应，结果区标题显示「文件 · Everything」。es.exe 默认从 voidtools 官网下载后放入数据目录（`设置 → 文件搜索` 可自定义路径并重新检测）。
- **内置索引模式（回退）**：未检测到 es.exe 时使用本地索引（桌面 / 文档 / 下载，可在设置中自定义目录），支持文件名与拼音首字母匹配。

## 目录结构

```
src/main/          主进程：窗口管理、应用扫描、文件索引、翻译服务、IPC
src/preload/       contextBridge 暴露给渲染层的 API
src/renderer/      搜索界面（原生 HTML/JS，无构建步骤）
plugins/translate/ 快速翻译插件（iframe 运行，postMessage 桥接）
assets/            应用图标、托盘图标
```

## 插件机制

`plugins/<id>/plugin.json` 声明插件名称、关键字、入口页面：

```json
{
  "name": "快速翻译",
  "keywords": ["翻译", "fy", "translate"],
  "entry": "index.html",
  "subInputPlaceholder": "输入要翻译的文本…"
}
```

输入关键字（或拼音）命中后回车进入插件页面（宿主内嵌 iframe），顶部搜索框自动变为插件的子输入框，内容实时转发给插件；插件通过 `plugins/translate/api.js` 同款桥接脚本调用宿主能力（`ztool.translate` / `ztool.request` / `ztool.copyText` / `ztool.setHeight` 等）。

## 致谢

架构参考了开源项目 [ZTools](https://github.com/ZToolsCenter/ZTools)（MIT）：开始菜单/UWP 应用扫描思路、失焦隐藏与分步 Esc 交互、动态窗口高度等设计均借鉴自该项目。
