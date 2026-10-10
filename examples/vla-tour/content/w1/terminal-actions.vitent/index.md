---
title: 终端与动作
kind: lab
actions:
  list-files:
    type: exec
    label: 列出本页文件
    command:
      win: dir /b
      posix: ls
  run-check:
    type: script
    label: 运行检查脚本
    file: scripts/check.js
    args: ["{{page.title}}"]
  zen:
    type: http
    label: 请求一个公开 API
    method: GET
    url: https://api.github.com/zen
  ask-summary:
    type: ask-ai
    prompt: 用三句话总结「{{page.title}}」这一页讲了什么。
  copy-cmd:
    type: copy
    text: node --version
---

课程可以预先写好「动作」：执行命令、运行脚本、请求后端接口、问 AI、复制文字、跳转页面……一点就执行。

## 按钮

::button[列出这一页 .vitent 里的文件]{action="list-files" icon="folder-open"}

::button[运行 scripts/check.js]{action="run-check" variant="primary"}

::button[请求 GitHub Zen API（需要联网）]{action="zen" icon="globe" variant="outline"}

行内按钮也行：:btn[查看 Node 版本]{action="node-version"}、:btn[复制命令]{action="copy-cmd"}、:btn[让 AI 总结本页]{action="ask-summary"}。

## 内嵌终端

::terminal[本页文件夹里的终端]{height="240"}

也可以预设一条命令：

::terminal[运行脚本]{command="node scripts/check.js hello" height="160"}

:::note
底部也有一个终端面板：点右上角的 :icon[square-terminal] 或按 :kbd[Ctrl] + :kbd[`]。
:::
