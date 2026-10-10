---
title: 测验
kind: quiz
complete: quiz
---

页面里所有测验都答对，这一页就会自动标记完成（`complete: quiz`）。答错两次后可以查看答案。

:::quiz{id="q-sorted"}
二分查找对输入有什么要求？
- [ ] 数组长度必须是 2 的幂
- [x] 数组必须有序
- [ ] 数组里不能有重复元素
::::explain
只要有序就行。长度任意；有重复元素时也能找到**某一个**匹配位置。
::::
::::hint
想想每次比较之后，我们凭什么扔掉一半？
::::
:::

:::quiz{id="q-ologn" shuffle}
下面哪些操作的时间复杂度是 $O(\log n)$？（多选）
- [x] 在有序数组里二分查找
- [x] 在平衡二叉搜索树里查找
- [ ] 遍历一个链表
- [ ] 冒泡排序
::::explain
二分查找和平衡 BST 每一步都把问题规模减半；遍历链表是 $O(n)$，冒泡排序是 $O(n^2)$。
::::
:::

:::quiz{id="q-steps" type="number" answer="20" tolerance="0"}
一个有 1,000,000 个元素的有序数组，二分查找**最多**需要比较多少次？（填一个整数）
::::explain
$\lceil \log_2(1\,000\,001) \rceil = 20$。
::::
:::

:::quiz{id="q-name" answer="binary search|二分查找|折半查找"}
「每次和中间元素比较、扔掉一半」的查找方法叫什么？（中英文都可以）
:::

:::cloze{id="c-loop"}
补全二分查找的循环：

`while (lo [[<=]] hi)`，中点写成 `mid = lo + (hi - lo) / [[2]]`；如果 `a[mid] < x`，就令 `lo = [[mid + 1|mid+1]]`。
:::

:::parsons{id="p-bs"}
把下面的代码行拖成正确的顺序：

```python
def search(a, x):
    lo, hi = 0, len(a) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if a[mid] == x: return mid
        if a[mid] < x: lo = mid + 1
        else: hi = mid - 1
    return -1
```
:::

:::quiz{id="q-feel" type="survey"}
目前为止，这个软件用起来感觉怎么样？
- [ ] 很顺手
- [ ] 还行，有些地方不明白
- [ ] 有点乱
:::

:::quiz{id="q-explain" type="open"}
用你自己的话解释：为什么二分查找比顺序查找快？写完后可以点「请 AI 点评」。
:::
