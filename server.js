// ═══════════════════════════════════════════════════════════
//  1. IMPORTS
// ═══════════════════════════════════════════════════════════

import express from 'express';
import cors from 'cors';
import * as cheerio from 'cheerio';
import { request, Agent as UndiciAgent } from 'undici';
import puppeteer from 'puppeteer';
import { URL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookup } from 'node:dns/promises';

import {
  downloadFile, extractPDF, extractJSON, extractCSV, extractXLSX,
  detectApiEndpoints, extractNextData, probeApiEndpoint,
  fetchSitemap, fetchRSS
} from './extractors.js';

import { API_CATALOG, getCatalogStats } from './apis-catalog.js';

import {
  getStatusText, sanitizeHeaders, summarizeJSON, analyzeJSONStructure,
  detectAPIHints, analyzeSecurity, classifyError, getErrorHint,
  validateTargetUrl, LIMITS, clamp
} from './utils.js';

// ═══════════════════════════════════════════════════════════
//  2. INITIALISATION APP
// ═══════════════════════════════════════════════════════════

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════════
//  3. CACHE
// ═══════════════════════════════════════════════════════════

const scanCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCacheKey(url, depth, maxPages) {
  return `${url}|${depth}|${maxPages}`;
}

function getFromCache(key) {
  const entry = scanCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    scanCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  scanCache.set(key, { data, timestamp: Date.now() });
  if (scanCache.size > 50) {
    const firstKey = scanCache.keys().next().value;
    scanCache.delete(firstKey);
  }
}

// ═══════════════════════════════════════════════════════════
//  4. RATE LIMIT + SSRF GUARD
// ═══════════════════════════════════════════════════════════

const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

function rateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateLimitStore.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }

  entry.count++;
  rateLimitStore.set(ip, entry);

  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      error: 'Trop de requêtes. Réessayez dans une minute.',
      errorType: 'RATE_LIMITED'
    });
  }

  next();
}

function ssrfGuard(req, res, next) {
  const target = req.body?.url;
  if (!target) return next();

  const check = validateTargetUrl(target);
  if (!check.ok) {
    return res.status(403).json({ error: check.reason, errorType: 'SSRF_BLOCKED' });
  }
  next();
}

// ═══════════════════════════════════════════════════════════
//  5. PUPPETEER
// ═══════════════════════════════════════════════════════════

let browserInstance = null;
let reusablePage = null;

async function getBrowser() {
  if (!browserInstance || !browserInstance.connected) {
    console.log('🌐 Démarrage de Chromium…');
    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
  }
  return browserInstance;
}

async function getReusablePage() {
  if (reusablePage && !reusablePage.isClosed()) return reusablePage;

  const browser = await getBrowser();
  const page = await browser.newPage();

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  );
  await page.setViewport({ width: 1366, height: 768 });
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
  });

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    try {
      const type = req.resourceType();
      if (['font', 'media'].includes(type)) {
        req.abort().catch(() => {});
      } else {
        req.continue().catch(() => {});
      }
    } catch {
      // Page déjà fermée
    }
  });

  reusablePage = page;
  return page;
}

async function closeBrowser() {
  if (reusablePage && !reusablePage.isClosed()) {
    try { await reusablePage.close(); } catch {}
    reusablePage = null;
  }
  if (browserInstance) {
    try { await browserInstance.close(); } catch {}
    browserInstance = null;
    console.log('🛑 Chromium fermé.');
  }
}

process.on('SIGINT', async () => { await closeBrowser(); process.exit(0); });
process.on('SIGTERM', async () => { await closeBrowser(); process.exit(0); });

const insecureAgent = new UndiciAgent({
  connect: { rejectUnauthorized: false }
});

// ═══════════════════════════════════════════════════════════
//  6. FETCH HELPERS
// ═══════════════════════════════════════════════════════════

async function fetchPage(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await request(url, {
      method: 'GET',
      maxRedirections: 10,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1'
      },
      signal: controller.signal
    });

    const rawBody = await res.body.arrayBuffer();
    const body = new TextDecoder('utf-8').decode(rawBody);

    return {
      status: res.statusCode,
      headers: res.headers,
      body,
      finalUrl: res.context?.history?.at(-1)?.toString() || url,
      via: 'undici'
    };
  } finally {
    clearTimeout(timer);
  }
}

