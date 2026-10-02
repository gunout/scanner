#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
#  patch5.sh — Ajoute la route /api/export (JSON/CSV)
# ═══════════════════════════════════════════════════════════
#
#  Usage :
#    chmod +x patch5.sh
#    ./patch5.sh              # Applique le patch
#    ./patch5.sh --dry-run    # Simule sans modifier
#    ./patch5.sh --revert     # Annule
#    ./patch5.sh --help       # Aide
# ═══════════════════════════════════════════════════════════

set -euo pipefail

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

log_info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error()   { echo -e "${RED}[ERR]${NC} $*" >&2; }

# ─── Aide ───
show_help() {
  cat <<EOF
Usage: ./patch5.sh [OPTIONS]

Options:
  --dry-run     Simule les modifications sans les appliquer
  --revert      Restaure les fichiers depuis la dernière sauvegarde
  --help        Affiche cette aide

Ce script ajoute :
  1. Route POST /api/export dans server.js (JSON/CSV)
  2. Bouton "Exporter" dans public/index.html
  3. Fonction exportResults() dans le front
  4. Vérification syntaxique

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
  [[ ! -f "$file" ]] && return 0
  mkdir -p "$BACKUP_DIR"
  local base
  base="$(basename "$file")"
  cp "$file" "${BACKUP_DIR}/${base}.${TIMESTAMP}.bak"
  log_info "Sauvegarde : $file"
}

