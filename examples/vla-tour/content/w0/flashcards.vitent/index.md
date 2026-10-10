---
title: 记忆卡片
kind: quiz
complete: view
---

主动回忆比反复阅读更有效。点击卡片翻面，用左右按钮切换。

:::flashcards{id="fc-complexity"}
- q: "二分查找的时间复杂度？"
  a: "$O(\\log n)$ —— 每一步把搜索区间减半。"
- q: "二分查找的前提条件？"
  a: "数组（或搜索空间）**有序** / 单调。"
- q: "`mid = (lo + hi) / 2` 有什么隐患？"
  a: "`lo + hi` 可能整数溢出。推荐写成 `lo + (hi - lo) / 2`。"
- q: "循环条件应该写 `lo < hi` 还是 `lo <= hi`？"
  a: "闭区间 `[lo, hi]` 写法用 `lo <= hi`；否则会漏掉最后一个元素。"
:::

:::tip
卡片的内容就是 YAML：每张卡一个 `q` 和一个 `a`，里面可以写 Markdown 和公式。
:::