function isProbablySPA(html) {
  const spaIndicators = [
    /<div id="__nuxt">/i,
    /<div id="__next">/i,
    /<div id="app">\s*<\/div>/i,
    /<div id="root">\s*<\/div>/i,
    /window\.__NUXT__/i,
    /window\.__NEXT_DATA__/i,
    /__VUE__/i,
    /data-server-rendered/i
  ];

  if (spaIndicators.some(rx => rx.test(html))) return true;

  const $ = cheerio.load(html);
  const linkCount = $('a[href]').length;
  if (linkCount < 5 && html.length > 10000) return true;

  return false;
}

async function fetchPageWithBrowser(url, timeoutMs = 30000) {
  const page = await getReusablePage();

  const response = await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: timeoutMs
  });

  try {
    await page.waitForFunction(
      () => document.querySelectorAll('a[href]').length > 3,
      { timeout: 5000 }
    );
  } catch {}

  await new Promise(r => setTimeout(r, 300));

  const html = await page.content();
  const finalUrl = page.url();
  const status = response ? response.status() : 200;

  return {
    status,
    headers: { 'content-type': 'text/html' },
    body: html,
    finalUrl,
    via: 'puppeteer'
  };
}

// ═══════════════════════════════════════════════════════════
//  7. CLASSIFICATION
// ═══════════════════════════════════════════════════════════

const EXCLUDED_PATHS = /\/(login|logout|signin|signup|register|password|reset|oauth|cart|panier|checkout|account|profile|settings|preferences|api\/)/i;
const EXCLUDED_EXTENSIONS = /\.(atom|rss|xml|json|txt|csv|zip|tar|gz|exe|dmg|iso)$/i;

function shouldSkipScanning(url) {
  return EXCLUDED_PATHS.test(url) || EXCLUDED_EXTENSIONS.test(url);
}

