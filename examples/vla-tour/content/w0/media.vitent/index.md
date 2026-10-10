---
title: PDF、Word 与多媒体
kind: pdf
---

`.vitent` 可以装任何文件。AI 可以把你的讲义、作业说明、录音一起放进课程里。

## PDF

PDF 用内置的 pdf.js 显示，文字可以直接**选中、高亮、问 AI**：

::pdf{src="assets/binary-search.pdf" height="560"}

## Word 文档

`.docx` 会被转换成正文显示，所以同样可以高亮：

::doc[学习笔记.docx]{src="assets/study-notes.docx"}

## 图片

::image{src="assets/array.svg" caption="有序数组上的一次二分查找" width="640"}

## 音频

::audio[一个和弦（音频示例）]{src="assets/chord.wav"}

## 附件

任何文件都可以作为附件，点「打开」用系统里的应用打开：

::file[二分查找讲义（PDF）]{src="assets/binary-search.pdf"}

行内附件也可以：:file[study-notes.docx]{src="assets/study-notes.docx"}。

## 视频

本地视频用 `::video{src="assets/xxx.mp4"}`；也支持 YouTube / bilibili / Vimeo 链接（需要联网）：

```text
::video[讲解视频]{src="https://www.bilibili.com/video/BV1xx411c7mD"}
```
