// 把 ES 模块图与 CSS 打成一个自包含的 standalone.html
//
// 为什么需要：
//  - 不依赖任何构建工具链，也不依赖托管方对 .js 的 MIME 处理
//  - 可以直接 file:// 打开，也可以放在任何只会渲染 HTML 的地方
//  - 模块图无循环依赖、只用具名导出，所以按拓扑序拼接 + 去掉 import/export 即可
//
// 用法：node tools/bundle.js

import { readFileSync, writeFileSync } from 'node:fs';

const ORDER = [
  'src/math/prf.js',
  'src/math/rules.js',
  'src/math/keeper.js',
  'src/math/actions.js',
  'src/math/contract.js',
  'src/math/engine.js',
  'src/providers/outcomeProvider.js',
  'src/providers/localProvider.js',
  'src/ui/app.js',
];

function strip(src) {
  return (
    src
      // 去掉所有 import 语句（含多行形式）
      .replace(/^\s*import\s+[^;]*?from\s*['"][^'"]+['"]\s*;?\s*$/gms, '')
      .replace(/^\s*import\s*['"][^'"]+['"]\s*;?\s*$/gm, '')
      // export const/function/class/let/var -> 去掉 export 关键字
      .replace(/^\s*export\s+(?=(const|let|var|function|class|async))/gm, '')
      // 去掉 export { ... }
      .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gms, '')
  );
}

const parts = ORDER.map((f) => {
  const body = strip(readFileSync(f, 'utf8')).trim();
  return `\n/* ======== ${f} ======== */\n${body}\n`;
});

const css = readFileSync('src/ui/style.css', 'utf8');
const html = readFileSync('index.html', 'utf8');

// 从 index.html 取出 head 里的 meta/title，重建一个自包含文档
const title = (html.match(/<title>([^<]*)<\/title>/) ?? [, '点球大赛'])[1];

const out = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="theme-color" content="#0a1220">
<meta name="description" content="点球大赛即时赢游戏 · 首版灰盒（S0+S1）· 开发期演示，模拟币，18+">
<title>${title}</title>
<link rel="icon" href="data:,">
<style>
${css}
</style>
</head>
<body>
<div id="app"></div>
<noscript style="color:#e8eef7;font-family:sans-serif;padding:16px;display:block">本演示需要启用 JavaScript。</noscript>
<script>
"use strict";
(function(){
${parts.join('\n')}
})();
</script>
</body>
</html>
`;

writeFileSync('standalone.html', out);
console.log(`standalone.html 已生成：${(out.length / 1024).toFixed(1)} KB，内联 ${ORDER.length} 个模块`);
