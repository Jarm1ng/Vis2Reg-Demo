/* Small, local-only view bookmarks. Anatomical edits and images are never copied. */
'use strict';
(() => {
  const STORAGE_KEY = 'vis2reg_saved_views_v1';
  const LIMIT = 24;
  const VIEW_MODES = ['reg', 'raw', 'explore', 'compare'];
  const MODE_LABELS = { reg: 'AR overlay', raw: 'Original image', explore: '3D anatomy', compare: 'Comparison' };
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const finiteArray = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);
  function normalizeView(value) {
    if (!plain(value) || value.version !== 1 || typeof value.caseKey !== 'string' || !/^[a-zA-Z0-9_-]{1,48}$/.test(value.caseKey) ||
      !Number.isSafeInteger(value.frame) || value.frame < 0 || !['reg', 'explore'].includes(value.mode) ||
      !Number.isFinite(value.opacity) || value.opacity < 0 || value.opacity > 100 ||
      typeof value.fog !== 'boolean' || typeof value.spin !== 'boolean' || ![0.5, 1, 2].includes(value.speed) ||
      !plain(value.layers) || Object.keys(value.layers).length > 32) return null;
    const layers = {};
    for (const [key, enabled] of Object.entries(value.layers)) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key) || typeof enabled !== 'boolean') return null;
      layers[key] = enabled;
    }
    const c = value.camera;
    if (!plain(c) || !finiteArray(c.position, 3) || !finiteArray(c.quaternion, 4) ||
      !finiteArray(c.target, 3) || !Number.isFinite(c.zoom) || c.zoom <= 0) return null;
    return { version: 1, caseKey: value.caseKey, frame: value.frame, mode: value.mode,
      opacity: value.opacity, layers, fog: value.fog, spin: value.spin, speed: value.speed,
      camera: { position: [...c.position], quaternion: [...c.quaternion], target: [...c.target], zoom: c.zoom } };
  }
  function normalizeRecord(value) {
    if (!plain(value) || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.id) ||
      typeof value.title !== 'string' || !value.title.trim() || typeof value.note !== 'string' ||
      !Number.isFinite(value.createdAt) || !Number.isFinite(new Date(value.createdAt).getTime()) ||
      !VIEW_MODES.includes(value.viewMode) || !Number.isFinite(value.comparison) || value.comparison < 0 || value.comparison > 100) return null;
    const view = normalizeView(value.view);
    if (!view || (value.viewMode === 'explore') !== (view.mode === 'explore')) return null;
    return { id: value.id, title: value.title.trim().slice(0, 72), note: value.note.trim().slice(0, 240),
      createdAt: value.createdAt, viewMode: value.viewMode, comparison: value.comparison, view };
  }
  function decode(raw) {
    if (raw === null) return { items: [], damaged: false };
    if (typeof raw !== 'string' || raw.length > 256000) throw Error('Invalid view library.');
    const data = JSON.parse(raw);
    if (!plain(data) || data.version !== 1 || !Array.isArray(data.items)) throw Error('Invalid view library.');
    const seen = new Set(), items = [];
    let damaged = data.items.length > LIMIT;
    for (const candidate of data.items.slice(0, LIMIT)) {
      const record = normalizeRecord(candidate);
      if (!record || seen.has(record.id)) { damaged = true; continue; }
      seen.add(record.id); items.push(record);
    }
    return { items, damaged };
  }
  function createStore(storage) {
    let items = [], notice = '', volatile = false;
    function reload() {
      // An external tab must not discard this session's failed writes, including
      // removals. Resume external updates after a local write succeeds again.
      if (volatile) return;
      let raw;
      try { raw = storage.getItem(STORAGE_KEY); }
      catch (_) { notice = 'Browser storage is unavailable. Views you save will last for this session only.'; return; }
      try {
        const result = decode(raw); items = result.items;
        notice = result.damaged ? 'Some saved views could not be read. Your valid views are still available.' : '';
      } catch (_) {
        items = []; notice = 'This browser’s saved-view library could not be read. You can start a new collection.';
      }
    }
    function commit(next) {
      items = next;
      try { storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, items })); volatile = false; notice = ''; return true; }
      catch (_) { volatile = true; notice = 'Browser storage is unavailable or full. These changes will last for this session only.'; return false; }
    }
    reload();
    return {
      get items() { return items; }, get notice() { return notice; }, reload,
      add(candidate, position = 0) {
        const record = normalizeRecord(candidate);
        if (!record) throw Error('This view could not be saved. Try again once the case has finished loading.');
        if (items.length >= LIMIT) throw Error('Your library has 24 views. Remove a view to make room for another.');
        if (items.some(item => item.id === record.id)) throw Error('This view is already in your library.');
        const next = [...items]; next.splice(Math.max(0, Math.min(position, next.length)), 0, record);
        return commit(next);
      },
      remove(id) {
        const position = items.findIndex(item => item.id === id);
        if (position < 0) return null;
        const record = items[position]; commit(items.filter(item => item.id !== id));
        return { record, position };
      }
    };
  }
  // The codec/store are also exercised by the local CPU regression suite.
  if (typeof module !== 'undefined' && module.exports) module.exports = { normalizeView, normalizeRecord, decode, createStore, STORAGE_KEY, LIMIT };
  if (typeof document === 'undefined') return;

  const byId = id => document.getElementById(id);
  const api = () => window.Vis2Reg;
  const experience = () => window.Vis2RegExperience;
  const store = createStore({ getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) });
  let filter = 'all', pending = null, removed = null, busy = false;
  function node(tag, className, text) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  }
  function icon(kind) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'sv-icon'); svg.setAttribute('aria-hidden', 'true');
    const paths = {
      bookmark: ['M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4Z'],
      close: ['m6 6 12 12M18 6 6 18'], arrow: ['M4 12h15m-5-5 5 5-5 5'],
      trash: ['M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7'],
      explore: ['m12 3 9 5v8l-9 5-9-5V8Zm0 9 9-4M3 8l9 4v9M7.5 5.5l9 5v8'],
      compare: ['M12 3v18M8 5H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4M16 5h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-4m0-9 3 2-3 2M8 10l-3 2 3 2'],
      reg: ['m12 3 10 5-10 5L2 8Zm-9 9 9 5 9-5M3 16l9 5 9-5'],
      raw: ['M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM3 16l5-5 5 5 3-3 5 5M15 8h.01'],
      plus: ['M12 5v14M5 12h14'], check: ['m5 12 4 4L19 6']
    };
    for (const d of paths[kind] || paths.bookmark) { const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path); }
    return svg;
  }
  function button(label, className = 'sv-button', iconName) {
    const result = node('button', className); result.type = 'button';
    if (iconName) result.append(icon(iconName)); result.append(node('span', '', label)); return result;
  }
  function closeButton(dialog) {
    const result = button('Close dialog', 'sv-close', 'close'); result.setAttribute('aria-label', 'Close dialog');
    result.querySelector('span').className = 'sr-only'; result.onclick = () => dialog.close(); return result;
  }
  function pauseWorkspace() {
    if (api()?.getState()?.playing) api().togglePlay();
    const guide = byId('guide'); if (guide) guide.hidden = true;
  }
  function notify(message) { if (typeof window.demoToast === 'function') window.demoToast(message); }
  function caseLabel(key) {
    if (key === 'p4video') return 'Patient 04';
    const match = /^llr_p(\d+)$/.exec(key);
    return match ? 'Patient ' + match[1].padStart(2, '0') : key;
  }
  function frameLabel(view) { return (view.caseKey.startsWith('llr_') ? 'Image ' + (view.frame + 1) : 'Frame ' + view.frame); }
  function caseSource(key) { return key === 'p4video' ? 'In-vivo sequence' : key.startsWith('llr_') ? 'LLR-LUS' : 'Case'; }
  function dialogBase(id, className, titleId) {
    const dialog = node('dialog', 'sv-dialog ' + className); dialog.id = id; dialog.setAttribute('aria-labelledby', titleId);
    dialog.addEventListener('click', event => {
      if (event.target !== dialog || busy) return;
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
    });
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    document.body.append(dialog); return dialog;
  }

  const library = dialogBase('saved-views-dialog', 'sv-library', 'sv-library-title');
  const libraryHeader = node('header', 'sv-header');
  const heading = node('div', 'sv-heading'); heading.append(node('div', 'sv-eyebrow', 'YOUR WORKSPACE'));
  const title = node('h2', '', 'Saved views'); title.id = 'sv-library-title';
  heading.append(title, node('p', '', 'Keep a perspective. Pick it up whenever you need it.'));
  libraryHeader.append(heading, closeButton(library)); library.append(libraryHeader);
  const toolbar = node('div', 'sv-toolbar');
  const filters = node('div', 'sv-filters'); filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', 'Filter saved views');
  const allFilter = button('All cases', 'sv-filter'), currentFilter = button('Current case', 'sv-filter');
  allFilter.onclick = () => { filter = 'all'; render(); }; currentFilter.onclick = () => { filter = 'current'; render(); };
  filters.append(allFilter, currentFilter);
  const count = node('span', 'sv-count'); count.setAttribute('aria-live', 'polite'); toolbar.append(filters, count); library.append(toolbar);
  const notice = node('p', 'sv-notice'); notice.setAttribute('role', 'status'); library.append(notice);
  const list = node('div', 'sv-grid'); list.setAttribute('aria-label', 'Saved views'); library.append(list);
  const undoBar = node('div', 'sv-undo'); undoBar.setAttribute('role', 'status');
  const undoText = node('span'), undoButton = button('Undo', 'sv-text-button');
  undoButton.onclick = () => {
    if (!removed || busy) return;
    try {
      store.add(removed.record, removed.position); removed = null; render();
      (filter === 'current' && !currentFilter.disabled ? currentFilter : allFilter).focus();
      notify('View restored to your library.');
    }
    catch (error) { notify(error.message); }
  };
  undoBar.append(undoText, undoButton); library.append(undoBar);
  const libraryFooter = node('footer', 'sv-footer');
  libraryFooter.append(node('p', '', 'Stored in this browser · view settings only, without anatomical edits.'));
  const addCurrent = button('Save current view', 'sv-button sv-primary', 'plus');
  addCurrent.onclick = () => { library.close(); openSave(); }; libraryFooter.append(addCurrent); library.append(libraryFooter);

  const naming = dialogBase('save-view-dialog', 'sv-naming', 'sv-name-title');
  const namingHeader = node('header', 'sv-header');
  const namingHeading = node('div', 'sv-heading'); namingHeading.append(node('div', 'sv-eyebrow', 'A MOMENT TO RETURN TO'));
  const namingTitle = node('h2', '', 'Save this view'); namingTitle.id = 'sv-name-title';
  namingHeading.append(namingTitle, node('p', '', 'Keep the frame, camera, layers and display settings.'));
  namingHeader.append(namingHeading, closeButton(naming)); naming.append(namingHeader);
  const form = node('form', 'sv-form');
  const summary = node('div', 'sv-capture-summary'); form.append(summary);
  const nameLabel = node('label', 'sv-field-label', 'View name'); nameLabel.htmlFor = 'sv-name';
  const nameInput = node('input', 'sv-input'); nameInput.id = 'sv-name'; nameInput.maxLength = 72; nameInput.required = true; nameInput.autocomplete = 'off';
  const noteLabel = node('label', 'sv-field-label', 'Note'); noteLabel.htmlFor = 'sv-note'; noteLabel.append(node('span', '', 'Optional'));
  const noteInput = node('textarea', 'sv-input'); noteInput.id = 'sv-note'; noteInput.maxLength = 240; noteInput.rows = 3; noteInput.placeholder = 'What would you like to revisit?';
  const errorMessage = node('p', 'sv-form-error'); errorMessage.setAttribute('role', 'alert'); errorMessage.hidden = true;
  const formFooter = node('div', 'sv-form-footer'); const cancel = button('Cancel'); cancel.onclick = () => naming.close();
  const confirm = button('Save view', 'sv-button sv-primary', 'bookmark'); confirm.type = 'submit'; formFooter.append(cancel, confirm);
  form.append(nameLabel, nameInput, noteLabel, noteInput, errorMessage, node('p', 'sv-form-hint', 'Saved on this device. Manual adjustments remain separate.'), formFooter); naming.append(form);
  form.addEventListener('submit', event => {
    event.preventDefault(); if (!pending) return;
    if (!nameInput.value.trim()) { nameInput.setCustomValidity('Give this view a name.'); nameInput.reportValidity(); return; }
    nameInput.setCustomValidity('');
    try {
      const persistent = store.add({ ...pending, title: nameInput.value.trim(), note: noteInput.value.trim() });
      pending = null; naming.close(); render();
      notify(persistent ? 'View saved. Find it in Saved views.' : 'View saved for this session only. Browser storage is unavailable.');
    } catch (error) { errorMessage.textContent = error.message; errorMessage.hidden = false; }
  });
  nameInput.addEventListener('input', () => nameInput.setCustomValidity(''));
  naming.addEventListener('close', () => { pending = null; });

  function capture() {
    const view = normalizeView(api()?.getViewState());
    if (!view) throw Error('The view is still loading. Please try again in a moment.');
    const viewMode = experience()?.getViewMode() || view.mode;
    const comparison = experience()?.getComparison() ?? 50;
    const id = window.crypto?.randomUUID?.() || 'view-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    return normalizeRecord({ id, title: caseLabel(view.caseKey) + ' · ' + frameLabel(view), note: '',
      createdAt: Date.now(), viewMode, comparison, view });
  }
  function openSave() {
    if (busy) return;
    if (store.items.length >= LIMIT) { openLibrary(); notify('Your library has 24 views. Remove a view to make room for another.'); return; }
    try {
      pauseWorkspace(); pending = capture();
      if (!pending) throw Error('The view could not be captured. Please try again.');
      nameInput.value = pending.title; noteInput.value = ''; nameInput.setCustomValidity(''); errorMessage.hidden = true;
      summary.replaceChildren(icon(pending.viewMode), node('span', '', caseLabel(pending.view.caseKey) + ' · ' + frameLabel(pending.view) + ' · ' + MODE_LABELS[pending.viewMode]));
      if (!naming.open) naming.showModal(); nameInput.focus(); nameInput.select();
    } catch (error) { pending = null; notify(error.message || 'The view could not be saved.'); }
  }
  function openLibrary() {
    if (busy) return;
    pauseWorkspace(); render(); if (!library.open) library.showModal();
  }
  async function restore(record, sourceButton) {
    if (busy) return;
    busy = true; library.setAttribute('aria-busy', 'true');
    library.querySelectorAll('button').forEach(element => element.disabled = true);
    sourceButton.querySelector('span').textContent = 'Opening…';
    try {
      await api().restoreView(record.view);
      experience()?.setComparison(record.comparison);
      experience()?.setViewMode(record.viewMode);
      library.close(); notify('Opened “' + record.title + '”.');
    } catch (error) {
      notice.textContent = error.message || 'This view could not be opened. Please try again.'; notice.hidden = false;
    } finally {
      busy = false; library.removeAttribute('aria-busy');
      library.querySelectorAll('button').forEach(element => element.disabled = false);
      sourceButton.querySelector('span').textContent = 'Open view';
      if (library.open) sourceButton.focus();
    }
  }
  function card(record) {
    const item = node('article', 'sv-card'); item.dataset.mode = record.viewMode;
    const art = node('div', 'sv-card-art'); art.append(icon(record.viewMode));
    const artMeta = node('div', 'sv-art-meta'); artMeta.append(node('span', 'sv-mode-tag', MODE_LABELS[record.viewMode]), node('strong', '', frameLabel(record.view))); art.append(artMeta);
    const body = node('div', 'sv-card-body'); const h3 = node('h3', '', record.title); h3.title = record.title;
    body.append(node('p', 'sv-case', caseLabel(record.view.caseKey) + ' · ' + caseSource(record.view.caseKey)), h3);
    if (record.note) body.append(node('p', 'sv-note', record.note));
    const settings = node('p', 'sv-settings', record.viewMode === 'raw' ? 'Original laparoscopic image' :
      record.viewMode === 'compare' ? Math.round(record.comparison) + '% comparison split' : Math.round(record.view.opacity) + '% liver transparency');
    body.append(settings);
    const actions = node('div', 'sv-card-actions'); const open = button('Open view', 'sv-open', 'arrow'); open.setAttribute('aria-label', 'Open ' + record.title); open.onclick = () => restore(record, open);
    const remove = button('Remove view', 'sv-remove', 'trash'); remove.setAttribute('aria-label', 'Remove ' + record.title); remove.querySelector('span').className = 'sr-only';
    remove.onclick = () => { removed = store.remove(record.id); render(); undoButton.focus(); };
    actions.append(open, remove); body.append(actions); item.append(art, body); return item;
  }
  function render() {
    const current = api()?.getState()?.curCase?.key;
    const items = store.items.filter(item => filter === 'all' || item.view.caseKey === current);
    allFilter.setAttribute('aria-pressed', String(filter === 'all')); currentFilter.setAttribute('aria-pressed', String(filter === 'current'));
    currentFilter.disabled = !current;
    count.textContent = filter === 'all' ? store.items.length + ' / ' + LIMIT + ' views' : items.length + ' view' + (items.length === 1 ? '' : 's') + ' in this case';
    notice.textContent = store.notice; notice.hidden = !store.notice;
    list.replaceChildren(); list.classList.toggle('is-empty', !items.length);
    if (items.length) items.forEach(record => list.append(card(record)));
    else {
      const empty = node('div', 'sv-empty'); empty.append(icon('bookmark'), node('h3', '', filter === 'current' && store.items.length ? 'A fresh perspective starts here.' : 'Your favourite perspectives, together.'),
        node('p', '', filter === 'current' && store.items.length ? 'No saved views for this case yet. Save the current view, or browse all cases.' : 'Find a useful frame or a revealing angle, then save it for your next walkthrough.'));
      const action = button(filter === 'current' && store.items.length ? 'Browse all cases' : 'Save current view', 'sv-button sv-primary', filter === 'current' && store.items.length ? 'arrow' : 'plus');
      action.onclick = () => { if (filter === 'current' && store.items.length) { filter = 'all'; render(); } else { library.close(); openSave(); } };
      empty.append(action); list.append(empty);
    }
    undoBar.hidden = !removed;
    if (removed) undoText.textContent = 'Removed “' + removed.record.title + '”.';
    addCurrent.disabled = store.items.length >= LIMIT;
    const trigger = byId('saved-views-open');
    if (trigger) { trigger.dataset.count = String(store.items.length); const badge = byId('saved-view-count'); if (badge) { badge.textContent = store.items.length; badge.hidden = !store.items.length; } trigger.setAttribute('aria-label', 'Saved views, ' + store.items.length + ' saved'); }
  }
  byId('save-view')?.addEventListener('click', openSave);
  byId('saved-views-open')?.addEventListener('click', openLibrary);
  window.addEventListener('vis2reg:case', () => { if (!busy) render(); });
  window.addEventListener('storage', event => { if (event.key === STORAGE_KEY && !busy) { store.reload(); render(); } });
  window.Vis2RegSavedViews = { open: openLibrary, save: openSave, getCount: () => store.items.length };
  render();
})();
