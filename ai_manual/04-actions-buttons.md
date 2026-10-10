# 04 · 动作与按钮

**动作（action）** 是课程预先写好、学习者一点就执行的操作：执行命令、运行脚本、请求后端接口、问 AI、操作界面……
**按钮（button）** 把动作放到界面上的某个位置。软件里几乎所有按钮都可以被课程扩展、覆盖或隐藏。

## 定义动作

在 `course.json` 的 `actions`（全课程）或页面 frontmatter 的 `actions`（本页，同名时优先）里定义：

```yaml
---
title: 编译与运行
actions:
  build:
    type: exec
    label: 编译
    command: gcc -Wall -o hello{exe} hello.c
    cwd: page
  hello:
    type: exec
    command:
      win: .\hello.exe
      posix: ./hello
    output: terminal
---
```

使用动作：`::button[编译]{action="build"}`、`:btn[运行]{action="hello"}`、按钮的 `action` 字段、HTML 组件的 `vla.run('build')`。
也可以不定义 id，直接写内联对象（在 YAML/JSON 里）。

### 动作类型

#### `exec` — 执行命令

| 字段 | 说明 |
| --- | --- |
| `command` | 命令字符串，或 `{ "win": "…", "posix": "…" }` 分平台。Windows 用 `cmd.exe` 执行，macOS/Linux 用 `/bin/sh` |
| `cwd` | `page`（默认，本 `.vitent` 文件夹）、`course`（课程根目录）、`home`、`ws:<工作区id>`（某个代码工作区里学习者的文件夹） |
| `stdin` | 标准输入 |
| `env` | 额外环境变量 `{ "KEY": "value" }` |
| `timeout` | 秒，默认 30 |
| `output` | `panel`（默认，显示 stdout/stderr 与退出码）、`terminal`（在底部终端里交互运行）、`toast`（弹出简短结果）、`none` |
| `confirm` | 执行前的确认文字 |

命令里可以用模板变量 `{node}` `{python}` `{exe}` `{bin:名字}` `{page}` `{course}` `{dir}`（见 [06](06-code-and-runtimes.md)），以及下面的 `{{…}}` 变量。

#### `script` — 运行 `.vitent` 里的脚本

```yaml
check:
  type: script
  file: scripts/check.js        # 相对本页；@/ 开头相对课程根目录
  args: ["{{page.title}}"]
```

用软件内置的 Node.js 运行，工作目录是本页文件夹（`@/` 脚本则是课程根目录）。字段 `stdin` `env` `timeout` `output`（`panel` / `terminal`）同上。

#### `http` — 请求后端接口

```yaml
submit:
  type: http
  method: POST
  url: https://example.com/api/grade
  headers: { "Content-Type": "application/json" }
  body: { "course": "{{course.id}}", "page": "{{page.src}}" }
  output: panel
```

只允许 `http(s)`。`body` 可以是字符串或对象（对象会转成 JSON）。结果显示状态码和响应（JSON 会格式化）。`output`: `panel` / `toast` / `none`；`timeout` 秒。

#### `open` — 打开链接或文件

```yaml
docs: { type: open, url: "https://en.cppreference.com/" }
sheet: { type: open, path: "assets/data.xlsx" }      # 用系统应用打开课程里的文件
```

#### `ask-ai` — 问 AI

```yaml
explain:
  type: ask-ai
  prompt: 解释「{{selection}}」在本页「{{page.title}}」里的意思。
  context: 学习者是初学者
```

打开「问 AI」窗口，问题预先填好，学习者可以修改后提问。

#### `ui` — 界面命令

```yaml
next: { type: ui, command: next }
```

`command`：`prev` `next` `home` `course` `toggle-sidebar` `toggle-notes` `toggle-terminal` `focus` `theme` `highlight` `edit` `export` `export-ai` `settings` `help` `complete` `reload`

#### `copy` — 复制文字

```yaml
copy-cmd: { type: copy, text: "gcc -Wall -o main main.c" }
```

#### `goto` — 跳转