function classifyResource(url, contentType = '') {
  const cleanUrl = url.split('#')[0].split('?')[0].toLowerCase();
  const ct = (contentType || '').toLowerCase();

  if (ct.includes('application/pdf') || cleanUrl.endsWith('.pdf')) return 'pdf';
  if (ct.includes('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(cleanUrl)) return 'image';
  if (ct.includes('video/') || /\.(mp4|webm|ogg|mov|avi)$/i.test(cleanUrl)) return 'video';
  if (ct.includes('audio/') || /\.(mp3|wav|ogg|flac|m4a)$/i.test(cleanUrl)) return 'audio';
  if (ct.includes('text/csv') || cleanUrl.endsWith('.csv')) return 'csv';
  if (ct.includes('application/msword') || cleanUrl.endsWith('.doc')) return 'doc';
  if (ct.includes('officedocument.wordprocessingml') || cleanUrl.endsWith('.docx')) return 'docx';
  if (ct.includes('application/vnd.ms-excel') || cleanUrl.endsWith('.xls')) return 'xls';
  if (ct.includes('officedocument.spreadsheetml') || cleanUrl.endsWith('.xlsx')) return 'xlsx';
  if (ct.includes('application/zip') || cleanUrl.endsWith('.zip')) return 'archive';
  if (ct.includes('text/plain') || cleanUrl.endsWith('.txt')) return 'txt';
  if (ct.includes('text/html')) return 'html';
  return 'other';
}

function scoreRelevance({ type, isInternal, text, url }) {
  let score = 0.5;

  if (EXCLUDED_PATHS.test(url)) return 0.05;

  if (isInternal) score += 0.15;
  else score -= 0.05;

  if (text && text.length > 5) score += 0.1;
  if (text && text.length > 20) score += 0.05;

  if (['pdf', 'doc', 'docx', 'xls', 'xlsx'].includes(type)) score += 0.15;
  if (type === 'image') score += 0.05;

  if (/^(javascript:|mailto:|tel:)/i.test(url)) score -= 0.4;

  return Math.max(0, Math.min(1, score));
}

// ═══════════════════════════════════════════════════════════
//  8. ENDPOINTS
// ═══════════════════════════════════════════════════════════

// ─── /api/scan ───
app.post('/api/scan', rateLimit, ssrfGuard, async (req, res) => {
  const {
    url,
    depth = 1,
    maxPages = 5,
    useBrowser = true,
    skipCache = false
  } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL manquante ou invalide.' });
  }

  const check = validateTargetUrl(url);
  if (!check.ok) return res.status(403).json({ error: check.reason, errorType: 'SSRF_BLOCKED' });

  const baseUrl = check.url;
  const safeDepth = clamp(depth, 0, LIMITS.MAX_DEPTH);
  const safeMaxPages = clamp(maxPages, 1, LIMITS.MAX_PAGES);

  const cacheKey = getCacheKey(baseUrl.href, safeDepth, safeMaxPages);
  if (!skipCache) {
    const cached = getFromCache(cacheKey);
    if (cached) {
      console.log(`📦 Cache hit pour ${baseUrl.href}`);
      return res.json({ ...cached, fromCache: true });
    }
  }

  const baseHost = baseUrl.hostname;
  const visited = new Set();
  const queue = [{ url: baseUrl.href, source: 'Page Principale', depth: 0 }];
  const results = [];
  const pagesScanned = [];
  const errors = [];
  const startTime = Date.now();

  while (queue.length > 0 && pagesScanned.length < safeMaxPages) {
    const { url: currentUrl, source, depth: currentDepth } = queue.shift();

    if (visited.has(currentUrl)) continue;
    visited.add(currentUrl);

    let page;
    let usedBrowser = false;

    try {
      page = await fetchPage(currentUrl);
      if (page.status >= 400) throw new Error(`HTTP ${page.status}`);
      if (useBrowser && isProbablySPA(page.body)) {
        console.log(`🔎 SPA détectée sur ${currentUrl} → bascule Puppeteer`);
        throw new Error('SPA_DETECTED');
      }
    } catch (err) {
      const reason = err.message === 'SPA_DETECTED'
        ? 'SPA (rendu JS requis)'
        : (err.code || err.message);
      console.warn(`⚠ undici insuffisant sur ${currentUrl}: ${reason}`);

      if (useBrowser) {
        try {
          console.log(`🌐 Fallback Puppeteer pour ${currentUrl}…`);
          page = await fetchPageWithBrowser(currentUrl);
          usedBrowser = true;
          if (page.status >= 400) throw new Error(`HTTP ${page.status} (via Puppeteer)`);
        } catch (err2) {
          console.error(`❌ Puppeteer échoue aussi:`, err2.message);
          errors.push({
            url: currentUrl,
            error: `undici: ${reason} | puppeteer: ${err2.message}`
          });
          continue;
        }
      } else {
        errors.push({ url: currentUrl, error: `undici: ${reason}` });
        continue;
      }
    }

    const contentType = page.headers['content-type'] || '';
    const head = page.body.trim().slice(0, 300).toLowerCase();
    const looksLikeHtml =
      head.includes('<html') || head.includes('<!doctype html') ||
      head.includes('<head') || head.includes('<body');

    if (!contentType.includes('text/html') && !looksLikeHtml) {
      errors.push({
        url: currentUrl,
        error: `Content-Type non-HTML : ${contentType || 'inconnu'}`
      });
      continue;
    }

    const $ = cheerio.load(page.body);
    const pageLinks = [];

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      if (/^(javascript:|mailto:|tel:|#)/i.test(href)) return;

      let absolute;
      try { absolute = new URL(href, currentUrl).href; } catch { return; }

      const text = $(el).text().trim().replace(/\s+/g, ' ').substring(0, 120);
      const isInternal = new URL(absolute).hostname === baseHost;
      const type = classifyResource(absolute);
      const relevance = scoreRelevance({ type, isInternal, text, url: absolute });

      pageLinks.push({
        url: absolute,
        title: text || '(sans titre)',
        type: isInternal ? 'internal' : 'external',
        resourceType: type,
        source,
        relevance: parseFloat(relevance.toFixed(2)),
        scannedAt: new Date().toISOString(),
        via: page.via
      });

      if (
        isInternal &&
        currentDepth < safeDepth &&
        !visited.has(absolute) &&
        !shouldSkipScanning(absolute)
      ) {
        queue.push({
          url: absolute,
          source: `Sous-page ${pagesScanned.length + 1}`,
          depth: currentDepth + 1
        });
      }
    });

    $('img[src], source[srcset], source[src]').each((_, el) => {
      const src = $(el).attr('src');
      const srcset = $(el).attr('srcset');
      const candidates = [];
      if (src) candidates.push(src);
      if (srcset) {
        srcset.split(',').forEach(part => {
          const u = part.trim().split(/\s+/)[0];
          if (u) candidates.push(u);
        });
      }
      candidates.forEach(href => {
        if (!href || href.startsWith('data:')) return;
        let absolute;
        try { absolute = new URL(href, currentUrl).href; } catch { return; }
        const isInternal = new URL(absolute).hostname === baseHost;
        const alt = $(el).attr('alt') || '(image sans alt)';
        pageLinks.push({
          url: absolute,
          title: alt.substring(0, 120),
          type: isInternal ? 'internal' : 'external',
          resourceType: 'image',
          source,
          relevance: 0.7,
          scannedAt: new Date().toISOString(),
          via: page.via
        });
      });
    });

    $('link[href], iframe[src], embed[src], object[data]').each((_, el) => {
      const href = $(el).attr('href') || $(el).attr('src') || $(el).attr('data');
      if (!href) return;
      let absolute;
      try { absolute = new URL(href, currentUrl).href; } catch { return; }
      const resourceType = classifyResource(absolute);
      if (!['pdf', 'image', 'video', 'audio', 'other'].includes(resourceType)) return;

      const isInternal = new URL(absolute).hostname === baseHost;
      pageLinks.push({
        url: absolute,
        title: `${resourceType.toUpperCase()} embarqué`,
        type: isInternal ? 'internal' : 'external',
        resourceType,
        source,
        relevance: 0.5,
        scannedAt: new Date().toISOString(),
        via: page.via
      });
    });

    const uniquePageLinks = [];
    const seen = new Set();
    for (const l of pageLinks) {
      if (!seen.has(l.url)) {
        seen.add(l.url);
        uniquePageLinks.push(l);
      }
    }

    results.push(...uniquePageLinks);
    pagesScanned.push({
      url: currentUrl,
      status: page.status,
      linksFound: uniquePageLinks.length,
      via: page.via,
      usedBrowser
    });

    console.log(`✅ ${currentUrl} — ${uniquePageLinks.length} liens (${page.via})`);
  }

  const globalSeen = new Set();
  const finalResults = results.filter(l => {
    if (globalSeen.has(l.url)) return false;
    globalSeen.add(l.url);
    return true;
  });

  const domainStats = {};
  finalResults.forEach(l => {
    try {
      const host = new URL(l.url).hostname;
      domainStats[host] = (domainStats[host] || 0) + 1;
    } catch {}
  });

  const topDomains = Object.entries(domainStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([domain, count]) => ({ domain, count }));

  const typeStats = {};
  finalResults.forEach(l => {
    typeStats[l.resourceType] = (typeStats[l.resourceType] || 0) + 1;
  });

  const stats = {
    total: finalResults.length,
    internal: finalResults.filter(l => l.type === 'internal').length,
    external: finalResults.filter(l => l.type === 'external').length,
    pages: pagesScanned.length,
    images: finalResults.filter(l => l.resourceType === 'image').length,
    pdf: finalResults.filter(l => l.resourceType === 'pdf').length,
    documents: finalResults.filter(l =>
      ['doc', 'docx', 'xls', 'xlsx', 'csv', 'txt'].includes(l.resourceType)
    ).length,
    errors: errors.length,
    usedBrowser: pagesScanned.some(p => p.usedBrowser),
    durationMs: Date.now() - startTime,
    topDomains,
    typeStats
  };

  const responseData = {
    success: true,
    scannedAt: new Date().toISOString(),
    stats,
    pages: pagesScanned,
    errors,
    links: finalResults
  };

  setCache(cacheKey, responseData);
  res.json(responseData);
});

// ─── /api/extract ───
app.post('/api/extract', rateLimit, async (req, res) => {
  const { urls = [] } = req.body || {};

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'Liste d\'URLs vide.' });
  }

  const validated = [];
  for (const u of urls.slice(0, LIMITS.MAX_EXTRACT_URLS)) {
    const check = validateTargetUrl(u);
    if (check.ok) validated.push(check.url.href);
  }

  if (validated.length === 0) {
    return res.status(403).json({ error: 'Aucune URL autorisée.', errorType: 'SSRF_BLOCKED' });
  }

  const results = [];
  const startTime = Date.now();

  for (const url of validated) {
    const ext = url.split('?')[0].split('.').pop().toLowerCase();
    try {
      let result;
      if (ext === 'pdf') result = await extractPDF(url);
      else if (ext === 'json') result = await extractJSON(url);
      else if (ext === 'csv') result = await extractCSV(url);
      else if (ext === 'xlsx' || ext === 'xls') result = await extractXLSX(url);
      else result = await probeApiEndpoint(url);

      results.push(result);
      console.log(`📄 Extrait ${url} — ${result.success !== false ? 'OK' : 'échec'}`);
    } catch (err) {
      results.push({ url, error: err.message });
      console.error(`❌ ${url} :`, err.message);
    }
  }

  res.json({
    success: true,
    extractedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    count: results.length,
    results
  });
});

