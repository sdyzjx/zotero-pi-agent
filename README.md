# Zotero Pi Agent

基于 [pi agent](https://github.com/earendil-works/pi)（`@earendil-works/pi-agent-core` + `pi-ai`）的 Zotero 7–9 AI 阅读助手插件。核心 agent 循环、模型接入与流式输出全部由 pi 提供，本插件只负责接入 Zotero 相关的工具与界面。

## 功能

**辅助阅读（划词）**
- 在 PDF 中选中文字，选择弹窗下方会出现 π 操作栏：**解释 / 翻译 / 总结 / 问 AI… / 引用到聊天**（可在设置里自定义）。
- 结果显示在选区旁的浮动卡片中，可继续追问、复制，或「保存为高亮批注」。卡片可拖动标题栏移动，拖动任意边或角（右下角有抓手）调整大小，大小会被记住。
- 翻译走快速模型（不开启思考），其余操作在该文章当前会话中由 agent 执行，因此会保留在聊天记录里。

**框图提问 / 看图**
- 阅读器工具栏的 **π⬚** 按钮或 `⌘/Ctrl + Shift + K`：在 PDF 上拖框选择图表、公式或表格，卡片中可选「解释这张图 / 转写内容（公式→LaTeX、表格→Markdown）」或直接提问，并可「保存为图片批注」。框选本身不会创建批注。
- 已有的图片（区域）批注：右键 →「π 问 AI（这张图）」。
- 聊天面板输入框左侧的 📷：框选区域作为图片附件随消息发送（可附多张）。
- Agent 工具 `view_page_image`：agent 可以自己查看某页、某块区域或某个图片批注（先用 `paper_search "Figure 3"` 找页码）。
- 看图需要 DeepSeek V4.1 Flash（支持图片输入）。V4 Pro 只支持文本：发送图片时会话自动切换到 Flash；V4 Pro 会话里调用 `view_page_image` 时，由 Flash 看图并把文字描述返回给 V4 Pro。
- 渲染使用阅读器自带的 pdf.js，按原始颜色输出（不受深色主题影响），长边不超过 1600px。

**文章级聊天面板**
- 拖动标题栏可移动；拖到窗口左右边缘会**自动吸附停靠**（停靠时阅读器会让出空间），拖离边缘恢复浮动。
- 可收起为边缘标签 / 浮动气泡，点击展开；可拖动边缘或四角调整大小。状态会被记住。
- 快捷键 `⌘/Ctrl + Shift + L` 打开 / 关闭；阅读器工具栏的 π 按钮、工具菜单中也有入口。
- 聊天记录**以文章为单位**保存（`<Zotero 数据目录>/zoteropi.sqlite`），同一篇文章下可新建、切换、重命名、删除会话。
- 每轮对话后自动生成会话**标题与结论**（📌 按钮查看），其他文章的会话可以查阅这些结论。
- 每轮回复中的思考与工具调用会折叠成一个「处理过程」块：默认折叠，只显示最新一步（运行中的工具会实时更新），标题显示工具调用次数、失败数、耗时，点击展开全部过程。
- 回复全程流式输出；输入框上方的活动条实时显示当前阶段（等待 / 思考 / 准备调用 / 正在执行的工具及耗时 / 输出回答），消息中的工具卡片显示运行状态与耗时，可展开查看参数与结果。
- 支持 Mermaid 图表：```mermaid 代码块渲染为图（流程图、时序图、类图、思维导图等），流式输出结束后渲染；每张图可切换「源码」、复制、「放大」到独立窗口（缩放 / 拖动）。图表以纯图片显示（不执行脚本），Mermaid 库首次用到时才加载。
- 所有消息支持 Markdown 与 LaTeX 公式（`$…$`、`$$…$$`、`\(…\)`、`\[…\]`，KaTeX 渲染）；`[p. 5](page:5)` 形式的页码引用可点击跳转。

**Agent 工具**

| 类别 | 工具 |
|---|---|
| 当前论文（渐进式披露） | `paper_overview` 结构概览 → `paper_search` 定位 → `paper_read` 按页 / 章节读取（带截断与 offset 续读）、`get_annotations`、`view_page_image`（看页面 / 区域 / 图片批注） |
| 批注 | `create_highlight`（按原文定位到 PDF 字符坐标）、`create_note_annotation`（页边便签）、`update_annotation_comment`、`go_to_page` |
| 文献库 | `library_search`，上述 paper_* 工具均可传 `item_key` 读取其他文献 |
| 历史会话 | `list_sessions`（含结论）、`read_session`、`search_annotations`（全库批注）、`save_conclusion` |
| 笔记 | `create_zotero_note`（Markdown → Zotero 笔记，公式保留） |
| 网络 | `web_search` / `web_fetch`（默认 DeepSeek Search / Fetch API，失败回退 DuckDuckGo / 本地抓取；可选 Tavily、Brave、SearXNG） |
| 学术 | `arxiv_search`、`arxiv_read`（arXiv HTML 全文，按章节读取，公式转 LaTeX）、`scholar_search`（Google Scholar，被拦截时回退 Semantic Scholar） |

pi 本身只内置了 bash / 读写文件等「电脑操作」类工具（在 `pi-coding-agent` 中），按需求未接入；上表工具均为本插件实现。

**模型**：DeepSeek V4.1 Flash（`deepseek-flash`，默认）与 DeepSeek V4 Pro（`deepseek-v4-pro`），来自 pi-ai 的 DeepSeek provider；设置中可添加其他 DeepSeek 模型 ID。每个会话可单独切换模型与思考强度。

## 安装

1. `npm install && npm run build`，得到 `build/zotero-pi-agent-<version>.xpi`。
2. Zotero → 工具 → 插件 → 齿轮 → 「从文件安装插件…」，选择该 xpi。
3. 打开 Zotero 设置 → **Pi Agent**（或 工具 → Pi Agent 设置…），填入 DeepSeek API Key，点「测试连接」。

**预置 API Key（本地构建）**：复制 `.env.example` 为 `.env`（已在 `.gitignore` 中，不会提交）：

```
DEEPSEEK_API_KEY=sk-...
```

构建时会把它写入插件的默认偏好，安装后无需再填写（设置页中修改会覆盖默认值）。这样生成的 xpi 内含 Key，请勿分享。

## 开发

```bash
npm run typecheck   # TypeScript 检查
npm test            # 纯逻辑单元测试（原文定位、标题识别、Markdown 公式）
npm run build:dev   # 开发构建（含 sourcemap 与本地调试端点）
```

开发构建会在 Zotero 本地服务器上注册 `POST /zoteropi/eval` 调试端点（仅 `build:dev`，正式构建不包含），用于自动化集成测试。

### 结构

```
addon/                 插件静态文件（manifest、bootstrap、prefs、HTML/CSS）
src/core/              运行在插件沙箱中的核心
  llm.ts               pi-ai 模型 / DeepSeek provider / API Key 注入
  sessions.ts          每个会话一个 pi Agent；持久化、快照、自动结论
  tools/               agent 工具（论文、批注、文献库、网络、学术）
  paper.ts text.ts     全文抽取（PDFWorker，按页）、标题识别、搜索、原文匹配
  annotate.ts          高亮 / 便签写入（Zotero.Annotations.saveFromJSON）
  ui/                  主窗口浮动面板、划词卡片、阅读器钩子
src/web/               聊天界面与设置页（Preact，chrome:// 页面）
src/shared/markdown.ts markdown-it + 数学公式扩展（关闭原始 HTML）
```

## 说明

- API Key 以明文保存在 Zotero 偏好设置（`prefs.js`）中。
- DeepSeek Search / Fetch 按次计费（约 $0.75 / 千次成功请求），可在设置中改用免费的 DuckDuckGo / 本地抓取。
- 自动创建高亮需要 PDF 附件；agent 会在后台打开阅读器以获取字符坐标。
