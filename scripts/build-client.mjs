import { build } from 'esbuild'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

await build({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  jsx: 'automatic',
  outfile: 'lib/.client.bundle.cjs',
  external: ['@deepseek-ai/*', 'react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  sourcemap: false,
  logLevel: 'info',
})

const body = readFileSync('lib/.client.bundle.cjs', 'utf8')
rmSync('lib/.client.bundle.cjs')

// 宿主包防线（回归闸）：浏览器模块表里只有少数平台种子包，插件产物若 require 了
// 宿主包（例如宿主 settings 模块带进来的 schemastery），加载时会直接
// "missed the module table" 而整插件不激活。
// 客户端代码必须只从 src/shared/*（纯字面量）与 src/client/* 取值——类型导入会被
// esbuild 抹掉，故这里查的是**真实 require**。
const FORBIDDEN = ['@deepseek-ai/schemastery', '@deepseek-ai/dsh-settings']
for (const specifier of FORBIDDEN) {
  if (body.includes('require("' + specifier + '")') || body.includes("require('" + specifier + "')")) {
    throw new Error(
      '[build-client] 客户端产物引用了宿主包 ' + specifier + ' —— ' +
      '浏览器模块表里没有它，加载会失败。请改为从 src/shared/* 取纯常量/类型。',
    )
  }
}

let cssBlock = ''
try {
  const cssFile = readFileSync(new URL('../src/client/styles.css', import.meta.url), 'utf8')
  if (cssFile.trim()) {
    cssBlock = [
      'if (typeof document !== "undefined") {',
      '  try {',
      "    if (!document.getElementById('mgcn-nav-styles')) {",
      "      var mgcnStyle = document.createElement('style');",
      "      mgcnStyle.id = 'mgcn-nav-styles';",
      "      mgcnStyle.setAttribute('data-plugin', '" + pkg.name + "');",
      "      mgcnStyle.textContent = " + JSON.stringify(cssFile) + ';',
      '      document.head.appendChild(mgcnStyle);',
      '    }',
      '  } catch (e) { }',
      '}',
    ].join('\n')
  }
} catch { }

const versionBlock = "const PKG_VERSION = '" + pkg.version + "';"

const out = [
  'window.__ModuleLoader__.load({',
  "  id: '" + pkg.name + "',",
  '  factory: (require) => {',
  '    var module = { exports: {} };',
  '    var exports = module.exports;',
  cssBlock,
  versionBlock,
  body,
  '    return module.exports;',
  '  }',
  '});',
  '',
].join('\n')

writeFileSync('lib/client.js', out)
console.log('lib/client.js written (' + out.length + ' bytes)')
