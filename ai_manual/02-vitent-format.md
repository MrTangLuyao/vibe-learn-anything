# 02 · `.vitent` 页面与 Vitent Markdown

每一页是一个 **`.vitent` 包**（vibe learn content）：一个以 `.vitent` 结尾的文件夹（打包后是 zip）。

```text
pointers.vitent/
├── index.md          ← 必需：页面内容（Vitent Markdown）
├── assets/           ← 图片、PDF、Word、音视频、数据文件……
├── code/             ← 代码工作区的初始文件（可选，见 :::workspace dir=）
├── scripts/          ← 动作要运行的脚本（可选，见 04）
└── widgets/          ← 自定义 HTML 组件（可选，见 07）
```

你可以往 `.vitent` 里放**任何文件**。子文件夹名只是约定，不是强制。

## `index.md`

```markdown
---
title: 指针是什么
kind: doc
complete: quiz
estimate: 15
---

正文用普通 Markdown 写……

:::tip[小提示]
这是一个组件。
:::
```

### Frontmatter（YAML）

| 字段 | 说明 |
| --- | --- |
| `title` | 页面标题（左侧列表与页面顶部）。`course.json` 里给页面写的 `title` 优先 |
| `kind` | 左侧列表的图标：`doc` `reading` `code` `lab` `quiz` `survey` `slides` `pdf` `video` `project` |
| `icon` | 可选，Lucide 图标名，覆盖 `kind` 的图标 |
| `complete` | 完成规则：`manual`（学习者点页尾「标记为完成」或在页面列表里右键标记）、`view`（打开约 3 秒即完成）、`quiz`（本页测验全部答对）、`tests`（本页工作区测试全部通过）、`all`（测验和测试都要）。不写时：有测验 → `quiz`；有带测试的工作区 → `tests`；否则 `manual`。学习者随时可以在页面列表里右键「标记为未完成」或「重置进度」 |
| `estimate` | 预计分钟数（信息性） |
| `actions` | 本页动作，见 [04](04-actions-buttons.md) |
| `buttons` | 本页按钮（优先级高于 `course.json`），见 [04](04-actions-buttons.md) |
| `hide` | 本页隐藏的按钮 id 列表 |

如果正文第一行是 `# 标题`，页面顶部就不再重复显示 `title`。

## 正文：Markdown

支持 CommonMark + GFM：标题、列表、表格、引用、`行内代码`、链接、图片、删除线、任务列表 `- [ ]`、自动链接，以及：

- **数学**（KaTeX）：行内 `$O(n \log n)$`，独立 `$$ … $$`（可以跨行）。`$` 后面紧跟空格的不会被当成公式。
- **代码块**：` ```c ` 带语法高亮；加属性变成可运行 / 可编辑（见 [03](03-vitent-blocks.md#代码块)）。
- **图表**：` ```mermaid ` 流程图、时序图、状态图、类图、甘特图、饼图……
- **原始 HTML**：允许少量用于排版（`<sub>`、`<details>`、`<br>` 等），`<script>`、事件属性、`<iframe>`、`<style>` 会被移除。交互请用组件。

### 路径

页面里引用的文件路径**相对于这个 `.vitent` 文件夹**；以 `@/` 开头的路径相对于**课程根目录**。

```markdown
![示意图](assets/diagram.svg)              ← pointers.vitent/assets/diagram.svg
::pdf{src="@/assets/lecture-03.pdf"}       ← 课程根目录 assets/lecture-03.pdf
```

### 跳到其他页面

链接到 `.vitent` 路径会在软件内跳转（可以跨章节）。可以写 `@/` 开头的绝对路径，也可以写相对这个 `.vitent` 文件夹的路径：

```markdown
[复习上一页](../intro.vitent)
[看 Week 2 的练习](@/content/w2/workshop.vitent)
[跳到小节](#指针运算)
```

外部 `https://` 链接会用系统浏览器打开；指向课程内其他文件的链接会用系统应用打开该文件。

## 组件语法（指令）

Vitent 用 **指令** 扩展 Markdown，三种形式：

### 1. 容器指令（多行）

```markdown
:::name[标签]{属性}
里面是 Markdown，可以再嵌套指令
:::
```

- 用三个或更多冒号开头，**用同样数量的冒号结束**。
- 嵌套时，内层**习惯上多用一个冒号**（`::::tab` … `::::`），便于阅读，也避免配错。
- `[标签]` 和 `{属性}` 都可省略。

````markdown
:::tabs
::::tab[C]
```c
int x = 1;
```
::::
::::tab[Python]
```python
x = 1
```
::::
:::
````

### 2. 叶子指令（单行）

```markdown
::name[标签]{属性}
```

必须独占一行。例：`::pdf{src="assets/slides.pdf" page=3}`、`::toc`。

### 3. 行内指令

```markdown
按 :kbd[Ctrl] + :kbd[C] 复制；:term[指针]{tip="存放地址的变量"}；:ask[这是什么意思？]
```

行内指令**必须带 `[标签]`**（可以是空的 `[]`），前一个字符不能是字母或数字（避免和 `http://` 冲突）。

### 属性写法

```text
{#my-id .my-class key="带空格的值" key2='单引号' n=3 flag}
```

- `#id` 等同于 `id="..."`；`.class` 加 CSS 类；`flag` 不带值等于 `true`；不加引号的数字会被当成数字。
- 字符串里可以用 `\"` 和 `\n`。

### 代码块的属性

写在语言名后面，可以带花括号也可以不带：

````markdown
```python {title="sum.py" run}
```js run stdin="3\n4"
```c lines="3-5"
````

### 组件 id

每个组件都有一个块 id，用来记录学习者的进度和高亮位置：

- 写了 `{#id}` 或 `id="…"` 就用它；
- 否则按出现顺序自动编号：`quiz-1`、`quiz-2`、`workspace-1`、`callout-3`……（提示框的简写 `:::tip` 等都算 `callout`）；
  Markdown 图片是 `img-N`，表格 `table-N`，代码块 `code-N`，mermaid 图 `diagram-N`。

**测验、填空、排序、工作区、闪卡、自定义组件一律写明确的 id**——否则你在前面插入一个新测验，后面所有测验的编号都会变，学习者的答题记录就对不上了。

## 写作建议

- 一页一个主题，10–20 分钟能读完做完。
- 用二级标题 `##` 划分小节（AI 处理高亮时会参考小节名）。
- 先给例子再出题；每页至少有一个可交互的检查点。
- 下一步看 [03 · 组件大全](03-vitent-blocks.md)。