```yaml
to-ws: { type: goto, page: "content/w2/workshop.vitent" }   # 课程根目录下的路径
to-ch: { type: goto, chapter: "w3-lab", index: 0 }          # 章节 id + 第几页（从 0 开始）
```

#### `sequence` — 依次执行

```yaml
build-run:
  type: sequence
  steps: [build, hello]          # 动作 id 或内联对象
  continueOnError: false         # 某一步失败（exec 退出码非 0）就停下
```

### 模板变量

字符串里的 `{{…}}` 会被替换：`{{page.title}}` `{{page.src}}` `{{course.title}}` `{{course.id}}` `{{chapter.title}}` `{{chapter.id}}` `{{selection}}`（学习者当前选中的文字）。

### 安全

`exec`、`script`、`http` 以及带命令的终端，第一次运行时软件会弹出系统对话框，让学习者选择「信任此课程」「仅这一次」或「取消」。
所以：**命令要做它说的事**，不要做和课程无关的事，不要删除课程以外的文件。

---

## 按钮

```json
"buttons": [
  {
    "id": "discussion",
    "slot": "topbar.right",
    "icon": "message-circle",
    "label": "课程讨论区",
    "action": { "type": "open", "url": "https://example.com/forum" },
    "order": 5
  }
]
```

| 字段 | 说明 |
| --- | --- |
| `id` | 必需。和已有按钮同 id 就是覆盖它 |
| `slot` | 位置（见下表） |
| `icon` | Lucide 图标名，或课程里的图片路径（`course.json` 里的相对课程根目录；页面里的相对本页） |
| `label` | 文字（`style` 为 `icon` 时作为悬停提示） |
| `tooltip` | 可选，悬停提示 |
| `style` | `icon`（只有图标，默认）、`text`、`both`（图标 + 文字） |
| `order` | 排序数字，越小越靠前，默认 50 |
| `action` | 动作 id 或内联动作 |
| `iconAfter` | 图标放在文字后面 |
| `hidden` | `true` 时移除这个 id 的按钮（包括内置按钮） |

### 位置 `slot`

| slot | 位置 |
| --- | --- |
| `topbar.left` | 窗口顶栏，面包屑后面 |
| `topbar.right` | 窗口顶栏右侧图标区（主题、语言、设置的左边） |
| `lessonbar.left` | 课程栏左侧（返回课程、上一页、下一页那一组） |
| `lessonbar.right` | 课程栏右侧（高亮、编辑那一组） |
| `sidebar.bottom` | 左侧页面列表底部 |
| `page.end` | 每页末尾「标记为完成」旁边 |

### 内置按钮

| id | slot | order | 作用 |
| --- | --- | --- | --- |
| `back` | lessonbar.left | 0 | 返回课程 |
| `focus` | lessonbar.left | 10 | 专注模式 |
| `prev` | lessonbar.left | 20 | 上一页 |
| `next` | lessonbar.left | 30 | 下一页 |
| `highlight` | lessonbar.right | 80 | 高亮模式 |
| `edit` | lessonbar.right | 90 | 编辑本页 |
| `sidebar` | topbar.right | 10 | 显示 / 隐藏页面列表 |
| `notes` | topbar.right | 20 | 笔记面板 |
| `terminal` | topbar.right | 30 | 底部终端 |

### 优先级

```text
内置按钮  <  course.json 的 buttons（全课程）  <  页面 frontmatter 的 buttons（本页）
```

- 同一个 `id`：后面的覆盖前面的（只写想改的字段即可，比如只改 `label` 或 `slot`）。
- `{"id": "edit", "hidden": true}` 或 `hide: [edit]`：隐藏。
- 页面的按钮只在这一页生效。

### 例子：本页加按钮、隐藏编辑

```yaml
---
title: 期中复习
buttons:
  - id: summary
    slot: lessonbar.right
    icon: sparkles
    label: 总结本页
    style: both
    order: 70
    action: { type: ask-ai, prompt: "用五个要点总结「{{page.title}}」" }
  - id: edit
    hidden: true
---
```
