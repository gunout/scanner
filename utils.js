// utils.js
// Helpers partagés entre server.js et extractors.js

// ─── HTTP status ───
export function getStatusText(code) {
  const map = {
    200: 'OK', 201: 'Created', 204: 'No Content',
    301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
    404: 'Not Found', 405: 'Method Not Allowed', 429: 'Too Many Requests',
    500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable'
  };
  return map[code] || '';
}

// ─── Sécurité des en-têtes ───
export function sanitizeHeaders(headers) {
  const safe = {};
  const blocked = ['set-cookie', 'cookie', 'authorization'];
  Object.entries(headers).forEach(([k, v]) => {
    if (!blocked.includes(k.toLowerCase())) safe[k] = v;
  });
  return safe;
}

export function analyzeSecurity(headers, status) {
  return {
    https: true,
    hsts: !!headers['strict-transport-security'],
    csp: !!headers['content-security-policy'],
    xFrameOptions: headers['x-frame-options'] || null,
    cors: headers['access-control-allow-origin'] || null,
    needsAuth: status === 401,
    forbidden: status === 403,
    rateLimitHint: headers['x-ratelimit-limit'] || headers['retry-after'] || null,
    server: headers['server'] || null,
    poweredBy: headers['x-powered-by'] || null
  };
}

// ─── JSON ───
export function summarizeJSON(obj) {
  const json = JSON.stringify(obj, null, 2);
  return {
    type: Array.isArray(obj) ? 'array' : typeof obj,
    length: Array.isArray(obj) ? obj.length : Object.keys(obj).length,
    keys: Array.isArray(obj) ? null : Object.keys(obj).slice(0, 30),
    sample: json.substring(0, 2500)
  };
}

export function analyzeJSONStructure(obj, depth = 0, maxDepth = 3) {
  if (depth > maxDepth) return '...';
  if (obj === null) return 'null';
  if (Array.isArray(obj)) {
    if (obj.length === 0) return 'array[]';
    return { type: 'array', length: obj.length, item: analyzeJSONStructure(obj[0], depth + 1, maxDepth) };
  }
  if (typeof obj === 'object') {
    const result = {};
    Object.entries(obj).slice(0, 20).forEach(([k, v]) => {
      result[k] = analyzeJSONStructure(v, depth + 1, maxDepth);
    });
    return result;
  }
  return typeof obj;
}

export function detectAPIHints(parsed, headers) {
  const hints = { hasPagination: false, hasHATEOAS: false, hasLinks: false, dataField: null };
  if (!parsed) return hints;
  if (typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (parsed._links || parsed.links || parsed._embedded) hints.hasHATEOAS = true;
    if (parsed.total !== undefined || parsed.page !== undefined || parsed.count !== undefined) hints.hasPagination = true;
    ['data', 'items', 'results', 'content', 'records', '_embedded'].forEach(f => {
      if (parsed[f] !== undefined) hints.dataField = f;
    });
  }
  if (headers['link']) hints.hasLinks = true;
  return hints;
}

// ─── Erreurs ───
export function classifyError(err) {
  const code = err.code || '';
  if (code.includes('CERT') || code.includes('SSL')) return 'TLS_CERTIFICATE';
  if (code.includes('TIMEOUT') || code.includes('ABORT')) return 'TIMEOUT';
  if (code.includes('ENOTFOUND')) return 'DNS_NOT_FOUND';
  if (code.includes('ECONNREFUSED')) return 'CONNECTION_REFUSED';
  if (code.includes('ECONNRESET')) return 'CONNECTION_RESET';
  return 'UNKNOWN';
}

export function getErrorHint(err) {
  const type = classifyError(err);
  return {
    TLS_CERTIFICATE: 'Certificat auto-signé ou invalide.',
    TIMEOUT: 'Le serveur ne répond pas dans les temps.',
    DNS_NOT_FOUND: 'Le nom de domaine ne résout pas.',
    CONNECTION_REFUSED: 'Le port est fermé ou le service down.',
    CONNECTION_RESET: 'La connexion a été coupée.',
    UNKNOWN: 'Erreur inconnue.'
  }[type] || 'Regarde le message d\'erreur complet.';
}

// ─── Sécurité SSRF ───
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^0\.0\.0\.0$/,
  /^metadata\./i,
  /\.local$/i,
  /\.internal$/i
];

const ALLOWED_PROTOCOLS = ['http:', 'https:'];

export function validateTargetUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'URL malformée.' };
  }

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    return { ok: false, reason: `Protocole non autorisé : ${parsed.protocol}` };
  }

  const host = parsed.hostname;
  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(host)) {
      return { ok: false, reason: `Hôte bloqué (SSRF) : ${host}` };
    }
  }

  if (/^\[?[0-9a-f:.]+\]?$/i.test(host) && /[.:]/.test(host)) {
    const isPrivate =
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^169\.254\./.test(host) ||
      host === '::1' ||
      /^fc00:/i.test(host) ||
      /^fe80:/i.test(host);
    if (isPrivate) {
      return { ok: false, reason: `Adresse privée bloquée : ${host}` };
    }
  }

  return { ok: true, url: parsed };
}

export function safeHref(url) {
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return '#';
    return u.href;
  } catch {
    return '#';
  }
}

// ─── Limites dures ───
export const LIMITS = {
  MAX_PAGES: 200,
  MAX_DEPTH: 3,
  MAX_URLS_FULL: 500,
  MAX_EXTRACT_URLS: 50,
  MAX_CONCURRENCY: 10,
  MAX_TIMEOUT_MS: 60000
};

export function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}