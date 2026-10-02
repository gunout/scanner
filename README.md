# Scanner Pro

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.21-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Puppeteer](https://img.shields.io/badge/Puppeteer-25.12-40B5A4?logo=puppeteer&logoColor=white)](https://pptr.dev/)
[![undici](https://img.shields.io/badge/undici-8.11-FF6B35)](https://undici.nodejs.org/)
[![Version](https://img.shields.io/badge/version-4.1.0-blue)](package.json)
[![License](https://img.shields.io/badge/license-usage%20personnel-blue)](#-licence)
[![Tests](https://img.shields.io/badge/tests-node%3Atest-green)](test/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](#-contribuer)
[![RGPD](https://img.shields.io/badge/RGPD-conforme-003399)](https://www.cnil.fr/fr/rgpd-de-quoi-parle-t-on)
[![RGAA](https://img.shields.io/badge/RGAA-4.1%20AA-000091)](https://accessibilite.numerique.gouv.fr/)

> ⚠️ **Usage légal uniquement.** Cet outil doit être utilisé sur des sites que vous êtes autorisé à analyser (vos propres systèmes, ou données publiques). Tout scan non autorisé peut constituer une infraction pénale (art. 323-1 du Code pénal français).

Outil d'analyse technique de sites web : extraction de liens, détection d'APIs, audit de sécurité.

---

## 📋 Sommaire

- [Fonctionnalités](#-fonctionnalités)
- [Installation](#-installation)
- [Architecture](#️-architecture)
- [API](#-api)
- [Open Data](#-open-data)
- [Sécurité](#-sécurité)
- [Cadre légal](#️-cadre-légal)
- [Stack technique](#️-stack-technique)
- [Tests](#-tests)
- [Contribuer](#-contribuer)
- [Licence](#-licence)

---

## ✨ Fonctionnalités

| Fonctionnalité | Description |
|---|---|
| 🔍 **Scan de page** | Extraction des liens, images, PDF, documents (profondeur configurable) |
| 🕷️ **Scan complet** | Exploration via `sitemap.xml` et flux RSS, analyse en parallèle |
| 🧠 **Détection de SPA** | Bascule automatique vers Puppeteer si le site nécessite JavaScript |
| 📄 **Extraction de documents** | PDF (texte, URLs, emails), CSV, XLSX, JSON |
| 🗄️ **Open Data** | Support udata, CKAN, OpenDataSoft, DCAT-AP |
| 🔌 **Analyse d'APIs** | Test manuel ou en masse du catalogue d'APIs publiques françaises |
| 📘 **Analyse Swagger/OpenAPI** | Endpoints, schémas, authentification |
| 📤 **Export** | JSON, CSV, JSONL |
| 🛡️ **Audit de sécurité** | HSTS, CSP, CORS, rate-limiting |

---

## 🚀 Installation

### Prérequis

- **Node.js** ≥ 20
- **npm** ≥ 9

### Étapes

```bash
# Cloner le dépôt
git clone https://github.com/gunout/scanner.git
cd scanner

# Installer les dépendances
npm install

# Démarrer le serveur
npm start
```

Le serveur écoute sur **`http://localhost:3001`**.

### Mode développement

```bash
npm run dev   # redémarrage auto via --watch
```

### Tests

```bash
npm test
```

---

## 🏗️ Architecture

```
scanner/
├── server.js           # Serveur Express + routes API
├── extractors.js       # Extraction PDF/JSON/CSV/XLSX, sitemap, RSS
├── optimizations.js    # AdaptiveQueue, PoolManager, CkanDetector...
├── utils.js            # Helpers partagés (SSRF, JSON, erreurs)
├── apis-catalog.js     # Catalogue d'APIs publiques françaises
├── package.json        # Dépendances et scripts
├── LICENSE             # Licence du projet
├── patch.sh → patch9.sh # Scripts de patch idempotents
├── test/
│   └── utils.test.js   # Tests unitaires
└── public/
    └── index.html      # Interface web
```

---

## 🔌 API

### `POST /api/scan`

Analyse une page et ses sous-pages.

**Body :**

```json
{
  "url": "https://example.com",
  "depth": 1,
  "maxPages": 5,
  "useBrowser": true,
  "skipCache": false
}
```

**Limites :** `depth` ≤ 3, `maxPages` ≤ 200.

---

### `POST /api/scan-full`

Scan complet via sitemap + RSS.

**Body :**

```json
{
  "url": "https://example.com",
  "maxUrls": 50,
  "concurrency": 3,
  "includeRSS": true
}
```

**Limites :** `maxUrls` ≤ 500, `concurrency` ≤ 10.

---

### `POST /api/scan-opendata`

**Détection automatique** du portail open data et extraction via API native.

**Body :**

```json
{
  "url": "https://www.data.gouv.fr",
  "maxDatasets": 100
}
```

**Standards supportés :**

| Standard | Portails | Exemple |
|---|---|---|
| **udata** | data.gouv.fr, Etalab | `https://www.data.gouv.fr` |
| **CKAN** | govdata.de, data.gov.uk | `https://www.govdata.de` |
| **OpenDataSoft** | opendata.paris.fr | `https://opendata.paris.fr` |
| **DCAT-AP** | data.europa.eu | `https://data.europa.eu` |

**Exemple de réponse :**

```json
{
  "type": "udata",
  "links": [...],
  "fromApi": true,
  "stats": {
    "total": 251,
    "durationMs": 4499,
    "mode": "api"
  }
}
```

---

### `POST /api/scan-news`

Scan optimisé pour sites d'actualités (découverte + fetch parallèle).

**Body :**

```json
{
  "url": "https://www.lemonde.fr",
  "maxArticles": 500,
  "concurrency": 5
}
```

---

### `POST /api/scan-api-batch`

Fetch parallèle d'une liste d'endpoints REST.

**Body :**

```json
{
  "endpoints": [
    "https://api.github.com/repos/nodejs/node",
    "https://api.github.com/repos/expressjs/express"
  ]
}
```

---

### `POST /api/extract`

Extrait le contenu de documents (PDF, CSV, XLSX, JSON).

**Body :**

```json
{
  "urls": ["https://example.com/doc.pdf", "https://example.com/data.csv"]
}
```

---

### `POST /api/probe-rest`

Teste un endpoint API manuellement.

**Body :**

```json
{
  "url": "https://api.example.com/v1/users",
  "method": "GET",
  "headers": {},
  "body": null,
  "insecure": false
}
```

---

### `POST /api/probe-catalog`

Teste en masse les APIs du catalogue.

**Body :**

```json
{
  "category": "Entreprises",
  "maxApis": 15
}
```

---

### `POST /api/export`

Exporte les résultats en JSON, CSV ou JSONL.

**Body :**

```json
{
  "links": [...],
  "format": "csv",
  "filename": "export"
}
```

**Formats supportés :**

| Format | Content-Type | Extension |
|---|---|---|
| `json` | `application/json` | `.json` |
| `csv` | `text/csv` | `.csv` |
| `jsonl` | `application/x-ndjson` | `.jsonl` |

---

### `GET /api/apis-catalog`

Retourne le catalogue complet des APIs publiques.

---

### `GET /api/pool/stats`

Statistiques du pool de connexions undici.

---

### `GET /api/health`

Statut du serveur.

```json
{
  "status": "ok",
  "project": "scanner",
  "version": "4.1.0",
  "node": "v22.x.x",
  "browser": true,
  "cacheSize": 0,
  "rateLimitEntries": 0
}
```

---

## 🗄️ Open Data

### Portails testés

| Portail | Type | Datasets | Durée |
|---|---|---|---|
| `data.gouv.fr` | udata | **251** | 4,5s |
| `govdata.de` | CKAN | **428** | 2,8s |
| `opendata.paris.fr` | OpenDataSoft | **100** | 8s |
| `data.europa.eu` | DCAT-AP | **100** | 5,5s |

### Exemples

```bash
# France (udata)
curl -X POST http://localhost:3001/api/scan-opendata \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.data.gouv.fr","maxDatasets":100}'

# Allemagne (CKAN)
curl -X POST http://localhost:3001/api/scan-opendata \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.govdata.de","maxDatasets":100}'

# Paris (OpenDataSoft)
curl -X POST http://localhost:3001/api/scan-opendata \
  -H "Content-Type: application/json" \
  -d '{"url":"https://opendata.paris.fr","maxDatasets":100}'

# Union européenne (DCAT-AP)
curl -X POST http://localhost:3001/api/scan-opendata \
  -H "Content-Type: application/json" \
  -d '{"url":"https://data.europa.eu","maxDatasets":100}'
```

### Interface web

Ouvrez http://localhost:3001 et cliquez sur l'onglet **"Open Data"**.

---

## 🔒 Sécurité

### Protection SSRF

Toutes les URLs sont validées avant d'être contactées :

- ❌ `localhost`, `127.0.0.1`, `::1`
- ❌ Plages privées : `10.x`, `192.168.x`, `172.16–31.x`
- ❌ Metadata cloud : `169.254.169.254`
- ❌ Domaines internes : `.local`, `.internal`
- ❌ Protocoles non HTTP(S) : `file://`, `ftp://`, `javascript:`

### Rate limiting

**30 requêtes/minute par IP** sur les routes POST coûteuses.

### Limites dures

| Ressource | Limite |
|---|---|
| Profondeur de scan | 3 |
| Pages par scan | 200 |
| URLs par scan complet | 500 |
| Concurrence | 10 |
| URLs par extraction | 50 |
| Datasets par portail | 1000 |

### Fix undici 8

Le projet inclut deux correctifs pour undici 8.11.2 :

1. **`Accept-Encoding: br`** retiré (bug de décodage Brotli)
2. **Redirections gérées manuellement** (bug HTTP/2 → HTTP/2)

---

## ⚖️ Cadre légal

Cet outil est conçu pour un usage **strictement légal** :

### ✅ Autorisé

- Audit de vos propres systèmes
- Analyse de données publiques dans le respect des CGU
- Tests de sécurité avec autorisation écrite

### ❌ Interdit

- Scanner des sites sans autorisation
- Contourner des protections d'accès
- Collecter des données personnelles sans base légale
- Toute utilisation contraire aux CGU du site cible

> En France, l'accès ou le maintien frauduleux dans un système de traitement automatisé de données est puni par l'**article 323-1 du Code pénal** (jusqu'à 3 ans d'emprisonnement et 100 000 € d'amende).

---

## 🛠️ Stack technique

| Composant | Rôle |
|---|---|
| **Node.js** ≥ 20 | Runtime |
| **Express** 4 | Serveur HTTP |
| **undici** | Client HTTP performant |
| **Puppeteer** | Navigateur headless pour SPA |
| **cheerio** | Parsing HTML/XML |
| **pdfjs-dist** | Extraction PDF |
| **exceljs** | Lecture XLSX |
| **csv-parse** | Parsing CSV |

---

## 🧪 Tests

```bash
npm test
```

Les tests couvrent :

- Validation SSRF (`validateTargetUrl`)
- Sécurité des liens (`safeHref`)
- Bornes numériques (`clamp`)
- Analyse JSON (`summarizeJSON`, `analyzeJSONStructure`)
- Détection d'indices API (`detectAPIHints`)
- Analyse de sécurité HTTP (`analyzeSecurity`)

---

## 🤝 Contribuer

Les contributions sont bienvenues !

1. Forkez le projet
2. Créez une branche (`git checkout -b feature/amelioration`)
3. Committez (`git commit -m 'Ajout fonctionnalité'`)
4. Pushez (`git push origin feature/amelioration`)
5. Ouvrez une Pull Request

---

## 📝 Licence

**Usage personnel et éducatif.**

L'auteur décline toute responsabilité en cas d'utilisation abusive. Voir la section [Cadre légal](#️-cadre-légal).

---

<p align="center">
  <sub>Fait avec ❤️ pour la communauté open source</sub>
</p>


---

<div align="center">

### 🇫🇷 Gunout · 2026

![Made in France](https://img.shields.io/badge/Made_in-France-002395?style=flat-square&labelColor=FFFFFF&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA5MDAgNjAwIj48cmVjdCB3aWR0aD0iOTAwIiBoZWlnaHQ9IjYwMCIgZmlsbD0iIzAwMjM5NSIvPjxyZWN0IHdpZHRoPSI5MDAiIGhlaWdodD0iNDAwIiB5PSIxMDAiIGZpbGw9IiNmZmYiLz48cmVjdCB3aWR0aD0iOTAwIiBoZWlnaHQ9IjIwMCIgeT0iNDAwIiBmaWxsPSIjZWQyOTM5Ii8+PC9zdmc+)
![GitHub](https://img.shields.io/badge/GitHub-gunout-181717?style=flat-square&logo=github&logoColor=white)
![Year](https://img.shields.io/badge/2026-ED2939?style=flat-square&labelColor=FFFFFF)

<sub>© 2026 <strong>Gunout</strong> — Tous droits réservés.</sub>

</div>
