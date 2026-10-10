---
title: 可运行的代码片段
kind: code
---

代码块加上 `run`，就会出现 **▶ 运行** 按钮，在你的电脑上真正执行。Node.js 内置在软件里，所以 JavaScript 示例总能运行；其他语言需要你装好对应的工具（Python、gcc……）。

:::info
第一次运行课程里的代码时，软件会问你是否**信任这门课**。课程只是文件，但可以执行命令，所以只信任来源可靠的课程。
:::

## JavaScript

```js run
const a = [2, 5, 8, 12, 16, 23, 38, 56];
function search(x) {
  let lo = 0, hi = a.length - 1, steps = 0;
  while (lo <= hi) {
    const mid = lo + ((hi - lo) >> 1);
    steps++;
    if (a[mid] === x) return { index: mid, steps };
    if (a[mid] < x) lo = mid + 1; else hi = mid - 1;
  }
  return { index: -1, steps };
}
console.log(search(23));
console.log(search(7));
```

## 带输入的程序

`stdin` 属性会作为标准输入传给程序：

```js run stdin="3\n4"
const [a, b] = require('fs').readFileSync(0, 'utf8').trim().split(/\s+/).map(Number);
console.log(`${a} + ${b} = ${a + b}`);
```

## 可以编辑的片段

加上 `editable`，片段会变成一个小编辑器——改完再运行：

```js run editable
// 试着把 n 改大一点
const n = 10;
const fib = [0, 1];
for (let i = 2; i < n; i++) fib.push(fib[i - 1] + fib[i - 2]);
console.log(fib.join(', '));
```

## Python（需要安装 Python 3）

```python run
import math
for n in [10, 1000, 10**6]:
    print(n, math.ceil(math.log2(n + 1)))
```

## C（需要 gcc）

```c run
#include <stdio.h>
int main(void) {
    for (int i = 1; i <= 3; i++) printf("line %d\n", i);
    return 0;
}
```
