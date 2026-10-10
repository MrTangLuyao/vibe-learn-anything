# 06 · 代码与运行环境

课程里的代码在**学习者自己的电脑上**真正运行：可运行代码块（` ```lang run `）、代码工作区（`:::workspace`）、
`exec` / `script` 动作和终端。

## Node.js 永远可用

软件自带 Node.js（和软件同一个运行时，版本 ≥ 24），所以 **`node`、TypeScript（`.ts`，类型擦除）和 `vla` 命令在课程里总是能用**——
即使学习者电脑上没装 Node。其他语言需要学习者自己安装工具，请在 `course.json` 的 `requirements` 里写明，并在访谈时确认。

> 学习者没有任何编程环境、课程又不是专门学某门语言时，**优先用 JavaScript 出练习**。

## 运行器（runner）

| runner | 主文件 | 编译 `build` | 运行 `run` |
| --- | --- | --- | --- |
| `node` | `main.js` | — | `{node} {main}` |
| `typescript` | `main.ts` | — | `{node} {main}` |
| `python` | `main.py` | — | `{python} {main}` |
| `c` | `main.c` | `gcc -Wall -std=c11 -g -o main{exe} {files:.c} -lm` | `{bin:main}` |
| `cpp` | `main.cpp` | `g++ -Wall -std=c++17 -g -o main{exe} {files:.cpp}` | `{bin:main}` |
| `java` | `Main.java` | `javac {files:.java}` | `java Main` |
| `go` | `main.go` | — | `go run {main}` |
| `rust` | `main.rs` | `rustc -o main{exe} {main}` | `{bin:main}` |
| `ruby` | `main.rb` | — | `ruby {main}` |
| `bash` | `main.sh` | — | `bash {main}` |
| `powershell` | `main.ps1` | — | `powershell -NoProfile -ExecutionPolicy Bypass -File {main}` |
| `sql` | `main.sql` | — | `sqlite3 -header -column :memory: < {main}` |

代码块的语言名会自动对应运行器：`js`/`javascript` → `node`，`py` → `python`，`c++`/`cc` → `cpp`，`sh` → `bash`，`ps1` → `powershell` 等。

### 自定义 / 覆盖运行器

在 `course.json` 里：

```json
"runners": {
  "c": { "build": "gcc -Wall -Wextra -std=c99 -g -o main{exe} {files:.c}" },
  "haskell": { "label": "Haskell", "main": "Main.hs", "build": "ghc -o main{exe} {main}", "run": "{bin:main}" },
  "wslc": { "label": "C (WSL)", "main": "main.c", "build": "wsl gcc -o main main.c", "run": "wsl ./main" }
}
```

字段：`label`、`main`、`build`（可选）、`run`。命令可以是字符串，也可以是 `{ "win": "…", "posix": "…" }`。

### 模板变量

| 变量 | 含义 |
| --- | --- |
| `{main}` | 主文件名 |
| `{files:.c}` | 工作区里所有 `.c` 文件（递归、加引号、空格分隔） |
| `{exe}` | Windows 上是 `.exe`，其他系统为空 |
| `{bin:main}` | 运行编译出来的程序：Windows `.\main.exe`，其他 `./main` |
| `{node}` | Node.js |
| `{python}` | 检测到的 Python 3（Windows 优先 `py -3`），学习者可在设置里改 |
| `{dir}` | 当前工作目录（绝对路径） |
| `{page}` | 当前 `.vitent` 文件夹（绝对路径） |
| `{course}` | 课程根目录（绝对路径） |
| `{file}` | 代码块运行时的临时文件名 |

### 跨平台

- Windows 上命令由 `cmd.exe` 执行，macOS / Linux 由 `/bin/sh` 执行。`&&`、`<`、`>` 两边都能用。
- 不同的写法用 `{ "win": "...", "posix": "..." }`。
- 输出统一按 UTF-8 处理（Windows 上会自动切换代码页），Python 会以 UTF-8 输出。

## 代码工作区的运行与测试

- **运行**：在工作区下方的真终端（pseudo-terminal）里执行 `build && run`，学习者可以交互输入（`scanf`、`input()`）。
- **提交**：先执行一次 `build`（或 `::::tests{build="…"}`），然后对每个测试用例**单独**执行 `run`（加上 `args`），
  把 `stdin` 送进去，比较标准输出。程序在测试时**不是**在终端里运行（`isatty` 为假，Node 里 `process.stdin.isTTY` 为 `undefined`）。

技巧：

```js
// 测试时从标准输入读；学习者在终端点「运行」时用默认值
const input = process.stdin.isTTY ? '' : require('fs').readFileSync(0, 'utf8').trim();
```

- 输出比较默认忽略行尾空白和首尾空行（`match: trim`）。浮点数请在题目里规定输出格式（如 `%.2f`）。
- 测试超时默认 10 秒，代码块运行默认 20 秒，`exec` 动作默认 30 秒。
- 学习者的代码在 `learner/workspaces/<页面键>/<工作区id>/`，导出给 AI 时你能看到。编译产物（`.exe`、`.o`、`.class` 等）不会被打包。

## 终端

- 底部终端：学习者随时可以打开 shell（本页文件夹 / 课程文件夹 / 用户目录）。
- `::terminal` 组件：嵌在页面里；可以预设 `command`。
- `exec` 动作 `output: terminal`：在底部终端新开一个标签运行命令。
- 终端里 `node` 和 `vla` 命令总是可用；学习者电脑上的其他工具照常可用。

## 环境要求与提示

```json
"requirements": [
  { "name": "gcc", "hint": "**Windows**：安装 MSYS2，然后 `pacman -S mingw-w64-ucrt-x86_64-gcc`；**macOS**：`xcode-select --install`；**Ubuntu**：`sudo apt install build-essential`" },
  { "name": "python", "hint": "从 python.org 安装 Python 3，安装时勾选 Add to PATH。" }
]
```

缺少的工具会在课程页顶部提示，`hint` 是 Markdown。

## 信任

课程第一次要运行命令时（代码块、工作区、`exec` / `script` / `http` 动作、带命令的终端），
软件弹出系统对话框，学习者选择「信任此课程」「仅这一次」或「取消」。信任可以在设置里撤销。
请让命令和课程内容一致、可预期。
