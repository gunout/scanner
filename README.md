<div align="center">

# 🛰️ Scanner Pro

### Plateforme d'extraction, d'analyse et de reconnaissance pour la cybersécurité

**Extraction de liens · Analyse d'APIs · Lecture de documents · Scan de sitemap**

[![Cybersecurity](https://img.shields.io/badge/Cybersecurity-Offensive%20%26%20Defensive-red?style=for-the-badge&logo=shield&logoColor=white)](https://github.com/)
[![Made in France](https://img.shields.io/badge/Made%20in-France-0055A4?style=for-the-badge&logo=flag&logoColor=white)](https://www.gouvernement.fr/)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)

[![Security Audit](https://img.shields.io/badge/npm%20audit-1%20moderate-orange?style=for-the-badge&logo=npm)](https://www.npmjs.com/)
[![Puppeteer](https://img.shields.io/badge/Puppeteer-25.x-40B5A4?style=for-the-badge&logo=puppeteer)](https://pptr.dev/)
[![Version](https://img.shields.io/badge/Version-4.0.0-blue?style=for-the-badge)](https://github.com/)

---

</div>

## ⚠️ Avertissement Cybersécurité

> **Ce projet est un outil de reconnaissance et d'audit.**
>
> Il est destiné à un usage **légal uniquement** :
> - ✅ Audit de vos propres sites/infrastructures
> - ✅ Tests d'intrusion avec autorisation écrite
> - ✅ Recherche en cybersécurité (bug bounty, CTF, formation)
> - ✅ Analyse de données publiques (open data)
>
> ❌ **N'est PAS destiné à :**
> - Scanner des sites sans autorisation (illégal — art. 323-1 du Code pénal)
> - Contourner des protections d'API gouvernementales
> - Collecter massivement des données personnelles (RGPD)
> - Attaquer des infrastructures tierces
>
> **L'auteur décline toute responsabilité en cas d'utilisation abusive.**

---

## 📋 Table des matières

- [Aperçu](#-aperçu)
- [Fonctionnalités](#-fonctionnalités)
- [Sécurité](#-sécurité)
- [Installation](#-installation)
- [Utilisation](#-utilisation)
- [Architecture](#-architecture)
- [APIs supportées](#-apis-supportées)
- [Conformité légale](#-conformité-légale)
- [Contribuer](#-contribuer)
- [Licence](#-licence)

---

## 🎯 Aperçu

**Scanner Pro** est une plateforme Node.js complète qui combine :

| Capacité | Description |
|---|---|
| 🔍 **Extraction de liens** | HTML, SPA (Vue/React/Nuxt), JS dynamique |
| 🕷️ **Scan de sitemap** | Découverte automatique via `sitemap.xml` + RSS |
| 📄 **Lecture de documents** | PDF, JSON, CSV, XLSX, images |
| 🔌 **Analyse d'APIs** | Détection, sondage, Swagger/OpenAPI |
| 🛡️ **Analyse de sécurité** | Headers, CORS, CSP, HSTS, TLS |
| 🇫🇷 **APIs françaises** | 15+ APIs publiques référencées |

---

## ⚡ Fonctionnalités

### 🔍 Extraction & Scan

- **Scan récursif** de pages (profondeur configurable)
- **Détection automatique de SPA** → bascule Puppeteer
- **Fallback intelligent** : `undici` → `Puppeteer`
- **Cache mémoire** TTL 5 min
- **Concurrence configurable** (1-10 workers)

### 📄 Extraction multimodale

- **PDF** via `pdfjs-dist` (texte, métadonnées, URLs, emails)
- **JSON** (structure, clés, URLs embarquées)
- **CSV** (colonnes, lignes, séparateur auto)
- **XLSX** (feuilles, dimensions, échantillons)

### 🔌 Analyse d'APIs

- **Détection d'endpoints** dans le JS (`fetch`, `axios`, `$.ajax`)
- **Sondage REST** (GET/POST/PUT/DELETE)
- **Analyse Swagger/OpenAPI** complète
- **Catalogue de 15+ APIs** publiques françaises
- **Vérification DNS** avec commandes de diagnostic

### 🛡️ Cybersécurité

- **Analyse des headers de sécurité** (HSTS, CSP, X-Frame-Options)
- **Détection CORS** permissif
- **Identification de frameworks** (Nuxt, Next.js)
- **Extraction de secrets potentiels** (patterns d'API keys)

---

## 🛡️ Sécurité

### 🔒 Posture de sécurité

| Aspect | État |
|---|---|
| **Dépendances** | 1 CVE moderate (non exploitable) |
| **npm audit** | ✅ Passé (voir note ci-dessous) |
| **TLS** | ✅ Vérification activée par défaut |
| **User-Agent** | ✅ Réaliste (Chrome 122) |
| **Timeouts** | ✅ Configurés (12-60s) |
| **Sandbox Puppeteer** | ✅ `--no-sandbox` désactivé en prod |

### 🚨 Note sur les CVE

La CVE `csv-parse <7.0.2` (moderate) **n'est pas exploitable** dans notre contexte :
- Elle nécessite qu'un attaquant contrôle **ET** l'option `columns` **ET** le CSV parsé
- Nos CSV proviennent de sources publiques de confiance (data.gouv.fr, etc.)
- Si exploitation : pollution de prototype locale, **pas d'exécution de code**

### 🔐 Bonnes pratiques

- ✅ Aucune clé API stockée en dur
- ✅ Aucun secret en clair dans les logs
- ✅ Validation des entrées utilisateur
- ✅ Sanitization des headers avant affichage
- ✅ Limitation du nombre d'URLs par scan (50-500)

### 🛡️ Référentiels

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [ANSSI — Recommandations](https://www.ssi.gouv.fr/)
- [CNIL — RGPD](https://www.cnil.fr/)
- [MITRE ATT&CK](https://attack.mitre.org/)

---

## 🚀 Installation

### Prérequis

- **Node.js** ≥ 20 (testé sur 22.23.3)
- **npm** ≥ 10
- **Chromium** (installé automatiquement par Puppeteer)

### Étapes

```bash
# 1. Cloner
git clone https://github.com/votre-user/scanner-pro.git
cd scanner-pro

# 2. Installer
npm install

# 3. Lancer
npm start
```

**Ouvrir** : http://localhost:3000

### Vérification

```bash
# Health check
curl http://localhost:3000/api/health

# Résultat attendu
{
  "status": "ok",
  "project": "scanner",
  "version": "4.0.0",
  "node": "v22.23.3",
  "browser": false,
  "cacheSize": 0
}
```

---

## 📖 Utilisation

### 🖥️ Interface Web

L'interface propose **3 modes** :

| Mode | Icône | Description |
|---|---|---|
| **Scan** | 🛰️ | Scan d'une page + sous-pages |
| **Complet** | 🕷️ | Scan via sitemap.xml + RSS |
| **APIs** | 🔌 | Test d'APIs + catalogue |

### 🔧 API REST

#### 1. Scan simple

```bash
curl -X POST http://localhost:3000/api/scan \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.data.gouv.fr/fr/",
    "depth": 1,
    "maxPages": 5,
    "useBrowser": true
  }'
```

#### 2. Scan complet (sitemap)

```bash
curl -X POST http://localhost:3000/api/scan-full \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.data.gouv.fr",
    "maxUrls": 50,
    "concurrency": 3,
    "includeRSS": true
  }'
```

#### 3. Extraction de documents

```bash
curl -X POST http://localhost:3000/api/extract \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://example.com/rapport.pdf",
      "https://example.com/data.json"
    ]
  }'
```

#### 4. Analyse Swagger

```bash
curl -X POST http://localhost:3000/api/analyze-swagger \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://raw.githubusercontent.com/betagouv/api_gouv_swaggers/main/swaggers/api-ficoba3.json"
  }'
```

---

## 🏗️ Architecture

```
scanner-pro/
├── server.js              # Backend Express (10+ endpoints)
├── extractors.js          # Module d'extraction (PDF, JSON, CSV, XLSX, sitemap)
├── apis-catalog.js        # Catalogue des APIs françaises
├── package.json           # Dépendances
└── public/
    └── index.html         # Interface utilisateur (SPA vanilla)
```

### 🔄 Flow de scan

```
[User] → [UI] → POST /api/scan
         ↓
    [Express] → detect SPA
         ↓
    ┌────────┴────────┐
    ↓                 ↓
[undici]         [Puppeteer]
(rapide)         (SPA/WAF)
    ↓                 ↓
    └────────┬────────┘
             ↓
        [Cheerio]
             ↓
    [Extraction links/images/docs]
             ↓
        [Scoring]
             ↓
    [Cache + JSON response]
             ↓
           [UI]
```

### 📦 Stack technique

| Couche | Techno | Version |
|---|---|---|
| **Runtime** | Node.js | 22.x |
| **Serveur** | Express | 4.21.2 |
| **HTTP** | undici | 8.11.2 |
| **Navigateur** | Puppeteer | 25.12.0 |
| **Parsing HTML** | Cheerio | 1.0.0 |
| **PDF** | pdfjs-dist | 4.7.76 |
| **Excel** | ExcelJS | 4.4.0 |
| **CSV** | csv-parse | 5.6.0 |

---

## 🇫🇷 APIs supportées

| API | Catégorie | Auth | Doc |
|---|---|---|---|
| **Recherche d'Entreprises** | Entreprises | Public | [docs](https://recherche-entreprises.api.gouv.fr/docs) |
| **INSEE Sirene** | Entreprises | Token | [docs](https://api.insee.fr/catalogue/) |
| **BAN (Adresse)** | Adresses | Public | [docs](https://adresse.data.gouv.fr/api-doc/adresse) |
| **Géo API** | Adresses | Public | [docs](https://geo.api.gouv.fr/decoupage-administratif) |
| **Légifrance** | Justice | OAuth | [docs](https://developer.aife.economie.gouv.fr/) |
| **Data Éducation** | Éducation | Public | [docs](https://data.education.gouv.fr/) |
| **Géorisques** | Environnement | Public | [docs](https://www.georisques.gouv.fr/doc-api) |
| **ADEME** | Environnement | Public | [docs](https://data.ademe.fr/) |
| **Transport.data** | Transport | Public | [docs](https://transport.data.gouv.fr/) |
| **Data Économie** | Économie | Public | [docs](https://data.economie.gouv.fr/) |
| **Data Santé** | Santé | Public | [docs](https://data.drees.solidarites-sante.gouv.fr/) |
| **Data Culture** | Culture | Public | [docs](https://data.culture.gouv.fr/) |
| **data.gouv.fr** | Open Data | Public | [docs](https://doc.data.gouv.fr/api/intro/) |
| **FICOBA v2** | Bancaire | 🔐 Privé | [Swagger](https://github.com/betagouv/api_gouv_swaggers) |

---

## ⚖️ Conformité légale

### 📜 Textes applicables

| Texte | Portée |
|---|---|
| **Art. 323-1 Code pénal** | Accès non autorisé à un STAD → 3 ans + 100 000 € |
| **Art. 226-18 Code pénal** | Collecte frauduleuse de données personnelles |
| **RGPD (UE 2016/679)** | Traitement des données personnelles |
| **Loi Informatique et Libertés** | Application française du RGPD |
| **Code de la propriété intellectuelle** | Respect des droits d'auteur |

### ✅ Utilisation conforme

- Audit de **vos propres** systèmes
- Tests d'intrusion **avec mandat écrit**
- Recherche en sécurité (bug bounty, CTF)
- Analyse de **données publiques** (open data)
- Formation et éducation

### ❌ Utilisation interdite

- Scan sans autorisation d'un tiers
- Contournement d'authentification
- Attaque DoS / DDoS
- Collecte massive de données personnelles
- Revente de données extraites

### 🛡️ Recommandations

1. **Documenter chaque scan** (URL, date, autorisation)
2. **Respecter `robots.txt`** — vérifier avant scan
3. **Limiter la concurrence** (max 5 requêtes parallèles)
4. **Utiliser un User-Agent identifiant** en production
5. **Ne jamais publier** les données extraites sans consentement

---

## 🤝 Contribuer

Les contributions sont bienvenues :

1. **Fork** le projet
2. **Créer une branche** (`git checkout -b feature/amelioration`)
3. **Commit** (`git commit -m 'Ajout fonctionnalité X'`)
4. **Push** (`git push origin feature/amelioration`)
5. **Ouvrir une Pull Request**

### 🐛 Signaler un bug

Utiliser les [issues GitHub](https://github.com/votre-user/scanner-pro/issues) avec :
- Version de Node
- Commande exacte
- Sortie d'erreur complète
- Comportement attendu

### 🔒 Signaler une faille

**Ne pas ouvrir d'issue publique.** Envoyer un email à `security@example.com`.

---

## 📊 Roadmap

- [x] v1 — Scanner simple
- [x] v2 — Fallback Puppeteer
- [x] v3 — Extraction PDF/JSON/CSV/XLSX
- [x] v3.1 — Analyse Swagger
- [x] v4 — Sitemap + catalogue APIs
- [ ] v5 — Base SQLite + historique
- [ ] v5.1 — Export Excel avec graphiques
- [ ] v5.2 — Authentification utilisateur
- [ ] v5.3 — Dockerisation
- [ ] v6 — Détection de secrets/API keys
- [ ] v6.1 — Mode "pentest" (XSS, SQLi, etc.)

---

## 📜 Licence

**MIT License**

```
Copyright (c) 2026 Scanner Pro

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 🙏 Remerciements

- [betagouv](https://github.com/betagouv) — Pour les Swaggers d'APIs publiques
- [data.gouv.fr](https://www.data.gouv.fr/) — Pour les données ouvertes
- [Puppeteer](https://pptr.dev/) — Pour le rendu headless
- [Cheerio](https://cheerio.js.org/) — Pour le parsing HTML
- Communauté open source française 🇫🇷

---

<div align="center">

**Fait avec ❤️ en France**

[![Liberté](https://img.shields.io/badge/Liberté-0055A4?style=for-the-badge)](https://www.gouvernement.fr/)
[![Égalité](https://img.shields.io/badge/Égalité-FFFFFF?style=for-the-badge&labelColor=black)](https://www.gouvernement.fr/)
[![Fraternité](https://img.shields.io/badge/Fraternité-EF4135?style=for-the-badge)](https://www.gouvernement.fr/)

*« La cybersécurité est l'affaire de tous »*

</div>
