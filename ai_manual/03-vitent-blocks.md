# 03 · 组件大全

记号：**容器** `:::name … :::`，**叶子** `::name`（单独一行），**行内** `:name[…]`。
所有组件都可以加 `{#id}`；带「进度」的组件**必须**写 id。

## 目录

- 文字与布局：[提示框](#提示框) · [折叠](#折叠-details) · [点击揭示](#点击揭示-reveal) · [标签页](#标签页-tabs) · [分栏](#分栏-columns) · [分步](#分步-steps) · [幻灯片](#幻灯片-slides) · [目录与分隔线](#目录与分隔线)
- 练习：[测验](#测验-quiz) · [完形填空](#完形填空-cloze) · [代码排序](#代码排序-parsons) · [记忆卡片](#记忆卡片-flashcards)
- 代码：[代码块](#代码块) · [代码工作区](#代码工作区-workspace) · [终端](#终端-terminal)
- 资料与媒体：[PDF](#pdf) · [Word](#word-文档-doc) · [图片](#图片-image) · [视频](#视频-video) · [音频](#音频-audio) · [附件](#附件-file) · [网页嵌入](#网页嵌入-embed) · [自定义组件](#自定义组件-html) · [引入文件](#引入文件-include)
- 动作与 AI：[按钮](#按钮-button) · [问 AI](#问-ai-ask)
- [行内组件](#行内组件)

---

## 提示框

````markdown
:::tip[可选标题]
内容（Markdown）。
:::
````

类型：`note` `tip` `info` `warning` `danger` `success` `question` `example`，也可以写 `:::callout{type="warning" title="…"}`。

| 属性 | 说明 |
| --- | --- |
| `[标签]` / `title` | 标题，不写就用类型的默认标题（如「提示」） |
| `icon` | Lucide 图标名，覆盖默认图标 |
| `collapsed` | 写了就能点标题折叠；`collapsed` 单独出现时默认收起，`collapsed=false` 默认展开 |

## 折叠 `details`

````markdown
:::details[点击展开：边界条件]{open}
内容
:::
````

`open`：默认展开。

## 点击揭示 `reveal`

````markdown
:::reveal[我想好了，看答案]
答案内容。学习者点开后会被记住。
:::
````

## 标签页 `tabs`

````markdown
:::tabs
::::tab[C]
```c
printf("%d\n", x);
```
::::
::::tab[Python]
```python
print(x)
```
::::
:::
````

## 分栏 `columns`

````markdown
:::columns{gap=24}
::::column{width=2}
左栏（占 2 份）
::::
::::column
右栏（占 1 份）
::::
:::
````

`width`：数字 = 份数（`fr`），也可以写 `300px`、`40%`。窄窗口时自动变成单栏。

## 分步 `steps`

````markdown
:::steps
::::step[第一步：确定区间]
`lo = 0`，`hi = n - 1`
::::
::::step[第二步：取中点]
…
::::
:::
````

一次显示一步，点「下一步」显示下一步。适合推导、算法过程。

## 幻灯片 `slides`

````markdown
:::slides{aspect="16:9"}
::::slide[标题页]
**一句话总结**
::::
::::slide[第二张]{align="top"}
- 要点 1
- 要点 2
::::
:::
````

| 属性 | 说明 |
| --- | --- |
| `aspect`（slides） | 宽高比，默认 `16:9` |
| `[标签]`（slide） | 幻灯片大标题 |
| `align`（slide） | `top` 顶部对齐，默认垂直居中 |
| `background`（slide） | CSS 背景，如 `#1d2b3a` 或 `linear-gradient(...)` |

方向键翻页，右下角可全屏。

## 目录与分隔线

```markdown
::toc[本页目录]{depth=3}
::divider
```

---

## 测验 `quiz`

**单选 / 多选**：用任务列表写选项，`[x]` 是正确答案；超过一个 `[x]` 自动变成多选。

````markdown
:::quiz{id="q-ptr-1" shuffle}
`int *p = &x;` 之后，`*p` 表示什么？
- [ ] x 的地址
- [x] x 的值
- [ ] p 的地址
::::explain
`*` 是解引用：取出 p 指向的那个变量的值。
::::
::::hint
`&` 取地址，`*` 反过来。
::::
:::
````

**填空 / 数值**：

````markdown
:::quiz{id="q-bits" type="number" answer="20" tolerance=0}
1,000,000 个元素最多比较几次？
:::

:::quiz{id="q-name" answer="binary search|二分查找"}
这种查找方法叫什么？
:::
````

**问卷 / 开放题**（没有标准答案，只记录回答；开放题有「请 AI 点评」按钮）：

````markdown
:::quiz{id="q-feel" type="survey"}
这一章的难度？
- [ ] 太简单
- [ ] 刚好
- [ ] 太难
:::

:::quiz{id="q-why" type="open"}
用你自己的话解释为什么……
:::
````

| 属性 | 说明 |
| --- | --- |
| `id` | **必写** |
| `type` | `single` `multiple` `text` `number` `survey` `poll` `open`；不写时按内容推断 |
| `answer` | 文字题答案，多个可接受答案用 `\|` 分隔 |
| `match` | 文字题匹配方式：默认忽略大小写和多余空格；`exact` 完全一致；`regex` 正则；`number` 数值比较（`type="number"` 时默认） |
| `tolerance` | 数值题允许误差 |
| `shuffle` | 打乱选项顺序（对每个学习者固定） |
| `reveal` | 答错几次后出现「显示答案」，默认 `2` |
| `points` | 分值（显示用） |

子容器：`::::explain`（答对后显示的解析）、`::::hint`（答错时显示的提示）。

## 完形填空 `cloze`

````markdown
:::cloze{id="c-loop"}
循环条件是 `lo [[<=]] hi`，更新左边界：`lo = [[mid + 1|mid+1]]`。
::::explain
闭区间写法……
::::
:::
````

`[[答案]]` 变成输入框；`[[a|b]]` 表示 a 或 b 都对。`match="exact"` 区分大小写。

## 代码排序 `parsons`

把**正确顺序**的代码写在代码块里，软件会打乱顺序让学习者拖动排列：

````markdown
:::parsons{id="p-swap"}
把交换函数排成正确的顺序：
```c
void swap(int *a, int *b) {
    int t = *a;
    *a = *b;
    *b = t;
}
```
:::
````

## 记忆卡片 `flashcards`

内容是 YAML 列表（可以直接写，也可以包在 ` ```yaml ` 代码块里），`q`/`a` 或 `front`/`back`，支持 Markdown 和公式：

````markdown
:::flashcards{id="fc-w1" shuffle}
- q: "`malloc` 返回什么？"
  a: "指向新分配内存的指针，失败时返回 `NULL`。"
- q: "二分查找复杂度"
  a: "$O(\\log n)$"
:::
````

YAML 字符串里有 `:` 或以特殊字符开头时请加引号；反斜杠要写成 `\\`。

---

## 代码块

````markdown
```c {title="hello.c" lines="3-5"}
…代码…
```

```python run
print(sum(range(10)))
```

```js run editable stdin="3\n4"
const [a, b] = require('fs').readFileSync(0, 'utf8').split('\n').map(Number);
console.log(a + b);
```
````

| 属性 | 说明 |
| --- | --- |
| `title` | 代码块标题（显示在顶部） |
| `lines` | 高亮行，如 `"2-4,7"` |
| `run` | 显示「运行」按钮，用语言对应的运行器执行。也可以 `run=python` 指定运行器 |
| `editable` | 变成小编辑器，学习者可以改了再运行 |
| `stdin` | 运行时的标准输入（`\n` 表示换行） |
| `timeout` | 运行超时（秒），默认 20 |

` ```mermaid ` 画图，` ```math ` / ` ```latex ` 写独立公式。运行器与语言见 [06](06-code-and-runtimes.md)。

## 代码工作区 `workspace`

像 Ed 的代码题：文件列表、多标签编辑器（Monaco）、状态栏、终端、运行、提交（测试）、提示、参考答案、重置、全屏。学习者的代码保存在课程的 `learner/workspaces/` 里。

````markdown
:::workspace{id="ws-swap" runner="c" title="交换两个数" main="main.c"}
```c file=main.c
#include <stdio.h>
#include "swap.h"

int main(void) {
    int a, b;
    scanf("%d %d", &a, &b);
    swap(&a, &b);
    printf("%d %d\n", a, b);
    return 0;
}
```

```c file=swap.h
void swap(int *a, int *b);
```

```c file=swap.c
#include "swap.h"
void swap(int *a, int *b) {
    /* TODO */
}
```

::::tests
```yaml
- name: 普通情况
  stdin: "1 2"
  expect: "2 1"
- name: 负数
  stdin: "-5 7"
  expect: "7 -5"
- name: 相同的数
  stdin: "3 3"
  expect: "3 3"
  hidden: true
```
::::

::::hint
用一个临时变量。
::::

::::solution
```c file=swap.c
#include "swap.h"
void swap(int *a, int *b) { int t = *a; *a = *b; *b = t; }
```
::::
:::
````

| 属性 | 说明 |
| --- | --- |
| `id` | **必写**（学习者的文件按它保存） |
| `runner` | 运行器：`node` `typescript` `python` `c` `cpp` `java` `go` `rust` `ruby` `bash` `powershell` `sql`，或 `course.json` 里自定义的 |
| `main` | 主文件，默认用运行器的默认文件名或第一个文件 |
| `build` / `run` | 覆盖运行器的编译 / 运行命令（模板变量见 06） |
| `dir` | 从 `.vitent` 里的某个文件夹复制初始文件（如 `dir="code/ws1"`），可以和代码块一起用 |
| `title` | 标题 |
| `height` | 高度（像素），默认 560 |
| `open` | 初始打开的标签，逗号分隔；不写时打开所有顶层文件（最多 6 个） |
| `readonly` | 只读文件，逗号分隔 |
| `tree` | 默认展开文件列表 |
| `terminal="open"` | 默认展开终端 |

- 初始文件：工作区里带 `file=路径` 的代码块（没有 `file=` 时第一个代码块作为主文件）。
- **运行**：在下方终端里执行「编译 && 运行」，可以交互输入。
- **提交**：先编译一次，再对每个测试用例运行程序、比较输出。

`::::tests` 是 YAML 列表，每项：

| 字段 | 说明 |
| --- | --- |
| `name` | 测试名 |
| `stdin` | 标准输入 |
| `args` | 追加到运行命令后的参数 |
| `expect` | 期望的标准输出；不写则只要求退出码为 0 |
| `match` | `trim`（默认：忽略行尾空白和首尾空行）、`exact`、`contains`、`regex` |
| `code` | 期望的退出码 |
| `hidden` | 隐藏测试：失败时不显示输入输出 |
| `timeout` | 秒，默认 10 |

`::::tests{build="..."}` 可以为测试单独指定编译命令。

## 终端 `terminal`

```markdown
::terminal[本页文件夹里的终端]{height=240}
::terminal[运行脚本]{command="node scripts/demo.js" cwd="page"}
```

| 属性 | 说明 |
| --- | --- |
| `cwd` | `page`（默认，本 `.vitent` 文件夹）、`course`、`home`、`ws:<工作区id>` |
| `command` | 预设命令（运行前会征得学习者对课程的信任）；不写就是交互式 shell |
| `height` | 高度（像素） |

学习者点按钮后才启动。

---

## PDF

```markdown
::pdf[第 3 讲讲义]{src="assets/lecture3.pdf" page=5 height=640}
```

内置 pdf.js：翻页、缩放、适合宽度、用系统应用打开、下载。**PDF 里的文字可以选中、高亮、问 AI**（扫描版没有文字层的 PDF 只能整体标记）。

| 属性 | 说明 |
| --- | --- |
| `src` | 必需 |
| `page` | 初始页 |
| `height` | 查看器高度（像素或 CSS 长度，默认 `78vh`） |
| `title` / `[标签]` | 标题栏文字 |

## Word 文档 `doc`

```markdown
::doc[作业说明]{src="assets/assignment1.docx"}
```

`.docx` 会被转换成正文显示（标题、列表、表格、图片），可以高亮。

## 图片 `image`

```markdown
![替代文字](assets/fig.png)
::image{src="assets/fig.svg" caption="图 1：内存布局" width=480}
```

点击放大。普通 Markdown 图片也行；`::image` 多了标题和宽度。

## 视频 `video`

```markdown
::video[第一讲录像]{src="assets/lecture1.mp4" start=90 poster="assets/cover.jpg"}
::video[讲解]{src="https://www.youtube.com/watch?v=xxxx"}
```

本地视频支持拖动进度，会记住看到哪里；YouTube / bilibili / Vimeo 链接自动嵌入（需要联网）。

## 音频 `audio`

```markdown
::audio[发音示例]{src="assets/word.mp3"}
```

## 附件 `file`

```markdown
::file[作业模板（Excel）]{src="assets/template.xlsx"}
```

学习者可以「打开」（系统应用）、「另存为」、「在文件夹中显示」。行内写法见下。

## 网页嵌入 `embed`

```markdown
::embed[可视化工具]{src="https://visualgo.net/en/sorting" height=520}
```

外部网页在沙箱里显示（需要网站允许被嵌入）。

## 自定义组件 `html`

```markdown
::html[二分查找可视化]{#viz-bsearch src="widgets/bsearch.html" height=380}
```

内置组件做不到的交互（模拟器、可视化、小游戏）就写一个 HTML 文件。它运行在沙箱里，通过桥接脚本和软件通信、使用软件配色、保存状态、标记完成。接口见 [07](07-components.md#自定义-html-组件)。

## 引入文件 `include`

```markdown
::include{src="parts/common-setup.md"}
```

把另一个 Markdown 文件的内容原样插入这里（最多嵌套 3 层）。适合多页共用的内容。

---

## 按钮 `button`

```markdown
::button[编译并运行]{action="build" icon="hammer" variant="primary"}
```

| 属性 | 说明 |
| --- | --- |
| `action` | 动作 id（页面或课程里定义的）或见 [04](04-actions-buttons.md) |
| `icon` | Lucide 图标名 |
| `variant` | `primary` `tonal`（默认） `outline` `text` |
| `output` | `panel`（默认，在按钮下方显示结果）或 `none` |

## 问 AI `ask`

```markdown
::ask[为什么这里要用 size_t？]{prompt="解释 C 语言里 size_t 的用途，以及为什么 strlen 返回 size_t。" context="学习者刚学完数组"}
```

学习者点击后弹出「问 AI」窗口（问题可以修改），回答可以保存到笔记；没有配置 AI 时会存为「待问」，导出给 AI 时一起回答。

---

## 行内组件

| 写法 | 效果 |
| --- | --- |
| `:kbd[Ctrl]` | 键盘按键 |
| `:term[指针]{tip="存放地址的变量"}` | 术语，鼠标悬停显示解释 |
| `:badge[新]{color="ok"}` | 小标签；颜色 `ok` `err` `warn` `info` `violet`（或 `green` `red` `yellow` `blue` `purple`） |
| `:hl[重点]{color="yellow"}` | 作者预先划的重点；`yellow` `green` `blue` `pink` |
| `:icon[rocket]{color="#e0645c"}` | Lucide 图标 |
| `:btn[运行]{action="build" icon="play"}` | 行内按钮（结果在弹窗里显示） |
| `:ask[这是什么？]{prompt="…"}` | 行内「问 AI」 |
| `:file[模板.xlsx]{src="assets/template.xlsx"}` | 行内附件（右键另存为） |
| `:link[去练习]{page="@/content/w2/ws.vitent"}` | 跳到某页（也可以 `chapter="w2-ws"` 或 `url="https://…"`） |
