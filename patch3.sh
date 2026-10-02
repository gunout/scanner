#!/usr/bin/env bash
# patch3.sh — Corrige le bug undici sur les redirections

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

log_ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_err()  { echo -e "${RED}[ERR]${NC} $*" >&2; }

# Backup
mkdir -p "$SCRIPT_DIR/.patch-backups"
cp "$SCRIPT_DIR/server.js" "$SCRIPT_DIR/.patch-backups/server.js.$(date +%s).bak"

# Vérifie que le patch n'est pas déjà appliqué
if grep -q "maxRedirections: 0" "$SCRIPT_DIR/server.js"; then
  log_warn "Déjà patché"
  exit 0
fi

# Applique le patch via Node (plus fiable que sed pour du multi-ligne)
node - "$SCRIPT_DIR/server.js" <<'NODEEOF'
const fs = require('fs');
const path = process.argv[2];
let content = fs.readFileSync(path, 'utf-8');

// Trouve la fonction fetchPage et remplace le bloc request
const oldPattern = /const res = await request\(url, \{\s*method: 'GET',\s*maxRedirections: 10,/;

if (!oldPattern.test(content)) {
  console.error('Pattern non trouvé dans fetchPage');
  process.exit(1);
}

// Remplace simplement maxRedirections: 10 par 0
content = content.replace(
  /maxRedirections: 10,/,
  'maxRedirections: 0,  // géré manuellement (bug undici 8)'
);

// Ajoute la gestion manuelle des redirections si absente
if (!content.includes('// Redirection ?')) {
  const oldRes = `    const rawBody = await res.body.arrayBuffer();
    const body = new TextDecoder('utf-8').decode(rawBody);

    return {
      status: res.statusCode,
      headers: res.headers,
      body,
      finalUrl: res.context?.history?.at(-1)?.toString() || url,
      via: 'undici'
    };`;

  const newRes = `    // Redirection ?
    if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
      const location = res.headers.location;
      if (!location) throw new Error(\`HTTP \${res.statusCode} sans Location\`);

      await res.body.dump().catch(() => {});

      const nextUrl = new URL(location, url).href;
      console.log(\`↪ Redirection \${res.statusCode} → \${nextUrl}\`);

      // Récursion
      return fetchPage(nextUrl, timeoutMs);
    }

    const rawBody = await res.body.arrayBuffer();
    const body = new TextDecoder('utf-8').decode(rawBody);

    return {
      status: res.statusCode,
      headers: res.headers,
      body,
      finalUrl: url,
      via: 'undici'
    };`;

  if (!content.includes(oldRes)) {
    console.error('Bloc de retour non trouvé');
    process.exit(1);
  }

  content = content.replace(oldRes, newRes);
}

fs.writeFileSync(path, content);
console.log('Patch appliqué');
NODEEOF

# Vérifie syntaxe
if node --check "$SCRIPT_DIR/server.js" 2>/dev/null; then
  log_ok "Syntaxe OK"
else
  log_err "Erreur de syntaxe — restaurez le backup"
  exit 1
fi

log_ok "patch3 appliqué. Redémarrez : npm start"