'use strict';
(function(root) {
  function refreshTerminalLayout(session, recoverDisplay = false) {
    const { xterm, fit, host } = session;
    if (!fit || !host.isConnected || !host.clientWidth || !host.clientHeight) return false;
    const atBottom = xterm.buffer.active.viewportY >= xterm.buffer.active.baseY;
    const core = xterm._core;
    if (recoverDisplay) {
      // xterm 5.5 can retain stale glyph dimensions/viewport state after a DPI change.
      core?._charSizeService?.measure();
      xterm.clearTextureAtlas?.();
    }
    // Skip fitting unchanged cell dimensions. Repeated observer notifications
    // still refresh the viewport, without invoking the resize path again.
    const proposed = fit.proposeDimensions?.();
    if (recoverDisplay || !proposed || proposed.cols !== xterm.cols || proposed.rows !== xterm.rows) fit.fit();
    host.scrollLeft = 0;
    if (host.parentElement?.id === 'xterm-host') host.parentElement.scrollLeft = 0;
    const panel = host.closest('#terminal-panel');
    if (panel) panel.scrollLeft = 0;
    if (xterm.element) xterm.element.scrollLeft = 0;
    const viewport = host.querySelector('.xterm-viewport');
    if (viewport) viewport.scrollLeft = 0;
    if (recoverDisplay || atBottom) xterm.scrollToBottom();
    core?.viewport?.syncScrollArea?.(true);
    xterm.refresh(0, xterm.rows - 1);
    return true;
  }
  function watchTerminalDisplay(recover) {
    let timer, resolution;
    const changed = () => {
      recover();
      clearTimeout(timer);
      timer = setTimeout(recover, 180);
    };
    const dpiChanged = () => { watchResolution(); changed(); };
    const watchResolution = () => {
      resolution?.removeEventListener('change', dpiChanged);
      resolution = root.matchMedia('(resolution: ' + root.devicePixelRatio + 'dppx)');
      resolution.addEventListener('change', dpiChanged);
    };
    const stopNative = root.fanboxPty?.onLayout?.(changed);
    root.addEventListener('resize', changed);
    root.visualViewport?.addEventListener('resize', changed);
    const visible = () => { if (!root.document.hidden) changed(); };
    root.document.addEventListener('visibilitychange', visible);
    watchResolution();
    return () => {
      clearTimeout(timer);
      stopNative?.();
      resolution?.removeEventListener('change', dpiChanged);
      root.removeEventListener('resize', changed);
      root.visualViewport?.removeEventListener('resize', changed);
      root.document.removeEventListener('visibilitychange', visible);
    };
  }
  if (typeof module !== 'undefined') module.exports = { refreshTerminalLayout, watchTerminalDisplay };
  else Object.assign(root, { refreshTerminalLayout, watchTerminalDisplay });
})(typeof window === 'undefined' ? globalThis : window);
