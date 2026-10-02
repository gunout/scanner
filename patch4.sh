#!/usr/bin/env bash
# patch4.sh — Ajoute le support udata (data.gouv.fr)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log_ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }

mkdir -p "$SCRIPT_DIR/.patch-backups"
cp "$SCRIPT_DIR/optimizations.js" "$SCRIPT_DIR/.patch-backups/optimizations.js.$(date +%s).bak"

node - "$SCRIPT_DIR/optimizations.js" <<'NODEEOF'
const fs = require('fs');
const path = process.argv[2];
let content = fs.readFileSync(path, 'utf-8');

if (content.includes("type: 'udata'")) {
  console.log('SKIP');
  process.exit(0);
}

// 1. Ajoute udata dans candidates
content = content.replace(
  /const candidates = \[\s*\{ type: 'ckan', url: `\$\{origin\}\/api\/3\/action\/package_search\?rows=1` \},/,
  `const candidates = [
      { type: 'ckan', url: \`\${origin}/api/3/action/package_search?rows=1\` },
      // udata (data.gouv.fr, etalab)
      { type: 'udata', url: \`\${origin}/api/1/datasets/?page_size=1\` },`
);

// 2. Ajoute le case udata dans extractAll
content = content.replace(
  /if \(type === 'ckan'\) \{\s*links = await this\.extractCkan\(origin, maxDatasets\);\s*\} else if \(type === 'opendatasoft'\)/,
  `if (type === 'ckan') {
        links = await this.extractCkan(origin, maxDatasets);
      } else if (type === 'udata') {
        links = await this.extractUdata(origin, maxDatasets);
      } else if (type === 'opendatasoft')`
);

// 3. Ajoute la méthode extractUdata
const method = `
  async extractUdata(origin, maxDatasets = 1000) {
    const pageSize = Math.min(maxDatasets, 100);
    const url = \`\${origin}/api/1/datasets/?page_size=\${pageSize}\`;

    const res = await this.pool.fetch(url, { accept: 'application/json' });
    if (res.status !== 200 || !res.json?.data) {
      throw new Error('udata API : réponse invalide');
    }

    const datasets = res.json.data;
    const links = [];

    for (const ds of datasets) {
      const dsUrl = \`\${origin}/datasets/\${ds.slug || ds.id}/\`;
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
          source: \`udata (\${ds.title})\`,
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

  _guessResourceType(formatOrUrl) {`;

content = content.replace(/\n  _guessResourceType\(formatOrUrl\) \{/, method);

fs.writeFileSync(path, content);
console.log('OK');
NODEEOF

if node --check "$SCRIPT_DIR/optimizations.js" 2>/dev/null; then
  log_ok "Syntaxe OK"
else
  echo "❌ Erreur de syntaxe"
  exit 1
fi

log_ok "patch4 appliqué. Redémarrez : npm start"