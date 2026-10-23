'use strict';
const assert = require('assert/strict');
(async () => {
  const {micromark} = await import('micromark');
  const {math, mathHtml} = await import('micromark-extension-math');
  const render = source => micromark(source, {extensions:[math()], htmlExtensions:[mathHtml({trust:false})]});
  assert.match(render('$x^2 + y^2$'), /class="katex"/);
  assert.match(render('$$\n\\frac{1}{2}\n$$'), /katex-display/);
  assert.doesNotMatch(render('$\\href{javascript:alert(1)}{click}$'), /href="javascript:/);
  console.log('PASS patched math extension renders inline/block formulas and rejects untrusted links');
})().catch(error => {console.error(error);process.exitCode=1;});
