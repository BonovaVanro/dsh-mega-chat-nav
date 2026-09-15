/**
 * 构建前 CSS 结构校验：跳过注释与字符串后逐块跟踪深度。
 *
 * 为什么需要：`git diff` 与"花括号计数"都看不出"多一个 } 提前闭合上下文"这类错误，
 * 而它会让其后的**整段样式被浏览器丢弃**（曾把 codex 与 harness 两段一起搞没）。
 */
import { readFileSync } from 'node:fs'

const path = new URL('../src/client/styles.css', import.meta.url)
const css = readFileSync(path, 'utf8')
let i = 0
let line = 1
let depth = 0
let buf = ''
const problems = []
while (i < css.length) {
  const ch = css[i]
  if (ch === '\n') { line += 1; i += 1; continue }
  if (ch === '/' && css[i + 1] === '*') {
    const end = css.indexOf('*/', i + 2)
    if (end < 0) { problems.push('未闭合注释（起于第 ' + line + ' 行）'); break }
    line += (css.slice(i, end).match(/\n/g) ?? []).length
    i = end + 2
    continue
  }
  if (ch === '"' || ch === "'") {
    const quote = ch
    let j = i + 1
    while (j < css.length && css[j] !== quote) { if (css[j] === '\\') j++; if (css[j] === '\n') line++; j++ }
    i = j + 1
    continue
  }
  if (ch === '{') { depth += 1; buf = ''; i += 1; continue }
  if (ch === '}') {
    depth -= 1
    if (depth < 0) { problems.push('多余的 } （第 ' + line + ' 行）'); depth = 0 }
    buf = ''
    i += 1
    continue
  }
  if (ch === ';') buf = ''
  else buf += ch
  i += 1
}
if (depth !== 0) problems.push('文件结束时仍有 ' + depth + ' 个未闭合的块')
if (problems.length > 0) {
  console.error('styles.css 结构校验失败：')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log('styles.css 结构校验通过（块配平）')
