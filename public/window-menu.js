(() => {
  if (!window.fanboxWindowMenu || window.fanboxEnv?.platform !== 'win32') return;
  const style = document.createElement('style');
  style.textContent = `
    body {padding-top:35px}
    #app {height:calc(100vh - 35px)}
    .window-menu {position:fixed;inset:0 0 auto 0;height:35px;display:flex;align-items:center;gap:2px;padding:0 145px 0 10px;background:var(--bg,#151714);color:var(--text,#e4e7df);border-bottom:1px solid var(--border,#30332c);z-index:9999;-webkit-app-region:drag;user-select:none}
    .window-menu img {width:20px;height:20px;margin-right:7px;pointer-events:none}
    .window-menu button {height:29px;padding:0 10px;border:0;border-radius:4px;background:transparent;color:inherit;font:inherit;font-size:12px;-webkit-app-region:no-drag}
    .window-menu button:hover,.window-menu button:focus-visible {background:rgba(128,128,128,.2)}
  `;
  document.head.append(style);
  const bar = document.createElement('nav');
  bar.className = 'window-menu'; bar.setAttribute('aria-label', '应用菜单');
  const icon = document.createElement('img'); icon.src = '/brand-icon.png'; icon.alt = '';
  bar.append(icon); document.body.prepend(bar);
  let frame, lastColors = '';
  const syncColors = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const css = getComputedStyle(bar);
      const hex = color => {
        const channels = color.match(/[\d.]+/g);
        return channels?.length >= 3 ? '#' + channels.slice(0,3).map(n => Math.round(Math.min(255,Math.max(0,Number(n)))).toString(16).padStart(2,'0')).join('') : null;
      };
      const color = hex(css.backgroundColor), symbolColor = hex(css.color);
      if (!color || !symbolColor || lastColors === color + symbolColor) return;
      lastColors = color + symbolColor;
      window.fanboxWindowMenu.colors({color,symbolColor}).catch(() => { lastColors = ''; });
    });
  };
  new MutationObserver(syncColors).observe(document.documentElement, {attributes:true,attributeFilter:['style','class','data-theme','data-theme-mode']});
  window.addEventListener('load',syncColors);
  syncColors();
  window.fanboxWindowMenu.list().then(labels => labels.forEach((label,index) => {
    const button = document.createElement('button');
    button.textContent = label.replace(/&/g, ''); button.setAttribute('aria-haspopup', 'menu');
    button.onclick = () => {
      const rect = button.getBoundingClientRect();
      window.fanboxWindowMenu.open({index,x:rect.left,y:rect.bottom}).catch(() => {});
    };
    bar.append(button);
  })).catch(() => {});
})();
