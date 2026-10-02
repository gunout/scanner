// apis-catalog.js
// Catalogue des APIs publiques françaises accessibles sans authentification

export const API_CATALOG = [
  // ─── Entreprises & Économie ───
  {
    id: 'recherche-entreprises',
    name: 'Recherche d\'Entreprises',
    description: 'Recherche par nom, SIREN, SIRET, dirigeant, adresse',
    category: 'Entreprises',
    auth: 'public',
    baseUrl: 'https://recherche-entreprises.api.gouv.fr',
    docsUrl: 'https://recherche-entreprises.api.gouv.fr/docs',
    examples: [
      { label: 'Recherche "airbus"', url: 'https://recherche-entreprises.api.gouv.fr/search?q=airbus' },
      { label: 'Par SIREN', url: 'https://recherche-entreprises.api.gouv.fr/search?q=542051180' },
      { label: 'Par code postal', url: 'https://recherche-entreprises.api.gouv.fr/search?q=75001&page=1' }
    ]
  },
  {
    id: 'insee-sirene',
    name: 'INSEE Sirene',
    description: 'Répertoire SIRENE des entreprises françaises',
    category: 'Entreprises',
    auth: 'token',
    baseUrl: 'https://api.insee.fr/entreprises/sirene/V3',
    docsUrl: 'https://api.insee.fr/catalogue/',
    note: 'Nécessite un token OAuth (gratuit sur inscription)',
    examples: [
      { label: 'SIREN 542051180', url: 'https://api.insee.fr/entreprises/sirene/V3/siren/542051180' }
    ]
  },

  // ─── Adresses & Géographie ───
  {
    id: 'ban',
    name: 'Base Adresse Nationale (BAN)',
    description: 'Géocodage et recherche d\'adresses françaises',
    category: 'Adresses',
    auth: 'public',
    baseUrl: 'https://api-adresse.data.gouv.fr',
    docsUrl: 'https://adresse.data.gouv.fr/api-doc/adresse',
    examples: [
      { label: 'Recherche "8 boulevard du Port"', url: 'https://api-adresse.data.gouv.fr/search/?q=8+boulevard+du+Port' },
      { label: 'Recherche par code postal', url: 'https://api-adresse.data.gouv.fr/search/?q=75001' },
      { label: 'Reverse geocoding', url: 'https://api-adresse.data.gouv.fr/reverse/?lon=2.37&lat=48.85' }
    ]
  },
  {
    id: 'geo-api',
    name: 'Géo API',
    description: 'Découpage administratif (communes, départements, régions)',
    category: 'Adresses',
    auth: 'public',
    baseUrl: 'https://geo.api.gouv.fr',
    docsUrl: 'https://geo.api.gouv.fr/decoupage-administratif',
    examples: [
      { label: 'Toutes les régions', url: 'https://geo.api.gouv.fr/regions' },
      { label: 'Départements', url: 'https://geo.api.gouv.fr/departements' },
      { label: 'Commune Paris', url: 'https://geo.api.gouv.fr/communes/75056' }
    ]
  },

  // ─── Droit & Légal ───
  {
    id: 'legifrance',
    name: 'Légifrance',
    description: 'Textes juridiques, codes, jurisprudence',
    category: 'Justice',
    auth: 'oauth',
    baseUrl: 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app',
    docsUrl: 'https://developer.aife.economie.gouv.fr/',
    note: 'Nécessite OAuth2 (PISTE)',
    examples: [
      { label: 'Recherche "RGPD"', url: 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app/search' }
    ]
  },

  // ─── Éducation ───
  {
    id: 'education-data',
    name: 'Data Éducation',
    description: 'Établissements scolaires, résultats examens',
    category: 'Éducation',
    auth: 'public',
    baseUrl: 'https://data.education.gouv.fr/api/explore/v2.1',
    docsUrl: 'https://data.education.gouv.fr/api/v2/console',
    examples: [
      { label: 'Établissements', url: 'https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets?limit=5' }
    ]
  },

  // ─── Environnement ───
  {
    id: 'georisques',
    name: 'Géorisques',
    description: 'Risques naturels et technologiques',
    category: 'Environnement',
    auth: 'public',
    baseUrl: 'https://www.georisques.gouv.fr/api/v1',
    docsUrl: 'https://www.georisques.gouv.fr/doc-api',
    examples: [
      { label: 'Risques à Paris', url: 'https://www.georisques.gouv.fr/api/v1/gaspar/risques?code_insee=75056' }
    ]
  },
  {
    id: 'ademe',
    name: 'ADEME',
    description: 'Données transition écologique',
    category: 'Environnement',
    auth: 'public',
    baseUrl: 'https://data.ademe.fr/data-fair/api/v1',
    docsUrl: 'https://data.ademe.fr/',
    examples: [
      { label: 'Datasets', url: 'https://data.ademe.fr/data-fair/api/v1/datasets?size=5' }
    ]
  },

  // ─── Transport ───
  {
    id: 'transport-data',
    name: 'Transport.data.gouv.fr',
    description: 'Données de mobilité (GTFS, temps réel)',
    category: 'Transport',
    auth: 'public',
    baseUrl: 'https://transport.data.gouv.fr/api',
    docsUrl: 'https://transport.data.gouv.fr/',
    examples: [
      { label: 'Datasets', url: 'https://transport.data.gouv.fr/api/datasets' }
    ]
  },

  // ─── Finances publiques ───
  {
    id: 'data-economie',
    name: 'Data Économie',
    description: 'Données économiques du Ministère',
    category: 'Économie',
    auth: 'public',
    baseUrl: 'https://data.economie.gouv.fr/api/explore/v2.1',
    docsUrl: 'https://data.economie.gouv.fr/pages/accueil/',
    examples: [
      { label: 'Datasets', url: 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets?limit=5' }
    ]
  },

  // ─── Santé ───
  {
    id: 'data-sante',
    name: 'Data Santé',
    description: 'Données de santé publique',
    category: 'Santé',
    auth: 'public',
    baseUrl: 'https://data.drees.solidarites-sante.gouv.fr/api/explore/v2.1',
    docsUrl: 'https://data.drees.solidarites-sante.gouv.fr/',
    examples: [
      { label: 'Datasets', url: 'https://data.drees.solidarites-sante.gouv.fr/api/explore/v2.1/catalog/datasets?limit=5' }
    ]
  },

  // ─── Fonction publique ───
  {
    id: 'data-fonction-publique',
    name: 'Data Fonction Publique',
    description: 'Données RH de la fonction publique',
    category: 'Administration',
    auth: 'public',
    baseUrl: 'https://www.data.gouv.fr/api/1',
    docsUrl: 'https://www.data.gouv.fr/fr/pages/donnees-api/',
    examples: [
      { label: 'Datasets récents', url: 'https://www.data.gouv.fr/api/1/datasets/?page_size=3' }
    ]
  },

  // ─── Culture ───
  {
    id: 'culture-data',
    name: 'Data Culture',
    description: 'Données culturelles (musées, monuments)',
    category: 'Culture',
    auth: 'public',
    baseUrl: 'https://data.culture.gouv.fr/api/explore/v2.1',
    docsUrl: 'https://data.culture.gouv.fr/',
    examples: [
      { label: 'Datasets', url: 'https://data.culture.gouv.fr/api/explore/v2.1/catalog/datasets?limit=5' }
    ]
  },

  // ─── Open Data ───
  {
    id: 'data-gouv',
    name: 'data.gouv.fr (Datasets)',
    description: 'Catalogue national des données ouvertes',
    category: 'Open Data',
    auth: 'public',
    baseUrl: 'https://www.data.gouv.fr/api/1',
    docsUrl: 'https://doc.data.gouv.fr/api/intro/',
    examples: [
      { label: 'Datasets', url: 'https://www.data.gouv.fr/api/1/datasets/?page_size=5' },
      { label: 'Organisations', url: 'https://www.data.gouv.fr/api/1/organizations/?page_size=5' },
      { label: 'Réutilisations', url: 'https://www.data.gouv.fr/api/1/reuses/?page_size=5' }
    ]
  }
];

export function getCatalogStats() {
  const byCategory = {};
  API_CATALOG.forEach(api => {
    byCategory[api.category] = (byCategory[api.category] || 0) + 1;
  });
  return {
    total: API_CATALOG.length,
    byCategory
  };
}