// optimizations.js
// Briques d'optimisation pour Scanner Pro.

import { request, Pool } from 'undici';
import { LIMITS, clamp } from './utils.js';
import { EventEmitter } from 'node:events';

// ═══════════════════════════════════════════════════════════
//  1. ADAPTIVE QUEUE
// ═══════════════════════════════════════════════════════════

export class AdaptiveQueue {
  constructor(options = {}) {
    this.initialConcurrency = clamp(options.initialConcurrency ?? 5, 1, 30);
    this.maxConcurrency = clamp(options.maxConcurrency ?? 20, 1, 50);
    this.minConcurrency = clamp(options.minConcurrency ?? 1, 1, 10);
    this.errorThreshold = options.errorThreshold ?? 0.1;
    this.recoveryThreshold = options.recoveryThreshold ?? 0.02;

    this.concurrency = this.initialConcurrency;
    this.active = 0;
    this.queue = [];
    this.completed = 0;
    this.errors = 0;
    this.startedAt = Date.now();
    this._adjustLock = false;
  }

  add(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this._process();
    });
  }

  _process() {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const { task, resolve, reject } = this.queue.shift();
      this.active++;

      Promise.resolve()
        .then(() => task())
        .then(result => { this.completed++; this._adjust(); resolve(result); })
        .catch(err => { this.errors++; this._adjust(); reject(err); })
        .finally(() => { this.active--; this._process(); });
    }
  }

  _adjust() {
    if (this._adjustLock) return;
    this._adjustLock = true;

    const total = this.completed + this.errors;
    if (total < 10) { this._adjustLock = false; return; }

    const errorRate = this.errors / total;

    if (errorRate > this.errorThreshold && this.concurrency > this.minConcurrency) {
      this.concurrency = Math.max(this.minConcurrency, Math.floor(this.concurrency * 0.7));
    } else if (errorRate < this.recoveryThreshold && this.concurrency < this.maxConcurrency) {
      this.concurrency = Math.min(this.maxConcurrency, this.concurrency + 1);
    }

    this._adjustLock = false;
  }

  async drain() {
    while (this.active > 0 || this.queue.length > 0) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  stats() {
    return {
      concurrency: this.concurrency,
      active: this.active,
      queued: this.queue.length,
      completed: this.completed,
      errors: this.errors,
      errorRate: (this.completed + this.errors) > 0
        ? (this.errors / (this.completed + this.errors)).toFixed(3)
        : '0.000',
      elapsedMs: Date.now() - this.startedAt
    };
  }
}

// ═══════════════════════════════════════════════════════════
//  2. POOL MANAGER
// ═══════════════════════════════════════════════════════════

export class PoolManager {
  constructor(options = {}) {
    this.connections = clamp(options.connections ?? 20, 1, 100);
    this.pipelining = clamp(options.pipelining ?? 1, 1, 10);
    this.keepAliveTimeout = options.keepAliveTimeout ?? 30_000;
    this.pools = new Map();
  }

  _getOrigin(url) {
    try { return new URL(url).origin; } catch { return null; }
  }

  _getPool(origin) {
    if (!this.pools.has(origin)) {
      this.pools.set(origin, new Pool(origin, {
        connections: this.connections,
        pipelining: this.pipelining,
        keepAliveTimeout: this.keepAliveTimeout
      }));
    }
    return this.pools.get(origin);
  }

  async fetch(url, options = {}) {
    const origin = this._getOrigin(url);
    if (!origin) throw new Error(`URL invalide : ${url}`);

    const pool = this._getPool(origin);
    const parsed = new URL(url);

    const reqOptions = {
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Scanner-Pro/4.0 (PoolManager)',
        'Accept': options.accept || '*/*',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        ...(options.headers || {})
      }
    };

    if (options.body && ['POST', 'PUT', 'PATCH'].includes(reqOptions.method)) {
      reqOptions.body = typeof options.body === 'string'
        ? options.body
        : JSON.stringify(options.body);
      if (!reqOptions.headers['Content-Type']) {
        reqOptions.headers['Content-Type'] = 'application/json';
      }
    }

    const res = await pool.request(reqOptions);
    const text = await res.body.text();
    const size = Buffer.byteLength(text, 'utf-8');

