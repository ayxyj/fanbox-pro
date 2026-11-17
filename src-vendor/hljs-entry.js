import hljs from 'highlight.js/lib/common';
import sql from 'highlight.js/lib/languages/sql';
hljs.registerLanguage('sql', sql);
hljs.registerAliases('hql', { languageName: 'sql' });
window.hljs = hljs;
