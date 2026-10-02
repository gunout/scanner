# Scanner Pro

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.21-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Puppeteer](https://img.shields.io/badge/Puppeteer-25.12-40B5A4?logo=puppeteer&logoColor=white)](https://pptr.dev/)
[![undici](https://img.shields.io/badge/undici-8.11-FF6B35)](https://undici.nodejs.org/)
[![Version](https://img.shields.io/badge/version-4.0.0-blue)](package.json)
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
| 🔌 **Analyse d'APIs** | Test manuel ou en masse du catalogue d'APIs publiques françaises |
| 📘 **Analyse Swagger/OpenAPI** | Endpoints, schémas, authentification |
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
├── utils.js            # Helpers partagés (SSRF, JSON, erreurs)
├── apis-catalog.js     # Catalogue d'APIs publiques françaises
├── package.json        # Dépendances et scripts
├── LICENSE             # Licence du projet
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

### `GET /api/apis-catalog`

Retourne le catalogue complet des APIs publiques.

---

### `GET /api/health`

Statut du serveur.

```json
{
  "status": "ok",
  "project": "scanner",
  "version": "4.0.0",
  "node": "v20.x.x",
  "browser": true,
  "cacheSize": 0,
  "rateLimitEntries": 0
}
```

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
