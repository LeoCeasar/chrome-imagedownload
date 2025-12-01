async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

// ----- 设置持久化 -----
const DEFAULT_SETTINGS = { fitMode: 'contain', previewEnabled: true, previewSize: 'md', previewDelay: 200, previewSticky: false, filterType: 'all', filterDomain: '', filterQuery: '' };
async function loadSettings() {
  try {
    const obj = await chrome.storage.local.get(['fitMode', 'previewEnabled', 'previewSize', 'previewDelay', 'previewSticky', 'filterType', 'filterDomain', 'filterQuery']);
    return { ...DEFAULT_SETTINGS, ...obj };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
async function saveSettings(partial) {
  try { await chrome.storage.local.set(partial); } catch {}
}

function filenameFromUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.split('/').filter(Boolean).pop() || 'media';
    return decodeURIComponent(path);
  } catch {
    return 'media';
  }
}

function changeExt(name, ext) {
  const idx = name.lastIndexOf('.');
  const base = idx > 0 ? name.slice(0, idx) : name;
  return base + '.' + ext.replace(/^\./, '');
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]+/g, '_');
}

let currentMedia = [];
function render(media) {
  const list = document.getElementById('mediaList');
  const status = document.getElementById('status');
  list.innerHTML = '';
  currentMedia = media;
  const filtered = applyFilters(media);
  status.textContent = `共 ${filtered.length} 项`;

  const frag = document.createDocumentFragment();
  filtered.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'card';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.url = item.url;
    checkbox.dataset.kind = item.kind;
    checkbox.id = 'chk_' + i;

    const wrap = document.createElement('div');
    wrap.className = 'thumb-wrap';

    const thumb = document.createElement(item.kind === 'video' ? 'video' : 'img');
    thumb.className = 'thumb';
    if (item.kind === 'video') {
      thumb.muted = true; thumb.autoplay = false; thumb.controls = false; thumb.preload = 'metadata';
    } else {
      thumb.loading = 'lazy'; thumb.referrerPolicy = 'no-referrer';
    }
    thumb.src = item.url;

    const badge = document.createElement('span');
    badge.className = 'dim-badge';
    badge.textContent = '';
    if (item.kind === 'video') {
      thumb.addEventListener('loadedmetadata', () => {
        const w = thumb.videoWidth || 0;
        const h = thumb.videoHeight || 0;
        if (w && h) badge.textContent = `${w}×${h}`;
      }, { once: true });
    } else {
      thumb.addEventListener('load', () => {
        const w = thumb.naturalWidth || 0;
        const h = thumb.naturalHeight || 0;
        if (w && h) badge.textContent = `${w}×${h}`;
      }, { once: true });
    }

    // Hover preview
    attachHoverPreview(thumb, item);

    const row = document.createElement('div');
    row.className = 'row';
    const chip = document.createElement('span');
    chip.className = 'kind';
    chip.textContent = item.kind === 'video' ? '视频' : '图片';

    const name = document.createElement('div');
    name.className = 'name';
    const fname = filenameFromUrl(item.url);
    name.textContent = fname;
    name.title = fname;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const origin = (new URL(item.url, 'http://x').origin === 'null') ? '' : new URL(item.url).origin;
    meta.textContent = origin;
    meta.title = item.url;

    row.appendChild(chip);
    wrap.appendChild(thumb);
    wrap.appendChild(badge);
    wrap.appendChild(row);
    wrap.appendChild(name);
    wrap.appendChild(meta);

    li.appendChild(checkbox);
    li.appendChild(wrap);
    frag.appendChild(li);
  });
  list.appendChild(frag);
}

function applyFilters(items) {
  const t = document.getElementById('filterType')?.value || 'all';
  const d = (document.getElementById('filterDomain')?.value || '').toLowerCase();
  const q = (document.getElementById('filterQuery')?.value || '').toLowerCase();
  return items.filter(it => {
    if (t !== 'all' && it.kind !== t) return false;
    const url = it.url.toLowerCase();
    const name = filenameFromUrl(it.url).toLowerCase();
    if (d && !url.includes(d)) return false;
    if (q && !(url.includes(q) || name.includes(q))) return false;
    return true;
  });
}

function getSelected() {
  const boxes = Array.from(document.querySelectorAll('input[type="checkbox"][data-url]'));
  return boxes.filter(b => b.checked).map(b => ({ url: b.dataset.url, kind: b.dataset.kind }));
}

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return await res.blob();
}