    let json = null;
    const ct = res.headers['content-type'] || '';
    if (ct.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
      try { json = JSON.parse(text); } catch {}
    }

    return { status: res.statusCode, headers: res.headers, text, json, size };
  }

  async close() {
    const promises = [];
    for (const pool of this.pools.values()) {
      promises.push(pool.close().catch(() => {}));
    }
    await Promise.all(promises);
    this.pools.clear();
  }

  stats() {
    return { pools: this.pools.size, origins: [...this.pools.keys()] };
  }
}

// ═══════════════════════════════════════════════════════════
//  3. CKAN DETECTOR
// ═══════════════════════════════════════════════════════════

export class CkanDetector {
  constructor(poolManager) {
    this.pool = poolManager;
  }

  async detect(baseUrl) {
    let origin;
    try { origin = new URL(baseUrl).origin; } catch { return { type: null, apiUrl: null }; }

    const candidates = [
      // CKAN — standard
      { type: 'ckan', url: `${origin}/api/3/action/package_search?rows=1` },
      // CKAN — chemins alternatifs (govdata.de, etc.)
      { type: 'ckan', url: `${origin}/ckan/api/3/action/package_search?rows=1` },
      { type: 'ckan', url: `${origin}/api/action/package_search?rows=1` },
      { type: 'ckan', url: `${origin}/catalog/api/3/action/package_search?rows=1` },
      // udata (data.gouv.fr, etalab)
      { type: 'udata', url: `${origin}/api/1/datasets/?page_size=1` },
      // DCAT-AP (data.europa.eu)
      { type: 'dcat', url: `${origin}/api/hub/search/search?limit=1` },
      { type: 'dcat', url: `${origin}/api/hub/search/datasets?limit=1` },
      // DKAN
      { type: 'dkan', url: `${origin}/api/1/search?page=0` },
      // Socrata
      { type: 'socrata', url: `${origin}/api/views.json?limit=1` },
      // OpenDataSoft
      { type: 'opendatasoft', url: `${origin}/api/v2/catalog/datasets?limit=1` }
    ];

    for (const candidate of candidates) {
      try {
        const res = await this.pool.fetch(candidate.url, { accept: 'application/json' });
        if (res.status === 200 && res.json && !res.json.error) {
          // Extrait la base URL (avant le chemin d'action)
          const apiBaseUrl = candidate.url
            .replace(/\/package_search.*$/, '')
            .replace(/\/datasets.*$/, '')
            .replace(/\/search.*$/, '');

          console.log(`✅ Portail détecté : ${candidate.type} (${origin})`);
          console.log(`   Base API : ${apiBaseUrl}`);

          return {
            type: candidate.type,
            apiUrl: candidate.url,
            apiBaseUrl  // ← NOUVEAU
          };
        }
      } catch {}
    }

    return { type: null, apiUrl: null, apiBaseUrl: null };
  }

  async extractCkan(origin, maxDatasets = 1000, apiBaseUrl = null) {
    const rows = Math.min(maxDatasets, 1000);
    const base = apiBaseUrl || `${origin}/api/3/action`;
    const url = `${base}/package_search?rows=${rows}`;

    const res = await this.pool.fetch(url, { accept: 'application/json' });
    if (res.status !== 200 || !res.json?.success) {
      throw new Error('CKAN API : réponse invalide');
    }

    const datasets = res.json.result?.results || [];
    const links = [];

    for (const ds of datasets) {
      const dsUrl = `${origin}/dataset/${ds.name || ds.id}`;
      links.push({
        url: dsUrl,
        title: ds.title || ds.name,
        type: 'internal',
        resourceType: 'html',
        source: 'CKAN (dataset)',
        relevance: 0.95,
        scannedAt: new Date().toISOString(),
        via: 'ckan-api',
        metadata: {
          id: ds.id,
          name: ds.name,
          organization: ds.organization?.title,
          tags: (ds.tags || []).map(t => t.name),
          numResources: (ds.resources || []).length
        }
      });

      for (const resource of ds.resources || []) {
        links.push({
          url: resource.url,
          title: resource.name || resource.description || ds.title,
          type: 'external',
          resourceType: this._guessResourceType(resource.format || resource.url),
          source: `CKAN (${ds.title})`,
          relevance: 0.9,
          scannedAt: new Date().toISOString(),
          via: 'ckan-api',
          metadata: {
            format: resource.format,
            size: resource.size,
            datasetId: ds.id
          }
        });
      }
    }

    return links;
  }

