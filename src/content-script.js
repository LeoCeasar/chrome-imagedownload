// Scans the page for image-like resources and returns a unique list of URLs
// - <img src>, srcset candidates
// - Common lazy-load attributes
// - CSS background-image urls

(function() {
  function resolveUrl(u) {
    try {
      return new URL(u, document.baseURI).href;
    } catch (e) {
      return u; // data:, blob:, invalid
    }
  }

  function extractFromSrcset(srcset) {
    if (!srcset) return [];
    // Split by comma, take the URL part before whitespace (descriptor)
    return srcset
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => part.split(/\s+/)[0])
      .filter(Boolean);
  }

  function extractFromBackgroundImage(bg) {
    if (!bg || bg === 'none') return [];
    const urls = [];
    const re = /url\((?:'|")?(.*?)(?:'|")?\)/g;
    let m;
    while ((m = re.exec(bg)) !== null) {
      if (m[1]) urls.push(m[1]);
    }
    return urls;
  }

  function uniqueArray(arr) {
    return Array.from(new Set(arr));
  }

  function collectImages() {
    const found = [];

    // From <img>
    const imgs = Array.from(document.images);
    for (const img of imgs) {
      if (img.src) found.push(img.src);
      extractFromSrcset(img.srcset).forEach(u => found.push(resolveUrl(u)));
      // Common lazy-load attributes
      ['data-src', 'data-original', 'data-lazy-src', 'data-url'].forEach(attr => {
        const v = img.getAttribute(attr);
        if (v) found.push(resolveUrl(v));
      });
    }

    // From elements with background-image
    const all = Array.from(document.querySelectorAll('*'));
    for (const el of all) {
      const style = getComputedStyle(el);
      const bg = style && style.backgroundImage;
      if (!bg || bg === 'none') continue;
      const urls = extractFromBackgroundImage(bg);
      for (const u of urls) {
        found.push(resolveUrl(u));
      }
    }

    // Optionally: link rel=preload as=image
    const preloads = Array.from(document.querySelectorAll('link[rel="preload"][as="image"]'));
    for (const link of preloads) {
      const href = link.getAttribute('href');
      if (href) found.push(resolveUrl(href));
    }

    // Normalize and filter
    const unique = uniqueArray(found)
      .filter(Boolean)
      .filter(u => {
        // Keep http(s), data, blob
        return /^(https?:|data:|blob:)/i.test(u);
      });

    // Map to simple records
    const images = unique.map(u => ({ url: u }));
    return images;
  }

  function collectVideos() {
    const found = [];
    const videos = Array.from(document.querySelectorAll('video'));
    for (const v of videos) {
      if (v.src) found.push(resolveUrl(v.src));
      const sources = Array.from(v.querySelectorAll('source'));
      for (const s of sources) {
        const u = s.getAttribute('src');
        if (u) found.push(resolveUrl(u));
      }
      // poster could be useful as an image
      const poster = v.getAttribute('poster');
      if (poster) found.push(resolveUrl(poster));
    }

    // Filter common video extensions but also allow blob/data
    const unique = uniqueArray(found)
      .filter(Boolean)
      .filter(u => /^(https?:|data:|blob:)/i.test(u));

    return unique.map(u => ({ url: u }));
  }

  function collectMedia() {
    const images = collectImages().map(x => ({ ...x, kind: 'image' }));
    const videos = collectVideos().map(x => ({ ...x, kind: 'video' }));
    // De-duplicate by url preferring video entries if duplicates
    const map = new Map();
    for (const item of [...images, ...videos]) {
      map.set(item.url, item);
    }
    return Array.from(map.values());
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === 'GET_IMAGES') {
      try {
        const images = collectImages();
        sendResponse({ ok: true, images });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return true; // async response
    } else if (message && message.type === 'GET_MEDIA') {
      try {
        const media = collectMedia();
        sendResponse({ ok: true, media });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return true;
    }
  });

  // Live update via ports
  const ports = new Set();
  function broadcast() {
    const payload = { type: 'MEDIA_UPDATE', media: collectMedia() };
    for (const p of Array.from(ports)) {
      try { p.postMessage(payload); } catch { ports.delete(p); }
    }
  }

  let scheduleId = null;
  function scheduleBroadcast() {
    if (scheduleId) return;
    scheduleId = requestAnimationFrame(() => {
      scheduleId = null;
      try { broadcast(); } catch {}
    });
  }

  const mo = new MutationObserver(() => scheduleBroadcast());
  mo.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset', 'style', 'poster']
  });

  window.addEventListener('load', scheduleBroadcast, { once: true });

  chrome.runtime.onConnect.addListener(port => {
    if (port && port.name === 'media-feed') {
      ports.add(port);
      // Send initial list
      try { port.postMessage({ type: 'MEDIA_UPDATE', media: collectMedia() }); } catch {}
      port.onDisconnect.addListener(() => ports.delete(port));
    }
  });
})();
