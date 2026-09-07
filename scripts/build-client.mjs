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
