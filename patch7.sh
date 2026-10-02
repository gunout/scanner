#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
#  patch7.sh — Corrige le chemin CKAN détecté
# ═══════════════════════════════════════════════════════════

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
log_ok()  { echo -e "${GREEN}[OK]${NC} $*"; }
log_err() { echo -e "${RED}[ERR]${NC} $*" >&2; }

mkdir -p "$SCRIPT_DIR/.patch-backups"
cp "$SCRIPT_DIR/optimizations.js" "$SCRIPT_DIR/.patch-backups/optimizations.js.$(date +%s).bak"

node - "$SCRIPT_DIR/optimizations.js" <<'NODEEOF'
const fs = require('fs');
const path = process.argv[2];
let content = fs.readFileSync(path, 'utf-8');

if (content.includes('apiBaseUrl')) {
  console.log('SKIP');
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════
//  1. detect() retourne { type, apiUrl, apiBaseUrl }
// ═══════════════════════════════════════════════════════════

const oldDetect = `for (const candidate of candidates) {
      try {
        const res = await this.pool.fetch(candidate.url, { accept: 'application/json' });
        if (res.status === 200 && res.json) {
          console.log(\`✅ Portail détecté : \${candidate.type} (\${origin})\`);
          return { type: candidate.type, apiUrl: candidate.url };
        }
      } catch {}
    }

    return { type: null, apiUrl: null };`;

const newDetect = `for (const candidate of candidates) {
      try {
        const res = await this.pool.fetch(candidate.url, { accept: 'application/json' });
        if (res.status === 200 && res.json && !res.json.error) {
          // Extrait la base URL (avant le chemin d'action)
          const apiBaseUrl = candidate.url
            .replace(/\\/package_search.*$/, '')
            .replace(/\\/datasets.*$/, '')
            .replace(/\\/search.*$/, '');

          console.log(\`✅ Portail détecté : \${candidate.type} (\${origin})\`);
          console.log(\`   Base API : \${apiBaseUrl}\`);

          return {
            type: candidate.type,
            apiUrl: candidate.url,
            apiBaseUrl  // ← NOUVEAU
          };
        }
      } catch {}
    }

    return { type: null, apiUrl: null, apiBaseUrl: null };`;

if (!content.includes(oldDetect)) {
  console.error('Pattern detect() non trouvé');
  process.exit(1);
}
content = content.replace(oldDetect, newDetect);

// ═══════════════════════════════════════════════════════════
//  2. extractCkan() accepte un paramètre apiBaseUrl
// ═══════════════════════════════════════════════════════════

const oldExtractCkan = `async extractCkan(origin, maxDatasets = 1000) {
    const rows = Math.min(maxDatasets, 1000);
    const url = \`\${origin}/api/3/action/package_search?rows=\${rows}\`;`;

const newExtractCkan = `async extractCkan(origin, maxDatasets = 1000, apiBaseUrl = null) {
    const rows = Math.min(maxDatasets, 1000);
    const base = apiBaseUrl || \`\${origin}/api/3/action\`;
    const url = \`\${base}/package_search?rows=\${rows}\`;`;

if (!content.includes(oldExtractCkan)) {
  console.error('Pattern extractCkan() non trouvé');
  process.exit(1);
}
content = content.replace(oldExtractCkan, newExtractCkan);

// ═══════════════════════════════════════════════════════════
//  3. extractAll() récupère apiBaseUrl et la passe
// ═══════════════════════════════════════════════════════════

const oldExtractAll = `const { type } = await this.detect(baseUrl);
    const origin = new URL(baseUrl).origin;

    if (!type) return { detected: null, links: [], fromApi: false };

    try {
      let links = [];
      if (type === 'ckan') {
        links = await this.extractCkan(origin, maxDatasets);
      } else if (type === 'udata') {`;

const newExtractAll = `const { type, apiBaseUrl } = await this.detect(baseUrl);
    const origin = new URL(baseUrl).origin;

    if (!type) return { detected: null, links: [], fromApi: false };

    try {
      let links = [];
      if (type === 'ckan') {
        links = await this.extractCkan(origin, maxDatasets, apiBaseUrl);
      } else if (type === 'udata') {`;

if (!content.includes(oldExtractAll)) {
  console.error('Pattern extractAll() non trouvé');
  process.exit(1);
}
content = content.replace(oldExtractAll, newExtractAll);

// ═══════════════════════════════════════════════════════════
//  4. extractAll() retourne aussi apiBaseUrl pour debug
// ═══════════════════════════════════════════════════════════

const oldReturn = `console.log(\`✅ \${links.length} ressources extraites via \${type}\`);
      return { detected: type, links, fromApi: true };`;

const newReturn = `console.log(\`✅ \${links.length} ressources extraites via \${type}\`);
      return { detected: type, links, fromApi: true, apiBaseUrl };`;

if (!content.includes(oldReturn)) {
  console.error('Pattern return non trouvé');
  process.exit(1);
}
content = content.replace(oldReturn, newReturn);

fs.writeFileSync(path, content);
console.log('OK');
NODEEOF

if node --check "$SCRIPT_DIR/optimizations.js" 2>/dev/null; then
  log_ok "Syntaxe OK"
else
  log_err "Erreur de syntaxe"
  exit 1
fi

log_ok "patch7 appliqué. Redémarrez : npm start"
echo ""
echo "  Testez :"
echo "    curl -X POST http://localhost:3001/api/scan-opendata \\"
echo "      -H 'Content-Type: application/json' \\"
echo "      -d '{\"url\":\"https://www.govdata.de\",\"maxDatasets\":100}' | jq '.stats, .type, .apiBaseUrl'"