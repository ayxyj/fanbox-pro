'use strict';
(function(root) {
  function attachTerminalScrolling(terminal, host) {
    let remainder = 0;
    terminal.attachCustomWheelEventHandler(event => {
      // Applications with their own mouse protocol/alternate screen keep xterm's handling.
      if (terminal.buffer.active.type !== 'normal' || terminal.modes.mouseTrackingMode !== 'none' ||
          event.ctrlKey || event.shiftKey || !event.deltaY || !terminal.buffer.active.baseY) {
        remainder = 0;
        return true;
      }
      const rowHeight = host.querySelector('.xterm-screen')?.getBoundingClientRect().height / terminal.rows;
      if (!rowHeight || !Number.isFinite(rowHeight)) return true;
      const options = terminal.options;
      const fast = event[`${options.fastScrollModifier || 'alt'}Key`];
      const sensitivity = (options.scrollSensitivity ?? 1) * (fast ? (options.fastScrollSensitivity ?? 5) : 1);
      let lines = event.deltaY * sensitivity;
      if (event.deltaMode === 0) lines /= rowHeight;
      else if (event.deltaMode === 2) lines *= terminal.rows;
      if (Math.sign(lines) !== Math.sign(remainder)) remainder = 0;
      remainder += lines;
      const whole = Math.trunc(remainder);
      remainder -= whole;
      // Change the logical viewport first. xterm then syncs its scrollbar and renderer together.
      // The old DOM-first path can swallow a scroll event after a programmatic refresh.
      if (whole) terminal.scrollLines(whole);
      if (terminal.buffer.active.viewportY === 0 || terminal.buffer.active.viewportY === terminal.buffer.active.baseY) remainder = 0;
      event.preventDefault();
      return false;
    });
  }
  if (typeof module !== 'undefined') module.exports = { attachTerminalScrolling };
  else root.attachTerminalScrolling = attachTerminalScrolling;
})(typeof window === 'undefined' ? globalThis : window);
