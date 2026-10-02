#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
#  patch.sh — Applique les optimisations à Scanner Pro
# ═══════════════════════════════════════════════════════════
#
#  Usage :
#    chmod +x patch.sh
#    ./patch.sh              # Applique les patchs
#    ./patch.sh --dry-run    # Simule sans modifier
#    ./patch.sh --revert     # Annule les modifications
#    ./patch.sh --help       # Aide
#
#  Le script est idempotent : on peut le relancer sans risque.
# ═══════════════════════════════════════════════════════════

set -euo pipefail

# ─── Configuration ───
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${SCRIPT_DIR}/.patch-backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DRY_RUN=false
REVERT=false

# ─── Couleurs ───
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ─── Logging ───
log_info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error()   { echo -e "${RED}[ERR]${NC} $*" >&2; }

# ─── Aide ───
show_help() {
  cat <<EOF
Usage: ./patch.sh [OPTIONS]

Options:
  --dry-run     Simule les modifications sans les appliquer
  --revert      Restaure les fichiers depuis la dernière sauvegarde
  --help        Affiche cette aide

Ce script applique les optimisations suivantes :
  1. Crée optimizations.js (AdaptiveQueue, PoolManager, etc.)
  2. Ajoute les imports dans server.js
  3. Ajoute les routes /api/scan-opendata, /api/scan-news, /api/scan-api-batch
  4. Ajoute /api/pool/stats
  5. Met à jour package.json (scripts)

Les fichiers originaux sont sauvegardés dans .patch-backups/
EOF
}

# ─── Parse args ───
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --revert)  REVERT=true ;;
    --help|-h) show_help; exit 0 ;;
    *) log_error "Option inconnue : $arg"; show_help; exit 1 ;;
  esac
done

# ─── Backup ───
backup_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  mkdir -p "$BACKUP_DIR"
  local base
  base="$(basename "$file")"
  local dest="${BACKUP_DIR}/${base}.${TIMESTAMP}.bak"
  cp "$file" "$dest"
  log_info "Sauvegarde : $file → $dest"
}

