# 08 · MCP 服务器：直接读写学习者的课程库

01–05 章的流程是「导出 `.vla` → AI 处理 → 打包 → 导入」。如果你（AI 智能体）运行在支持
**MCP（Model Context Protocol）** 的客户端里，可以省掉这一圈：Vibe Learn Anything 自带一个 MCP 服务器，
让你直接读取学习者软件里**已导入的课程**，看到学习者**此刻**正在看哪一页、选中了什么、写了什么代码，
并且**实时修改**课程——保存后软件立刻刷新页面。

| 方式 | 适合 |
| --- | --- |
| MCP（本章） | 学习者正在软件里学习：即时回答问题、改讲解、加练习、看学习者的代码 |
| `.vla` 文件流程（01–05） | 生成一门新课程、大规模改版、离线处理 |

## 启动

```bash
node tools/vla.mjs mcp --data "<数据目录>"
```

- 传输方式是 **stdio**：标准输入 / 输出上每行一条 JSON-RPC 2.0 消息。stdout 只输出协议消息，日志写到 stderr。
- 不需要安装任何依赖（AI 工作区里的 `tools/vla.mjs` 是打包好的单文件）。在软件内置终端里 `vla mcp` 也可以。
- 一般不用手动启动：MCP 客户端会按下面的配置自己启动它。
- 软件不开着也能用（服务器只读写文件）；但只有软件开着时 `live.json` 才会更新。

### 数据目录

按顺序取第一个：`--data <目录>` → 环境变量 `VLA_DATA` → 软件默认的配置目录：

