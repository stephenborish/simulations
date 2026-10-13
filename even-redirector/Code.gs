/**
 * EVEN REDIRECTOR — Google Apps Script backend
 *
 * Each destination is selected exactly once per shuffled cycle.
 * Selection AND visit statistics share a ScriptLock so concurrent requests
 * cannot overwrite one another's counts or distribution state.
 *
 * Script Properties configuration:
 *   ADMIN_KEY = a long, unique secret (at least 24 characters)
 *
 * Publish the web app:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * IMPORTANT: The public /exec?r=... HTML page is only a manual fallback.
 * Use the GitHub Pages redirect URL for reliable automatic navigation.
 */

const LINK_PREFIX = 'link_';
const LEGACY_IDX_PREFIX = 'idx_';
const ADMIN_PROPERTY = 'ADMIN_KEY';
const MAX_URLS = 100;

// Public URL of redirect-page/index.html on your GitHub Pages site.
// Change this only if you publish the redirect page somewhere else.
const PUBLIC_REDIRECT_BASE =
  'https://stephenborish.github.io/simulations/even-redirector/';

/** Serves the administrator UI or the public destination resolver. */
function doGet(e) {
  const params = (e && e.parameter) || {};

  if (params.action === 'resolve') {
    return serveResolve_(params);
  }

  const slug = String(params.r || params.slug || '').trim();
  if (slug) {
    // Compatibility for old /exec?r=slug links. Apps Script iframe sandbox
    // forbids reliable automatic top-level navigation, so a click is needed.
    try {
      const result = chooseDestination_(slug);
      if (!result.ok) return renderLanding_(null, result.error);
      return renderLanding_(result.url, null);
    } catch (err) {
      return renderLanding_(null, 'The destination is temporarily unavailable.');
    }
  }

  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Even Redirector — Manage Links');
}

/**
 * Public JSONP endpoint consumed by the UNSANDBOXED GitHub Pages page.
 * Returns only the destination needed for a public redirect.
 * Callback is fixed: never evaluate a user-provided function name.
 */
