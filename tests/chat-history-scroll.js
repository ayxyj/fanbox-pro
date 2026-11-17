'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await window.loadURL('data:text/html,<style>.remote-log{height:240px;overflow:auto;overflow-anchor:none}article{height:40px}</style><div class="remote-log"></div>');
    const source = fs.readFileSync('public/remote-workspace.js', 'utf8');
    const draw = source.slice(source.indexOf('  function drawLog('), source.indexOf('  async function startAI('));
    const result = await window.webContents.executeJavaScript(`
      try {
      const body = document.body, panel = {hidden:false}, tab = 'ai', selected = 'test';
      const current = {items:Array.from({length:350}, (_, i)=>({key:String(i),kind:'assistant',text:'message '+i}))};
      const chat = () => current;
      const renderChatAuthor = () => {};
      const renderMessage = (node,item) => {node.textContent=item.text};
      const renderMessageControls = () => {};
      ${draw}
      const log = body.querySelector('.remote-log');
      const assert = (value, message) => {if(!value)throw Error(message)};
      drawLog();
      assert(log.querySelectorAll('article').length===100, 'initial page');
      log.scrollTop=400;
      const anchor=log.querySelector('[data-message-id="260"]');
      const before=anchor.getBoundingClientRect().top;
      log.querySelector('button').click();
      assert(Math.abs(anchor.getBoundingClientRect().top-before)<2, 'prepend scroll anchor');
      assert(log.querySelector('article').dataset.messageId==='150', 'older messages precede recent messages');
      log.scrollTop=0; log.onscroll();
      log.scrollTop=0; log.onscroll();
      assert(log.querySelector('article').dataset.messageId==='0', 'earliest message reachable');
      assert([...log.querySelectorAll('article')].every((node,i)=>node.dataset.messageId===String(i)), 'chronological order');
      log.scrollTop=400;
      const reading=log.querySelector('[data-message-id="10"]'), readingTop=reading.getBoundingClientRect().top;
      current.items.push({key:'350',kind:'assistant',text:'new reply'});
      drawLog();
      assert(Math.abs(reading.getBoundingClientRect().top-readingTop)<2,'new replies preserve reading position');
      assert(log.querySelector('article').dataset.messageId==='0','new replies retain oldest loaded message');
      'PASS: chronological pagination, scroll anchoring, top loading and new-message stability';
      } catch(error) { error.stack; }
    `);
    if (!String(result).startsWith('PASS:')) throw Error(result);
    console.log(result);
    await window.webContents.insertCSS(fs.readFileSync('public/remote-workspace.css','utf8'));
    const controls = source.slice(source.indexOf('  const copyTimers'), source.indexOf('  function renderChatAuthor'));
    const controlsResult = await window.webContents.executeJavaScript(`(async () => {
      let copied = '';
      Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{writeText:async text=>{copied=text}} });
      const wrap = fn => fn;
      ${controls}
      const assert = (value,message)=>{if(!value)throw Error(message)};
      for(const kind of ['user','assistant','command']) {
        const node=document.createElement('article');node.className='chat-message chat-'+kind;node.innerHTML='<div class="chat-content"></div>';document.body.append(node);
        const item={kind,text:'**original Markdown**',metrics:kind==='assistant'?{model:'fixture',maxTokens:8192,usage:{prompt_tokens:123,completion_tokens:45}}:null};
        renderMessageControls(node,item);
        const button=node.querySelector('.chat-copy');assert(button,'copy available '+kind);
        const style=getComputedStyle(button);assert(style.top==='6px','copy at top '+kind);assert(kind==='user'?style.left==='6px':style.right==='6px','copy corner '+kind);
        await button.onclick();assert(copied===item.text,'copies source '+kind);assert(button.textContent==='✓','success feedback '+kind);
        item.text='updated streaming response';renderMessageControls(node,item);await button.onclick();assert(copied===item.text,'copies latest response');
        assert(node.querySelectorAll('.chat-copy').length===1,'no duplicate buttons');
        if(kind==='assistant') {const details=node.querySelector('.chat-metrics');assert(details.parentElement.className==='chat-content','inline metadata');assert(details.querySelector('summary').textContent.includes('输入 123'),'usage summary');assert(details.querySelector('div').textContent.includes('8192'),'expanded details');assert(!details.open,'collapsed by default');}
      }
      await new Promise(resolve=>setTimeout(resolve,1700));
      assert([...document.querySelectorAll('.chat-copy')].every(button=>button.textContent==='⧉'),'feedback resets');
      return 'PASS: copy for all message kinds, latest text, success feedback and inline usage';
    })().catch(error=>error.stack)`);
    if(!String(controlsResult).startsWith('PASS:'))throw Error(controlsResult);
    console.log(controlsResult);

  } finally { window.destroy(); app.quit(); }
}).catch(error => { console.error(error); app.exit(1); });
