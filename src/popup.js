async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// ----- 设置持久化 -----
const DEFAULT_SETTINGS = { fitMode: 'contain', previewEnabled: true, previewSize: 'md', previewDelay: 200, previewSticky: false, filterDomain: '', filterQuery: '' };
async function loadSettings() {
  try {
    const obj = await chrome.storage.local.get(['fitMode', 'previewEnabled', 'previewSize', 'previewDelay', 'previewSticky', 'filterDomain', 'filterQuery']);
    return { ...DEFAULT_SETTINGS, ...obj };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
async function saveSettings(partial) {
  try { await chrome.storage.local.set(partial); } catch {}
}

function filenameFromUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.split('/').filter(Boolean).pop() || 'image';
    // strip query-based filenames like foo.jpg?x=y
    return decodeURIComponent(path);
  } catch {
    return 'image';
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

let currentImages = [];
function renderImages(images) {
  const list = document.getElementById('imageList');
  list.innerHTML = '';
  currentImages = images;
  const filtered = applyFilters(images);
  const frag = document.createDocumentFragment();
  filtered.forEach((img, i) => {
    const li = document.createElement('li');
    li.className = 'card';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.url = img.url;
    checkbox.id = 'chk_' + i;

    const wrap = document.createElement('div');
    wrap.className = 'thumb-wrap';

    const thumb = document.createElement('img');
    thumb.className = 'thumb';
    thumb.loading = 'lazy';
    thumb.referrerPolicy = 'no-referrer';
    thumb.src = img.url;

    const badge = document.createElement('span');
    badge.className = 'dim-badge';
    badge.textContent = '';

    thumb.addEventListener('load', () => {
      const w = thumb.naturalWidth || 0;
      const h = thumb.naturalHeight || 0;
      if (w && h) badge.textContent = `${w}×${h}`;
    }, { once: true });

    // Hover preview
    attachHoverPreview(thumb, { url: img.url, kind: 'image' });

    const name = document.createElement('div');
    name.className = 'name';
    const fname = filenameFromUrl(img.url);
    name.textContent = fname;
    name.title = fname;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const origin = new URL(img.url, 'http://x').origin === 'null' ? '' : new URL(img.url).origin;
    meta.textContent = origin;
    meta.title = img.url;

    wrap.appendChild(thumb);
    wrap.appendChild(badge);
    wrap.appendChild(name);
    wrap.appendChild(meta);

    li.appendChild(checkbox);
    li.appendChild(wrap);
    frag.appendChild(li);
  });
  list.appendChild(frag);
}

function applyFilters(items) {
  const d = (document.getElementById('filterDomain')?.value || '').toLowerCase();
  const q = (document.getElementById('filterQuery')?.value || '').toLowerCase();
  return items.filter(it => {
    const url = it.url.toLowerCase();
    const name = filenameFromUrl(it.url).toLowerCase();
    if (d && !url.includes(d)) return false;
    if (q && !(url.includes(q) || name.includes(q))) return false;
    return true;
  });
}

async function scanImages() {
  const status = document.getElementById('status');
  status.textContent = '正在扫描...';
  const tab = await getActiveTab();
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'GET_IMAGES' });
    if (res && res.ok) {
      renderImages(res.images);
      status.textContent = `已发现 ${res.images.length} 张图片`;
    } else {
      status.textContent = '扫描失败';
    }
  } catch (e) {
    status.textContent = '无法从此页面读取图片（可能受 CSP 或未注入内容脚本影响）';
  }
}

function getSelected() {
  const boxes = Array.from(document.querySelectorAll('input[type="checkbox"][data-url]'));
  return boxes.filter(b => b.checked).map(b => b.dataset.url);
}

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return await res.blob();
}

async function fetchImageAsBlob(url) {
  const res = await fetch(url, { credentials: 'omit', cache: 'no-cache' });
  // Some servers may block; rely on host_permissions to allow cross-origin
  if (!res.ok) throw new Error('Fetch failed: ' + res.status);
  return await res.blob();
}

async function convertToJpeg(url, quality = 0.92) {
  const blob = await fetchImageAsBlob(url);
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

    // Prefer toBlob for memory; fallback to dataURL
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
    // Let Chrome hold the blob url until download starts; revoke slightly later
    setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
  }
}

function updateQualityVisibility() {
  const fmt = document.querySelector('input[name="format"]:checked')?.value;
  const row = document.getElementById('qualityRow');
  row.hidden = fmt !== 'jpeg';
}

async function onDownloadClicked() {
  const urls = getSelected();
  if (!urls.length) return;
  const fmt = document.querySelector('input[name="format"]:checked')?.value || 'original';
  const quality = parseFloat(document.getElementById('quality').value || '0.92');

  const status = document.getElementById('status');
  let done = 0;
  status.textContent = `开始下载（共 ${urls.length}）...`;
  document.getElementById('downloadBtn').disabled = true;

  for (const url of urls) {
    try {
      // Check permission each time
      const info = await (window.PAY?.getActivationInfo?.() || Promise.resolve({ active: false }));
      const active = !!(info && info.active);
      if (!active) {
        const remaining = await (window.PAY?.getRemainingDailyQuota?.() || 0);
        if (remaining <= 0) {
          status.textContent = `免费额度已用完（每天 ${window.PAY?.FREE_DAILY_LIMIT || 5} 张）。`;
          break;
        }
      }
      if (fmt === 'jpeg') {
        await downloadJpeg(url, quality);
      } else {
        await downloadOriginal(url);
      }
      done++;
      status.textContent = `已完成 ${done}/${urls.length}`;
      if (!active) {
        // Consume one quota per image
        await (window.PAY?.consumeQuota?.(1) || Promise.resolve());
        // Reflect in pay UI if visible
        await refreshPayUI().catch(()=>{});
      }
    } catch (e) {
      console.warn('Download failed for', url, e);
    }
  }

  status.textContent = `下载完成：${done}/${urls.length}`;
  document.getElementById('downloadBtn').disabled = false;
}

