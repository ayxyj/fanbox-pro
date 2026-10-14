'use strict';
// Directory children are fetched only when expanded. Keep a bounded cache per root.
const fileTree = {
  roots: new Map(),
  iconCache: new Map(),
  icon(entry) {
    const key = JSON.stringify([state.theme, entry.isDir, entry.kind, entry.isDir ? 'folder' : entry.name.split('.').pop().toLowerCase()]);
    if (!this.iconCache.has(key)) {
      this.iconCache.set(key, iconSvg(entry, 18));
      if (this.iconCache.size > 256) this.iconCache.delete(this.iconCache.keys().next().value);
    }
    return this.iconCache.get(key);
  },
  bulk: null,
  updateControls() {
    const visible = state.view === 'tree' && !!state.cwd && !state.recentMode && !state.gsMode && !state.skillsMode;
    if (this.bulk && (!visible || this.bulk.root !== state.cwd)) this.cancelBulk();
    document.getElementById('tree-actions').style.display = visible ? '' : 'none';
    const progress = document.getElementById('tree-progress');
    progress.style.display = visible ? '' : 'none';
    progress.textContent = this.bulk ? `已展开 ${this.bulk.count} 个 · 待读取 ${this.bulk.remaining} 个` : '';
    const expand = document.getElementById('tree-expand-all');
    expand.textContent = this.bulk ? '停止展开' : '全部展开';
    expand.setAttribute('aria-busy', String(!!this.bulk));
    document.getElementById('tree-collapse-all').disabled = !visible || !this.current().expanded.size;
  },
  cancelBulk() {
    if (this.bulk) this.bulk.cancelled = true;
    this.bulk = null;
  },
  collapseAll(path) {
    this.cancelBulk();
    const expanded = this.current().expanded;
    if (path) {
      const prefix = path.endsWith(state.sep) ? path : path + state.sep;
      for (const folder of expanded) if (folder === path || folder.startsWith(prefix)) expanded.delete(folder);
    } else expanded.clear();
    renderFiles();
  },
  async expandAll(folder) {
    if (this.bulk) {
      this.cancelBulk(); this.updateControls();
      if (!folder) return;
    }
    const root = state.cwd, tree = this.current();
    const operation = {root, count: 0, remaining: 0, cancelled: false};
    this.bulk = operation;
    const queue = folder ? [folder] : this.sorted(state.entries).filter(e => e.isDir && !e.isSymlink);
    operation.remaining = queue.length;
    this.updateControls();
    const seen = new Set();
    let next = 0;
    const active = () => this.bulk === operation && !operation.cancelled && state.cwd === root
      && state.view === 'tree' && !state.recentMode && !state.gsMode && !state.skillsMode;
    let failed = 0, lastPaint = 0;
    try {
      while (next < queue.length && active()) {
        const batch = queue.slice(next, next + 4); next += batch.length;
        const reads = batch.map(async entry => {
          if (!active() || seen.has(entry.path)) return;
          seen.add(entry.path);
          tree.expanded.add(entry.path);
          if (!tree.children.has(entry.path)) await this.load(tree, root, entry.path);
          if (!active()) return;
          operation.count++;
          if (tree.errors.has(entry.path)) { failed++; return; }
          for (const child of this.sorted(tree.children.get(entry.path) || [])) {
            if (child.isDir && !child.isSymlink) queue.push(child);
          }
        });
        this.updateControls();
        if (Date.now() - lastPaint >= 100) { renderFilesWhenIdle(); lastPaint = Date.now(); }
        await Promise.all(reads);
        if (!active()) break;
        operation.remaining = queue.length - next;
        this.updateControls();
        if (Date.now() - lastPaint >= 100) { renderFilesWhenIdle(); lastPaint = Date.now(); }
        // Yield even when every directory is cached, so cancellation stays responsive.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (active()) toast(`已展开 ${operation.count} 个文件夹` + (failed ? ` · ${failed} 个读取失败` : ''));
    } finally {
      if (this.bulk === operation) this.bulk = null;
      this.updateControls();
      if (state.cwd === root && state.view === 'tree') renderFilesWhenIdle();
    }
  },
  current() {
    let tree = this.roots.get(state.cwd);
    if (!tree) {
      tree = { expanded: new Set(), children: new Map(), pending: new Map(), errors: new Map() };
      this.roots.set(state.cwd, tree);
      if (this.roots.size > 8) this.roots.delete(this.roots.keys().next().value);
    }
    this.roots.delete(state.cwd); this.roots.set(state.cwd, tree);
    return tree;
  },
  sorted(entries) {
    const saved = state.entries;
    state.entries = entries;
    try { return visibleEntries(); } finally { state.entries = saved; }
  },
  flatten() {
    const tree = this.current(), rows = [];
    const visit = (entries, depth) => {
      for (const e of this.sorted(entries)) {
        rows.push({ ...e, treeDepth: depth });
        if (e.isDir && tree.expanded.has(e.path)) visit(tree.children.get(e.path) || [], depth + 1);
      }
    };
    visit(state.entries, 0);
    return rows;
  },
  async toggle(entry) {
    this.cancelBulk();
    const tree = this.current(), root = state.cwd;
    if (tree.expanded.has(entry.path)) tree.expanded.delete(entry.path);
    else {
      tree.expanded.add(entry.path);
      if (!tree.children.has(entry.path)) this.load(tree, root, entry.path);
    }
    renderFiles();
  },
  async load(tree, root, path) {
    if (tree.pending.has(path)) return tree.pending.get(path);
    tree.errors.delete(path);
    const promise = api('/api/list?tree=1&path=' + encodeURIComponent(path)).then(data => {
      if (data.error) throw Error(data.error);
      tree.children.set(path, data.entries);
    }).catch(error => {
      tree.errors.set(path, error.message);
    }).finally(() => {
      tree.pending.delete(path);
      if (this.bulk?.root !== root && state.cwd === root && state.view === 'tree' && !state.gsMode && !state.skillsMode) renderFilesWhenIdle();
    });
    tree.pending.set(path, promise);
    return promise;
  },
  async refresh(root) {
    const tree = this.roots.get(root);
    if (!tree) return;
    // Wait for existing reads, then reread expanded directories with bounded concurrency.
    await Promise.all(tree.pending.values());
    const paths = [...tree.expanded];
    await Promise.all(Array.from({ length: Math.min(4, paths.length) }, async () => {
      while (paths.length) await this.load(tree, root, paths.shift());
    }));
  },
  rowHeight: 48,
  overscan: 24,
  schedulePaint() {
    if (this.paintFrame || state.view !== 'tree' || state.gsMode || state.skillsMode || state.recentMode) return;
    this.paintFrame = requestAnimationFrame(() => { this.paintFrame = null; this.paint(); });
  },
  offset() {
    const viewport = document.getElementById('content');
    return this.wrap.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
  },
  reveal(index) {
    if (!this.virtual || !this.wrap?.isConnected || this.root !== state.cwd) return;
    const position = this.positions.get(index);
    if (position === undefined) return;
    const viewport = document.getElementById('content');
    const top = this.offset() + position * this.rowHeight, bottom = top + this.rowHeight;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (bottom > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = bottom - viewport.clientHeight;
    this.paint();
  },
  render(area, rows) {
    const tree = this.current();
    let wrap = area.querySelector('.file-tree');
    if (!wrap) {
      wrap = document.createElement('div'); wrap.className = 'list file-tree';
      wrap.setAttribute('role', 'tree'); area.replaceChildren(wrap);
    }
    if (this.wrap !== wrap || this.root !== state.cwd) this.nodes = new Map();
    this.wrap = wrap; this.root = state.cwd;
    this.items = []; this.positions = new Map();
    rows.forEach((entry, index) => {
      this.positions.set(index, this.items.length);
      this.items.push({entry, index, key: entry.path});
      const expanded = tree.expanded.has(entry.path), loading = tree.pending.has(entry.path), error = tree.errors.get(entry.path);
      if (entry.isDir && expanded && (loading || error || tree.children.get(entry.path)?.length === 0)) {
        this.items.push({key: 'hint:' + entry.path, entry, hint: loading ? '读取中…' : error ? '读取失败：' + error : '空文件夹', error});
      }
    });
    this.virtual = this.items.length > 250;
    wrap.classList.toggle('virtual-tree', this.virtual);
    wrap.style.height = this.virtual ? this.items.length * this.rowHeight + 'px' : '';
    this.paint();
  },
  paint() {
    if (!this.wrap?.isConnected || this.root !== state.cwd || state.view !== 'tree' || state.gsMode || state.skillsMode || state.recentMode) return;
    const tree = this.current(), viewport = document.getElementById('content');
    const top = this.virtual ? Math.max(0, viewport.scrollTop - this.offset()) : 0;
    const start = this.virtual ? Math.max(0, Math.floor(top / this.rowHeight) - this.overscan) : 0;
    const end = this.virtual ? Math.min(this.items.length, Math.ceil((top + viewport.clientHeight) / this.rowHeight) + this.overscan) : this.items.length;
    const visible = new Set();
    let cursor = this.wrap.firstChild;
    for (let position = start; position < end; position++) {
      const item = this.items[position], entry = item.entry;
      visible.add(item.key);
      let row = this.nodes.get(item.key);
      if (item.hint) {
        if (!row) { row = document.createElement('div'); row.className = 'tree-hint'; }
        if (row.textContent !== item.hint) row.textContent = item.hint;
        row.style.paddingLeft = (54 + (entry.treeDepth + 1) * 18) + 'px';
        row.title = item.error ? '点击重试' : '';
        row.onclick = item.error ? () => { this.load(tree, state.cwd, entry.path); renderFiles(); } : null;
      } else {
        // Expansion, selection and metadata updates leave the inline icon DOM intact.
        const key = JSON.stringify([entry.path, entry.name, entry.isDir, entry.kind, entry.hidden, entry.project, entry.treeDepth, state.theme]);
        if (!row || row.dataset.treeKey !== key) {
          row = listRow(entry, item.index, true); row.__treeEntry = entry; row.dataset.treeKey = key;
          row.setAttribute('role', 'treeitem'); row.setAttribute('aria-level', entry.treeDepth + 1);
          row.style.setProperty('--tree-depth', entry.treeDepth);
          const name = row.querySelector('.fname'), icon = row.querySelector('.icon');
          const label = document.createElement('span'); label.className = 'tree-label';
          label.append(...name.childNodes); name.append(label); name.prepend(icon);
          label.title = entry.name;
          const details = document.createElement('div'); details.className = 'tree-details';
          details.append(...row.querySelectorAll('.meta')); name.after(details);
          const toggle = document.createElement('button'); toggle.className = 'tree-toggle'; toggle.disabled = !entry.isDir;
          name.prepend(toggle);
          if (entry.isDir) {
            toggle.onclick = event => { event.stopPropagation(); this.toggle(entry); };
            const click = row.onclick;
            row.onclick = event => {
              if (event.target.closest('.fav-btn')) return click(event);
              applySelection(entry.path); this.toggle(entry);
            };
          }
        } else Object.assign(row.__treeEntry, entry);
        const expanded = tree.expanded.has(entry.path), loading = tree.pending.has(entry.path);
        const toggle = row.querySelector('.tree-toggle');
        const glyph = entry.isDir ? (loading ? '⋯' : expanded ? '▾' : '▸') : '';
        if (toggle.textContent !== glyph) toggle.textContent = glyph;
        if (entry.isDir) {
          row.setAttribute('aria-expanded', expanded);
          toggle.setAttribute('aria-label', (expanded ? '折叠 ' : '展开 ') + entry.name);
        }
        row.classList.toggle('selected', state.selected === entry.path);
        row.classList.toggle('cursor', state.cursor === item.index);
        const changed = state.changed?.get(entry.name);
        row.classList.toggle('changed', !!changed);
        if (changed) {
          row.dataset.changed = changed.count > 1 ? '改·' + changed.count : '改';
          row.style.setProperty('--heat', Math.min(1, 0.4 + changed.count * 0.12).toFixed(2));
          row.title = changed.files.size ? '刚变更：\n' + [...changed.files].join('\n') : '';
        } else { delete row.dataset.changed; row.style.removeProperty('--heat'); row.removeAttribute('title'); }
        const meta = row.querySelectorAll('.meta');
        const time = fmtTime(entry.mtime), size = entry.isDir ? '' : fmtSize(entry.size);
        if (meta[0].textContent !== time) meta[0].textContent = time;
        if (meta[1].textContent !== size) meta[1].textContent = size;
        const star = row.querySelector('.fav-btn'), favorite = isFav(entry.path);
        if (star.classList.contains('on') !== favorite) { star.classList.toggle('on', favorite); star.innerHTML = svgWrap(SVG.star, 'currentColor', 15, favorite); }
        row.dataset.idx = item.index;
      }
      this.nodes.set(item.key, row);
      row.style.transform = this.virtual ? `translateY(${position * this.rowHeight}px)` : '';
      // Move only changed positions; untouched rows never leave the live document.
      if (row === cursor) cursor = cursor.nextSibling;
      else this.wrap.insertBefore(row, cursor);
    }
    while (cursor) { const next = cursor.nextSibling; cursor.remove(); cursor = next; }
    for (const key of this.nodes.keys()) {
      if (this.nodes.size <= 512) break;
      if (!visible.has(key)) this.nodes.delete(key);
    }
  },
};
