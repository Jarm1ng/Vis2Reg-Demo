/* Browse the bundled cases without loading their mesh data. */
'use strict';
(() => {
  const launch = document.getElementById('browse-cases');
  if (!launch) return;
  let entries = null, busy = false;
  const create = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const dialog = create('dialog', 'case-library');
  dialog.id = 'case-library-dialog';
  dialog.setAttribute('aria-labelledby', 'case-library-title');
  dialog.setAttribute('aria-describedby', 'case-library-description');
  const header = create('header', 'case-library-header');
  const heading = create('div');
  heading.append(create('div', 'eyebrow', 'THE CASE COLLECTION'));
  const title = create('h2', '', 'Explore a different perspective.');
  title.id = 'case-library-title';
  const description = create('p', '', 'Patient 04 · a recorded laparoscopic sequence.');
  description.id = 'case-library-description';
  heading.append(title, description);
  const close = create('button', 'icon-btn case-library-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close case library');
  close.addEventListener('click', () => dialog.close());
  header.append(heading, close);
  const content = create('div', 'case-library-content');
  const footer = create('footer', 'case-library-footer');
  footer.append(create('span', 'status-dot'), create('span', '', 'Prepared research data · Internal anatomy alignment is not validated in this viewer.'));
  dialog.append(header, content, footer);
  document.body.append(dialog);
  launch.setAttribute('aria-haspopup', 'dialog');
  launch.setAttribute('aria-controls', dialog.id);

  async function json(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('Data unavailable');
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  function currentKey() { return window.Vis2Reg?.getState()?.curCase?.key; }
  function caseName(c) {
    const match = c.key.match(/(?:llr_p|p)(\d+)/);
    return match ? 'Patient ' + match[1].padStart(2, '0') : c.label || c.key;
  }
  function framePath(c, frame) {
    const directory = c.dir.split('/').map(encodeURIComponent).join('/');
    return 'data/' + directory + '/frames/f_' + String(frame.i).padStart(6, '0') + '.jpg';
  }
  function openCase(entry, button) {
    const select = document.getElementById('case-sel');
    const option = select && Array.from(select.options).find(option =>
      (option.dataset.caseKey || option.dataset.key) === entry.case.key || option.value === String(entry.index));
    if (!option) {
      window.demoToast?.('The case viewer is still preparing. Please try again.');
      return;
    }
    button.disabled = true;
    dialog.close();
    if (currentKey() !== entry.case.key) {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  function render() {
    content.replaceChildren();
    const grid = create('div', 'case-library-grid');
    const activeKey = currentKey();
    for (const entry of entries) {
      const c = entry.case, meta = entry.meta, isVideo = c.type === 'video';
      const active = c.key === activeKey;
      const card = create('button', 'case-card' + (isVideo ? ' case-card-featured' : '') + (active ? ' is-current' : ''));
      card.type = 'button';
      card.dataset.caseKey = c.key;
      card.disabled = !meta;
      const label = caseName(c) + ' · ' + (isVideo ? 'Recorded sequence' : 'LLR-LUS image set');
      card.setAttribute('aria-label', label + (active ? ', current case' : ', open case'));
      if (active) card.setAttribute('aria-current', 'true');
      const visual = create('span', 'case-card-visual');
      const placeholder = create('span', 'case-card-placeholder', meta ? 'Preview unavailable' : 'Details could not be loaded');
      placeholder.setAttribute('aria-hidden', 'true'); visual.append(placeholder);
      if (meta) {
        const image = create('img', 'case-card-image');
        image.alt = 'First laparoscopic image from ' + label;
        image.decoding = 'async';
        image.addEventListener('error', () => image.hidden = true);
        image.src = framePath(c, meta.frames[0]);
        visual.append(image);
      }
      const tag = create('span', 'case-card-tag', isVideo ? 'RECORDED SEQUENCE' : 'LLR-LUS');
      visual.append(tag);
      if (active) visual.append(create('span', 'case-card-current', 'Current case'));
      const body = create('span', 'case-card-body');
      body.append(create('span', 'case-card-source', isVideo ? 'IN-VIVO LAPAROSCOPY' : 'CLINICAL IMAGE SET'));
      body.append(create('span', 'case-card-title', caseName(c)));
      const stats = meta ? (meta.count + (isVideo ? ' frames' : ' images') +
        (isVideo && Number.isFinite(meta.fps) && meta.fps > 0 ? ' · ' + ((meta.count - 1) / meta.fps).toFixed(1) + ' s' : '')) : 'Details unavailable';
      body.append(create('span', 'case-card-stats', stats));
      body.append(create('span', 'case-card-pose', isVideo ? 'Prepared manual poses' : 'Default pose · alignment required'));
      body.append(create('span', 'case-card-note', isVideo ? 'Explore the recorded sequence with saved manual liver alignment.' : 'Inspect preoperative liver and tumour anatomy alongside individual images.'));
      const action = create('span', 'case-card-action', active ? 'Continue exploring' : 'Open case');
      const arrow = create('span', '', '↗');
      arrow.setAttribute('aria-hidden', 'true');
      action.append(arrow);
      body.append(action);
      card.append(visual, body);
      card.addEventListener('click', () => openCase(entry, card));
      grid.append(card);
    }
    content.append(grid);
    if (entries.some(entry => !entry.meta)) {
      const notice = create('div', 'case-library-notice');
      notice.setAttribute('role', 'status');
      notice.append(create('span', '', 'Some case details are unavailable. The other cases are ready to explore.'));
      const retry = create('button', 'btn', 'Retry unavailable cases');
      retry.type = 'button';
      retry.addEventListener('click', () => load());
      notice.append(retry);
      content.append(notice);
    }
  }
  async function load() {
    if (busy) return;
    busy = true;
    launch.disabled = true;
    content.setAttribute('aria-busy', 'true');
    const pending = create('div', 'case-library-loading');
    pending.setAttribute('role', 'status');
    pending.append(create('span', 'spin'), create('span', '', 'Preparing the case collection…'));
    content.replaceChildren(pending);
    try {
      const manifest = await json('data/datasets.json');
      if (!Array.isArray(manifest.cases) || !manifest.cases.length) throw new Error('No cases available');
      const results = await Promise.allSettled(manifest.cases.map(async c => {
        if (typeof c.dir !== 'string' || typeof c.key !== 'string') throw new Error('Invalid case');
        const directory = c.dir.split('/').map(encodeURIComponent).join('/');
        const meta = await json('data/' + directory + '/frames.json');
        if (!Array.isArray(meta.frames) || !meta.frames.length || !Number.isInteger(meta.frames[0].i) ||
          meta.frames[0].i < 0 || !Number.isInteger(meta.count) || meta.count < 1) throw new Error('Invalid case details');
        return meta;
      }));
      entries = manifest.cases.map((c, index) => ({ case: c, index, meta: results[index].status === 'fulfilled' ? results[index].value : null }));
      render();
    } catch (error) {
      entries = null;
      const notice = create('div', 'case-library-loading');
      notice.setAttribute('role', 'alert');
      notice.append(create('strong', '', 'The case collection could not be loaded.'), create('span', '', 'Please try again. Your current workspace is unchanged.'));
      const retry = create('button', 'btn primary', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', () => load());
      notice.append(retry);
      content.replaceChildren(notice);
    } finally {
      busy = false;
      launch.disabled = false;
      content.setAttribute('aria-busy', 'false');
    }
  }
  launch.addEventListener('click', () => {
    const api = window.Vis2Reg;
    if (api?.getState()?.playing) api.togglePlay();
    if (entries) render();
    dialog.showModal();
    if (!entries) load();
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  window.addEventListener('vis2reg:case', () => { if (dialog.open && entries && !busy) render(); });
})();
