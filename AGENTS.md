# Vibe Learn Anything — 给 AI 智能体的说明

你在一个 **Vibe Learn Anything** 工作区里。Vibe Learn Anything 是一个桌面学习软件：
它导入 AI 生成的课程文件 **`.vla`**，学习者在里面系统地学习、做练习、写代码，
并且用高亮把疑问交回给 AI。**AI 是课程的作者，也是学习者的助教。**

## 先判断用户要什么

| 用户想要 | 你要读 | 你要做 |
| --- | --- | --- |
| 学一个新东西 / 生成课程 | [`generate_course.md`](generate_course.md) | 先**提问**了解需求，再生成 `.vla` |
| 处理一个 `.vla` 里的高亮 / 注释 / 问题 | [`ai_manual/05-annotations.md`](ai_manual/05-annotations.md) | 回答「问 AI」，按「请 AI 修改」改课程 |
| 修改、扩充已有课程 | `ai_manual/01`–`04` | 解包 → 修改 → 校验 → 打包 |
| 当前目录就是解包后的课程（有 `course.json`） | `ai_manual/05-annotations.md` | 直接在原地修改文件，不要打包 |

## 手册目录（`ai_manual/`）

1. [`01-vla-format.md`](ai_manual/01-vla-format.md) — `.vla` 课程包与 `course.json`
2. [`02-vitent-format.md`](ai_manual/02-vitent-format.md) — `.vitent` 页面包与 Vitent Markdown 语法
3. [`03-vitent-blocks.md`](ai_manual/03-vitent-blocks.md) — 全部组件（测验、代码工作区、PDF、幻灯片……）
4. [`04-actions-buttons.md`](ai_manual/04-actions-buttons.md) — 动作（执行命令 / 请求后端 / 问 AI …）与可扩展按钮
5. [`05-annotations.md`](ai_manual/05-annotations.md) — 高亮、注释（learner / answer）、学习进度，AI 处理流程
6. [`06-code-and-runtimes.md`](ai_manual/06-code-and-runtimes.md) — 代码运行器、测试、终端、环境要求
7. [`07-components.md`](ai_manual/07-components.md) — 软件内置的开源组件与自定义 HTML 组件接口
8. [`08-mcp.md`](ai_manual/08-mcp.md) — MCP 服务器：通过 MCP 客户端直接读取、实时修改学习者软件里的课程

## 工具

`tools/vla.mjs` 是自带的命令行工具（Node.js 18+）。在 AI 工作区里它是打包好的单文件，不需要安装依赖；在源码仓库里先运行一次 `npm install`。

```bash
node tools/vla.mjs new courses/my-course --title "我的课程" --id my-course   # 新建课程骨架
node tools/vla.mjs validate courses/my-course                               # 校验（有错误时退出码为 1）
node tools/vla.mjs pack courses/my-course -o out/my-course.vla              # 校验并打包
node tools/vla.mjs unpack inbox/my-course.vla courses/my-course             # 解包（.vitent 变成文件夹）
node tools/vla.mjs info out/my-course.vla                                   # 查看目录结构
node tools/vla.mjs notes courses/my-course                                  # 列出等待 AI 处理的高亮
node tools/vla.mjs answer courses/my-course h-xxxx --text "回答"            # 以 answer 身份回答一条高亮
```

在 Vibe Learn 内置终端里，`node` 和 `vla` 命令总是可用（软件自带 Node.js）。

## 文件夹约定（AI 工作区）

```
VibeLearn/
├── AGENTS.md  generate_course.md  ai_manual/  tools/vla.mjs
├── courses/<id>/   ← 课程源文件（你在这里写）
├── inbox/          ← 软件导出给你处理的 .vla
└── out/            ← 你打包好的 .vla（软件会自动提示学习者导入）
```

## 铁律

- **每次打包前都要 `validate` 通过**；有 error 就修，不要用 `--force` 交差。
- 课程内容用学习者的语言写（通常是中文），代码标识符保持英文。
- 用 Vitent 组件表达交互，**不要**为普通内容手写 HTML；只有内置组件做不到时才用 `::html` 自定义组件。
- 测验、代码工作区等交互组件一律写明确的 `id`，这样学习者的进度和高亮在你修改课程后仍然对得上。
- 不要删除或改写 `annotations.json` 里作者为 `learner` 的注释，也不要动 `learner/` 文件夹里的学习记录。
