#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
#  patch8.sh — Corrige le chemin DCAT-AP (data.europa.eu)
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

if (content.includes("'/search?limit=") || content.includes("/search?limit=\${limit}")) {
  console.log('SKIP');
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════
//  1. Corrige la liste candidates DCAT-AP
// ═══════════════════════════════════════════════════════════

const oldDcatCandidates = `// DCAT-AP (data.europa.eu)
      { type: 'dcat', url: \`\${origin}/api/hub/search/datasets?limit=1\` },
      { type: 'dcat', url: \`\${origin}/api/hub/search/search?limit=1\` },`;

const newDcatCandidates = `// DCAT-AP (data.europa.eu)
      { type: 'dcat', url: \`\${origin}/api/hub/search/search?limit=1\` },
      { type: 'dcat', url: \`\${origin}/api/hub/search/datasets?limit=1\` },`;

if (content.includes(oldDcatCandidates)) {
  content = content.replace(oldDcatCandidates, newDcatCandidates);
  console.log('Candidates réordonnés');
}

// ═══════════════════════════════════════════════════════════
//  2. Corrige extractDcat() pour utiliser /search
// ═══════════════════════════════════════════════════════════

const oldDcatUrl = `const url = \`\${origin}/api/hub/search/datasets?limit=\${limit}\`;`;
const newDcatUrl = `const url = \`\${origin}/api/hub/search/search?limit=\${limit}\`;`;

if (content.includes(oldDcatUrl)) {
  content = content.replace(oldDcatUrl, newDcatUrl);
  console.log('extractDcat URL corrigée');
} else {
  console.log('extractDcat URL non trouvée (peut-être déjà patchée)');
}

// ═══════════════════════════════════════════════════════════
//  3. Améliore extractDcat() pour mieux parser la structure
// ═══════════════════════════════════════════════════════════

const oldDcatBody = `// Structure DCAT-AP : { result: { results: [...] } }
    const datasets = res.json.result?.results
      || res.json.results
      || res.json.data
      || [];`;

const newDcatBody = `// Structure DCAT-AP : { result: { count, results: [...] } }
    const datasets = res.json.result?.results
      || res.json.results
      || res.json.data
      || [];

    console.log(\`📊 DCAT-AP : \${datasets.length} datasets trouvés (total: \${res.json.result?.count || '?'})\`);`;

if (content.includes(oldDcatBody)) {
  content = content.replace(oldDcatBody, newDcatBody);
  console.log('extractDcat parsing amélioré');
}

fs.writeFileSync(path, content);
console.log('OK');
NODEEOF

if node --check "$SCRIPT_DIR/optimizations.js" 2>/dev/null; then
  log_ok "Syntaxe OK"
else
  log_err "Erreur de syntaxe"
  exit 1
fi

log_ok "patch8 appliqué. Redémarrez : npm start"
echo ""
echo "  Testez :"
echo "    curl -X POST http://localhost:3001/api/scan-opendata \\"
echo "      -H 'Content-Type: application/json' \\"
echo "      -d '{\"url\":\"https://data.europa.eu\",\"maxDatasets\":100}' | jq '.stats, .type'"