  async extractOpenDataSoft(origin, maxDatasets = 1000) {
    const url = `${origin}/api/v2/catalog/datasets?limit=${Math.min(maxDatasets, 100)}`;
    const res = await this.pool.fetch(url, { accept: 'application/json' });
    if (res.status !== 200 || !res.json?.datasets) {
      throw new Error('OpenDataSoft API : réponse invalide');
    }

    return res.json.datasets.map(ds => ({
      url: `${origin}/explore/dataset/${ds.dataset_id}/`,
      title: ds.metas?.title || ds.dataset_id,
      type: 'internal',
      resourceType: 'html',
      source: 'OpenDataSoft',
      relevance: 0.9,
      scannedAt: new Date().toISOString(),
      via: 'opendatasoft-api',
      metadata: {
        id: ds.dataset_id,
        records: ds.metas?.records_count,
        theme: ds.metas?.theme
      }
    }));
  }

  async extractAll(baseUrl, maxDatasets = 1000) {
    const { type, apiBaseUrl } = await this.detect(baseUrl);
    const origin = new URL(baseUrl).origin;

    if (!type) return { detected: null, links: [], fromApi: false };

    try {
      let links = [];
      if (type === 'ckan') {
        links = await this.extractCkan(origin, maxDatasets, apiBaseUrl);
      } else if (type === 'udata') {
        links = await this.extractUdata(origin, maxDatasets);
      } else if (type === 'dcat') {
        links = await this.extractDcat(origin, maxDatasets);
      } else if (type === 'opendatasoft') {
        links = await this.extractOpenDataSoft(origin, maxDatasets);
      } else {
        return { detected: type, links: [], fromApi: false };
      }

      console.log(`✅ ${links.length} ressources extraites via ${type}`);
      return { detected: type, links, fromApi: true, apiBaseUrl };
    } catch (err) {
      console.warn(`⚠ Extraction ${type} échouée : ${err.message}`);
      return { detected: type, links: [], fromApi: false };
    }
  }

  async extractUdata(origin, maxDatasets = 1000) {
    const pageSize = Math.min(maxDatasets, 100);
    const url = `${origin}/api/1/datasets/?page_size=${pageSize}`;

    const res = await this.pool.fetch(url, { accept: 'application/json' });
    if (res.status !== 200 || !res.json?.data) {
      throw new Error('udata API : réponse invalide');
    }

    const datasets = res.json.data;
    const links = [];

    for (const ds of datasets) {
      const dsUrl = `${origin}/datasets/${ds.slug || ds.id}/`;
      links.push({
        url: dsUrl,
        title: ds.title,
        type: 'internal',
        resourceType: 'html',
        source: 'udata (dataset)',
        relevance: 0.95,
        scannedAt: new Date().toISOString(),
        via: 'udata-api',
        metadata: {
          id: ds.id,
          slug: ds.slug,
          organization: ds.organization?.name,
          tags: (ds.tags || []),
          numResources: (ds.resources || []).length
        }
      });

      for (const resource of ds.resources || []) {
        links.push({
          url: resource.url,
          title: resource.title,
          type: 'external',
          resourceType: this._guessResourceType(resource.format || resource.url),
          source: `udata (${ds.title})`,
          relevance: 0.9,
          scannedAt: new Date().toISOString(),
          via: 'udata-api',
          metadata: {
            format: resource.format,
            filesize: resource.filesize,
            datasetId: ds.id
          }
        });
      }
    }

    return links;
  }