# ─── Revert ───
do_revert() {
  log_info "Restauration depuis la dernière sauvegarde…"

  if [[ ! -d "$BACKUP_DIR" ]]; then
    log_error "Aucun backup trouvé."
    exit 1
  fi

  local last_ts
  last_ts="$(ls -1 "$BACKUP_DIR" | grep -oE '[0-9]{8}_[0-9]{6}' | sort -u | tail -n1)"

  [[ -z "$last_ts" ]] && { log_error "Aucun timestamp."; exit 1; }

  for bak in "$BACKUP_DIR"/*."$last_ts".bak; do
    [[ -e "$bak" ]] || continue
    local base target
    base="$(basename "$bak")"
    base="${base%.$last_ts.bak}"
    target="${SCRIPT_DIR}/${base}"
    cp "$bak" "$target"
    log_success "Restauré : $target"
  done

  log_success "Revenir terminé."
  exit 0
}

# ─── Prérequis ───
check_prerequisites() {
  for f in server.js public/index.html; do
    if [[ ! -f "${SCRIPT_DIR}/${f}" ]]; then
      log_error "Fichier requis manquant : $f"
      exit 1
    fi
  done
  log_success "Prérequis OK"
}

# ═══════════════════════════════════════════════════════════
#  PATCH 1 : server.js — Route /api/export
# ═══════════════════════════════════════════════════════════

patch_server() {
  local file="${SCRIPT_DIR}/server.js"

  if grep -q "/api/export" "$file" 2>/dev/null; then
    log_warn "server.js déjà patché — ignoré"
    return 0
  fi

  if $DRY_RUN; then
    log_info "[DRY-RUN] Patcherait server.js"
    return 0
  fi

  backup_file "$file"
  log_info "Ajout de la route /api/export…"

  node - "$file" <<'NODEEOF'
const fs = require('fs');
const path = process.argv[2];
let content = fs.readFileSync(path, 'utf-8');

const route = `
// ─── /api/export — Export JSON/CSV ───
app.post('/api/export', rateLimit, async (req, res) => {
  const { links = [], format = 'json', filename = null } = req.body || {};

  if (!Array.isArray(links) || links.length === 0) {
    return res.status(400).json({ error: 'Aucun lien à exporter.' });
  }

  const safeName = (filename || 'export')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .substring(0, 100);

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', \`attachment; filename="\${safeName}.json"\`);
    return res.send(JSON.stringify(links, null, 2));
  }

  if (format === 'csv') {
    const headers = [
      'url', 'title', 'type', 'resourceType',
      'source', 'relevance', 'via',
      'organization', 'format', 'datasetId'
    ];

    const escapeCsv = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (/[",\\n\\r]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };

    const rows = links.map(l => [
      escapeCsv(l.url),
      escapeCsv(l.title),
      escapeCsv(l.type),
      escapeCsv(l.resourceType),
      escapeCsv(l.source),
      escapeCsv(l.relevance),
      escapeCsv(l.via),
      escapeCsv(l.metadata?.organization),
      escapeCsv(l.metadata?.format),
      escapeCsv(l.metadata?.datasetId)
    ].join(','));

    const csv = '\\uFEFF' + [headers.join(','), ...rows].join('\\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', \`attachment; filename="\${safeName}.csv"\`);
    return res.send(csv);
  }

  if (format === 'jsonl') {
    const jsonl = links.map(l => JSON.stringify(l)).join('\\n');
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', \`attachment; filename="\${safeName}.jsonl"\`);
    return res.send(jsonl);
  }

  res.status(400).json({
    error: 'Format non supporté. Utilisez : json, csv, jsonl.'
  });
});

// ═══════════════════════════════════════════════════════════
//  9. HEALTH
// ═══════════════════════════════════════════════════════════`;

// Insère la route avant le bloc HEALTH
const healthMarker = `// ═══════════════════════════════════════════════════════════
//  9. HEALTH
// ═══════════════════════════════════════════════════════════`;

if (!content.includes(healthMarker)) {
  console.error('Marqueur HEALTH non trouvé');
  process.exit(1);
}

content = content.replace(healthMarker, route);

fs.writeFileSync(path, content);
console.log('OK');
NODEEOF

  log_success "server.js : route /api/export ajoutée"
}

# ═══════════════════════════════════════════════════════════
#  PATCH 2 : index.html — Bouton + fonction export
# ═══════════════════════════════════════════════════════════

patch_html() {
  local file="${SCRIPT_DIR}/public/index.html"

  if grep -q "btnExport" "$file" 2>/dev/null; then
    log_warn "index.html déjà patché — ignoré"
    return 0
  fi

  if $DRY_RUN; then
    log_info "[DRY-RUN] Patcherait index.html"
    return 0
  fi

  backup_file "$file"
  log_info "Ajout du bouton Exporter…"

  node - "$file" <<'NODEEOF'
const fs = require('fs');
const path = process.argv[2];
let content = fs.readFileSync(path, 'utf-8');

// ─── 1. Ajoute le bouton "Exporter" après "Détecter les APIs" ───
const oldBtn = `<button id="btnDetectApis" class="btn btn-secondaire">
            <i class="fas fa-code" aria-hidden="true"></i>
            Détecter les APIs
          </button>`;

const newBtn = `<button id="btnDetectApis" class="btn btn-secondaire">
            <i class="fas fa-code" aria-hidden="true"></i>
            Détecter les APIs
          </button>
          <button id="btnExport" class="btn btn-secondaire">
            <i class="fas fa-download" aria-hidden="true"></i>
            Exporter les résultats
          </button>`;

if (!content.includes(oldBtn)) {
  console.error('Bouton "Détecter les APIs" non trouvé');
  process.exit(1);
}

content = content.replace(oldBtn, newBtn);

// ─── 2. Ajoute la fonction exportResults() avant les événements ───
const eventsMarker = `// ═══════════════════════════════════════════════════════════
//  ÉVÉNEMENTS
// ═══════════════════════════════════════════════════════════`;

const exportFunc = `// ═══════════════════════════════════════════════════════════
//  EXPORT
// ═══════════════════════════════════════════════════════════

async function exportResults() {
  const links = state.filteredLinks.length > 0 ? state.filteredLinks : state.allLinks;

  if (!links || links.length === 0) {
    return notification('Aucun résultat à exporter. Lancez d\\'abord un scan.', 'attention');
  }

  const format = await showExportDialog(links.length);
  if (!format) return;

  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        links,
        format,
        filename: \`scanner-\${new Date().toISOString().slice(0,10)}\`
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || \`HTTP \${res.status}\`);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = \`scanner-\${new Date().toISOString().slice(0,10)}.\${format}\`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    notification(\`\${links.length} résultats exportés en \${format.toUpperCase()}.\`, 'succes');
  } catch (err) {
    console.error(err);
    notification(\`Erreur d'export : \${err.message}\`, 'erreur');
  }
}

function showExportDialog(count) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = \`
      position: fixed; inset: 0; background: rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; padding: 20px;
    \`;
    overlay.innerHTML = \`
      <div style="background: white; border-radius: 6px; padding: 24px; max-width: 480px; width: 100%; box-shadow: 0 8px 24px rgba(0,0,0,0.2);">
        <h3 style="color: var(--couleur-primaire); margin-bottom: 12px; font-size: 1.1rem;">
          Exporter \${count} résultats
        </h3>
        <p style="color: var(--gris-700); margin-bottom: 20px; font-size: 0.9rem;">
          Choisissez le format d'export :
        </p>
        <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px;">
          <button class="btn btn-secondaire" style="text-align: left; justify-content: flex-start;" data-format="json">
            <i class="fas fa-code"></i> <strong>JSON</strong> — structuré, idéal pour traitement
          </button>
          <button class="btn btn-secondaire" style="text-align: left; justify-content: flex-start;" data-format="csv">
            <i class="fas fa-table"></i> <strong>CSV</strong> — tableur (Excel, LibreOffice)
          </button>
          <button class="btn btn-secondaire" style="text-align: left; justify-content: flex-start;" data-format="jsonl">
            <i class="fas fa-list"></i> <strong>JSONL</strong> — un objet JSON par ligne
          </button>
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button class="btn btn-secondaire" style="width: auto; padding: 8px 20px;" data-action="cancel">Annuler</button>
        </div>
      </div>
    \`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      const format = e.target.closest('[data-format]')?.dataset.format;
      if (format) {
        overlay.remove();
        resolve(format);
      } else if (e.target.dataset.action === 'cancel' || e.target === overlay) {
        overlay.remove();
        resolve(null);
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════
//  ÉVÉNEMENTS
// ═══════════════════════════════════════════════════════════`;

if (!content.includes(eventsMarker)) {
  console.error('Marqueur ÉVÉNEMENTS non trouvé');
  process.exit(1);
}

content = content.replace(eventsMarker, exportFunc);

// ─── 3. Ajoute l'écouteur du bouton ───
const listenerMarker = `$('#btnLoadFicoba').addEventListener('click', loadFicoba);`;

if (!content.includes(listenerMarker)) {
  console.error('Marqueur listener non trouvé');
  process.exit(1);
}

content = content.replace(
  listenerMarker,
  `${listenerMarker}\n$('#btnExport').addEventListener('click', exportResults);`
);

fs.writeFileSync(path, content);
console.log('OK');
NODEEOF

  log_success "index.html : bouton + fonction export ajoutés"
}

# ═══════════════════════════════════════════════════════════
#  VÉRIFICATIONS
# ═══════════════════════════════════════════════════════════

verify_syntax() {
  log_info "Vérification syntaxique…"

  if $DRY_RUN; then
    log_info "[DRY-RUN] Vérifierait la syntaxe"
    return 0
  fi

  local errors=0

  if ! node --check "${SCRIPT_DIR}/server.js" 2>/dev/null; then
    log_error "Erreur de syntaxe dans server.js"
    errors=$((errors + 1))
  fi

  # Vérifie le HTML (cherche les marqueurs)
  if ! grep -q "exportResults" "${SCRIPT_DIR}/public/index.html"; then
    log_error "Fonction exportResults() non trouvée dans index.html"
    errors=$((errors + 1))
  fi

  if ! grep -q "btnExport" "${SCRIPT_DIR}/public/index.html"; then
    log_error "Bouton btnExport non trouvé dans index.html"
    errors=$((errors + 1))
  fi

  if [[ $errors -gt 0 ]]; then
    log_error "$errors vérification(s) échouée(s)"
    return 1
  fi

  log_success "Tout est OK"
}

# ═══════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════

main() {
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  Scanner Pro — Patch 5 : Export JSON/CSV"
  echo "═══════════════════════════════════════════════════════════"
  echo ""

  if $REVERT; then
    do_revert
  fi

  if $DRY_RUN; then
    log_warn "Mode DRY-RUN — aucune modification"
    echo ""
  fi

  check_prerequisites
  echo ""

  log_info "Étape 1/3 : Route /api/export dans server.js"
  patch_server
  echo ""

  log_info "Étape 2/3 : Bouton + fonction dans index.html"
  patch_html
  echo ""

  log_info "Étape 3/3 : Vérifications"
  verify_syntax
  echo ""

  echo "═══════════════════════════════════════════════════════════"
  log_success "Patch 5 appliqué avec succès !"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  echo "  Prochaines étapes :"
  echo "    1. lsof -ti:3001 | xargs -r kill -9"
  echo "    2. npm start"
  echo "    3. Ouvrir http://localhost:3001"
  echo "    4. Lancer un scan, puis cliquer sur « Exporter les résultats »"
  echo ""
  echo "  Test rapide (curl) :"
  echo "    curl -X POST http://localhost:3001/api/export \\\\"
  echo "      -H 'Content-Type: application/json' \\\\"
  echo "      -d '{\"links\":[{\"url\":\"https://example.com\",\"title\":\"Test\"}],\"format\":\"json\"}'"
  echo ""
  echo "  Pour annuler : ./patch5.sh --revert"
  echo ""
}

main "$@"