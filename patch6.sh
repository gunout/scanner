#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
#  patch6.sh — Support CKAN multi-chemins + DCAT-AP
# ═══════════════════════════════════════════════════════════
#
#  Ajoute :
#   - CKAN à chemins alternatifs (/ckan/api/3/, /api/action/, etc.)
#   - DCAT-AP (data.europa.eu)
# ═══════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

log_ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_err()  { echo -e "${RED}[ERR]${NC} $*" >&2; }

mkdir -p "$SCRIPT_DIR/.patch-backups"
cp "$SCRIPT_DIR/optimizations.js" "$SCRIPT_DIR/.patch-backups/optimizations.js.$(date +%s).bak"

node - "$SCRIPT_DIR/optimizations.js" <<'NODEEOF'
const fs = require('fs');
const path = process.argv[2];
let content = fs.readFileSync(path, 'utf-8');

if (content.includes("ckan.govdata.de") || content.includes('/ckan/api/3/action/')) {
  console.log('SKIP');
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════
//  1. Remplace la liste candidates par une version étendue
// ═══════════════════════════════════════════════════════════

const oldCandidates = `const candidates = [
      { type: 'ckan', url: \`\${origin}/api/3/action/package_search?rows=1\` },
      // udata (data.gouv.fr, etalab)
      { type: 'udata', url: \`\${origin}/api/1/datasets/?page_size=1\` },
      { type: 'dkan', url: \`\${origin}/api/1/search?page=0\` },
      { type: 'socrata', url: \`\${origin}/api/views.json?limit=1\` },
      { type: 'opendatasoft', url: \`\${origin}/api/v2/catalog/datasets?limit=1\` }
    ];`;

const newCandidates = `const candidates = [
      // CKAN — standard
      { type: 'ckan', url: \`\${origin}/api/3/action/package_search?rows=1\` },
      // CKAN — chemins alternatifs (govdata.de, etc.)
      { type: 'ckan', url: \`\${origin}/ckan/api/3/action/package_search?rows=1\` },
      { type: 'ckan', url: \`\${origin}/api/action/package_search?rows=1\` },
      { type: 'ckan', url: \`\${origin}/catalog/api/3/action/package_search?rows=1\` },
      // udata (data.gouv.fr, etalab)
      { type: 'udata', url: \`\${origin}/api/1/datasets/?page_size=1\` },
      // DCAT-AP (data.europa.eu)
      { type: 'dcat', url: \`\${origin}/api/hub/search/datasets?limit=1\` },
      { type: 'dcat', url: \`\${origin}/api/hub/search/search?limit=1\` },
      // DKAN
      { type: 'dkan', url: \`\${origin}/api/1/search?page=0\` },
      // Socrata
      { type: 'socrata', url: \`\${origin}/api/views.json?limit=1\` },
      // OpenDataSoft
      { type: 'opendatasoft', url: \`\${origin}/api/v2/catalog/datasets?limit=1\` }
    ];`;

if (!content.includes(oldCandidates)) {
  console.error('Pattern candidates non trouvé');
  process.exit(1);
}
content = content.replace(oldCandidates, newCandidates);

// ═══════════════════════════════════════════════════════════
//  2. Ajoute le case 'dcat' dans extractAll
// ═══════════════════════════════════════════════════════════

const oldSwitch = `} else if (type === 'udata') {
        links = await this.extractUdata(origin, maxDatasets);
      } else if (type === 'opendatasoft') {`;

const newSwitch = `} else if (type === 'udata') {
        links = await this.extractUdata(origin, maxDatasets);
      } else if (type === 'dcat') {
        links = await this.extractDcat(origin, maxDatasets);
      } else if (type === 'opendatasoft') {`;

if (!content.includes(oldSwitch)) {
  console.error('Pattern switch non trouvé');
  process.exit(1);
}
content = content.replace(oldSwitch, newSwitch);

// ═══════════════════════════════════════════════════════════
//  3. Ajoute la méthode extractDcat avant _guessResourceType
// ═══════════════════════════════════════════════════════════

const oldGuess = `  _guessResourceType(formatOrUrl) {`;

const newMethod = `  async extractDcat(origin, maxDatasets = 1000) {
    const limit = Math.min(maxDatasets, 100);
    const url = \`\${origin}/api/hub/search/datasets?limit=\${limit}\`;

    const res = await this.pool.fetch(url, { accept: 'application/json' });
    if (res.status !== 200 || !res.json) {
      throw new Error('DCAT-AP API : réponse invalide');
    }

    // Structure DCAT-AP : { result: { results: [...] } }
    const datasets = res.json.result?.results
      || res.json.results
      || res.json.data
      || [];

    const links = [];

    for (const ds of datasets) {
      // DCAT-AP utilise 'id', 'title', 'description'
      const dsId = ds.id || ds.identifier || ds.uri;
      const dsTitle = ds.title || ds.name || dsId;
      const dsUrl = \`\${origin}/data/datasets/\${encodeURIComponent(dsId)}\`;

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
          title: dist.title || dist.description || \`\${dsTitle} - distribution\`,
          type: 'external',
          resourceType: this._guessResourceType(dist.format || distUrl),
          source: \`DCAT-AP (\${dsTitle})\`,
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

  _guessResourceType(formatOrUrl) {`;

if (!content.includes(oldGuess)) {
  console.error('Pattern _guessResourceType non trouvé');
  process.exit(1);
}
content = content.replace(oldGuess, newMethod);

fs.writeFileSync(path, content);
console.log('OK');
NODEEOF

# Vérifie syntaxe
if node --check "$SCRIPT_DIR/optimizations.js" 2>/dev/null; then
  log_ok "Syntaxe OK"
else
  log_err "Erreur de syntaxe"
  exit 1
fi

log_ok "patch6 appliqué. Redémarrez : npm start"
echo ""
echo "  Testez :"
echo "    curl -X POST http://localhost:3001/api/scan-opendata \\"
echo "      -H 'Content-Type: application/json' \\"
echo "      -d '{\"url\":\"https://www.govdata.de\",\"maxDatasets\":100}' | jq '.stats, .type'"
echo ""
echo "    curl -X POST http://localhost:3001/api/scan-opendata \\"
echo "      -H 'Content-Type: application/json' \\"
echo "      -d '{\"url\":\"https://data.europa.eu\",\"maxDatasets\":100}' | jq '.stats, .type'"