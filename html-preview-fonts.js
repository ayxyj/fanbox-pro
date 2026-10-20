'use strict';

// Font CSS must not keep a local document white while an optional font service is unreachable.
// Skip comments and raw script/style text, where a <link> may only be an example or a string.
function deferFontStyles(html) {
  const tokens = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  const attribute = (tag, name) => {
    const match = tag.match(new RegExp('\\s'+name+'\\s*=\\s*(?:"([^\"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
    return match ? (match[1] ?? match[2] ?? match[3]) : null;
  };
  return html.replace(tokens, tag => {
    if (!/^<link\b/i.test(tag) || !/\bstylesheet\b/i.test(attribute(tag, 'rel') || '')) return tag;
    let url;
    try { url = new URL(attribute(tag, 'href'), 'http://preview.invalid'); } catch { return tag; }
    if (!/^https?:$/.test(url.protocol) || url.hostname !== 'fonts.googleapis.com') return tag;
    const media = attribute(tag, 'media') ?? 'all';
    tag = tag.replace(/\smedia\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '');
    return tag.replace(/\s*\/?>(\s*)$/, ` media="print" data-fanbox-font-media="${media.replace(/"/g, '&quot;')}">$1`);
  });
}

module.exports = { deferFontStyles };