function wireEvents() {
  document.getElementById('refreshBtn').addEventListener('click', scanImages);
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

  const openBtn = document.getElementById('openSidebarBtn');
  openBtn.addEventListener('click', async () => {
    const tab = await getActiveTab();
    try {
      // Ensure side panel displays our page, then open it
      if (chrome.sidePanel?.setOptions) {
        await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'src/sidepanel.html', enabled: true });
      }
      if (chrome.sidePanel?.open) {
        await chrome.sidePanel.open({ tabId: tab.id });
      }
    } catch (e) {
      console.warn('Open side panel failed', e);
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  wireEvents();
  updateQualityVisibility();

  // 加载设置并应用
  const settings = await loadSettings();
  const fit = document.getElementById('fitMode');
  const pe = document.getElementById('previewEnabled');
  const ps = document.getElementById('previewSize');
  const pd = document.getElementById('previewDelay');
  const pk = document.getElementById('previewSticky');
  const fdomain = document.getElementById('filterDomain');
  const fquery = document.getElementById('filterQuery');
  if (fit) fit.value = settings.fitMode;
  if (pe) pe.checked = !!settings.previewEnabled;
  if (ps) ps.value = settings.previewSize;
  if (pd) pd.value = String(settings.previewDelay);
  if (pk) pk.checked = !!settings.previewSticky;
  if (fdomain) fdomain.value = settings.filterDomain || '';
  if (fquery) fquery.value = settings.filterQuery || '';

  applyFitMode(settings.fitMode);
  ensurePreviewLayer(settings.previewSize);

  // 绑定设置持久化
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
  fdomain?.addEventListener('input', async () => {
    renderImages(currentImages);
    await saveSettings({ filterDomain: fdomain.value });
  });
  fquery?.addEventListener('input', async () => {
    renderImages(currentImages);
    await saveSettings({ filterQuery: fquery.value });
  });
  await scanImages();
  await refreshPayUI();
  // wire pay bar actions
  document.getElementById('buyBtn')?.addEventListener('click', () => window.PAY?.openPaymentPage?.());
  document.getElementById('refreshLicenseBtn')?.addEventListener('click', async () => {
    try {
      // Try a short poll to catch freshly-activated purchases
      await (window.PAY?.pollForPayment?.(60000, 2000) || Promise.resolve());
      await refreshPayUI(true);
    } catch {}
  });
  // React to license changes broadcast by PAY
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'LICENSE_CHANGED') {
        try { console.info('[UI][popup] LICENSE_CHANGED msg =', msg); } catch {}
        refreshPayUI(true).catch(()=>{});
      }
    });
  } catch {}
});

// ---------- 悬浮预览逻辑（图片） ----------
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
  const meta = document.createElement('div');
  meta.className = 'preview-meta';
  box.appendChild(head);
  box.appendChild(img);
  box.appendChild(meta);
  document.body.appendChild(box);
  previewLayer = { box, img, meta, close };
  setPreviewSize(size);
  close.addEventListener('click', () => pinPreview(false));
  img.addEventListener('load', () => {
    const dims = img.naturalWidth && img.naturalHeight ? `${img.naturalWidth}×${img.naturalHeight}` : '';
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
      layer.img.src = item.url;
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
    layer.meta.textContent = '';
  }
  function click() {
    if (!pk || !pk.checked) return;
    if (!previewState.pinned) {
      // 进入固定模式
      previewState.pinned = true;
      previewState.url = item.url;
      layer.box.classList.add('pinned');
      layer.box.style.display = 'block';
    } else {
      // 如果点击同一张，则取消固定；否则切换
      if (previewState.url === item.url) {
        pinPreview(false);
      } else {
        previewState.url = item.url;
        layer.img.src = item.url;
      }
    }
  }
  el.addEventListener('mouseenter', show);
  el.addEventListener('mousemove', move);
  el.addEventListener('mouseleave', hide);
  el.addEventListener('click', click);
}

const previewState = { pinned: false, url: null };
function pinPreview(flag) {
  const layer = ensurePreviewLayer();
  previewState.pinned = !!flag;
  if (!flag) {
    previewState.url = null;
    layer.box.classList.remove('pinned');
    layer.box.style.display = 'none';
    layer.img.removeAttribute('src');
    layer.meta.textContent = '';
  } else {
    layer.box.classList.add('pinned');
  }
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

const metaCache = new Map(); // url -> {type,size}
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
  if (!dims && layer.img && layer.img.naturalWidth && layer.img.naturalHeight) {
    dims = `${layer.img.naturalWidth}×${layer.img.naturalHeight}`;
  }
  if (dims) parts.push(dims);
  if (info && info.type) parts.push(info.type);
  if (info && info.size) parts.push(info.size);
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
    try { console.info('[UI][popup] refreshPayUI activation info =', info); } catch {}
  } catch (e) {
    console.error('[UI][popup] refreshPayUI getActivationInfo failed:', e);
  }
  const active = !!(info && info.active);
  if (active) {
    // Show activation message and hide quota/buy
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
    // Show free quota and buy button
    const remaining = await (window.PAY?.getRemainingDailyQuota?.() || 0);
    if (quotaText) { quotaText.textContent = `免费额度：今日剩余 ${remaining} 张`; quotaText.hidden = false; }
    if (licenseText) licenseText.hidden = true;
    if (buyBtn) buyBtn.hidden = false;
    if (refreshBtn) refreshBtn.hidden = false;
    bar.hidden = false;
  }
}
