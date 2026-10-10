# 05 · 高亮、注释与 AI 回路

学习者在软件里高亮文字或标记组件，并写注释。其中两种荧光笔是写给你（AI）的：

| `kind` | 软件里叫 | 你要做什么 |
| --- | --- | --- |
| `ask` | 问 AI | **回答**学习者的问题 |
| `revise` | 请 AI 修改 | 按学习者的要求**修改课程内容**，再说明改了什么 |
| `yellow` `green` `blue` `pink` | 普通荧光笔 | 学习者自己的笔记。通常不用处理，但可以借此了解学习者在意什么、哪里卡住 |

## 两个身份：`learner` 和 `answer`

- 学习者在软件里写的每一条注释，作者都是 **`learner`**。
- 你（AI）写的每一条，作者都是 **`answer`**。
- 不要修改或删除 `learner` 的注释；你自己之前写的 `answer` 可以修订。

## `annotations.json`

位于课程根目录：

```json
{
  "vla_annotations": 1,
  "highlights": [
    {
      "id": "h-mgk2x1ab3cd",
      "kind": "ask",
      "page": "content/w1/pointers.vitent",
      "status": "open",
      "created": "2026-10-11T08:30:00.000Z",
      "updated": "2026-10-11T08:31:12.000Z",
      "targets": [
        {
          "type": "text",
          "exact": "解引用运算符 * 会取出指针指向的值",
          "prefix": "在声明之外，",
          "suffix": "。所以 *p = 5 会",
          "start": 1834,
          "scope": "page",
          "section": "指针的基本操作"
        },
        {
          "type": "block",
          "block": "ws-swap",
          "widget": "workspace",
          "label": "交换两个数",
          "detail": { "file": "swap.c", "lines": [3, 5], "text": "*a = *b;" }
        }
      ],
      "comments": [
        { "id": "c-mgk2x9q1", "author": "learner", "text": "为什么 swap 里要用指针？直接传 int 不行吗？", "created": "2026-10-11T08:31:12.000Z" }
      ]
    }
  ]
}
```

### 高亮字段

| 字段 | 说明 |
| --- | --- |
| `id` | 高亮 id |
| `kind` | `yellow` `green` `blue` `pink` `ask` `revise` |
| `page` | 所在页面（课程根目录下的 `.vitent` 路径） |
| `status` | `open`（等待处理）、`answered`（已回答）、`applied`（已按要求修改）、`resolved`（学习者标记已解决） |
| `targets` | 被高亮的内容，可以有多段（一次高亮可以拖选多处文字、标记多个组件） |
| `comments` | 注释列表，**按数组顺序显示**（学习者可以拖动排序） |
| `created` / `updated` | ISO 时间 |

### 目标 `targets[]`

**`type: "text"`** — 一段文字（W3C 文本引用选择器）：

| 字段 | 说明 |
| --- | --- |
| `exact` | 被高亮的原文（渲染后的纯文本，不含 Markdown 符号） |
| `prefix` / `suffix` | 前后各约 32 个字符，用来在原文重复出现时定位 |
| `start` | 在该区域纯文本里的字符位置（提示用） |
| `scope` | `page` = 页面正文；`doc-1` = 某个 Word 组件里的文字；`pdf-1:p3` = 某个 PDF 组件第 3 页的文字 |
| `section` | 所在小节标题（帮你在 `index.md` 里找到位置） |

**`type: "block"`** — 整个组件（学习者点了组件下方的「标记这个控件」）：