function serveResolve_(params) {
  let data;
  try {
    data = chooseDestination_(String(params.r || params.slug || '').trim(), String(params.t || ''));
  } catch (err) {
    console.error('Redirect resolver error:', err);
    // retry:true tells the page this is transient (e.g. lock timeout) and it should try again.
    data = { ok: false, retry: true, error: 'The redirect service is busy.' };
  }

  // Prevent JS line-separator problems in old browsers.
  const json = JSON.stringify(data)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return ContentService.createTextOutput('redirectResolved(' + json + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/** Public entry point for the admin page to check credentials and list links. */
function listLinks(adminKey) {
  requireAdmin_(adminKey);
  const properties = PropertiesService.getScriptProperties().getProperties();
  const results = [];

  Object.keys(properties).forEach(function(key) {
    if (key.indexOf(LINK_PREFIX) !== 0) return;

    const slug = key.slice(LINK_PREFIX.length);
    try {
      const record = JSON.parse(properties[key]);
      results.push({
        slug: slug,
        count: Array.isArray(record.urls) ? record.urls.length : 0,
        clicks: Number(record.clicks) || 0,
        updatedIso: record.updatedIso || record.createdIso || '',
        lastClickIso: record.lastClickIso || '',
        link: makePublicLink_(slug)
      });
    } catch (err) {
      console.error('Skipping corrupt link record: ' + slug);
    }
  });

  results.sort(function(a, b) {
    return (b.updatedIso || '').localeCompare(a.updatedIso || '');
  });
  return results;
}

/** Create a link, or update an existing custom slug. */
function saveLink(slug, urls, adminKey) {
  requireAdmin_(adminKey);
  const list = validateUrls_(urls);
  let requestedSlug = String(slug || '').trim();
  if (requestedSlug && !isValidSlug_(requestedSlug)) {
    throw new Error('Slugs must be 1–64 characters: letters, digits, _ or -, starting with a letter or digit.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const store = PropertiesService.getScriptProperties();
    let existing = null;
    let finalSlug = requestedSlug;

    if (!finalSlug) {
      // Check the property store under the lock to avoid duplicate slugs.
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
        if (!store.getProperty(LINK_PREFIX + candidate)) {
          finalSlug = candidate;
          break;
        }
      }
      if (!finalSlug) throw new Error('Could not generate a unique link. Please try again.');
    } else {
      existing = readRecord_(store, finalSlug);
    }

    const now = new Date().toISOString();
    const sameUrls = !!existing &&
      JSON.stringify(existing.urls) === JSON.stringify(list);

    const keepCycle = sameUrls && validOrder_(existing.order, list.length) &&
      isValidPosition_(existing.nextPos, list.length);

    const record = {
      urls: list,
      createdIso: (existing && existing.createdIso) || now,
      updatedIso: now,
      clicks: (existing && Number(existing.clicks)) || 0,
      lastClickIso: (existing && existing.lastClickIso) || '',
      // Retain a valid current cycle only if destinations did not change.
      order: keepCycle ? existing.order : shuffledOrder_(list.length),
      nextPos: keepCycle ? existing.nextPos : 0
    };

    // Protect against the documented 9 KB Script Properties value limit.
    const serialized = JSON.stringify(record);
    if (Utilities.newBlob(serialized).getBytes().length > 8500) {
      throw new Error('This set of destination URLs is too large for Script Properties.');
    }

    store.setProperty(LINK_PREFIX + finalSlug, serialized);
    store.deleteProperty(LEGACY_IDX_PREFIX + finalSlug);
    return makePublicLink_(finalSlug);
  } finally {
    lock.releaseLock();
  }
}

/** Delete a link and its original round-robin rotation key (if present). */
function deleteLink(slug, adminKey) {
  requireAdmin_(adminKey);
  slug = String(slug || '').trim();
  if (!isValidSlug_(slug)) throw new Error('Invalid slug.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const store = PropertiesService.getScriptProperties();
    store.deleteProperty(LINK_PREFIX + slug);
    store.deleteProperty(LEGACY_IDX_PREFIX + slug);
    return true;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Atomically choose the next destination and record the visit.
 * A full cycle is a randomly shuffled list containing each URL exactly once.
 */
function chooseDestination_(slug, token) {
  if (!isValidSlug_(slug)) {
    return { ok: false, error: 'Invalid redirect link.' };
  }

  // Idempotency: the page sends one random token per page load and may retry.
  // A repeated token gets the SAME destination and is never counted twice.
  const cache = CacheService.getScriptCache();
  const cacheKey = /^[A-Za-z0-9_-]{8,64}$/.test(token) ? 'tok_' + slug + '_' + token : '';
  if (cacheKey) {
    const hit = cache.get(cacheKey);
    if (hit) return { ok: true, url: hit };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // Re-check: an earlier attempt with this token may have finished while we waited.
    if (cacheKey) {
      const hit = cache.get(cacheKey);
      if (hit) return { ok: true, url: hit };
    }
    const store = PropertiesService.getScriptProperties();
    const record = readRecord_(store, slug);
    if (!record || !Array.isArray(record.urls) || record.urls.length < 2) {
      return { ok: false, error: 'This redirect link does not exist.' };
    }

    const total = record.urls.length;
    if (!validOrder_(record.order, total) ||
        !isValidPosition_(record.nextPos, total)) {
      // Older existing records are migrated automatically on their next visit.
      record.order = shuffledOrder_(total);
      record.nextPos = 0;
    }

    const index = record.order[record.nextPos];
    const url = record.urls[index];

    record.nextPos += 1;
    if (record.nextPos >= total) {
      record.order = shuffledOrder_(total);
      record.nextPos = 0;
    }

    record.clicks = (Number(record.clicks) || 0) + 1;
    record.lastClickIso = new Date().toISOString();

    // State and statistics are saved in ONE property write under ONE lock.
    store.setProperty(LINK_PREFIX + slug, JSON.stringify(record));
    if (cacheKey) {
      try { cache.put(cacheKey, url, 21600); } catch (err) { /* cache is best-effort */ }
    }
    return { ok: true, url: url };
  } finally {
    lock.releaseLock();
  }
}

function readRecord_(store, slug) {
  const raw = store.getProperty(LINK_PREFIX + slug);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error('This link has a damaged saved record: ' + slug);
  }
}

function shuffledOrder_(length) {
  const result = [];
  for (let i = 0; i < length; i++) result.push(i);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }
  return result;
}

function validOrder_(order, length) {
  if (!Array.isArray(order) || order.length !== length) return false;
  const seen = {};
  for (let i = 0; i < length; i++) {
    const value = order[i];
    if (!Number.isInteger(value) || value < 0 || value >= length || seen[value]) {
      return false;
    }
    seen[value] = true;
  }
  return true;
}

function isValidPosition_(pos, length) {
  return Number.isInteger(pos) && pos >= 0 && pos < length;
}

function validateUrls_(urls) {
  if (!Array.isArray(urls)) throw new Error('Provide the URLs as a list.');
  if (urls.length < 2 || urls.length > MAX_URLS) {
    throw new Error('Enter between 2 and ' + MAX_URLS + ' destination URLs.');
  }

  const cleaned = urls.map(function(item) { return String(item || '').trim(); });
  const seen = {};
  cleaned.forEach(function(url, index) {
    if (!/^https?:\/\/[^\s]+$/i.test(url)) {
      throw new Error('Destination ' + (index + 1) + ' must be a complete http:// or https:// URL without spaces.');
    }
    if (seen[url]) throw new Error('Duplicate destination: ' + url);
    seen[url] = true;
  });
  return cleaned;
}

function isValidSlug_(slug) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(slug);
}

function makePublicLink_(slug) {
  return PUBLIC_REDIRECT_BASE.replace(/\/+$/, '/') + '?r=' + encodeURIComponent(slug);
}

function requireAdmin_(adminKey) {
  const configured = PropertiesService.getScriptProperties().getProperty(ADMIN_PROPERTY);
  if (!configured || configured.length < 24) {
    throw new Error('Administrator access is not configured. Set a Script Property named ADMIN_KEY with a secret of at least 24 characters.');
  }
  if (String(adminKey || '') !== configured) {
    throw new Error('Incorrect administrator key.');
  }
}

function escapeHtml_(value) {
  return String(value).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function renderLanding_(url, error) {
  const content = error
    ? '<h1>Link unavailable</h1><p>' + escapeHtml_(error) + '</p>'
    : '<h1>Your destination is ready</h1>' +
      '<p>Use the button below to continue. Older Google Apps Script links require this click.</p>' +
      '<a class="go" href="' + escapeHtml_(url) + '" target="_top" rel="noopener noreferrer">Continue to destination</a>';

  const html = '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<base target="_top"><title>Even Redirector</title><style>' +
    'body{font:16px system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:24px;line-height:1.6;color:#222}' +
    '.go{display:inline-block;margin-top:12px;padding:13px 20px;color:white;background:#302257;border-radius:10px;text-decoration:none;font-weight:700}' +
    '</style></head><body>' + content + '</body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Even Redirector');
}
