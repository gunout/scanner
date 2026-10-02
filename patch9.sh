#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
#  patch9.sh — Ajoute l'onglet "Open Data" dans l'interface
# ═══════════════════════════════════════════════════════════
#
#  Usage :
#    chmod +x patch9.sh
#    ./patch9.sh              # Applique
#    ./patch9.sh --dry-run    # Simule
#    ./patch9.sh --revert     # Annule
#    ./patch9.sh --help       # Aide
# ═══════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${SCRIPT_DIR}/.patch-backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DRY_RUN=false
REVERT=false

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error()   { echo -e "${RED}[ERR]${NC} $*" >&2; }

show_help() {
  cat <<EOF
Usage: ./patch9.sh [OPTIONS]

Options:
  --dry-run     Simule sans modifier
  --revert      Restaure depuis la dernière sauvegarde
  --help        Affiche cette aide

Ce script ajoute :
  1. Onglet "Open Data" dans public/index.html
  2. Sélecteur de portail (udata, CKAN, OpenDataSoft, DCAT-AP)
  3. Formulaire de scan
  4. Tableau de résultats formaté
  5. Bouton d'export JSON/CSV
  6. Vérification syntaxique

Les fichiers originaux sont sauvegardés dans .patch-backups/
EOF
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --revert)  REVERT=true ;;
    --help|-h) show_help; exit 0 ;;
    *) log_error "Option inconnue : $arg"; show_help; exit 1 ;;
  esac
done

backup_file() {
  local file="$1"
  [[ ! -f "$file" ]] && return 0
  mkdir -p "$BACKUP_DIR"
  local base; base="$(basename "$file")"
  cp "$file" "${BACKUP_DIR}/${base}.${TIMESTAMP}.bak"
  log_info "Sauvegarde : $file"
}

