/* Workspace tools. Prepared anatomy and registration data remain in the engine. */
'use strict';
(() => {
  const el = id => document.getElementById(id);
  const viewer = document.querySelector('.viewer');
  const api = () => window.Vis2Reg;
  const toast = message => window.demoToast(message);
  let comparing = false, captureURL = null, captureBusy = false;
  let focused = null;

  function viewMode() {
    return comparing ? 'compare' : viewer.classList.contains('raw') ? 'raw' : api()?.getState().mode || 'reg';
  }
  function paintCompare(value) {
    const n = Math.max(0, Math.min(100, Number.isFinite(+value) ? +value : 50));
    el('compare-slider').value = n;
    viewer.style.setProperty('--compare', n + '%');
    el('compare-value').textContent = Math.round(n) + '%';
    el('compare-slider').setAttribute('aria-valuetext', Math.round(n) + '% original image, ' + Math.round(100 - n) + '% AR overlay');
  }
  function leaveCompare() {
    comparing = false;
    viewer.classList.remove('comparing');
    el('comparison-ui').hidden = true;
    el('comparison-caption').hidden = true;
    el('mode-compare').classList.remove('active');
    el('mode-compare').setAttribute('aria-pressed', 'false');
  }
  function enterCompare() {
    if (!api()?.getState().count || api().getState().loading) return;
    el('mode-reg').click();
    comparing = true;
    viewer.classList.add('comparing');
    el('comparison-ui').hidden = false;
    el('comparison-caption').hidden = false;
    document.querySelectorAll('.view-tabs button').forEach(b => {
      const active = b.id === 'mode-compare';
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    el('mode-badge').textContent = 'Same frame · two perspectives';
    window.dispatchEvent(new Event('resize'));
  }
  function setViewMode(mode) {
    if (!['reg', 'raw', 'compare', 'explore'].includes(mode)) return;
    if (viewMode() === mode) return;
    if (mode === 'compare') enterCompare();
    else el('mode-' + mode).click();
  }
  window.Vis2RegExperience = {
    getViewMode: viewMode, setViewMode,
    getComparison: () => +el('compare-slider').value,
    setComparison: paintCompare
  };
  el('mode-compare').onclick = enterCompare;
  el('compare-slider').addEventListener('input', e => paintCompare(e.target.value));
  el('compare-center').onclick = () => paintCompare(50);
  ['mode-reg','mode-raw','mode-explore','v-front','v-top','v-side','v-reset','em-reg','em-struct','em-deform'].forEach(id => {
    el(id).addEventListener('click', () => { if (comparing) { leaveCompare(); window.dispatchEvent(new Event('resize')); } });
  });
  window.addEventListener('vis2reg:mode', ({detail}) => {
    leaveCompare();
    paintStatus();
  });
  window.addEventListener('vis2reg:frame', () => {
    if (comparing) el('mode-badge').textContent = 'Same frame · two perspectives';
  });
  paintCompare(50);

  function theme(value) {
    const dark = value === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    el('theme-toggle').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    el('theme-toggle').title = dark ? 'Switch to light theme' : 'Switch to dark theme';
    el('theme-toggle').setAttribute('aria-pressed', String(dark));
    el('theme-toggle').querySelector('use').setAttribute('href', dark ? '#i-sun' : '#i-moon');
    document.querySelector('meta[name="theme-color"]').content = dark ? '#111d1a' : '#f4f6f2';
  }
  try { theme(localStorage.getItem('vis2reg_theme') || 'light'); } catch { theme('light'); }
  el('theme-toggle').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    theme(next);
    try { localStorage.setItem('vis2reg_theme', next); } catch { /* Theme still works for this session. */ }
  };

  function paintFocus() {
    const structures = api()?.getStructures?.() || [];
    const host = el('structure-focus');
    const signature = structures.map(s => s.key).join('|');
    if (host.dataset.structures === signature && host.children.length) {
      Array.from(host.children).forEach(button => {
        const key = button.dataset.key || null;
        button.classList.toggle('active', key === focused);
        button.setAttribute('aria-pressed', String(key === focused));
        if (key) button.disabled = !structures.find(s => s.key === key)?.visible;
      });
      return;
    }
    host.dataset.structures = signature;
    host.replaceChildren();
    function chip(key, label, color, visible) {
      const button = document.createElement('button');
      button.className = 'focus-chip';
      button.dataset.key = key || '';
      button.setAttribute('aria-pressed', String(key === focused));
      button.classList.toggle('active', key === focused);
      if (color) {
        const dot = document.createElement('i');
        dot.style.backgroundColor = Array.isArray(color) ? `rgb(${color.join(',')})` : color;
        dot.setAttribute('aria-hidden', 'true'); button.append(dot);
      }
      const text = document.createElement('span'); text.textContent = label; button.append(text);
      button.disabled = visible === false;
      button.title = visible === false ? 'Enable this anatomical layer to focus it' : key ? 'Highlight ' + label : 'Clear structure focus';
      button.onclick = () => {
        if (viewer.classList.contains('raw') || comparing) setViewMode('reg');
        focused = key === focused ? null : key;
        api().focusStructure(focused);
        paintFocus();
      };
      host.append(button);
    }
    chip(null, 'All anatomy', null, true);
    structures.forEach(s => chip(s.key, s.label, s.color, s.visible));
  }
  function paintStatus() {
    const s = api()?.getState();
    if (!s) return;
    const playing = !!s.playing;
    el('stage-state').textContent = s.editMode !== 'off' ? 'Editing' : playing ? 'Playing' : s.mode === 'explore' ? '3D view' : 'Ready';
    viewer.classList.toggle('is-playing', playing);
  }
  window.addEventListener('vis2reg:selection', e => { focused = e.detail?.key ?? null; paintFocus(); });
  window.addEventListener('vis2reg:display', paintFocus);
  window.addEventListener('vis2reg:playback', paintStatus);
  el('layer-list').addEventListener('change', paintFocus);
  window.addEventListener('vis2reg:case', e => {
    leaveCompare(); focused = null; paintFocus(); paintStatus();
    el('sequence-note').textContent = e.detail.type === 'images' ? e.detail.count + ' recorded images' : 'Select a moment to explore';
    el('capture-open').disabled = false;
  });

  async function exportImage() {
    if (captureBusy || !api()?.getState().count) return;
    if (!api().captureImage) { toast('The image export is still preparing. Please try again.'); return; }
    captureBusy = true;
    const button = el('capture-open'); button.disabled = true;
    const label = button.querySelector('span'); label.textContent = 'Preparing…';
    try {
      if (api().getState().playing) api().togglePlay();
      el('guide').hidden = true;
      const s = api().getState(), mode = viewMode();
      const comparison = +el('compare-slider').value;
      const caseText = el('case-title').textContent + ' · ' + el('case-kind').textContent;
      // Start both captures before yielding so a later user action cannot mix frames.
      const overlayCapture = api().captureImage({original: mode === 'raw'});
      const originalCapture = mode === 'compare' ? api().captureImage({original: true}) : Promise.resolve(null);
      const [overlayBlob, originalBlob] = await Promise.all([overlayCapture, originalCapture]);
      const bitmap = await createImageBitmap(overlayBlob);
      const canvas = document.createElement('canvas');
      const w = bitmap.width, h = bitmap.height, header = Math.round(w * .04), footer = Math.round(w * .027);
      canvas.width = w; canvas.height = h + header + footer;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#12241d'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, header); bitmap.close();
      if (mode === 'compare') {
        const original = await createImageBitmap(originalBlob);
        const x = Math.round(w * comparison / 100);
        ctx.save(); ctx.beginPath(); ctx.rect(0, header, x, h); ctx.clip(); ctx.drawImage(original, 0, header, w, h); ctx.restore(); original.close();
        ctx.strokeStyle = '#d3eac9'; ctx.lineWidth = Math.max(2, w / 700); ctx.beginPath(); ctx.moveTo(x, header); ctx.lineTo(x, header + h); ctx.stroke();
      }
      const pad = Math.round(w * .019);
      const titles = {reg:'AR overlay',raw:'Original image',compare:'Original / AR comparison',explore:'3D anatomy'};
      ctx.fillStyle = '#edf6ef'; ctx.font = `600 ${Math.round(w * .015)}px -apple-system, sans-serif`;
      ctx.textBaseline = 'middle'; ctx.fillText('Vis2Reg', pad, header / 2);
      ctx.font = `${Math.round(w * .0095)}px -apple-system, sans-serif`;
      ctx.fillStyle = '#b8cdc0'; ctx.textAlign = 'right';
      const frameText = s.curCase.type === 'images' ? 'Image ' + (s.frameIdx + 1) : 'Frame ' + s.frameIdx;
      ctx.fillText(caseText + ' / ' + frameText + ' / ' + titles[mode], w - pad, header / 2);
      ctx.textAlign = 'left'; ctx.font = `${Math.round(w * .008)}px -apple-system, sans-serif`;
      const scope = s.curCase.type === 'images' ? 'Preoperative anatomy · alignment unvalidated · research demonstration' : 'Prepared sequence · manual registration · illustrative anatomy · research demonstration';
      ctx.fillText(scope, pad, header + h + footer / 2);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('The image could not be encoded.')), 'image/png'));
      if (captureURL) URL.revokeObjectURL(captureURL);
      captureURL = URL.createObjectURL(blob);
      el('capture-preview').src = captureURL;
      el('capture-download').href = captureURL;
      el('capture-download').download = `Vis2Reg_${s.curCase.key}_${String(s.frameIdx).padStart(4,'0')}_${mode}.png`;
      el('capture-meta').textContent = `${titles[mode]} · ${canvas.width} × ${canvas.height} px · ${(blob.size/1048576).toFixed(1)} MB`;
      el('capture-dialog').showModal();
    } catch (error) { toast(error.message || 'The image could not be exported. Please try again.'); }
    finally { captureBusy = false; button.disabled = false; label.textContent = 'Export PNG'; }
  }
  el('capture-open').onclick = exportImage;
  el('capture-open').disabled = true;
  el('capture-close').onclick = () => el('capture-dialog').close();
  el('capture-dialog').addEventListener('close', () => { el('capture-open').focus(); });

  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || document.querySelector('dialog[open]') ||
        e.target.closest('input,select,textarea,button,a,[contenteditable="true"]') || api()?.getState().editMode !== 'off') return;
    const modes = {'1':'reg','2':'raw','3':'compare','4':'explore'};
    if (modes[e.key]) { e.preventDefault(); setViewMode(modes[e.key]); }
    if (e.key.toLowerCase() === 'b') { e.preventDefault(); el('save-view').click(); }
    if (e.key.toLowerCase() === 'e') { e.preventDefault(); exportImage(); }
    if (e.key.toLowerCase() === 'r' && comparing) leaveCompare();
  });
})();
