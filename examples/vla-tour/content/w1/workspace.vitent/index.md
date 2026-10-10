---
title: 代码工作区
kind: code
complete: tests
---

`:::workspace` 是一个完整的练习环境：文件列表、多标签编辑器（VS Code 同款 Monaco）、终端、运行和测试。你写的代码保存在课程的 `learner/` 文件夹里，导出给 AI 时它能看到并点评。

## 练习：实现二分查找

补全 `search.js` 里的 `binarySearch`，然后点 **提交** 运行测试。点 **运行** 会在下方终端里执行 `main.js`，你可以在终端里继续输入命令。

:::workspace{id="ws-bsearch" runner="node" main="main.js" title="binary-search" height="560"}
```js file=main.js
const { binarySearch } = require('./search.js');

const a = [2, 5, 8, 12, 16, 23, 38, 56];
// 测试会通过标准输入传入数字；在终端里直接运行时用默认值 23
const input = process.stdin.isTTY ? '' : require('fs').readFileSync(0, 'utf8').trim();
const x = input ? Number(input) : 23;
console.log(binarySearch(a, x));
```

```js file=search.js
// 返回 x 在有序数组 a 中的下标；找不到返回 -1
function binarySearch(a, x) {
  // TODO: 在这里写你的代码
  return -1;
}

module.exports = { binarySearch };
```

::::tests
```yaml
- name: 找到中间的元素
  stdin: "16"
  expect: "4"
- name: 找到最后一个元素
  stdin: "56"
  expect: "7"
- name: 找到第一个元素
  stdin: "2"
  expect: "0"
- name: 找不到时返回 -1
  stdin: "7"
  expect: "-1"
- name: 隐藏测试
  stdin: "38"
  expect: "6"
  hidden: true
```
::::

::::hint
维护闭区间 `[lo, hi]`，循环条件是 `lo <= hi`。
::::

::::solution
```js file=search.js
function binarySearch(a, x) {
  let lo = 0, hi = a.length - 1;
  while (lo <= hi) {
    const mid = lo + ((hi - lo) >> 1);
    if (a[mid] === x) return mid;
    if (a[mid] < x) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

module.exports = { binarySearch };
```
::::
:::

:::tip[快捷键]
编辑器里 :kbd[Ctrl] + :kbd[S] 保存（也会自动保存），:kbd[Ctrl] + :kbd[Enter] 运行。右上角 :icon[maximize-2] 可以最大化。
:::

## 其他语言

把 `runner` 换成 `python`、`c`、`cpp`、`java`、`go`、`rust`……就是对应语言的工作区；也可以用 `build=` 和 `run=` 写任意命令。详见帮助里的「代码与运行环境」。
