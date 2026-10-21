const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const workspace = path.resolve(__dirname, '..');
const scratch = path.join(workspace, 'dist', 'test-data');
fs.mkdirSync(scratch, { recursive: true });
const profile = fs.mkdtempSync(path.join(scratch, 'guide-preview-'));
app.setPath('userData', profile);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 1050, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  try {
    await win.loadFile(path.join(workspace, process.env.GUIDE_DIRECTORY || 'docs/user-guide', 'index.html'));
    assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('nav a').length"), 18);
    await win.webContents.executeJavaScript(`(async()=>{
      for(const page of pages){
        location.hash=page.file;show();
        if(document.querySelector('h1')?.textContent!==page.title)throw Error('Wrong heading: '+page.file);
        await Promise.all([...document.querySelectorAll('article img')].map(i=>i.decode()));
        if(document.documentElement.scrollWidth>innerWidth)throw Error('Horizontal overflow: '+page.file);
      }
      document.querySelector('#search').value='密码';document.querySelector('#search').dispatchEvent(new Event('input'));
      if(!document.querySelector('nav a'))throw Error('Search missing results');
      document.querySelector('#search').value='';navigation();location.hash='ai-settings.md';show();
    })()`);
    await new Promise(r => setTimeout(r, 300));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(profile, 'guide-preview.png'), image.toPNG());
    console.log('PASS: 18 chapters, navigation, search, all screenshots load, no horizontal overflow');
    console.log(path.join(profile, 'guide-preview.png'));
  } finally { win.destroy(); app.quit(); }
}).catch(error => { console.error(error); app.exit(1); });