# ─── Revert ───
do_revert() {
  log_info "Restauration depuis la dernière sauvegarde…"

  if [[ ! -d "$BACKUP_DIR" ]]; then
    log_error "Aucun backup trouvé dans $BACKUP_DIR"
    exit 1
  fi

  local last_ts
  last_ts="$(ls -1 "$BACKUP_DIR" | grep -oE '[0-9]{8}_[0-9]{6}' | sort -u | tail -n1)"

  if [[ -z "$last_ts" ]]; then
    log_error "Aucun timestamp trouvé dans les backups"
    exit 1
  fi

  log_info "Timestamp cible : $last_ts"

  for bak in "$BACKUP_DIR"/*."$last_ts".bak; do
    [[ -e "$bak" ]] || continue
    local base
    base="$(basename "$bak")"
    base="${base%.$last_ts.bak}"
    local target="${SCRIPT_DIR}/${base}"
    cp "$bak" "$target"
    log_success "Restauré : $target"
  done

  # Supprime optimizations.js s'il existe
  if [[ -f "${SCRIPT_DIR}/optimizations.js" ]]; then
    rm -f "${SCRIPT_DIR}/optimizations.js"
    log_success "Supprimé : optimizations.js"
  fi

  log_success "Revenir terminé."
  exit 0
}

# ─── Vérification des prérequis ───
check_prerequisites() {
  log_info "Vérification des prérequis…"

  local missing=()
  for cmd in node npm; do
    if ! command -v "$cmd" &> /dev/null; then
      missing+=("$cmd")
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    log_error "Commandes manquantes : ${missing[*]}"
    exit 1
  fi

  local required_files=("server.js" "utils.js" "extractors.js" "package.json")
  for f in "${required_files[@]}"; do
    if [[ ! -f "${SCRIPT_DIR}/${f}" ]]; then
      log_error "Fichier requis manquant : $f"
      exit 1
    fi
  done

  log_success "Prérequis OK (Node $(node -v), npm $(npm -v))"
}

# ═══════════════════════════════════════════════════════════
#  ÉTAPE 1 : Créer optimizations.js
# ═══════════════════════════════════════════════════════════

create_optimizations() {
  local file="${SCRIPT_DIR}/optimizations.js"

  if [[ -f "$file" ]]; then
    log_warn "optimizations.js existe déjà — ignoré"
    return 0
  fi

  if $DRY_RUN; then
    log_info "[DRY-RUN] Créerait optimizations.js"
    return 0
  fi

  log_info "Création de optimizations.js…"

  cat > "$file" <<'OPTIMIZATIONS_EOF'
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
      { type: 'ckan', url: `${origin}/api/3/action/package_search?rows=1` },
      { type: 'dkan', url: `${origin}/api/1/search?page=0` },
      { type: 'socrata', url: `${origin}/api/views.json?limit=1` },
      { type: 'opendatasoft', url: `${origin}/api/v2/catalog/datasets?limit=1` }
    ];

    for (const candidate of candidates) {
      try {
        const res = await this.pool.fetch(candidate.url, { accept: 'application/json' });
        if (res.status === 200 && res.json) {
          console.log(`✅ Portail détecté : ${candidate.type} (${origin})`);
          return { type: candidate.type, apiUrl: candidate.url };
        }
      } catch {}
    }

    return { type: null, apiUrl: null };
  }

  async extractCkan(origin, maxDatasets = 1000) {
    const rows = Math.min(maxDatasets, 1000);
    const url = `${origin}/api/3/action/package_search?rows=${rows}`;

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
    const { type } = await this.detect(baseUrl);
    const origin = new URL(baseUrl).origin;

    if (!type) return { detected: null, links: [], fromApi: false };

    try {
      let links = [];
      if (type === 'ckan') {
        links = await this.extractCkan(origin, maxDatasets);
      } else if (type === 'opendatasoft') {
        links = await this.extractOpenDataSoft(origin, maxDatasets);
      } else {
        return { detected: type, links: [], fromApi: false };
      }

      console.log(`✅ ${links.length} ressources extraites via ${type}`);
      return { detected: type, links, fromApi: true };
    } catch (err) {
      console.warn(`⚠ Extraction ${type} échouée : ${err.message}`);
      return { detected: type, links: [], fromApi: false };
    }
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
OPTIMIZATIONS_EOF

  log_success "optimizations.js créé"
}

# ═══════════════════════════════════════════════════════════
#  ÉTAPE 2 : Patcher server.js
# ═══════════════════════════════════════════════════════════

patch_server() {
  local file="${SCRIPT_DIR}/server.js"

  # Vérifie si déjà patché
  if grep -q "from './optimizations.js'" "$file" 2>/dev/null; then
    log_warn "server.js déjà patché — ignoré"
    return 0
  fi

  if $DRY_RUN; then
    log_info "[DRY-RUN] Patcherait server.js"
    return 0
  fi

  backup_file "$file"
  log_info "Patch de server.js…"

  local tmp="${file}.tmp.$$"

  # ─── 2.1 : Ajouter l'import après apis-catalog.js ───
  awk '
    /^import \{ API_CATALOG, getCatalogStats \} from/ {
      print
      print "import {"
      print "  AdaptiveQueue,"
      print "  PoolManager,"
      print "  CkanDetector,"
      print "  ArticleDiscoverer,"
      print "  BatchFetcher,"
      print "  ProgressTracker,"
      print "  scanOpenData,"
      print "  scanNews,"
      print "  scanRestApi"
      print "} from \x27./optimizations.js\x27;"
      next
    }
    { print }
  ' "$file" > "$tmp"

  # ─── 2.2 : Ajouter le PoolManager global après `const PORT = ...` ───
  awk '
    /^const PORT = process\.env\.PORT/ {
      print
      print ""
      print "// Pool undici global (connexions réutilisées)"
      print "const globalPool = new PoolManager({ connections: 20 });"
      next
    }
    { print }
  ' "$tmp" > "${tmp}.2"

  # ─── 2.3 : Étendre le handler SIGINT pour fermer le pool ───
  awk '
    /^process\.on\(.SIGINT., async \(\) => \{ await closeBrowser\(\); process\.exit\(0\); \}\);$/ {
      print "process.on(\x27SIGINT\x27, async () => {"
      print "  await globalPool.close();"
      print "  await closeBrowser();"
      print "  process.exit(0);"
      print "});"
      next
    }
    /^process\.on\(.SIGTERM., async \(\) => \{ await closeBrowser\(\); process\.exit\(0\); \}\);$/ {
      print "process.on(\x27SIGTERM\x27, async () => {"
      print "  await globalPool.close();"
      print "  await closeBrowser();"
      print "  process.exit(0);"
      print "});"
      next
    }
    { print }
  ' "${tmp}.2" > "${tmp}.3"

  # ─── 2.4 : Ajouter les nouvelles routes avant le bloc HEALTH ───
  awk '
    /^\/\/  9\. HEALTH/ {
      print "// ─── /api/scan-opendata ───"
      print "app.post(\x27/api/scan-opendata\x27, rateLimit, ssrfGuard, async (req, res) => {"
      print "  const { url, maxDatasets = 1000 } = req.body || {};"
      print "  if (!url) return res.status(400).json({ error: \x27URL manquante.\x27 });"
      print ""
      print "  const check = validateTargetUrl(url);"
      print "  if (!check.ok) return res.status(403).json({ error: check.reason, errorType: \x27SSRF_BLOCKED\x27 });"
      print ""
      print "  try {"
      print "    const result = await scanOpenData(check.url.href, {"
      print "      pool: globalPool,"
      print "      maxDatasets: clamp(maxDatasets, 1, 5000)"
      print "    });"
      print "    res.json({ success: true, scannedAt: new Date().toISOString(), ...result });"
      print "  } catch (err) {"
      print "    res.status(500).json({ error: err.message });"
      print "  }"
      print "});"
      print ""
      print "// ─── /api/scan-news ───"
      print "app.post(\x27/api/scan-news\x27, rateLimit, ssrfGuard, async (req, res) => {"
      print "  const { url, maxArticles = 500, concurrency = 5 } = req.body || {};"
      print "  if (!url) return res.status(400).json({ error: \x27URL manquante.\x27 });"
      print ""
      print "  const check = validateTargetUrl(url);"
      print "  if (!check.ok) return res.status(403).json({ error: check.reason, errorType: \x27SSRF_BLOCKED\x27 });"
      print ""
      print "  try {"
      print "    const page = await getReusablePage();"
      print "    const result = await scanNews(check.url.href, {"
      print "      page,"
      print "      maxArticles: clamp(maxArticles, 1, LIMITS.MAX_URLS_FULL),"
      print "      concurrency: clamp(concurrency, 1, 15)"
      print "    });"
      print "    res.json({ success: true, scannedAt: new Date().toISOString(), ...result });"
      print "  } catch (err) {"
      print "    res.status(500).json({ error: err.message });"
      print "  }"
      print "});"
      print ""
      print "// ─── /api/scan-api-batch ───"
      print "app.post(\x27/api/scan-api-batch\x27, rateLimit, async (req, res) => {"
      print "  const { endpoints = [], method = \x27GET\x27, headers = {}, body = null } = req.body || {};"
      print "  if (!Array.isArray(endpoints) || endpoints.length === 0) {"
      print "    return res.status(400).json({ error: \x27Liste d\\\x27endpoints vide.\x27 });"
      print "  }"
      print ""
      print "  const validated = [];"
      print "  for (const ep of endpoints.slice(0, LIMITS.MAX_URLS_FULL)) {"
      print "    const check = validateTargetUrl(ep);"
      print "    if (check.ok) validated.push(check.url.href);"
      print "  }"
      print ""
      print "  if (validated.length === 0) {"
      print "    return res.status(403).json({ error: \x27Aucune URL autorisée.\x27, errorType: \x27SSRF_BLOCKED\x27 });"
      print "  }"
      print ""
      print "  try {"
      print "    const result = await scanRestApi(validated, { method, headers, body, concurrency: 10, maxConcurrency: 25 });"
      print "    res.json({ success: true, scannedAt: new Date().toISOString(), ...result });"
      print "  } catch (err) {"
      print "    res.status(500).json({ error: err.message });"
      print "  }"
      print "});"
      print ""
      print "// ─── /api/pool/stats ───"
      print "app.get(\x27/api/pool/stats\x27, (_, res) => {"
      print "  res.json({ success: true, pool: globalPool.stats() });"
      print "});"
      print ""
      print "// ═══════════════════════════════════════════════════════════"
    }
    { print }
  ' "${tmp}.3" > "${tmp}.4"

  mv "${tmp}.4" "$file"
  rm -f "$tmp" "${tmp}.2" "${tmp}.3"

  log_success "server.js patché"
}

# ═══════════════════════════════════════════════════════════
#  ÉTAPE 3 : Mettre à jour package.json
# ═══════════════════════════════════════════════════════════

patch_package() {
  local file="${SCRIPT_DIR}/package.json"

  if grep -q '"optimizations"' "$file" 2>/dev/null; then
    log_warn "package.json déjà patché — ignoré"
    return 0
  fi

  if $DRY_RUN; then
    log_info "[DRY-RUN] Patcherait package.json"
    return 0
  fi

  backup_file "$file"
  log_info "Patch de package.json…"

  # Utilise node pour manipuler le JSON de manière fiable
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('$file', 'utf-8'));
    pkg.version = '4.1.0';
    pkg.scripts = pkg.scripts || {};
    pkg.scripts['optimizations'] = 'node -e \"import(\\\"./optimizations.js\\\").then(m => console.log(Object.keys(m)))\"';
    fs.writeFileSync('$file', JSON.stringify(pkg, null, 2) + '\n');
  "

  log_success "package.json patché"
}

# ═══════════════════════════════════════════════════════════
#  ÉTAPE 4 : Vérification syntaxique
# ═══════════════════════════════════════════════════════════

verify_syntax() {
  log_info "Vérification syntaxique…"

  if $DRY_RUN; then
    log_info "[DRY-RUN] Vérifierait la syntaxe"
    return 0
  fi

  local errors=0

  for f in optimizations.js server.js utils.js extractors.js; do
    if [[ ! -f "${SCRIPT_DIR}/${f}" ]]; then
      continue
    fi
    if ! node --check "${SCRIPT_DIR}/${f}" 2>/dev/null; then
      log_error "Erreur de syntaxe dans $f"
      errors=$((errors + 1))
    fi
  done

  if [[ $errors -gt 0 ]]; then
    log_error "$errors fichier(s) en erreur"
    return 1
  fi

  log_success "Syntaxe OK"
}

# ═══════════════════════════════════════════════════════════
#  ÉTAPE 5 : Test d'import
# ═══════════════════════════════════════════════════════════

verify_imports() {
  log_info "Vérification des imports…"

  if $DRY_RUN; then
    log_info "[DRY-RUN] Vérifierait les imports"
    return 0
  fi

  if node --input-type=module -e "
    import('./optimizations.js')
      .then(m => {
        const required = ['AdaptiveQueue', 'PoolManager', 'CkanDetector', 'ArticleDiscoverer', 'BatchFetcher', 'ProgressTracker', 'scanOpenData', 'scanNews', 'scanRestApi'];
        const missing = required.filter(k => !(k in m));
        if (missing.length) {
          console.error('Exports manquants :', missing.join(', '));
          process.exit(1);
        }
        console.log('✅ Tous les exports sont présents');
      })
      .catch(err => {
        console.error('❌ Import échoué :', err.message);
        process.exit(1);
      });
  " 2>&1; then
    log_success "Imports OK"
  else
    log_error "Imports échoués"
    return 1
  fi
}

# ═══════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════

main() {
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  Scanner Pro — Patch des optimisations"
  echo "═══════════════════════════════════════════════════════════"
  echo ""

  if $REVERT; then
    do_revert
  fi

  if $DRY_RUN; then
    log_warn "Mode DRY-RUN activé — aucune modification ne sera faite"
    echo ""
  fi

  check_prerequisites
  echo ""

  log_info "Étape 1/5 : Création de optimizations.js"
  create_optimizations
  echo ""

  log_info "Étape 2/5 : Patch de server.js"
  patch_server
  echo ""

  log_info "Étape 3/5 : Patch de package.json"
  patch_package
  echo ""

  log_info "Étape 4/5 : Vérification syntaxique"
  verify_syntax
  echo ""

  log_info "Étape 5/5 : Vérification des imports"
  verify_imports
  echo ""

  echo "═══════════════════════════════════════════════════════════"
  log_success "Patch appliqué avec succès !"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  echo "  Prochaines étapes :"
  echo "    1. npm start"
  echo "    2. curl http://localhost:3001/api/pool/stats"
  echo "    3. curl -X POST http://localhost:3001/api/scan-opendata \\"
  echo "         -H 'Content-Type: application/json' \\"
  echo "         -d '{\"url\":\"https://www.data.gouv.fr\"}'"
  echo ""
  echo "  Pour annuler : ./patch.sh --revert"
  echo ""
}

main "$@"