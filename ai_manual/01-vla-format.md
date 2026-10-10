# 01 · `.vla` 课程包与 `course.json`

`.vla`（Vibe Learn Archive）就是一个 **zip 压缩包**。根目录必须有 `course.json`。

```text
my-course.vla
├── course.json                 ← 必需：课程信息与结构
├── content/                    ← 页面（每页一个 .vitent）
│   ├── w1/intro.vitent         ← 可以是 zip 文件，也可以是文件夹
│   └── w1/workshop.vitent
├── assets/                     ← 全课程共享的资源（页面里用 @/assets/... 引用）
├── annotations.json            ← 学习者的高亮与注释、AI 的回答（软件写入，见 05）
└── learner/                    ← 学习进度、测验记录、写过的代码（软件写入，见 05）
```

- `.vitent` 在 `.vla` 里可以是**嵌套的 zip 文件**（打包工具的默认做法），也可以是**文件夹**。软件导入时会把它们统一展开成文件夹。
- 用 `node tools/vla.mjs pack <文件夹>` 打包、`unpack` 解包，工具会处理嵌套 zip，你只需要编辑文件夹。
- 不要依赖文件名大小写；路径分隔符一律用 `/`。

## `course.json`

```json
{
  "vla": 1,
  "id": "c-revival",
  "title": "C 语言复习",
  "code": "C101",
  "subtitle": "为 Algorithms and Data Structures 做准备",
  "description": "这门课帮你在两周内捡回 C 语言。**每页约 15 分钟。**",
  "color": "#2f6fb3",
  "icon": "code-xml",
  "version": "1.0.0",
  "language": "zh-CN",
  "term": "2026 Semester 2",
  "ai": { "context": "学习者是大二学生，学过 C 但半年没写，目标是 COMP20003 的作业。喜欢简洁的解释和大量练习。" },
  "requirements": [
    { "name": "gcc", "hint": "Windows：安装 [MSYS2](https://www.msys2.org/) 后运行 `pacman -S mingw-w64-ucrt-x86_64-gcc`，并把 `C:\\msys64\\ucrt64\\bin` 加入 PATH。" }
  ],
  "units": [
    {
      "id": "week-0",
      "title": "Week 0",
      "description": "热身",
      "chapters": [
        {
          "id": "w0-revival",
          "title": "Week 0: Short Revival",
          "kind": "lesson",
          "due": "2026-10-23T23:59",
          "description": "基本语法、字符串、数组",
          "pages": [
            "content/w0/checking.vitent",
            { "src": "content/w0/basics.vitent", "title": "W0.1: Some Basic Features of C", "kind": "pdf" }
          ]
        }
      ]
    }
  ],
  "runners": {},
  "actions": {},
  "buttons": [],
  "hide": []
}
```

### 字段

| 字段 | 必需 | 说明 |
| --- | :---: | --- |
| `vla` | | 格式版本，写 `1` |
| `id` | ✓ | 课程唯一 id：小写字母、数字、`-` `_` `.`。**同一门课更新时 id 不变**，软件据此保留学习者的进度和笔记 |
| `title` | ✓ | 课程名 |
| `code` | | 课程卡片上的短代号（如 `COMP20003`），没有就显示标题 |
| `subtitle` | | 副标题 |
| `description` | | 课程介绍，Markdown |
| `color` | | 主题色 `#rrggbb`，用于课程卡片左侧色条和图标 |
| `icon` | | 课程图标，[Lucide](https://lucide.dev/icons/) 图标名（如 `book-open`、`code-xml`、`flask-conical`） |
| `version` | | 语义化版本。**每次修改课程都把最后一位 +1** |
| `language` | | 内容语言，如 `zh-CN`、`en` |
| `term` | | 学期，如 `2026 Semester 2`。课程被归档后按学期分组 |
| `ai.context` | | 学习者画像和课程背景。软件里「问 AI」时会发给 AI |
| `requirements` | | 需要的命令行工具：`{ "name": "gcc", "check": "gcc", "hint": "Markdown 安装说明" }`。`check` 默认等于 `name`。缺少时课程页会显示提示 |
| `units` | ✓ | 单元列表（见下） |
| `chapters` | | 没有单元时可以直接写章节列表，软件会当成一个无标题单元 |
| `runners` | | 覆盖或新增代码运行器，见 [06](06-code-and-runtimes.md) |
| `actions` | | 全课程可用的动作，见 [04](04-actions-buttons.md) |
| `buttons` | | 全课程的扩展按钮，见 [04](04-actions-buttons.md) |
| `hide` | | 隐藏的内置按钮 id 列表，如 `["edit"]` |

### 单元 `units[]`

| 字段 | 说明 |
| --- | --- |
| `id` | 单元 id（唯一） |
| `title` | 显示在课程页的分组标题，如 `Week 1` |
| `description` | 可选，小字说明 |
| `chapters` | 章节列表 |

### 章节 `chapters[]`

章节就是课程页里的一行（点进去是左侧有页面列表的学习界面）。

| 字段 | 说明 |
| --- | --- |
| `id` | 章节 id，**全课程唯一** |
| `title` | 章节名 |
| `kind` | 图标类型：`lesson` `reading` `code` `lab` `quiz` `video` `slides` `project` `survey` |
| `icon` / `color` | 可选，覆盖图标（Lucide 名）和图标底色 |
| `due` | 可选，截止时间 ISO 格式 `2026-10-23T23:59` |
| `description` | 可选，标题下的小字 |
| `pages` | 页面列表：字符串路径，或 `{ "src", "title", "kind", "icon" }`（这里写的会覆盖页面自己的 frontmatter） |

页面路径都相对于 `.vla` 根目录，以 `.vitent` 结尾。**一个页面只属于一个章节。**

## 完成状态

学习者每页的完成状态由页面的 `complete` 规则决定（见 [02](02-vitent-format.md)）。
一章所有页面完成 → 课程页显示 ✓；部分完成 → 显示 ●；未开始 → ○。

## 更新一门已导入的课程

导入一个 `id` 相同的 `.vla` 时，软件会问学习者「更新」还是「另存为副本」。更新时：

- 用新包替换 `course.json`、`content/`、`assets/` 等全部课程内容；
- **保留**学习者本地的 `learner/`（进度、代码），并与包里的 `learner/` 合并；
- `annotations.json` 按高亮 id 合并：同一高亮取 `updated` 较新的版本，评论按评论 id 取并集。

所以修改课程时：**保持页面路径和组件 id 稳定**，必要时才重命名。

## 校验

```bash
node tools/vla.mjs validate courses/<id>
```

会检查：JSON 格式、id、章节与页面是否存在、每页的 frontmatter 与指令语法、引用的资源是否存在、动作与按钮的定义、`annotations.json` 的格式。
