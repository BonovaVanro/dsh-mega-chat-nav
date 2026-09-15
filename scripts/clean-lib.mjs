/**
 * 构建前清理 lib/：tsc 不会删除被移除源文件的旧输出，孤儿产物（例如已删除的模块）
 * 会被 npm pack 一起打进去。源码在 src/，lib/ 纯产物，可安全整体重建。
 */
import { rmSync } from 'node:fs'

rmSync(new URL('../lib', import.meta.url), { recursive: true, force: true })
