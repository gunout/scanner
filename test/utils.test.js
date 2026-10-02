// tests/utils.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTargetUrl,
  safeHref,
  clamp,
  getStatusText,
  classifyError,
  analyzeSecurity,
  detectAPIHints,
  summarizeJSON,
  analyzeJSONStructure,
  LIMITS
} from '../utils.js';

// ═══════════════════════════════════════════════════════════
//  validateTargetUrl — SSRF
// ═══════════════════════════════════════════════════════════

test('validateTargetUrl accepte une URL https publique', () => {
  const r = validateTargetUrl('https://www.data.gouv.fr/fr/');
  assert.equal(r.ok, true);
  assert.equal(r.url.hostname, 'www.data.gouv.fr');
});

test('validateTargetUrl accepte une URL http publique', () => {
  const r = validateTargetUrl('http://example.com');
  assert.equal(r.ok, true);
});

test('validateTargetUrl rejette localhost', () => {
  const r = validateTargetUrl('http://localhost:3000');
  assert.equal(r.ok, false);
  assert.match(r.reason, /SSRF|bloqué/i);
});

test('validateTargetUrl rejette 127.0.0.1', () => {
  const r = validateTargetUrl('http://127.0.0.1/admin');
  assert.equal(r.ok, false);
});

test('validateTargetUrl rejette 169.254.169.254 (metadata AWS)', () => {
  const r = validateTargetUrl('http://169.254.169.254/latest/meta-data/');
  assert.equal(r.ok, false);
});

test('validateTargetUrl rejette 10.x.x.x', () => {
  assert.equal(validateTargetUrl('http://10.0.0.1').ok, false);
  assert.equal(validateTargetUrl('http://10.255.255.255').ok, false);
});

test('validateTargetUrl rejette 192.168.x.x', () => {
  assert.equal(validateTargetUrl('http://192.168.1.1').ok, false);
});

test('validateTargetUrl rejette 172.16.x.x à 172.31.x.x', () => {
  assert.equal(validateTargetUrl('http://172.16.0.1').ok, false);
  assert.equal(validateTargetUrl('http://172.31.255.255').ok, false);
});

test('validateTargetUrl accepte 172.32.x.x (hors plage privée)', () => {
  // 172.32 n'est PAS dans la plage privée 172.16–172.31
  const r = validateTargetUrl('http://172.32.0.1');
  assert.equal(r.ok, true);
});

test('validateTargetUrl rejette .local', () => {
  assert.equal(validateTargetUrl('http://serveur.local').ok, false);
});

test('validateTargetUrl rejette .internal', () => {
  assert.equal(validateTargetUrl('http://api.internal').ok, false);
});

test('validateTargetUrl rejette les protocoles non http(s)', () => {
  assert.equal(validateTargetUrl('ftp://example.com').ok, false);
  assert.equal(validateTargetUrl('file:///etc/passwd').ok, false);
  assert.equal(validateTargetUrl('javascript:alert(1)').ok, false);
  assert.equal(validateTargetUrl('data:text/html,<script>').ok, false);
});

test('validateTargetUrl rejette une URL malformée', () => {
  assert.equal(validateTargetUrl('pas une url').ok, false);
  assert.equal(validateTargetUrl('').ok, false);
  assert.equal(validateTargetUrl(null).ok, false);
});

// ═══════════════════════════════════════════════════════════
//  safeHref
// ═══════════════════════════════════════════════════════════

test('safeHref retourne l\'URL pour http(s)', () => {
  assert.equal(safeHref('https://example.com'), 'https://example.com/');
  assert.equal(safeHref('http://example.com'), 'http://example.com/');
});

test('safeHref retourne # pour javascript:', () => {
  assert.equal(safeHref('javascript:alert(1)'), '#');
});

test('safeHref retourne # pour data:', () => {
  assert.equal(safeHref('data:text/html,<script>'), '#');
});

test('safeHref retourne # pour une URL invalide', () => {
  assert.equal(safeHref('pas une url'), '#');
  assert.equal(safeHref(''), '#');
});

// ═══════════════════════════════════════════════════════════
//  clamp
// ═══════════════════════════════════════════════════════════

test('clamp borne les valeurs', () => {
  assert.equal(clamp(5, 1, 10), 5);
  assert.equal(clamp(0, 1, 10), 1);
  assert.equal(clamp(20, 1, 10), 10);
  assert.equal(clamp(-5, 0, 100), 0);
});

test('clamp gère les valeurs non numériques', () => {
  assert.equal(clamp('abc', 1, 10), 1);
  assert.equal(clamp(null, 1, 10), 1);
  assert.equal(clamp(undefined, 1, 10), 1);
  assert.equal(clamp(NaN, 1, 10), 1);
});