async function fetchAsBlob(url) {
  const res = await fetch(url, { credentials: 'omit', cache: 'no-cache' });
  if (!res.ok) throw new Error('Fetch failed: ' + res.status);
  return await res.blob();
}

async function convertToJpeg(url, quality = 0.92) {
  const blob = await fetchAsBlob(url);
  const objUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Image load error'));
      image.src = objUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const jpegBlob = await new Promise((resolve) => {
      if (canvas.toBlob) {
        canvas.toBlob(b => resolve(b), 'image/jpeg', quality);
      } else {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        dataUrlToBlob(dataUrl).then(resolve);
      }
    });
    return jpegBlob;
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

async function downloadOriginal(url, suggestedName) {
  const filename = sanitizeFilename(suggestedName || filenameFromUrl(url));
  await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
}

async function downloadJpeg(url, quality = 0.92, suggestedName) {
  const blob = await convertToJpeg(url, quality);
  const objUrl = URL.createObjectURL(blob);
  try {
    const base = sanitizeFilename(changeExt(suggestedName || filenameFromUrl(url), 'jpg'));
    await chrome.downloads.download({ url: objUrl, filename: base, conflictAction: 'uniquify', saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
  }
}

function updateQualityVisibility() {
  const fmt = document.querySelector('input[name="format"]:checked')?.value;
  document.getElementById('qualityRow').hidden = fmt !== 'jpeg';
}

async function onDownloadClicked() {
  const items = getSelected();
  if (!items.length) return;
  const fmt = document.querySelector('input[name="format"]:checked')?.value || 'original';
  const quality = parseFloat(document.getElementById('quality').value || '0.92');
  const status = document.getElementById('status');
  let done = 0;
  status.textContent = `开始下载（共 ${items.length}）...`;
  document.getElementById('downloadBtn').disabled = true;

  for (const it of items) {
    try {
      // Check permission each time (only counts image items)
      let active = false;
      if (it.kind === 'image') {
        const info = await (window.PAY?.getActivationInfo?.() || Promise.resolve({ active: false }));
        active = !!(info && info.active);
        if (!active) {
          const remaining = await (window.PAY?.getRemainingDailyQuota?.() || 0);
          if (remaining <= 0) {
            status.textContent = `免费额度已用完（每天 ${window.PAY?.FREE_DAILY_LIMIT || 5} 张）。`;
            break;
          }
        }
      }
      if (fmt === 'jpeg' && it.kind === 'image') {
        await downloadJpeg(it.url, quality);
      } else {
        await downloadOriginal(it.url);
      }
      done++;
      status.textContent = `已完成 ${done}/${items.length}`;
      if (it.kind === 'image') {
        const info2 = await (window.PAY?.getActivationInfo?.() || Promise.resolve({ active: false }));
        const active2 = !!(info2 && info2.active);
        if (!active2) await (window.PAY?.consumeQuota?.(1) || Promise.resolve());
        await refreshPayUI().catch(()=>{});
      }
    } catch (e) { console.warn('Download failed', it, e); }
  }
  status.textContent = `下载完成：${done}/${items.length}`;
  document.getElementById('downloadBtn').disabled = false;
}

function wireEvents() {
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    try {
      const tabId = await getActiveTabId();
      if (!tabId) return;
      const res = await chrome.tabs.sendMessage(tabId, { type: 'GET_MEDIA' });
      if (res && res.ok) render(res.media || []);
    } catch (e) {
      console.warn('Manual refresh failed', e);
    }
  });
  document.getElementById('downloadBtn').addEventListener('click', onDownloadClicked);
  document.getElementById('selectAllBtn').addEventListener('click', () => {
    document.querySelectorAll('input[type="checkbox"][data-url]').forEach(b => (b.checked = true));
  });
  document.getElementById('clearBtn').addEventListener('click', () => {
    document.querySelectorAll('input[type="checkbox"][data-url]').forEach(b => (b.checked = false));
  });
  document.querySelectorAll('input[name="format"]').forEach(r => r.addEventListener('change', updateQualityVisibility));
  const q = document.getElementById('quality');
  const qv = document.getElementById('qualityVal');
  q.addEventListener('input', () => (qv.textContent = Number(q.value).toFixed(2)));
}

async function start() {
  wireEvents();
  updateQualityVisibility();
  // 加载设置
  const settings = await loadSettings();
  const fit = document.getElementById('fitMode');
  const pe = document.getElementById('previewEnabled');
  const ps = document.getElementById('previewSize');
  const pd = document.getElementById('previewDelay');
  const pk = document.getElementById('previewSticky');
  const ft = document.getElementById('filterType');
  const fdomain = document.getElementById('filterDomain');
  const fquery = document.getElementById('filterQuery');
  if (fit) fit.value = settings.fitMode;
  if (pe) pe.checked = !!settings.previewEnabled;
  if (ps) ps.value = settings.previewSize;
  if (pd) pd.value = String(settings.previewDelay);
  if (pk) pk.checked = !!settings.previewSticky;
  if (ft) ft.value = settings.filterType;
  if (fdomain) fdomain.value = settings.filterDomain || '';
  if (fquery) fquery.value = settings.filterQuery || '';
  applyFitMode(settings.fitMode);
  ensurePreviewLayer(settings.previewSize);

  // 绑定设置更新
  fit?.addEventListener('change', async () => {
    applyFitMode(fit.value);
    await saveSettings({ fitMode: fit.value });
  });
  pe?.addEventListener('change', async () => {
    await saveSettings({ previewEnabled: pe.checked });
  });
  ps?.addEventListener('change', async () => {
    setPreviewSize(ps.value);
    await saveSettings({ previewSize: ps.value });
  });
  pd?.addEventListener('change', async () => {
    await saveSettings({ previewDelay: Number(pd.value || 0) });
  });
  pk?.addEventListener('change', async () => {
    await saveSettings({ previewSticky: pk.checked });
  });
  ft?.addEventListener('change', async () => {
    render(currentMedia);
    await saveSettings({ filterType: ft.value });
  });
  fdomain?.addEventListener('input', async () => {
    render(currentMedia);
    await saveSettings({ filterDomain: fdomain.value });
  });
  fquery?.addEventListener('input', async () => {
    render(currentMedia);
    await saveSettings({ filterQuery: fquery.value });
  });

  const tabId = await getActiveTabId();
  if (!tabId) return;
  try {
    // const port = chrome.tabs.connect(tabId, { name: 'media-feed' });
    let port = chrome.tabs.connect(tabId, { name: 'media-feed' });
    if (chrome.runtime.lastError) {
        console.debug('[media-feed] connect failed:', chrome.runtime.lastError.message);
        port = null;
    }
    port.onMessage.addListener(msg => {
      if (msg && msg.type === 'MEDIA_UPDATE') render(msg.media || []);
    });
    // Also request once in case observer hasn't fired yet
    const res = await chrome.tabs.sendMessage(tabId, { type: 'GET_MEDIA' });
    if (res && res.ok) render(res.media);
  } catch (e) {
    document.getElementById('status').textContent = '无法连接到页面内容脚本';
  }
  await refreshPayUI();
  document.getElementById('buyBtn')?.addEventListener('click', () => window.PAY?.openPaymentPage?.());
  document.getElementById('refreshLicenseBtn')?.addEventListener('click', async () => {
    try {
      await (window.PAY?.pollForPayment?.(60000, 2000) || Promise.resolve());
      await refreshPayUI(true);
    } catch {}
  });
  // React to license changes broadcast by PAY
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'LICENSE_CHANGED') {
        try { console.info('[UI][sidepanel] LICENSE_CHANGED msg =', msg); } catch {}
        refreshPayUI(true).catch(()=>{});
      }
    });
  } catch {}
}