| 系统 | 默认数据目录 |
| --- | --- |
| Windows | `%APPDATA%\Vibe Learn Anything` |
| macOS | `~/Library/Application Support/Vibe Learn Anything` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/Vibe Learn Anything` |

```text
<数据目录>/
├── library/<课程id>/     ← 每门已导入的课程，已解包：course.json、*.vitent 文件夹、annotations.json、learner/
├── library.json          ← 课程索引（软件内部用，可能不存在）
└── live.json             ← 学习者此刻在看什么（软件实时写入）
```

## 客户端配置

大多数 MCP 客户端用这样的 JSON 配置（文件位置和外层字段名以客户端文档为准）：

```json
{
  "mcpServers": {
    "vibe-learn": {
      "command": "node",
      "args": ["C:/Users/me/Documents/VibeLearn/tools/vla.mjs", "mcp"],
      "env": { "VLA_DATA": "C:/Users/me/AppData/Roaming/Vibe Learn Anything" }
    }
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `command` | Node.js（18+）可执行文件，`node` 或完整路径 |
| `args` | `tools/vla.mjs` 的**绝对路径**，加上 `mcp`；也可以再加 `--data <目录>` |
| `env.VLA_DATA` | 数据目录。使用默认目录时可以省略 |

**软件的「设置」页可以自动把这段配置安装到常见的 MCP 客户端里**，学习者通常不需要手写。

## `live.json`：学习者此刻在看什么

软件在学习者切换页面、选中文字、移动光标时写入。所有字段都可能缺失：

| 字段 | 说明 |
| --- | --- |
| `view` | 当前界面：`lesson`（学习页）、`course`（课程页）、`dashboard`（首页）、`settings` |
| `courseId` / `courseTitle` | 当前课程 |
| `chapterId` / `chapterTitle` | 当前章节 |
| `page` / `pageTitle` / `pageIndex` | 当前页面路径（如 `content/w1/workspace.vitent`）、标题、在本章中的序号 |
| `selection` | 选中的内容：`{ "text", "source": "page" \| "code" }`（页面正文或代码编辑器） |
| `workspace` | 当前代码工作区：`{ "id", "file", "language", "cursorLine", "selection", "code" }`，`code` 是编辑器里**当前**的代码（可能还没保存） |
| `updatedAt` | 写入时间（ISO） |

`get_current_context` 会读取它，并补充：

| 字段 | 说明 |
| --- | --- |
| `ageSeconds` | 距离 `updatedAt` 过了多少秒。很久以前的数据说明软件可能已经关了 |
| `courseAiContext` | `course.json` 的 `ai.context`（学习者画像） |
| `openHighlights` | 这一页 `status: "open"` 的高亮，含全部注释 |
| `workspaceDir` / `workspaceFiles` | 学习者在这一页写的代码：`learner/workspaces/<页面键>/` 下的文件 |
| `pageFiles` | 页面文件夹里除 `index.md` 外的文件 |
| `notes` | 提示（例如没有打开页面、页面不在 `course.json` 里） |

最后附上这一页 `index.md` 的原文。`live.json` 不存在时，说明软件现在没有打开任何页面，用 `list_courses` / `get_course` 浏览。

## 工具

所有路径都相对于**课程根目录**，用 `/` 分隔；页面路径以 `.vitent` 结尾。`course_id` 是课程文件夹名（`list_courses` 可以查到）。
出错（参数不对、课程或页面不存在、校验不通过、被拒绝的路径）时，结果带 `isError: true` 和原因，**不会写入任何东西**。

### 只读

| 工具 | 参数 | 作用 |
| --- | --- | --- |
| `get_current_context` | — | 学习者此刻在看什么（见上）。**每次先调用它** |
| `list_courses` | — | 所有课程：`id`、`title`、`code`、`version`、页数、`openAskRevise`（等待处理的 ask / revise 高亮数） |
| `get_course` | `course_id` | 课程大纲：单元 → 章节（`id` `title` `kind`）→ 页面（`src` `title` `kind`），以及 `aiContext` |
| `read_page` | `course_id`、`page` | 页面 `index.md` 原文 + 所在章节、标题、页面文件夹里的其他文件、open 高亮数 |
| `list_annotations` | `course_id`，可选 `status`、`kind`、`page` | 高亮列表（含 `targets` 和 `comments`），可按状态 / 类型 / 页面筛选 |
| `validate_course` | `course_id` | 完整校验（同 `node tools/vla.mjs validate`），返回 error 和 warning |
| `list_files` | `course_id`，可选 `dir` | 递归列出文件和大小（跳过 `node_modules` `.git`，最多 500 条，用 `dir` 缩小范围） |
| `read_file` | `course_id`、`path` | 读取文本文件：`course.json`、资源、脚本、`learner/progress.json`、学习者代码……二进制文件和超过 1 MB 的文件会被拒绝 |

### 写入

| 工具 | 参数 | 作用 |
| --- | --- | --- |
| `edit_page` | `course_id`、`page`、`old_text`、`new_text`，可选 `replace_all` | 在 `index.md` 里做**精确替换**。`old_text` 必须原样出现且只出现一次（否则加上更多上下文，或设 `replace_all: true`）。换行符自动匹配。会引入 Vitent error 的修改不写入 |
| `write_page` | `course_id`、`page`、`text` | 用 `text` 替换整个 `index.md`（含 frontmatter）。先校验，有 error 不写入；成功后返回 warning（包括引用了但还不存在的资源） |
| `create_page` | `course_id`、`chapter_id`、`name`、`text`，可选 `title`、`after` | 新建 `<文件夹>/<name>.vitent/index.md`（文件夹 = 该章第一页所在的文件夹，章节为空时是 `content/<chapter_id>`），并加入 `course.json` 中该章的 `pages`：放在 `after` 指定的页面之后，默认放在最后。条目写法跟随相邻条目（字符串或 `{ "src", "title" }`）。`title` 在 frontmatter 没有标题时写进 frontmatter |
| `reply_annotation` | `course_id`、`highlight_id`、`text`，可选 `status` | 给高亮追加一条 `author: "answer"` 的注释（Markdown），并更新 `updated`。`status` 默认：`ask` → `answered`，`revise` → `applied`，其他类型不变 |
| `write_file` | `course_id`、`path`、`content` | 写一个文本文件（资源、代码初始文件、脚本、自定义组件、`course.json`……），自动创建文件夹。页面的 `index.md` 按 `write_page` 的规则校验；`course.json` 必须是合法 JSON |

`write_file` **拒绝**：`learner/` 下的任何路径（学习者的数据只读）、`annotations.json`（用 `reply_annotation`）、课程文件夹以外的路径。

## 推荐流程

**回答问题（`ask`）**

1. `get_current_context` → 看 `openHighlights`、`selection`、`workspace.code`。
2. 需要时 `read_page`、`read_file` 读学习者的代码（`learner/workspaces/<页面键>/<工作区id>/…`）和 `learner/progress.json`。
3. `reply_annotation` 回答。按 [05](05-annotations.md) 的要求写：针对学习者的问题和水平，结合高亮原文。

**按要求修改（`revise`）或主动改进**

1. `read_page` 拿到原文。
2. 小改用 `edit_page`，整页重写用 `write_page`，新资源用 `write_file`，新页面用 `create_page`。
3. `validate_course` 确认没有 error。
4. 如果是 `revise` 高亮：用 `reply_annotation` 简短列出改了什么，状态自动变成 `applied`。
   MCP 不修改高亮的 `targets`；被高亮的原文改写后，软件会显示「原文已改动」，这是正常的。

## 规则

- **每次修改后 `validate_course` 都要没有 error。** 写入工具会先校验，有 error 就不写入——按返回的行号修好再写，不要绕过。
- **不要删除或改写 `learner` 的注释**，只用 `reply_annotation` 追加 `answer`。
- **`learner/` 只读**：可以读来了解学习者，不能写。
- 保持**组件 id 和页面路径稳定**，学习者的进度、代码和高亮都靠它们对应。
- 修改是**实时**的，学习者可能正看着这一页：一次改完一处，别让页面停在半成品状态。
- 内容用学习者的语言写（通常是中文），代码标识符保持英文；用 Vitent 组件表达交互（见 [02](02-vitent-format.md)、[03](03-vitent-blocks.md)）。
- 原地修改不经过导入合并，`course.json` 的 `version` 可以不改；改动较大时仍建议把最后一位 +1。