| 字段 | 说明 |
| --- | --- |
| `block` | 组件 id（见 [02 · 组件 id](02-vitent-format.md#组件-id)） |
| `widget` | 组件类型，如 `quiz` `workspace` `pdf` `image` `code` `table` `diagram` |
| `label` | 组件标题或开头的文字 |
| `detail` | 额外信息：代码工作区 / 可编辑代码块是当前文件、选中的行和文字；PDF 是当前页码；视频是播放到的秒数 |

**`type: "page"`** — 整页（来自 `::ask` 按钮等）。

## 处理流程

### A. 学习者把 `.vla` 交给你

```bash
node tools/vla.mjs unpack inbox/c-revival.vla courses/c-revival   # 目录已存在就解包到新目录再对比合并
node tools/vla.mjs notes courses/c-revival                         # 列出 open 的 ask / revise
# …处理…
node tools/vla.mjs validate courses/c-revival
node tools/vla.mjs pack courses/c-revival -o out/c-revival.vla      # 记得先把 course.json 的 version +0.0.1
```

### B. 软件让你直接在课程文件夹里工作

当前目录就是解包后的课程（有 `course.json`）。直接修改文件，**不要打包**，最后运行 `validate`。软件会在你结束后自动刷新课程。

### 回答 `ask`

1. 读 `targets`（文字和组件）、所在页面的 `index.md`、所有 `comments`，以及 `course.json` 的 `ai.context`。
   如果涉及代码工作区，去看学习者的代码：`learner/workspaces/<页面键>/<工作区id>/`（页面键 = 页面路径去掉 `.vitent`，`/` 换成 `__`，如 `content__w1__pointers`）。
2. 在该高亮的 `comments` **末尾**追加一条：
   ```json
   { "id": "c-<随机字符>", "author": "answer", "text": "<Markdown 回答>", "created": "<当前 ISO 时间>" }
   ```
   也可以用工具：`node tools/vla.mjs answer <课程目录> <高亮id> --file answer.md`（会自动设置状态）。
3. 把 `status` 改成 `"answered"`，更新 `updated`。

回答要求：针对学习者的问题和水平；结合高亮的原文；必要时举例、画 mermaid 图、给代码；
如果问题暴露了课程讲得不清楚，**同时**考虑改进那一页（并在回答里说明「我也把这部分讲解改清楚了」）。

### 处理 `revise`

1. 读学习者的要求（`comments` 里 `learner` 的内容）。
2. 修改对应页面的 `index.md`（或资源文件）：只改需要改的部分，保持 Vitent 语法正确，**不要改动组件 id**。
   常见要求：讲得更细、换个例子、加练习、修正错误、加图、调整难度、翻译。
3. 如果被高亮的原文被你改写了，把 `targets[].exact`（以及 `prefix` / `suffix`）更新成新文字，让高亮继续落在正确的位置；
   找不到合适对应时可以保持不变（软件会显示「原文已改动」）。
4. 追加一条 `answer` 注释，**说明改了什么**（简短列出）。
5. `status` 改成 `"applied"`，更新 `updated`。
6. `course.json` 的 `version` 最后一位 +1。

### 普通荧光笔和 `resolved`

- 普通颜色的高亮不需要处理。如果学习者在注释里明显提了问题，可以回答（追加 `answer`，不改 `status`）。
- `resolved` 的高亮不要再处理。

### 你也可以主动

- 发现学习者在某处反复出错（看 `learner/progress.json` 的测验记录），可以在相关页面补充讲解或练习。
- 可以新建高亮来提醒学习者，例如给某段文字加一个 `kind: "yellow"` 的高亮并写一条 `answer` 注释（id 用 `h-` 开头的随机串）。不要滥用。

## 学习记录 `learner/`

软件写入，**只读**（你可以读来了解学习者，不要修改）：

```text
learner/
├── progress.json
└── workspaces/<页面键>/<工作区id>/...   ← 学习者在代码工作区里写的文件
```

`progress.json`：

```json
{
  "vla_progress": 1,
  "last": { "chapter": "w1-pointers", "page": "content/w1/pointers.vitent", "at": "…" },
  "pages": {
    "content/w1/pointers.vitent": {
      "visited": "2026-10-11T08:00:00.000Z",
      "completed": "2026-10-11T08:20:00.000Z",
      "quiz": {
        "q-ptr-1": { "answer": [1], "correct": true, "attempts": 2, "at": "…" },
        "q-ptr-2": { "answer": "0x7ff", "correct": false, "attempts": 3, "at": "…" }
      },
      "tests": { "ws-swap": { "passed": 2, "total": 3, "at": "…" } },
      "widgets": { "fc-w1": { "seen": [0, 1, 2] }, "viz-bsearch": { "state": { "found": 2 } } }
    }
  }
}
```

单选 / 多选题的 `answer` 是**选项在 `index.md` 里的序号（从 0 开始）**；文字题是字符串；`attempts` 是尝试次数。

## 检查清单

- [ ] 每个 `open` 的 `ask` 都有了 `answer` 注释且 `status: "answered"`
- [ ] 每个 `open` 的 `revise` 都改了内容、有说明、`status: "applied"`
- [ ] 没有动 `learner` 的注释和 `learner/` 文件夹
- [ ] 组件 id 没变；`version` 已 +1
- [ ] `node tools/vla.mjs validate` 没有 error