  async extractDcat(origin, maxDatasets = 1000) {
    const limit = Math.min(maxDatasets, 100);
    const url = `${origin}/api/hub/search/search?limit=${limit}`;

    const res = await this.pool.fetch(url, { accept: 'application/json' });
    if (res.status !== 200 || !res.json) {
      throw new Error('DCAT-AP API : réponse invalide');
    }

    // Structure DCAT-AP : { result: { count, results: [...] } }
    const datasets = res.json.result?.results
      || res.json.results
      || res.json.data
      || [];

    console.log(`📊 DCAT-AP : ${datasets.length} datasets trouvés (total: ${res.json.result?.count || '?'})`);

    const links = [];

    for (const ds of datasets) {
      // DCAT-AP utilise 'id', 'title', 'description'
      const dsId = ds.id || ds.identifier || ds.uri;
      const dsTitle = ds.title || ds.name || dsId;
      const dsUrl = `${origin}/data/datasets/${encodeURIComponent(dsId)}`;

      links.push({
        url: dsUrl,
        title: typeof dsTitle === 'string' ? dsTitle : (dsTitle?.fr || dsTitle?.en || dsId),
        type: 'internal',
        resourceType: 'html',
        source: 'DCAT-AP (dataset)',
        relevance: 0.95,
        scannedAt: new Date().toISOString(),
        via: 'dcat-api',
        metadata: {
          id: dsId,
          publisher: ds.publisher?.name || ds.publisher,
          themes: (ds.themes || []).map(t => t.label || t),
          numDistributions: (ds.distributions || []).length
        }
      });

      // Distributions (ressources)
      for (const dist of ds.distributions || []) {
        const distUrl = dist.access_url || dist.download_url || dist.url;
        if (!distUrl) continue;

        links.push({
          url: distUrl,
          title: dist.title || dist.description || `${dsTitle} - distribution`,
          type: 'external',
          resourceType: this._guessResourceType(dist.format || distUrl),
          source: `DCAT-AP (${dsTitle})`,
          relevance: 0.9,
          scannedAt: new Date().toISOString(),
          via: 'dcat-api',
          metadata: {
            format: dist.format,
            datasetId: dsId
          }
        });
      }
    }

    return links;
  }

  _guessResourceType(formatOrUrl) {
    const s = (formatOrUrl || '').toLowerCase();
    if (s.includes('csv')) return 'csv';
    if (s.includes('json')) return 'json';
    if (s.includes('xls')) return 'xlsx';
    if (s.includes('pdf')) return 'pdf';
    if (s.includes('xml')) return 'xml';
    if (s.includes('zip')) return 'archive';
    if (s.includes('geojson') || s.includes('shp')) return 'geo';
    return 'other';
  }
}

// ═══════════════════════════════════════════════════════════
//  4. ARTICLE DISCOVERER
// ═══════════════════════════════════════════════════════════

export class ArticleDiscoverer {
  constructor(options = {}) {
    this.patterns = options.patterns || [
      /\/\d{4}\/\d{2}\//,
      /\/\d{4}-\d{2}-\d{2}\//,
      /\/article\//i,
      /\/news\//i,
      /\/actualite\//i,
      /\/post\//i,
      /\/blog\//i,
      /\/\d{4}\//
    ];
    this.maxLinks = clamp(options.maxLinks ?? 500, 1, 5000);
  }

  filterArticles(urls) {
    const seen = new Set();
    const results = [];

    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);

      try {
        const path = new URL(url).pathname;
        if (this.patterns.some(p => p.test(path))) {
          results.push(url);
          if (results.length >= this.maxLinks) break;
        }
      } catch {}
    }

    return results;
  }

  async discoverFromPage(page, frontPageUrl) {
    await page.goto(frontPageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const urls = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]'))
        .map(a => a.href)
        .filter(u => u.startsWith('http'));
    });

    return this.filterArticles(urls);
  }

  discoverFromSitemap(sitemapUrls) {
    return this.filterArticles(sitemapUrls);
  }
}

// ═══════════════════════════════════════════════════════════
//  5. BATCH FETCHER
// ═══════════════════════════════════════════════════════════

export class BatchFetcher {
  constructor(options = {}) {
    this.pool = options.pool || new PoolManager({
      connections: options.connections ?? 20
    });
    this.queue = new AdaptiveQueue({
      initialConcurrency: options.initialConcurrency ?? 5,
      maxConcurrency: options.maxConcurrency ?? 20,
      minConcurrency: options.minConcurrency ?? 1
    });
    this.onProgress = options.onProgress || null;
    this.progressInterval = options.progressInterval ?? 25;
  }

  async fetchAll(urls, options = {}) {
    const results = [];
    let processed = 0;

    for (const url of urls) {
      this.queue.add(async () => {
        try {
          const res = await this.pool.fetch(url, options);
          results.push({ url, status: res.status, data: res, error: null });
        } catch (err) {
          results.push({ url, status: 0, data: null, error: err.message });
        } finally {
          processed++;
          if (this.onProgress && processed % this.progressInterval === 0) {
            this.onProgress({ processed, total: urls.length, ...this.queue.stats() });
          }
        }
      }).catch(() => {});
    }

    await this.queue.drain();
    return results;
  }

