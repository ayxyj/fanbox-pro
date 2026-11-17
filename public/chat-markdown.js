'use strict';
(() => {
  const escape = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  window.renderChatMarkdown = text => {
    if (!window.marked) return escape(text);
    const renderer = new window.marked.Renderer();
    renderer.html = html => escape(html);
    renderer.link = (href, title, label) => {
      try {
        const url = new URL(href);
        if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return label;
        return `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      } catch { return label; }
    };
    renderer.image = (_href, _title, alt) => escape(alt);
    return window.marked.parse(String(text || ''), { renderer, gfm: true, breaks: true, async: false });
  };
})();
