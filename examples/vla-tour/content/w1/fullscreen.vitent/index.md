---
title: 全屏代码练习
kind: code
complete: tests
---

:::::fullscreen
::::workspace{id="ws-fizzbuzz" runner="node" main="main.js" title="FizzBuzz · 全屏"}
这一页只有一个 `:::fullscreen` 块，所以代码区铺满了整个阅读区。补全 `main.js`，然后点 **提交**。遇到问题可以点右上角的 **AI**。

```js file=main.js
// 打印 1..n：3 的倍数打印 Fizz，5 的倍数打印 Buzz，同时是两者的倍数打印 FizzBuzz
const input = process.stdin.isTTY ? '' : require('fs').readFileSync(0, 'utf8').trim();
const n = input ? Number(input) : 15;

for (let i = 1; i <= n; i++) {
  // TODO: 按规则打印
  console.log(i);
}
```

:::tests
```yaml
- name: n = 5
  stdin: "5"
  expect: "1\n2\nFizz\n4\nBuzz"
- name: n = 15
  stdin: "15"
  expect: "1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz"
```
:::

:::hint
先判断「同时是 3 和 5 的倍数」，再分别判断 3 和 5。
:::
::::
:::::