  async close() {
    await this.pool.close();
  }
}

// ═══════════════════════════════════════════════════════════
//  6. PROGRESS TRACKER
// ═══════════════════════════════════════════════════════════

export class ProgressTracker extends EventEmitter {
  constructor(total, options = {}) {
    super();
    this.total = total;
    this.completed = 0;
    this.errors = 0;
    this.startTime = Date.now();
    this.intervalMs = options.intervalMs ?? 1000;
    this._lastEmit = 0;
  }

  tick(success = true) {
    this.completed++;
    if (!success) this.errors++;

    const now = Date.now();
    if (now - this._lastEmit >= this.intervalMs) {
      this._lastEmit = now;
      this.emit('progress', this.stats());
    }
  }

  stats() {
    const elapsed = Date.now() - this.startTime;
    const rate = this.completed / (elapsed / 1000);
    const remaining = this.total - this.completed;
    const eta = rate > 0 ? (remaining / rate) * 1000 : 0;

    return {
      total: this.total,
      completed: this.completed,
      errors: this.errors,
      percent: ((this.completed / this.total) * 100).toFixed(1),
      elapsedMs: elapsed,
      ratePerSec: rate.toFixed(2),
      etaMs: Math.round(eta)
    };
  }

  done() {
    this.emit('done', this.stats());
  }
}

// ═══════════════════════════════════════════════════════════
//  7. HELPERS DE HAUT NIVEAU
// ═══════════════════════════════════════════════════════════

export async function scanOpenData(baseUrl, options = {}) {
  const pool = options.pool || new PoolManager({ connections: 10 });
  const detector = new CkanDetector(pool);
  const startTime = Date.now();

  const { detected, links, fromApi } = await detector.extractAll(
    baseUrl,
    options.maxDatasets ?? 1000
  );

  return {
    type: detected,
    links,
    fromApi,
    stats: {
      total: links.length,
      durationMs: Date.now() - startTime,
      mode: fromApi ? 'api' : 'html-fallback'
    }
  };
}

export async function scanNews(frontPageUrl, options = {}) {
  const startTime = Date.now();
  const discoverer = new ArticleDiscoverer({ maxLinks: options.maxArticles ?? 500 });

  let candidateUrls = [];
  if (options.sitemapUrls) {
    candidateUrls = discoverer.discoverFromSitemap(options.sitemapUrls);
    console.log(`📰 ${candidateUrls.length} articles depuis sitemap`);
  }

  if (candidateUrls.length === 0 && options.page) {
    candidateUrls = await discoverer.discoverFromPage(options.page, frontPageUrl);
    console.log(`📰 ${candidateUrls.length} articles depuis la page d'accueil`);
  }

  const fetcher = new BatchFetcher({
    initialConcurrency: options.concurrency ?? 5,
    maxConcurrency: options.maxConcurrency ?? 15,
    onProgress: options.onProgress
  });

  const results = await fetcher.fetchAll(candidateUrls, { accept: 'text/html' });
  await fetcher.close();

  return {
    articles: results.filter(r => r.status === 200).map(r => r.url),
    stats: {
      discovered: candidateUrls.length,
      fetched: results.filter(r => r.status === 200).length,
      errors: results.filter(r => r.error).length,
      durationMs: Date.now() - startTime
    }
  };
}

export async function scanRestApi(endpoints, options = {}) {
  const startTime = Date.now();
  const fetcher = new BatchFetcher({
    connections: options.connections ?? 30,
    initialConcurrency: options.concurrency ?? 10,
    maxConcurrency: options.maxConcurrency ?? 25,
    onProgress: options.onProgress
  });

  const results = await fetcher.fetchAll(endpoints, {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body || null,
    accept: 'application/json'
  });

  await fetcher.close();

  return {
    responses: results,
    stats: {
      total: endpoints.length,
      success: results.filter(r => r.status >= 200 && r.status < 300).length,
      errors: results.filter(r => r.error).length,
      durationMs: Date.now() - startTime
    }
  };
}