// ─── /api/detect-apis ───
app.post('/api/detect-apis', rateLimit, ssrfGuard, async (req, res) => {
  const { url, probe = false } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL manquante.' });

  try {
    const page = await fetchPageWithBrowser(url);
    const endpoints = detectApiEndpoints(page.body, page.finalUrl);
    const nextData = extractNextData(page.body);

    let probed = [];
    if (probe && endpoints.length > 0) {
      const toProbe = endpoints.slice(0, 5);
      probed = await Promise.all(toProbe.map(ep => probeApiEndpoint(ep)));
    }

    res.json({
      success: true,
      url: page.finalUrl,
      framework: nextData ? nextData.framework : 'inconnu',
      nextData: nextData ? {
        page: nextData.page,
        query: nextData.query,
        buildId: nextData.buildId,
        hasProps: !!nextData.props
      } : null,
      endpointsCount: endpoints.length,
      endpoints,
      probed
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── /api/probe-rest ───
app.post('/api/probe-rest', rateLimit, ssrfGuard, async (req, res) => {
  const {
    url,
    method = 'GET',
    headers = {},
    body = null,
    insecure = false,
    timeout = 15000
  } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL manquante.' });
  }

  const check = validateTargetUrl(url);
  if (!check.ok) return res.status(403).json({ error: check.reason, errorType: 'SSRF_BLOCKED' });

  const parsedUrl = check.url;

  try {
    const addresses = await lookup(parsedUrl.hostname, { all: true });
    console.log(`✅ ${parsedUrl.hostname} résout vers :`, addresses.map(a => a.address).join(', '));
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: `DNS non résolu : ${parsedUrl.hostname}`,
      errorType: 'DNS_NOT_FOUND',
      hint: `Le nom "${parsedUrl.hostname}" n'existe pas sur ton réseau.`,
      checks: [
        { label: 'VPN actif ?', cmd: 'ifconfig | grep -E "tun|utun|ppp"' },
        { label: 'Entrée /etc/hosts ?', cmd: `cat /etc/hosts | grep -i "${parsedUrl.hostname}"` },
        { label: 'DNS résout ?', cmd: `dig ${parsedUrl.hostname}` }
      ],
      details: err.code
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const start = Date.now();

  try {
    const fetchOptions = {
      method,
      headers: {
        'User-Agent': 'Scanner-Pro/4.0 (API Probe)',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        ...headers
      },
      signal: controller.signal,
      dispatcher: insecure ? insecureAgent : undefined
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      if (!fetchOptions.headers['Content-Type']) {
        fetchOptions.headers['Content-Type'] = 'application/json';
      }
    }

    const resp = await request(url, fetchOptions);
    const rawBody = await resp.body.arrayBuffer();
    const text = new TextDecoder('utf-8').decode(rawBody);

    const contentType = resp.headers['content-type'] || '';
    let parsed = null;
    let structure = null;

    if (contentType.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
      try {
        parsed = JSON.parse(text);
        structure = analyzeJSONStructure(parsed);
      } catch {}
    }

    res.json({
      success: true,
      url,
      method,
      status: resp.statusCode,
      statusText: getStatusText(resp.statusCode),
      durationMs: Date.now() - start,
      headers: sanitizeHeaders(resp.headers),
      contentType,
      size: rawBody.byteLength,
      preview: text.substring(0, 3000),
      isJSON: !!parsed,
      json: parsed ? summarizeJSON(parsed) : null,
      structure,
      security: analyzeSecurity(resp.headers, resp.statusCode),
      apiHints: detectAPIHints(parsed, resp.headers)
    });
  } catch (err) {
    res.json({
      success: false,
      url,
      method,
      error: err.code || err.message,
      errorType: classifyError(err),
      durationMs: Date.now() - start,
      hint: getErrorHint(err)
    });
  } finally {
    clearTimeout(timer);
  }
});

// ─── /api/analyze-swagger ───
app.post('/api/analyze-swagger', rateLimit, async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL manquante.' });

  try {
    const { buffer } = await downloadFile(url, 15000);
    const text = buffer.toString('utf-8');
    let spec;

    try {
      spec = JSON.parse(text);
    } catch {
      return res.status(400).json({
        error: 'Format non JSON. Le YAML n\'est pas encore supporté.'
      });
    }

    const info = spec.info || {};
    const servers = spec.servers || [];
    const paths = spec.paths || {};
    const securitySchemes = spec.components?.securitySchemes || {};

    const endpoints = Object.entries(paths).map(([path, methods]) => {
      const operations = Object.entries(methods)
        .filter(([m]) => ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'].includes(m))
        .map(([method, op]) => ({
          method: method.toUpperCase(),
          operationId: op.operationId,
          summary: op.summary || op.description || '',
          tags: op.tags || [],
          parameters: (op.parameters || []).map(p => ({
            name: p.name || p.$ref?.split('/').pop() || '?',
            in: p.in,
            required: p.required,
            description: p.description
          })),
          hasBody: !!op.requestBody,
          security: op.security,
          authType: op['x-auth-type'],
          throttling: op['x-throttling-tier']
        }));
      return { path, operations };
    });

    const schemas = spec.components?.schemas || {};
    const schemaList = Object.entries(schemas).map(([name, schema]) => ({
      name,
      type: schema.type,
      properties: schema.properties ? Object.keys(schema.properties) : [],
      description: schema.description
    }));

    const authSchemes = Object.entries(securitySchemes).map(([name, scheme]) => ({
      name,
      type: scheme.type,
      flows: scheme.flows ? Object.keys(scheme.flows) : null,
      scopes: scheme.flows?.implicit?.scopes || scheme.flows?.authorizationCode?.scopes || null
    }));

    res.json({
      success: true,
      url,
      info: {
        title: info.title,
        description: info.description,
        version: info.version,
        contact: info.contact
      },
      servers,
      endpointsCount: endpoints.length,
      endpoints,
      schemasCount: schemaList.length,
      schemas: schemaList,
      authSchemes
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── /api/apis-catalog ───
app.get('/api/apis-catalog', (_, res) => {
  res.json({
    success: true,
    stats: getCatalogStats(),
    apis: API_CATALOG
  });
});

// ─── /api/sitemap ───
app.post('/api/sitemap', rateLimit, ssrfGuard, async (req, res) => {
  const { url, includeRSS = false } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL manquante.' });

  try {
    const sitemap = await fetchSitemap(url);
    let rss = null;
    if (includeRSS) rss = await fetchRSS(url);

    res.json({
      success: sitemap.success,
      sitemap,
      rss: rss || null,
      error: sitemap.success ? null : sitemap.error
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── /api/scan-full ───
app.post('/api/scan-full', rateLimit, ssrfGuard, async (req, res) => {
  const {
    url,
    maxUrls = 50,
    useBrowser = true,
    concurrency = 3,
    includeRSS = true,
    skipCache = false
  } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL manquante ou invalide.' });
  }

  const check = validateTargetUrl(url);
  if (!check.ok) return res.status(403).json({ error: check.reason, errorType: 'SSRF_BLOCKED' });

  const baseUrl = check.url;
  const safeMaxUrls = clamp(maxUrls, 1, LIMITS.MAX_URLS_FULL);
  const safeConcurrency = clamp(concurrency, 1, LIMITS.MAX_CONCURRENCY);

  const cacheKey = `full|${baseUrl.href}|${safeMaxUrls}|${includeRSS}`;
  if (!skipCache) {
    const cached = getFromCache(cacheKey);
    if (cached) {
      console.log(`📦 Cache hit (scan complet) pour ${baseUrl.href}`);
      return res.json({ ...cached, fromCache: true });
    }
  }

  const startTime = Date.now();
  const errors = [];
  const pagesScanned = [];
  const results = [];
  const visited = new Set();

  console.log(`🕷️ Scan complet de ${baseUrl.href}`);

  let urlsToScan = [];

  try {
    const sitemap = await fetchSitemap(baseUrl.href);
    if (sitemap.success && sitemap.urls) {
      urlsToScan = sitemap.urls.map(u => u.url);
      console.log(`📄 Sitemap: ${urlsToScan.length} URLs trouvées`);
    }
  } catch (err) {
    console.warn(`⚠ Sitemap échoué: ${err.message}`);
  }

  if (includeRSS) {
    try {
      const rss = await fetchRSS(baseUrl.href);
      if (rss.success) {
        const rssUrls = rss.urls.map(u => u.url);
        urlsToScan = [...new Set([...urlsToScan, ...rssUrls])];
        console.log(`📰 RSS: ${rssUrls.length} URLs supplémentaires`);
      }
    } catch (err) {
      console.warn(`⚠ RSS échoué: ${err.message}`);
    }
  }

  if (urlsToScan.length === 0) {
    console.log(`⚠ Aucun sitemap, scan de la page principale`);
    try {
      const page = await fetchPageWithBrowser(baseUrl.href);
      const $ = cheerio.load(page.body);
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) return;
        try {
          const abs = new URL(href, baseUrl.href).href;
          if (new URL(abs).hostname === baseUrl.hostname) urlsToScan.push(abs);
        } catch {}
      });
      urlsToScan = [...new Set(urlsToScan)];
      console.log(`🔗 ${urlsToScan.length} URLs depuis la page principale`);
    } catch (err) {
      console.warn(`⚠ Page principale inaccessible: ${err.message}`);
    }
  }

  urlsToScan = urlsToScan.slice(0, safeMaxUrls);

  if (urlsToScan.length === 0) {
    return res.json({
      success: false,
      error: 'Aucune URL à scanner.',
      stats: { total: 0, pages: 0, errors: 1, durationMs: Date.now() - startTime },
      errors: [{ url: baseUrl.href, error: 'Aucune URL trouvée' }],
      pages: [],
      links: []
    });
  }

  console.log(`🚀 Scan de ${urlsToScan.length} URLs (concurrency: ${safeConcurrency})`);

  const scanOne = async (targetUrl) => {
    if (visited.has(targetUrl)) return;
    visited.add(targetUrl);

    let page;
    try {
      page = await fetchPage(targetUrl);
      if (page.status >= 400) throw new Error(`HTTP ${page.status}`);
      if (useBrowser && isProbablySPA(page.body)) throw new Error('SPA_DETECTED');
    } catch (err) {
      if (useBrowser) {
        try {
          page = await fetchPageWithBrowser(targetUrl);
          if (page.status >= 400) throw new Error(`HTTP ${page.status} (via Puppeteer)`);
        } catch (err2) {
          errors.push({
            url: targetUrl,
            error: `undici: ${err.code || err.message} | puppeteer: ${err2.message}`
          });
          return;
        }
      } else {
        errors.push({ url: targetUrl, error: err.code || err.message });
        return;
      }
    }

    const contentType = page.headers['content-type'] || '';
    if (!contentType.includes('text/html') && !page.body.includes('<html')) {
      errors.push({ url: targetUrl, error: `Content-Type non-HTML` });
      return;
    }

    const $ = cheerio.load(page.body);
    const pageLinks = [];

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) return;

      let absolute;
      try { absolute = new URL(href, targetUrl).href; } catch { return; }

      const text = $(el).text().trim().replace(/\s+/g, ' ').substring(0, 120);
      const isInternal = new URL(absolute).hostname === baseUrl.hostname;
      const type = classifyResource(absolute);

      pageLinks.push({
        url: absolute,
        title: text || '(sans titre)',
        type: isInternal ? 'internal' : 'external',
        resourceType: type,
        source: targetUrl,
        relevance: 0.6,
        scannedAt: new Date().toISOString(),
        via: page.via
      });
    });

    $('img[src]').each((_, el) => {
      const src = $(el).attr('src');
      if (!src || src.startsWith('data:')) return;
      try {
        const absolute = new URL(src, targetUrl).href;
        pageLinks.push({
          url: absolute,
          title: $(el).attr('alt') || '(image)',
          type: 'internal',
          resourceType: 'image',
          source: targetUrl,
          relevance: 0.5,
          scannedAt: new Date().toISOString(),
          via: page.via
        });
      } catch {}
    });

    const uniqueLinks = [];
    const seen = new Set();
    for (const l of pageLinks) {
      if (!seen.has(l.url)) {
        seen.add(l.url);
        uniqueLinks.push(l);
      }
    }

    results.push(...uniqueLinks);
    pagesScanned.push({
      url: targetUrl,
      status: page.status,
      linksFound: uniqueLinks.length,
      via: page.via
    });

    console.log(`✅ ${targetUrl} — ${uniqueLinks.length} liens (${page.via})`);
  };

  for (let i = 0; i < urlsToScan.length; i += safeConcurrency) {
    const batch = urlsToScan.slice(i, i + safeConcurrency);
    await Promise.all(batch.map(scanOne));
  }

  const globalSeen = new Set();
  const finalResults = results.filter(l => {
    if (globalSeen.has(l.url)) return false;
    globalSeen.add(l.url);
    return true;
  });

  const stats = {
    total: finalResults.length,
    internal: finalResults.filter(l => l.type === 'internal').length,
    external: finalResults.filter(l => l.type === 'external').length,
    pages: pagesScanned.length,
    images: finalResults.filter(l => l.resourceType === 'image').length,
    pdf: finalResults.filter(l => l.resourceType === 'pdf').length,
    documents: finalResults.filter(l =>
      ['doc', 'docx', 'xls', 'xlsx', 'csv', 'txt'].includes(l.resourceType)
    ).length,
    errors: errors.length,
    durationMs: Date.now() - startTime,
    sitemapUsed: urlsToScan.length,
    mode: 'full'
  };

  const responseData = {
    success: true,
    scannedAt: new Date().toISOString(),
    stats,
    pages: pagesScanned,
    errors,
    links: finalResults
  };

  setCache(cacheKey, responseData);
  res.json(responseData);
});

// ─── /api/probe-catalog — NOUVEAU ───
app.post('/api/probe-catalog', rateLimit, async (req, res) => {
  const { category = null, maxApis = 15, insecure = false } = req.body || {};

  const safeMax = clamp(maxApis, 1, 30);

  // Filtre par catégorie si demandé
  const apis = category
    ? API_CATALOG.filter(a => a.category === category)
    : API_CATALOG;

  // Pour chaque API, prend le premier exemple
  const targets = apis
    .filter(a => a.examples && a.examples.length > 0)
    .slice(0, safeMax)
    .map(a => ({
      id: a.id,
      name: a.name,
      category: a.category,
      auth: a.auth,
      url: a.examples[0].url,
      label: a.examples[0].label
    }));

  if (targets.length === 0) {
    return res.status(400).json({ error: 'Aucune API à tester.' });
  }

  console.log(`🧪 Probe catalogue : ${targets.length} APIs`);

  const results = [];
  for (const target of targets) {
    const check = validateTargetUrl(target.url);
    if (!check.ok) {
      results.push({
        ...target,
        success: false,
        error: check.reason,
        errorType: 'SSRF_BLOCKED'
      });
      continue;
    }

    try {
      const probe = await probeApiEndpoint(target.url, {
        method: 'GET',
        timeoutMs: 12000
      });
      results.push({
        ...target,
        success: probe.success,
        status: probe.status,
        statusText: probe.statusText,
        durationMs: probe.durationMs,
        isJSON: probe.isJSON,
        size: probe.size,
        error: probe.error || null,
        errorType: probe.errorType || null,
        security: probe.security || null
      });
    } catch (err) {
      results.push({
        ...target,
        success: false,
        error: err.message,
        errorType: 'UNKNOWN'
      });
    }
  }

  const summary = {
    total: results.length,
    ok: results.filter(r => r.success && r.status < 400).length,
    redirects: results.filter(r => r.status >= 300 && r.status < 400).length,
    clientErrors: results.filter(r => r.status >= 400 && r.status < 500).length,
    serverErrors: results.filter(r => r.status >= 500).length,
    failed: results.filter(r => !r.success).length
  };

  res.json({
    success: true,
    probedAt: new Date().toISOString(),
    summary,
    results
  });
});

// ═══════════════════════════════════════════════════════════
//  9. HEALTH
// ═══════════════════════════════════════════════════════════

app.get('/api/health', (_, res) =>
  res.json({
    status: 'ok',
    project: 'scanner',
    version: '4.0.0',
    node: process.version,
    browser: !!browserInstance,
    cacheSize: scanCache.size,
    rateLimitEntries: rateLimitStore.size
  })
);

// ═══════════════════════════════════════════════════════════
//  10. LANCEMENT
// ═══════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`✅ Scanner Pro v4.0 prêt sur http://localhost:${PORT}`);
  console.log(`   Node ${process.version} • undici 8 • puppeteer 25`);
});