document.addEventListener('DOMContentLoaded', start);

// 初始样式为完整显示，并响应切换
document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('fit-contain');
  const fit = document.getElementById('fitMode');
  if (fit) {
    fit.addEventListener('change', () => {
      const v = fit.value;
      document.documentElement.classList.toggle('fit-cover', v === 'cover');
      document.documentElement.classList.toggle('fit-contain', v !== 'cover');
    });
  }
});

// ---------- 悬浮预览逻辑（图片/视频） ----------
let previewLayer;
function ensurePreviewLayer(size = 'md') {
  if (previewLayer) return previewLayer;
  const box = document.createElement('div');
  box.className = 'preview-box';
  const head = document.createElement('div');
  head.className = 'preview-head';
  const title = document.createElement('div');
  title.textContent = '预览';
  const close = document.createElement('button');
  close.className = 'preview-close';
  close.textContent = '关闭';
  head.appendChild(title); head.appendChild(close);
  const img = document.createElement('img');
  const video = document.createElement('video');
  video.muted = true; video.controls = true; video.preload = 'metadata';
  const meta = document.createElement('div');
  meta.className = 'preview-meta';
  box.appendChild(head);
  box.appendChild(img);
  box.appendChild(video);
  box.appendChild(meta);
  document.body.appendChild(box);
  previewLayer = { box, img, video, meta, close };
  setPreviewSize(size);
  close.addEventListener('click', () => pinPreview(false));
  img.addEventListener('load', () => {
    const dims = img.naturalWidth && img.naturalHeight ? `${img.naturalWidth}×${img.naturalHeight}` : '';
    if (previewLayer.currentItem) {
      const info = metaCache.get(previewLayer.currentItem.url) || {};
      setPreviewMeta(previewLayer, previewLayer.currentItem, info, dims);
    }
  });
  video.addEventListener('loadedmetadata', () => {
    const dims = (video.videoWidth && video.videoHeight) ? `${video.videoWidth}×${video.videoHeight}` : '';
    if (previewLayer.currentItem) {
      const info = metaCache.get(previewLayer.currentItem.url) || {};
      setPreviewMeta(previewLayer, previewLayer.currentItem, info, dims);
    }
  });
  return previewLayer;
}