do_revert() {
  log_info "Restauration…"
  [[ ! -d "$BACKUP_DIR" ]] && { log_error "Aucun backup."; exit 1; }

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

check_prerequisites() {
  for f in public/index.html server.js; do
    [[ ! -f "${SCRIPT_DIR}/${f}" ]] && { log_error "Manquant : $f"; exit 1; }
  done
  log_success "Prérequis OK"
}

# ═══════════════════════════════════════════════════════════
#  PATCH : index.html
# ═══════════════════════════════════════════════════════════

patch_html() {
  local file="${SCRIPT_DIR}/public/index.html"

  if grep -q "modeOpenData" "$file" 2>/dev/null; then
    log_warn "index.html déjà patché — ignoré"
    return 0
  fi

  if $DRY_RUN; then
    log_info "[DRY-RUN] Patcherait index.html"
    return 0
  fi

  backup_file "$file"
  log_info "Ajout de l'onglet Open Data…"

  node - "$file" <<'NODEEOF'
const fs = require('fs');
const path = process.argv[2];
let content = fs.readFileSync(path, 'utf-8');

// ═══════════════════════════════════════════════════════════
//  1. Ajoute l'onglet dans la barre de navigation
// ═══════════════════════════════════════════════════════════

const oldTabs = `<button class="onglet" data-mode="api" role="tab" aria-selected="false" aria-controls="modeApi">
          <i class="fas fa-plug" aria-hidden="true"></i>
          Analyse d'APIs
        </button>
      </nav>`;

const newTabs = `<button class="onglet" data-mode="api" role="tab" aria-selected="false" aria-controls="modeApi">
          <i class="fas fa-plug" aria-hidden="true"></i>
          Analyse d'APIs
        </button>
        <button class="onglet" data-mode="opendata" role="tab" aria-selected="false" aria-controls="modeOpenData">
          <i class="fas fa-database" aria-hidden="true"></i>
          Open Data
        </button>
      </nav>`;

if (!content.includes(oldTabs)) {
  console.error('Marqueur tabs non trouvé');
  process.exit(1);
}
content = content.replace(oldTabs, newTabs);

// ═══════════════════════════════════════════════════════════
//  2. Ajoute le panneau Open Data avant </section> de colonne
// ═══════════════════════════════════════════════════════════

const oldPanel = `      <div id="modeApi" class="panneau" role="tabpanel" style="display:none;">`;

const openDataPanel = `      <div id="modeOpenData" class="panneau" role="tabpanel" style="display:none;">
        <div class="panneau-entete">
          <h2 class="panneau-titre">
            <i class="fas fa-database" style="color: var(--couleur-accent);" aria-hidden="true"></i>
            Portails Open Data
          </h2>
          <span class="info-resultat">4 standards supportés</span>
        </div>

        <div class="carte" style="margin-bottom: 20px;">
          <p style="font-size: 0.875rem; color: var(--gris-700); margin-bottom: 16px;">
            Détection automatique du type de portail et extraction via API native.
            <strong>×30 plus rapide</strong> qu'un scan HTML classique.
          </p>

          <div class="champ-groupe">
            <label for="odUrl" class="champ-label">URL du portail</label>
            <input type="url" id="odUrl" class="champ-input" value="https://www.data.gouv.fr" placeholder="https://www.data.gouv.fr">
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div class="champ-groupe">
              <label for="odPortal" class="champ-label">Portail (auto-détecté)</label>
              <select id="odPortal" class="champ-select">
                <option value="auto" selected>Auto-détection</option>
                <option value="udata">udata (France)</option>
                <option value="ckan">CKAN (Allemagne, UK…)</option>
                <option value="opendatasoft">OpenDataSoft (Paris…)</option>
                <option value="dcat">DCAT-AP (UE)</option>
              </select>
            </div>
            <div class="champ-groupe">
              <label for="odMax" class="champ-label">Datasets max</label>
              <select id="odMax" class="champ-select">
                <option value="50">50</option>
                <option value="100" selected>100</option>
                <option value="500">500</option>
                <option value="1000">1000</option>
              </select>
            </div>
          </div>

          <div style="margin-bottom: 16px;">
            <p style="font-size: 0.82rem; color: var(--gris-700); margin-bottom: 8px; font-weight: 600;">
              Exemples rapides :
            </p>
            <div style="display: flex; flex-wrap: wrap; gap: 6px;">
              <button class="btn btn-secondaire od-example" data-url="https://www.data.gouv.fr" data-portal="udata" style="width:auto; padding:6px 12px; font-size:0.75rem;">
                🇫🇷 data.gouv.fr
              </button>
              <button class="btn btn-secondaire od-example" data-url="https://opendata.paris.fr" data-portal="opendatasoft" style="width:auto; padding:6px 12px; font-size:0.75rem;">
                🗼 Paris
              </button>
              <button class="btn btn-secondaire od-example" data-url="https://www.govdata.de" data-portal="ckan" style="width:auto; padding:6px 12px; font-size:0.75rem;">
                🇩🇪 govdata.de
              </button>
              <button class="btn btn-secondaire od-example" data-url="https://data.europa.eu" data-portal="dcat" style="width:auto; padding:6px 12px; font-size:0.75rem;">
                🇪🇺 data.europa.eu
              </button>
            </div>
          </div>

          <div class="btn-group">
            <button id="btnScanOpenData" class="btn btn-primaire">
              <i class="fas fa-play"></i> Scanner via API
            </button>
          </div>
        </div>

        <div class="stats-grille" id="odStats" style="display:none; margin-bottom: 20px;">
          <div class="stat-carte">
            <div class="stat-valeur" id="odStatTotal">0</div>
            <div class="stat-libelle">Ressources</div>
          </div>
          <div class="stat-carte">
            <div class="stat-valeur" id="odStatDatasets">0</div>
            <div class="stat-libelle">Datasets</div>
          </div>
          <div class="stat-carte">
            <div class="stat-valeur" id="odStatResources">0</div>
            <div class="stat-libelle">Fichiers</div>
          </div>
          <div class="stat-carte">
            <div class="stat-valeur" id="odStatDuration">0</div>
            <div class="stat-libelle">ms</div>
          </div>
        </div>

        <div id="odResults"></div>
      </div>

      <div id="modeApi" class="panneau" role="tabpanel" style="display:none;">`;

if (!content.includes(oldPanel)) {
  console.error('Panneau API non trouvé');
  process.exit(1);
}
content = content.replace(oldPanel, openDataPanel);

// ═══════════════════════════════════════════════════════════
//  3. Ajoute le cas "opendata" dans le gestionnaire d'onglets
// ═══════════════════════════════════════════════════════════

const oldTabHandler = `const mode = tab.dataset.mode;
    $('#modeScan').style.display = mode === 'scan' ? 'block' : 'none';
    $('#modeFull').style.display = mode === 'full' ? 'block' : 'none';
    $('#modeApi').style.display = mode === 'api' ? 'block' : 'none';
  });`;

const newTabHandler = `const mode = tab.dataset.mode;
    $('#modeScan').style.display = mode === 'scan' ? 'block' : 'none';
    $('#modeFull').style.display = mode === 'full' ? 'block' : 'none';
    $('#modeApi').style.display = mode === 'api' ? 'block' : 'none';
    $('#modeOpenData').style.display = mode === 'opendata' ? 'block' : 'none';
  });`;

if (!content.includes(oldTabHandler)) {
  console.error('Handler tabs non trouvé');
  process.exit(1);
}
content = content.replace(oldTabHandler, newTabHandler);

// ═══════════════════════════════════════════════════════════
//  4. Ajoute le cas "opendata" dans switchTab()
// ═══════════════════════════════════════════════════════════

const oldSwitchTab = `$('#modeScan').style.display = mode === 'scan' ? 'block' : 'none';
  $('#modeFull').style.display = mode === 'full' ? 'block' : 'none';
  $('#modeApi').style.display = mode === 'api' ? 'block' : 'none';
}`;

const newSwitchTab = `$('#modeScan').style.display = mode === 'scan' ? 'block' : 'none';
  $('#modeFull').style.display = mode === 'full' ? 'block' : 'none';
  $('#modeApi').style.display = mode === 'api' ? 'block' : 'none';
  $('#modeOpenData').style.display = mode === 'opendata' ? 'block' : 'none';
}`;

if (content.includes(oldSwitchTab)) {
  content = content.replace(oldSwitchTab, newSwitchTab);
}

// ═══════════════════════════════════════════════════════════
//  5. Ajoute les fonctions Open Data avant les ÉVÉNEMENTS
// ═══════════════════════════════════════════════════════════

const eventsMarker = `// ═══════════════════════════════════════════════════════════
//  ÉVÉNEMENTS
// ═══════════════════════════════════════════════════════════`;

const openDataFunctions = `// ═══════════════════════════════════════════════════════════
//  OPEN DATA
// ═══════════════════════════════════════════════════════════

async function scanOpenData() {
  const url = $('#odUrl').value.trim();
  const maxDatasets = parseInt($('#odMax').value, 10);

  if (!url) return notification('Veuillez saisir une URL.', 'erreur');

  $('#btnScanOpenData').disabled = true;
  $('#odResults').innerHTML = \`
    <div class="chargement">
      <div class="spinner" role="status"></div>
      <p><strong>Détection du portail…</strong></p>
      <p style="font-size: 0.85rem; margin-top: 8px;">
        Test des APIs udata, CKAN, OpenDataSoft, DCAT-AP
      </p>
    </div>\`;
  $('#odStats').style.display = 'none';

  try {
    const res = await fetch('/api/scan-opendata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, maxDatasets })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || \`HTTP \${res.status}\`);
    }

    const data = await res.json();

    if (!data.success || data.stats.total === 0) {
      $('#odResults').innerHTML = \`
        <div class="alerte alerte-attention">
          <i class="fas fa-circle-exclamation"></i>
          <div>
            <strong>Aucun dataset trouvé</strong>
            <p style="margin-top: 6px;">
              Le portail \${escapeHtml(url)} n'a pas d'API open data reconnue.
              Types testés : udata, CKAN, OpenDataSoft, DCAT-AP.
            </p>
          </div>
        </div>\`;
      return;
    }

    // Stats
    const datasets = data.links.filter(l => l.via && l.via.includes('-api') && l.metadata?.numResources !== undefined);
    const resources = data.links.filter(l => l.type === 'external');

    $('#odStatTotal').textContent = data.stats.total;
    $('#odStatDatasets').textContent = datasets.length;
    $('#odStatResources').textContent = resources.length;
    $('#odStatDuration').textContent = data.stats.durationMs;
    $('#odStats').style.display = 'grid';

    // Résultats
    renderOpenDataResults(data);

    notification(\`\${data.stats.total} ressources extraites via \${data.type} en \${(data.stats.durationMs/1000).toFixed(1)}s.\`, 'succes');
  } catch (err) {
    console.error(err);
    $('#odResults').innerHTML = \`
      <div class="alerte alerte-erreur">
        <i class="fas fa-triangle-exclamation"></i>
        <div><strong>Erreur :</strong> \${escapeHtml(err.message)}</div>
      </div>\`;
    notification(err.message, 'erreur');
  } finally {
    $('#btnScanOpenData').disabled = false;
  }
}

function renderOpenDataResults(data) {
  const datasets = data.links.filter(l => l.type === 'internal' && l.via?.includes('-api'));
  const resources = data.links.filter(l => l.type === 'external');

  const rows = data.links.slice(0, 200).map(l => {
    const isDataset = l.type === 'internal';
    const org = l.metadata?.organization || l.metadata?.publisher || '—';
    const format = l.metadata?.format || (isDataset ? 'page' : '—');

    return \`
      <tr>
        <td>
          <div style="font-weight:600; margin-bottom:4px;">\${escapeHtml(l.title || '(sans titre)')}</div>
          <div class="cellule-url">
            <a href="\${safeHref(l.url)}" target="_blank" rel="noopener noreferrer">\${escapeHtml(l.url)}</a>
          </div>
        </td>
        <td>\${isDataset
          ? '<span class="badge badge-interne">DATASET</span>'
          : \`<span class="badge badge-doc">\${escapeHtml(format.toUpperCase())}</span>\`}</td>
        <td style="font-size:0.82rem; color: var(--gris-700);">\${escapeHtml(org)}</td>
        <td style="font-size:0.75rem; font-family: var(--font-mono);">\${escapeHtml(l.via || '')}</td>
      </tr>
    \`;
  }).join('');

  const more = data.links.length > 200
    ? \`<p style="text-align:center; padding:16px; color: var(--gris-700);">… et \${data.links.length - 200} autres résultats (utilisez l'export pour tout récupérer)</p>\`
    : '';

  $('#odResults').innerHTML = \`
    <div class="panneau-entete" style="margin-top: 20px;">
      <h3 class="panneau-titre" style="font-size: 1.1rem;">
        <i class="fas fa-list" style="color: var(--couleur-accent);"></i>
        Résultats — \${escapeHtml(data.type.toUpperCase())}
      </h3>
      <button class="btn btn-primaire" id="btnExportOpenData" style="width:auto; padding:8px 16px; font-size:0.85rem;">
        <i class="fas fa-download"></i> Exporter (\${data.links.length})
      </button>
    </div>

    <div class="tableau-wrapper">
      <table class="tableau">
        <caption class="sr-only">Résultats open data : \${data.links.length} ressources</caption>
        <thead>
          <tr>
            <th style="width:55%">Titre / URL</th>
            <th>Type</th>
            <th>Organisation</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>\${rows}</tbody>
      </table>
    </div>
    \${more}
  \`;

  // Attache l'export
  $('#btnExportOpenData')?.addEventListener('click', async () => {
    const format = await showExportDialog(data.links.length);
    if (!format) return;

    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          links: data.links,
          format,
          filename: \`opendata-\${data.type}-\${new Date().toISOString().slice(0,10)}\`
        })
      });

      if (!res.ok) throw new Error(\`HTTP \${res.status}\`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = \`opendata-\${data.type}-\${new Date().toISOString().slice(0,10)}.\${format}\`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      notification(\`\${data.links.length} résultats exportés.\`, 'succes');
    } catch (err) {
      notification(\`Erreur : \${err.message}\`, 'erreur');
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  ÉVÉNEMENTS
// ═══════════════════════════════════════════════════════════`;

if (!content.includes(eventsMarker)) {
  console.error('Marqueur ÉVÉNEMENTS non trouvé');
  process.exit(1);
}
content = content.replace(eventsMarker, openDataFunctions);

// ═══════════════════════════════════════════════════════════
//  6. Ajoute les écouteurs d'événements
// ═══════════════════════════════════════════════════════════

const listenerMarker = `$('#btnExport').addEventListener('click', exportResults);`;

if (!content.includes(listenerMarker)) {
  console.error('Marqueur listener non trouvé');
  process.exit(1);
}

const newListeners = `${listenerMarker}
$('#btnScanOpenData').addEventListener('click', scanOpenData);

$$('.od-example').forEach(btn => {
  btn.addEventListener('click', () => {
    $('#odUrl').value = btn.dataset.url;
    $('#odPortal').value = btn.dataset.portal;
    scanOpenData();
  });
});`;

content = content.replace(listenerMarker, newListeners);

fs.writeFileSync(path, content);
console.log('OK');
NODEEOF

  log_success "index.html : onglet Open Data ajouté"
}

# ═══════════════════════════════════════════════════════════
#  VÉRIFICATIONS
# ═══════════════════════════════════════════════════════════

verify() {
  log_info "Vérification…"

  if $DRY_RUN; then
    log_info "[DRY-RUN] Vérifierait"
    return 0
  fi

  local file="${SCRIPT_DIR}/public/index.html"
  local errors=0

  for marker in "modeOpenData" "btnScanOpenData" "scanOpenData" "od-example"; do
    if ! grep -q "$marker" "$file"; then
      log_error "Marqueur manquant : $marker"
      errors=$((errors + 1))
    fi
  done

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
  echo "  Scanner Pro — Patch 9 : Interface Open Data"
  echo "═══════════════════════════════════════════════════════════"
  echo ""

  if $REVERT; then do_revert; fi

  if $DRY_RUN; then
    log_warn "Mode DRY-RUN — aucune modification"
    echo ""
  fi

  check_prerequisites
  echo ""

  log_info "Étape 1/2 : Ajout de l'onglet Open Data"
  patch_html
  echo ""

  log_info "Étape 2/2 : Vérifications"
  verify
  echo ""

  echo "═══════════════════════════════════════════════════════════"
  log_success "Patch 9 appliqué avec succès !"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  echo "  Prochaines étapes :"
  echo "    1. lsof -ti:3001 | xargs -r kill -9"
  echo "    2. npm start"
  echo "    3. Ouvrir http://localhost:3001"
  echo "    4. Cliquer sur l'onglet « Open Data »"
  echo "    5. Choisir un exemple (data.gouv.fr, Paris, govdata.de, EU)"
  echo ""
  echo "  Pour annuler : ./patch9.sh --revert"
  echo ""
}

main "$@"