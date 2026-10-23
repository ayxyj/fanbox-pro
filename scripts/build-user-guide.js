'use strict';
const fs = require('fs'), path = require('path');
const { marked } = require('marked');
const root = path.resolve(__dirname, '../docs/user-guide');
const summary = fs.readFileSync(path.join(root, 'SUMMARY.md'), 'utf8');
const entries = [...summary.matchAll(/\* \[([^\]]+)\]\(([^)]+)\)/g)].map(([, title, file]) => ({ title, file }));
let imageCount = 0;
const pages = entries.map(entry => {
  const md = fs.readFileSync(path.join(root, entry.file), 'utf8');
  for (const match of md.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|#)/.test(target)) continue;
    if (!fs.existsSync(path.resolve(root, target.split('#')[0]))) throw Error('Missing link: ' + entry.file + ' -> ' + target);
    if (target.startsWith('assets/')) imageCount++;
  }
  return { ...entry, text: md, html: marked.parse(md) };
});
const data = JSON.stringify(pages).replace(/</g, '\\u003c');
const metadata=pages.find(page=>page.file==='README.md')?.text.match(/^\*\*适用版本：(.+?)\*\*$/m)?.[1];
if(!metadata)throw Error('User guide version/date metadata is missing');
const safeMetadata=metadata.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
fs.writeFileSync(path.join(root, 'index.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>fanbox-pro 用户指南</title>
<style>
:root{color-scheme:light;--ink:#17243b;--muted:#62748d;--line:#e2e8f0;--accent:#2964ce}
*{box-sizing:border-box}body{margin:0;color:var(--ink);background:#fff;font:16px/1.85 "Segoe UI","Microsoft YaHei",sans-serif}
aside{position:fixed;inset:0 auto 0 0;width:280px;overflow:auto;padding:28px 20px;background:#f5f7fb;border-right:1px solid var(--line)}
.brand{font-size:21px;font-weight:700;letter-spacing:-.5px}.version{color:var(--muted);font-size:12px;margin:4px 0 20px}
input{width:100%;font:inherit;font-size:14px;border:1px solid #cbd5e1;border-radius:8px;padding:9px 12px;background:white}
nav{margin-top:18px}nav a{display:block;padding:8px 12px;margin:3px 0;border-radius:7px;text-decoration:none;color:#40516b;font-size:14px;line-height:1.6}
nav a:hover,nav a.active{background:#e4ecfc;color:#174da5}main{margin-left:280px;padding:40px clamp(24px,6vw,90px) 80px;max-width:1420px}
.crumb{font-size:13px;color:var(--muted);border-bottom:1px solid var(--line);padding-bottom:18px;margin-bottom:32px}
article{max-width:980px}h1{font-size:34px;line-height:1.35;letter-spacing:-.6px;margin:0 0 24px}h2{font-size:23px;margin:40px 0 16px}h3{font-size:18px}
p{margin:15px 0}a{color:var(--accent)}img{max-width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:10px;cursor:zoom-in;margin:22px 0 12px}
em{color:var(--muted);font-size:14px}table{display:block;overflow:auto;border-collapse:collapse;width:100%;margin:22px 0;font-size:14px}
td,th{padding:12px 16px;text-align:left;border:1px solid var(--line);vertical-align:top}th{background:#f0f4fa;white-space:nowrap}
blockquote{margin:24px 0;padding:10px 20px;border-left:4px solid #e6ae3d;background:#fff9eb;font-size:15px}
pre{overflow:auto;background:#15233a;color:#e7efff;padding:20px;border-radius:9px;line-height:1.65}code{font-family:Consolas,monospace;font-size:.9em}p code,li code,td code{background:#edf2fa;padding:2px 5px;border-radius:4px}
li{margin:6px 0}.pager{display:flex;gap:16px;justify-content:space-between;border-top:1px solid var(--line);margin-top:42px;padding-top:24px}.pager a{text-decoration:none}
dialog{border:0;border-radius:10px;max-width:96vw;max-height:96vh;padding:12px;background:#fff}dialog::backdrop{background:#000b}dialog img{max-height:88vh;max-width:92vw;object-fit:contain;margin:0;cursor:zoom-out}dialog button{display:block;margin:0 0 8px auto;padding:6px 14px}
@media(max-width:800px){aside{position:static;width:auto;max-height:320px;border-bottom:1px solid var(--line)}main{margin:0;padding:28px 18px}h1{font-size:27px}}
@media print{aside,.crumb,.pager{display:none}main{margin:0;padding:0}img,table{break-inside:avoid}a{color:inherit}pre{white-space:pre-wrap}}
</style></head><body><aside><div class="brand">fanbox-pro</div><div class="version">用户指南 · ${safeMetadata}</div><input id="search" aria-label="搜索章节内容" placeholder="搜索操作、命令或错误…"><nav></nav></aside>
<main><div class="crumb">使用指南 / <span id="current"></span>　·　点击截图可放大</div><article></article><div class="pager"></div></main>
<dialog id="zoom"><button type="button">关闭</button><img alt="放大后的界面截图"></dialog>
<script>
const pages=${data};let selected=0;
const nav=document.querySelector('nav');
function navigation(){const q=document.querySelector('#search').value.toLowerCase();nav.replaceChildren();pages.forEach((p,i)=>{if(q&&!p.text.toLowerCase().includes(q))return;const a=document.createElement('a');a.href='#'+p.file;a.textContent=p.title;a.classList.toggle('active',i===selected);nav.append(a);});}
function show(){const file=decodeURIComponent(location.hash.slice(1))||'README.md';selected=Math.max(0,pages.findIndex(p=>p.file===file));const p=pages[selected];document.querySelector('article').innerHTML=p.html;document.querySelector('#current').textContent=p.title;document.title=p.title+' · fanbox-pro 用户指南';document.querySelector('.pager').innerHTML=[selected>0?'<a href="#'+pages[selected-1].file+'">← '+pages[selected-1].title+'</a>':'<span></span>',selected<pages.length-1?'<a href="#'+pages[selected+1].file+'">'+pages[selected+1].title+' →</a>':''].join('');navigation();scrollTo(0,0);}
document.querySelector('#search').oninput=navigation;onhashchange=show;
document.querySelector('article').onclick=e=>{const image=e.target.closest('img');if(image){document.querySelector('#zoom img').src=image.src;document.querySelector('#zoom').showModal();return;}const a=e.target.closest('a');if(a&&a.getAttribute('href')?.endsWith('.md')){e.preventDefault();if(a.getAttribute('href')==='SUMMARY.md'){document.querySelector('#search').focus();return;}location.hash=a.getAttribute('href');}};
document.querySelector('#zoom button').onclick=()=>document.querySelector('#zoom').close();document.querySelector('#zoom img').onclick=()=>document.querySelector('#zoom').close();show();
</script></body></html>`, 'utf8');
console.log(`Validated ${pages.length} pages and ${imageCount} image references; built offline index.html`);
