---
title: 可扩展的按钮
kind: doc
buttons:
  - id: page-ask
    slot: lessonbar.right
    icon: sparkles
    label: 总结本页
    style: both
    order: 70
    action:
      type: ask-ai
      prompt: 用三句话总结「{{page.title}}」。
  - id: docs-link
    slot: topbar.left
    icon: external-link
    label: 打开 MDN
    action:
      type: open
      url: https://developer.mozilla.org/
  - id: page-terminal
    slot: page.end
    icon: square-terminal
    label: 在这里打开终端
    style: both
    action:
      type: ui
      command: toggle-terminal
  - id: edit
    hidden: true
---

软件里几乎所有按钮都可以扩展。看看这一页的界面和其他页有什么不同：

- 课程栏右侧多了一个 **总结本页** 按钮（`lessonbar.right`）；
- 顶栏左侧多了一个 **打开 MDN**（`topbar.left`）；
- 页面底部多了 **在这里打开终端**（`page.end`）；
- 课程栏里的 **编辑本页** 按钮被隐藏了（`hidden: true`）；
- 顶栏右侧的 **AI 手册** 是 `course.json` 里定义的全局按钮，每一页都有。

## 优先级

```text
内置按钮  <  course.json 的 buttons（全局）  <  .vitent 的 buttons（本页，优先）
```

同一个 `id` 后者覆盖前者；`hidden: true` 把它去掉。内置按钮的 id 有：`back`、`focus`、`prev`、`next`、`highlight`、`edit`、`sidebar`、`notes`、`terminal`。

## 可以放按钮的位置

| slot | 位置 |
| --- | --- |
| `topbar.left` / `topbar.right` | 窗口顶栏（面包屑后 / 右侧图标区） |
| `lessonbar.left` / `lessonbar.right` | 课程栏（上一页下一页旁 / 标题右边） |
| `sidebar.bottom` | 左侧页面列表底部 |
| `page.end` | 每页末尾「标记完成」旁 |

按钮的 `action` 可以是 `exec`（执行命令）、`script`、`http`（调用后端接口）、`open`、`ask-ai`、`ui`（界面命令）、`copy`、`goto`、`sequence`。详见帮助里的「动作与按钮」。

:::success[导览结束 🎉]
你已经看完了所有功能。回到首页，点 **用 AI 生成课程**，让 AI 为你想学的任何东西做一门课吧。
:::