test('clamp convertit les chaînes numériques', () => {
  assert.equal(clamp('5', 1, 10), 5);
  assert.equal(clamp('15', 1, 10), 10);
});

// ═══════════════════════════════════════════════════════════
//  getStatusText
// ═══════════════════════════════════════════════════════════

test('getStatusText retourne les libellés connus', () => {
  assert.equal(getStatusText(200), 'OK');
  assert.equal(getStatusText(404), 'Not Found');
  assert.equal(getStatusText(500), 'Internal Server Error');
});

test('getStatusText retourne une chaîne vide pour inconnu', () => {
  assert.equal(getStatusText(999), '');
});

// ═══════════════════════════════════════════════════════════
//  classifyError
// ═══════════════════════════════════════════════════════════

test('classifyError identifie les types d\'erreurs', () => {
  assert.equal(classifyError({ code: 'CERT_HAS_EXPIRED' }), 'TLS_CERTIFICATE');
  assert.equal(classifyError({ code: 'UND_ERR_ABORTED' }), 'TIMEOUT');
  assert.equal(classifyError({ code: 'ENOTFOUND' }), 'DNS_NOT_FOUND');
  assert.equal(classifyError({ code: 'ECONNREFUSED' }), 'CONNECTION_REFUSED');
  assert.equal(classifyError({ code: 'ECONNRESET' }), 'CONNECTION_RESET');
  assert.equal(classifyError({ code: 'AUTRE' }), 'UNKNOWN');
});

// ═══════════════════════════════════════════════════════════
//  analyzeSecurity
// ═══════════════════════════════════════════════════════════

test('analyzeSecurity détecte HSTS et CSP', () => {
  const r = analyzeSecurity({
    'strict-transport-security': 'max-age=31536000',
    'content-security-policy': "default-src 'self'"
  }, 200);
  assert.equal(r.hsts, true);
  assert.equal(r.csp, true);
  assert.equal(r.needsAuth, false);
});

test('analyzeSecurity détecte 401 et 403', () => {
  assert.equal(analyzeSecurity({}, 401).needsAuth, true);
  assert.equal(analyzeSecurity({}, 403).forbidden, true);
});

// ═══════════════════════════════════════════════════════════
//  detectAPIHints
// ═══════════════════════════════════════════════════════════

test('detectAPIHints détecte la pagination', () => {
  const r = detectAPIHints({ total: 100, page: 1, data: [] }, {});
  assert.equal(r.hasPagination, true);
  assert.equal(r.dataField, 'data');
});

test('detectAPIHints détecte HATEOAS', () => {
  const r = detectAPIHints({ _links: { self: {} } }, {});
  assert.equal(r.hasHATEOAS, true);
});

test('detectAPIHints retourne des valeurs par défaut', () => {
  const r = detectAPIHints(null, {});
  assert.equal(r.hasPagination, false);
  assert.equal(r.hasHATEOAS, false);
});

// ═══════════════════════════════════════════════════════════
//  summarizeJSON
// ═══════════════════════════════════════════════════════════

test('summarizeJSON résume un objet', () => {
  const r = summarizeJSON({ a: 1, b: 2 });
  assert.equal(r.type, 'object');
  assert.equal(r.length, 2);
  assert.deepEqual(r.keys, ['a', 'b']);
});

test('summarizeJSON résume un tableau', () => {
  const r = summarizeJSON([1, 2, 3]);
  assert.equal(r.type, 'array');
  assert.equal(r.length, 3);
  assert.equal(r.keys, null);
});

// ═══════════════════════════════════════════════════════════
//  analyzeJSONStructure
// ═══════════════════════════════════════════════════════════

test('analyzeJSONStructure analyse un objet imbriqué', () => {
  const r = analyzeJSONStructure({ user: { name: 'Alice', age: 30 } });
  assert.equal(r.user.name, 'string');
  assert.equal(r.user.age, 'number');
});

test('analyzeJSONStructure limite la profondeur', () => {
  const deep = { a: { b: { c: { d: { e: 'trop profond' } } } } };
  const r = analyzeJSONStructure(deep, 0, 2);
  assert.equal(r.a.b, '...');
});

// ═══════════════════════════════════════════════════════════
//  LIMITS
// ═══════════════════════════════════════════════════════════

test('LIMITS contient les bornes attendues', () => {
  assert.equal(LIMITS.MAX_PAGES, 200);
  assert.equal(LIMITS.MAX_DEPTH, 3);
  assert.equal(LIMITS.MAX_URLS_FULL, 500);
  assert.equal(LIMITS.MAX_CONCURRENCY, 10);
});