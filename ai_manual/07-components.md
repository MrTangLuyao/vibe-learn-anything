# 07 · 内置开源组件与自定义 HTML 组件

Vibe Learn Anything 自带一套开源组件。课程**不需要**也**不应该**再打包这些库——直接用对应的 Vitent 写法即可。

| 能力 | 组件（开源） | 在课程里怎么用 |
| --- | --- | --- |
| Markdown 渲染 | markdown-it | 正文 |
| 代码编辑器（VS Code 同款） | Monaco Editor | `:::workspace`、` ```lang editable `、编辑模式 |
| 终端模拟器 | xterm.js + node-pty（真终端） | 工作区终端、`::terminal`、底部终端 |
| PDF 阅读（带文字层，可高亮） | pdf.js | `::pdf` |
| Word 文档 | mammoth.js | `::doc` |
| 数学公式 | KaTeX | `$…$`、`$$…$$`、` ```math ` |
| 图表 | Mermaid | ` ```mermaid ` |
| 代码高亮 | highlight.js | 代码块 |
| 拖拽排序 | SortableJS | `:::parsons`、注释排序 |
| 图标（1500+） | Lucide | `icon=`、`:icon[name]`，名字查 <https://lucide.dev/icons/> |
| 运行代码 | 内置 Node.js + 学习者电脑上的编译器 / 解释器 | 见 [06](06-code-and-runtimes.md) |

Mermaid 支持：`flowchart` `sequenceDiagram` `classDiagram` `stateDiagram-v2` `erDiagram` `gantt` `pie` `mindmap` `timeline` `gitGraph` `xychart-beta` 等。
图里的文字有中文或特殊符号时用引号：`A["指针 *p"]`。

## 自定义 HTML 组件

内置组件做不到的交互——物理模拟、算法动画、可操作的图表、小游戏、实验台——写成一个 HTML 文件放进 `.vitent`：

```markdown
::html[链表插入演示]{#viz-list src="widgets/list.html" height=420}
```

### 运行环境

- 在**沙箱 iframe** 里运行：可以执行脚本、用表单和弹窗，但**不能**访问软件本身、学习者的文件，也不能直接执行命令。
- 文件里的相对路径相对这个 HTML 文件（可以引用同一 `.vitent` 里的图片、JS、JSON）。
- 可以联网加载公开资源（CDN），但学习者可能离线，**优先把依赖放进 `.vitent`**。
- 默认高度 420px；引入桥接脚本后会**自动适应内容高度**。

### 桥接脚本

在 `<head>` 里引入：

```html
<script src="vla://_/bridge.js"></script>
```

然后：

```js
const info = await vla.ready();
// info = { theme: "dark" | "light", tokens: { "--bg": "#1f1f1e", ... }, lang: "zh" | "en",
//          state: <上次保存的状态>, page: "content/…", course: "课程名" }

await vla.setState({ score: 3 });   // 保存状态（每个学习者、每个组件单独保存，随课程导出）
const s = await vla.getState();

vla.complete();                     // 标记本页完成
const r = await vla.run('check');   // 运行本页或课程里定义的动作 → { ok, code, stdout, stderr, status, text }
vla.ask('为什么指针要加 1？');       // 打开「问 AI」窗口
vla.toast('做得好！', 'ok');         // 软件里弹出提示：'info' | 'ok' | 'err'
vla.openUrl('https://…');           // 用系统浏览器打开
vla.resize(500);                    // 手动设置高度（一般不需要）

addEventListener('vla:theme', e => { /* e.detail = { theme, tokens } 学习者切换了主题 */ });
```

### 配色

`vla.ready()` 之后，软件的配色会自动写到 `<html>` 的 CSS 变量里，并设置 `data-theme`：

`--bg` `--surface` `--surface-high` `--border` `--text` `--muted` `--accent` `--accent-on` `--ok` `--err` `--warn` `--info` `--code-bg` `--font` `--font-mono`

```css
html, body { margin: 0; background: transparent; color: var(--text); font-family: var(--font); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; }
button { background: var(--accent); color: #fff; border: 0; border-radius: 999px; padding: 8px 16px; }
```

**背景保持透明**，让组件融入页面；按钮用胶囊形（`border-radius: 999px`），圆角卡片 16px，和软件风格一致。
在 `:root` 里写好深色的默认值，桥接加载前也能正常显示。

### 示例骨架

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<script src="vla://_/bridge.js"></script>
<style>
  :root { --bg:#1f1f1e; --surface:#2a2a29; --border:#3a3a39; --text:#e8e8e8; --muted:#a1a1a0; --accent:#d97757; }
  html, body { margin: 0; background: transparent; color: var(--text); font-family: var(--font, monospace); }
  .wrap { padding: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; }
</style>
</head>
<body>
<div class="wrap">
  <p id="msg">加载中…</p>
  <button id="done">我学会了</button>
</div>
<script>
  vla.ready().then(info => {
    document.getElementById('msg').textContent = info.state?.clicked ? '欢迎回来！' : '点按钮试试';
  });
  document.getElementById('done').onclick = async () => {
    await vla.setState({ clicked: true });
    vla.complete();
    vla.toast('已完成本页', 'ok');
  };
</script>
</body>
</html>
```

### 什么时候不要用

普通文字、测验、代码题、图表、幻灯片、提示框都有内置组件，**不要**用 HTML 重新实现——更费 token，也会失去高亮、进度、主题等功能。