function attachHoverPreview(el, item) {
  const layer = ensurePreviewLayer();
  const pe = document.getElementById('previewEnabled');
  const pk = document.getElementById('previewSticky');
  const pd = document.getElementById('previewDelay');
  let active = false;
  let timer = null;
  function show(e) {
    if (pe && !pe.checked) return; // 预览关闭
    if (previewState.pinned) return; // 已固定
    if (timer) clearTimeout(timer);
    const delay = Number(pd?.value || 0);
    timer = setTimeout(() => {
      active = true;
      if (item.kind === 'video') {
        layer.video.style.display = 'block';
        layer.img.style.display = 'none';
        layer.video.src = item.url;
      } else {
        layer.img.style.display = 'block';
        layer.video.style.display = 'none';
        layer.img.src = item.url;
      }
      previewLayer.currentItem = item;
      setPreviewMeta(layer, item, {});
      fetchMetaFor(item).then(info => { if (active) setPreviewMeta(layer, item, info || {}); }).catch(()=>{});
      layer.box.style.display = 'block';
      move(e);
    }, Math.max(0, delay));
  }
  function move(e) {
    if (!(active || previewState.pinned)) return;
    const pad = 12;
    const vw = window.innerWidth, vh = window.innerHeight;
    const bw = layer.box.offsetWidth || 360, bh = layer.box.offsetHeight || 360;
    let left = e.clientX + pad;
    let top = e.clientY + pad;
    if (left + bw > vw) left = e.clientX - bw - pad;
    if (top + bh > vh) top = e.clientY - bh - pad;
    layer.box.style.left = Math.max(0, left) + 'px';
    layer.box.style.top = Math.max(0, top) + 'px';
  }
  function hide() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (previewState.pinned) return; // 固定时不隐藏
    active = false;
    layer.box.style.display = 'none';
    layer.img.removeAttribute('src');
    layer.video.pause();
    layer.video.removeAttribute('src');
    layer.meta.textContent = '';
  }
  function click() {
    if (!pk || !pk.checked) return;
    if (!previewState.pinned) {
      previewState.pinned = true;
      previewState.url = item.url;
      layer.box.classList.add('pinned');
      layer.box.style.display = 'block';
    } else {
      if (previewState.url === item.url) {
        pinPreview(false);
      } else {
        previewState.url = item.url;
        if (item.kind === 'video') {
          layer.video.style.display = 'block';
          layer.img.style.display = 'none';
          layer.video.src = item.url;
        } else {
          layer.img.style.display = 'block';
          layer.video.style.display = 'none';
          layer.img.src = item.url;
        }
      }
    }
  }
  el.addEventListener('mouseenter', show);
  el.addEventListener('mousemove', move);
  el.addEventListener('mouseleave', hide);
  el.addEventListener('click', click);
}

function applyFitMode(mode) {
  document.documentElement.classList.toggle('fit-cover', mode === 'cover');
  document.documentElement.classList.toggle('fit-contain', mode !== 'cover');
}

function setPreviewSize(size) {
  if (!previewLayer) return;
  previewLayer.box.classList.remove('preview-sm', 'preview-md', 'preview-lg');
  previewLayer.box.classList.add(`preview-${size}`);
}

