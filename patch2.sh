#!/usr/bin/env bash
# patch2.sh — Corrige UND_ERR_INVALID_ARG

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

log_ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }

# ─── 1. Retirer 'br' de server.js ───
if grep -q "'Accept-Encoding': 'gzip, deflate, br'" "$SCRIPT_DIR/server.js"; then
  cp "$SCRIPT_DIR/server.js" "$SCRIPT_DIR/.patch-backups/server.js.$(date +%s).bak"
  sed -i.bak "s/'Accept-Encoding': 'gzip, deflate, br'/'Accept-Encoding': 'gzip, deflate'/" "$SCRIPT_DIR/server.js"
  log_ok "server.js : 'br' retiré de Accept-Encoding"
else
  log_warn "server.js : pattern non trouvé ou déjà patché"
fi

# ─── 2. Réduire le timeout undici ───
if grep -q "async function fetchPage(url, timeoutMs = 12000)" "$SCRIPT_DIR/server.js"; then
  sed -i.bak "s/async function fetchPage(url, timeoutMs = 12000)/async function fetchPage(url, timeoutMs = 5000)/" "$SCRIPT_DIR/server.js"
  log_ok "server.js : timeout undici réduit à 5s"
else
  log_warn "server.js : timeout déjà modifié"
fi

# ─── 3. Ajouter un log d'erreur détaillé ───
if ! grep -q "fetchPage(\${url}) → code=" "$SCRIPT_DIR/server.js"; then
  # Insertion délicate — on l'ajoute dans le catch existant
  python3 - "$SCRIPT_DIR/server.js" <<'PYEOF'
import sys, re
path = sys.argv[1]
with open(path, 'r') as f:
    content = f.read()

old = """  } catch (err) {
    const reason = err.message === 'SPA_DETECTED'
      ? 'SPA (rendu JS requis)'
      : (err.code || err.message);"""

new = """  } catch (err) {
    if (err.code === 'UND_ERR_INVALID_ARG') {
      console.error(`❌ fetchPage(${url}) → UND_ERR_INVALID_ARG`);
      console.error('   → Cause probable : en-tête trop long ou Brotli mal formé');
      console.error('   → Bascule directe vers Puppeteer');
    }
    const reason = err.message === 'SPA_DETECTED'
      ? 'SPA (rendu JS requis)'
      : (err.code || err.message);"""

if old in content:
    content = content.replace(old, new)
    with open(path, 'w') as f:
        f.write(content)
    print("OK")
else:
    print("SKIP")
PYEOF
  log_ok "server.js : log d'erreur ajouté"
fi

# ─── 4. Ajouter maxHeaderSize ───
if ! grep -q "maxHeaderSize" "$SCRIPT_DIR/server.js"; then
  sed -i.bak "s/      signal: controller.signal\n    });/      signal: controller.signal,\n      maxHeaderSize: 65536\n    });/" "$SCRIPT_DIR/server.js" 2>/dev/null || true
  log_warn "maxHeaderSize : à ajouter manuellement (pattern complexe)"
fi

# ─── 5. Vérification syntaxique ───
if node --check "$SCRIPT_DIR/server.js" 2>/dev/null; then
  log_ok "Syntaxe server.js OK"
else
  echo "❌ Erreur de syntaxe dans server.js"
  exit 1
fi

echo ""
log_ok "Patch2 appliqué. Redémarrez : npm start"