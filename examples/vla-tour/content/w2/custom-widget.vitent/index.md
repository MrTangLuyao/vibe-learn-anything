---
title: 自定义交互组件
kind: lab
---

内置组件不够用时，AI 可以写一个小网页放进 `.vitent`，用 `::html` 嵌进来。它运行在隔离的沙箱里，通过 `vla://_/bridge.js` 和软件对话：保存状态、标记完成、运行动作、问 AI，并且自动使用软件的配色。

下面是一个二分查找可视化。找到目标后，这一页会自动标记完成。

::html[二分查找可视化]{src="widgets/bsearch.html" height="380"}

:::details[这个组件是怎么写的？]
```html
<script src="vla://_/bridge.js"></script>
<script>
  const info = await vla.ready();      // 主题、语言、上次保存的状态
  await vla.setState({ found: true }); // 每个学习者单独保存
  vla.complete();                      // 标记本页完成
  vla.ask('为什么 mid 要这样算？');     // 打开「问 AI」
</script>
```
完整接口见帮助文档里的「组件大全 → html」。
:::