const metaCache = new Map();
const previewState = { pinned: false, url: null };
async function fetchMetaFor(item) {
  const key = item.url;
  if (metaCache.has(key)) return metaCache.get(key);
  try {
    const res = await fetch(key, { method: 'HEAD' });
    const type = res.headers.get('content-type') || '';
    const len = res.headers.get('content-length');
    const size = len ? formatBytes(Number(len)) : '';
    const info = { type, size };
    metaCache.set(key, info);
    return info;
  } catch {
    return null;
  }
}

function setPreviewMeta(layer, item, info, dims='') {
  const parts = [];
  const fname = filenameFromUrl(item.url);
  if (fname) parts.push(fname);
  if (!dims) {
    if (layer.img.style.display !== 'none' && layer.img.naturalWidth && layer.img.naturalHeight) {
      dims = `${layer.img.naturalWidth}×${layer.img.naturalHeight}`;
    } else if (layer.video.style.display !== 'none' && layer.video.videoWidth && layer.video.videoHeight) {
      dims = `${layer.video.videoWidth}×${layer.video.videoHeight}`;
    }
  }
  if (dims) parts.push(dims);
  if (info.type) parts.push(info.type);
  if (info.size) parts.push(info.size);
  layer.meta.textContent = parts.join(' · ');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B','KB','MB','GB'];
  let i = 0; let val = bytes;
  while (val >= 1024 && i < units.length-1) { val /= 1024; i++; }
  return `${val.toFixed(val < 10 && i>0 ? 1 : 0)} ${units[i]}`;
}

// ------ 支付/额度 UI 辅助 ------
async function refreshPayUI(force = false) {
  const bar = document.getElementById('payBar');
  if (!bar) return;
  const quotaText = document.getElementById('quotaText');
  const licenseText = document.getElementById('licenseText');
  const buyBtn = document.getElementById('buyBtn');
  const refreshBtn = document.getElementById('refreshLicenseBtn');
  function fmt(ts) {
    if (!Number.isFinite(ts)) return '';
    try { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; } catch { return ''; }
  }
  let info = { active: false, expiresAt: null, user: null };
  try {
    info = await (window.PAY?.getActivationInfo?.() || Promise.resolve(info));
    try { console.info('[UI][sidepanel] refreshPayUI activation info =', info); } catch {}
  } catch (e) {
    console.error('[UI][sidepanel] refreshPayUI getActivationInfo failed:', e);
  }
  const active = !!(info && info.active);
  if (active) {
    if (licenseText) {
      const suffix = info.expiresAt ? ` · 有效期至 ${fmt(info.expiresAt)}` : '';
      licenseText.textContent = `已解锁${suffix}`;
      licenseText.hidden = false;
    }
    if (quotaText) quotaText.hidden = true;
    if (buyBtn) buyBtn.hidden = true;
    if (refreshBtn) refreshBtn.hidden = false;
    bar.hidden = false;
  } else {
    const remaining = await (window.PAY?.getRemainingDailyQuota?.() || 0);
    if (quotaText) { quotaText.textContent = `免费额度：今日剩余 ${remaining} 张`; quotaText.hidden = false; }
    if (licenseText) licenseText.hidden = true;
    if (buyBtn) buyBtn.hidden = false;
    if (refreshBtn) refreshBtn.hidden = false;
    bar.hidden = false;
  }
}

// Render all images into the preview list (one per row)
function renderPreviewList(media) {
  const layer = ensurePreviewLayer();
  const list = layer.list;
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  (media || []).filter(it => it.kind === 'image').forEach(it => {
    const row = document.createElement('div');
    row.className = 'preview-entry';
    const el = document.createElement('img');
    el.src = it.url;
    el.referrerPolicy = 'no-referrer';
    el.loading = 'lazy';
    row.appendChild(el);
    frag.appendChild(row);
  });
  list.appendChild(frag);
}

function pinPreview(flag) {
  const layer = ensurePreviewLayer();
  previewState.pinned = !!flag;
  if (!flag) {
    previewState.url = null;
    layer.box.classList.remove('pinned');
    layer.box.style.display = 'none';
    layer.img.removeAttribute('src');
    layer.video.pause();
    layer.video.removeAttribute('src');
    layer.meta.textContent = '';
  } else {
    layer.box.classList.add('pinned');
  }
}
