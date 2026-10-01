import * as cheerio from 'cheerio';
import { request } from 'undici';
import ExcelJS from 'exceljs';
import { parse as csvParse } from 'csv-parse/sync';

// ═══════════════════════════════════════════════════════════
//  TÉLÉCHARGEMENT
// ═══════════════════════════════════════════════════════════

export async function downloadFile(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await request(url, {
      method: 'GET',
      maxRedirections: 5,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'fr-FR,fr;q=0.9'
      },
      signal: controller.signal
    });

    if (res.statusCode >= 400) {
      throw new Error(`HTTP ${res.statusCode}`);
    }

    const buffer = Buffer.from(await res.body.arrayBuffer());
    return {
      buffer,
      contentType: res.headers['content-type'] || '',
      size: buffer.length,
      status: res.statusCode
    };
  } finally {
    clearTimeout(timer);
  }
}

// ═══════════════════════════════════════════════════════════
//  EXTRACTEUR PDF — avec pdfjs-dist (pas pdf-parse)
// ═══════════════════════════════════════════════════════════

export async function extractPDF(url) {
  try {
    const { buffer, size } = await downloadFile(url, 60000);

    // Import dynamique pour éviter les bugs au chargement
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const uint8Array = new Uint8Array(buffer);

    const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
    const pdf = await loadingTask.promise;

    let fullText = '';
    const maxPages = Math.min(pdf.numPages, 20);

    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += pageText + '\n';
    }

    const metadata = await pdf.getMetadata().catch(() => ({}));

    return {
      success: true,
      url,
      size,
      pages: pdf.numPages,
      info: {
        Title: metadata?.info?.Title || null,
        Author: metadata?.info?.Author || null,
        Subject: metadata?.info?.Subject || null,
        Creator: metadata?.info?.Creator || null
      },
      text: fullText.substring(0, 5000),
      textLength: fullText.length,
      urlsInText: extractUrlsFromText(fullText),
      emails: extractEmails(fullText)
    };
  } catch (err) {
    return { success: false, url, error: err.message };
  }
}

function extractUrlsFromText(text) {
  const regex = /https?:\/\/[^\s<>"']+/gi;
  const matches = text.match(regex) || [];
  return [...new Set(matches)].slice(0, 50);
}

function extractEmails(text) {
  const regex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(regex) || [];
  return [...new Set(matches)].slice(0, 20);
}

// ═══════════════════════════════════════════════════════════
//  EXTRACTEUR JSON
// ═══════════════════════════════════════════════════════════

export async function extractJSON(url) {
  try {
    const { buffer, size } = await downloadFile(url, 30000);
    const text = buffer.toString('utf-8');
    const data = JSON.parse(text);

    return {
      success: true,
      url,
      size,
      keys: Object.keys(data).slice(0, 50),
      isArray: Array.isArray(data),
      arrayLength: Array.isArray(data) ? data.length : null,
      sample: JSON.stringify(
        Array.isArray(data) ? data.slice(0, 3) : data,
        null, 2
      ).substring(0, 3000),
      urlsFound: extractUrlsFromJSON(data)
    };
  } catch (err) {
    return { success: false, url, error: err.message };
  }
}

function extractUrlsFromJSON(obj, depth = 0) {
  if (depth > 4 || !obj) return [];
  const urls = [];

  if (typeof obj === 'string') {
    if (/^https?:\/\//i.test(obj)) urls.push(obj);
  } else if (Array.isArray(obj)) {
    obj.slice(0, 50).forEach(item => urls.push(...extractUrlsFromJSON(item, depth + 1)));
  } else if (typeof obj === 'object') {
    Object.values(obj).forEach(v => urls.push(...extractUrlsFromJSON(v, depth + 1)));
  }

  return [...new Set(urls)].slice(0, 100);
}

// ═══════════════════════════════════════════════════════════
//  EXTRACTEUR CSV
// ═══════════════════════════════════════════════════════════

export async function extractCSV(url) {
  try {
    const { buffer, size } = await downloadFile(url, 30000);
    const text = buffer.toString('utf-8');
    const firstLine = text.split('\n')[0];
    const separator = firstLine.includes(';') ? ';'
                     : firstLine.includes('\t') ? '\t'
                     : ',';

    const records = csvParse(text, {
      columns: true,
      skip_empty_lines: true,
      delimiter: separator,
      relax_quotes: true,
      relax_column_count: true
    });

    return {
      success: true,
      url,
      size,
      separator,
      columns: records.length > 0 ? Object.keys(records[0]) : [],
      rowCount: records.length,
      sample: records.slice(0, 5),
      preview: text.substring(0, 1000)
    };
  } catch (err) {
    return { success: false, url, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════
//  EXTRACTEUR XLSX / XLS
// ═══════════════════════════════════════════════════════════

export async function extractXLSX(url) {
  try {
    const { buffer, size } = await downloadFile(url, 45000);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const sheets = workbook.worksheets.map(sheet => {
      const rows = [];
      let rowCount = 0;

      sheet.eachRow((row, rowNumber) => {
        rowCount = rowNumber;
        if (rowNumber <= 5) {
          const values = row.values.slice(1).map(v => {
            if (v === null || v === undefined) return '';
            if (typeof v === 'object' && v.text) return v.text;
            if (typeof v === 'object' && v.result !== undefined) return v.result;
            return v;
          });
          rows.push(values);
        }
      });

      return {
        name: sheet.name,
        rows: rowCount,
        columns: sheet.columnCount,
        sample: rows
      };
    });

    return {
      success: true,
      url,
      size,
      sheetCount: workbook.worksheets.length,
      sheetNames: workbook.worksheets.map(s => s.name),
      sheets
    };
  } catch (err) {
    return { success: false, url, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════
//  DÉTECTION D'ENDPOINTS DANS LE HTML/JS
// ═══════════════════════════════════════════════════════════

export function detectApiEndpoints(html, baseUrl) {
  const endpoints = new Set();
  const $ = cheerio.load(html);

  $('script').each((_, el) => {
    const content = $(el).html() || '';
    const patterns = [
      /fetch\s*\(\s*["'`]([^"'`]+)["'`]/g,
      /axios\s*\.\s*(?:get|post|put|delete|patch)\s*\(\s*["'`]([^"'`]+)["'`]/g,
      /\$\.(?:get|post|ajax)\s*\(\s*["'`]([^"'`]+)["'`]/g,
      /["'`](https?:\/\/[^"'`\s<>]+)["'`]/g,
      /["'`](\/(?:api|v\d+|rest|graphql|json|data)[^"'`\s<>]*)["'`]/g
    ];

    patterns.forEach(rx => {
      let m;
      while ((m = rx.exec(content)) !== null) endpoints.add(m[1]);
    });
  });

  $('[data-api], [data-url], [data-endpoint], [data-src]').each((_, el) => {
    ['data-api', 'data-url', 'data-endpoint', 'data-src'].forEach(a => {
      const v = $(el).attr(a);
      if (v && /^https?:\/\/|^\//.test(v)) endpoints.add(v);
    });
  });

  $('link[href*="/api"], link[type="application/json"]').each((_, el) => {
    endpoints.add($(el).attr('href'));
  });

  const resolved = [];
  for (const ep of endpoints) {
    try {
      const absolute = new URL(ep, baseUrl).href;
      if (/\.(png|jpe?g|gif|svg|woff2?|ttf|eot|css)$/i.test(absolute)) continue;
      if (/google-analytics|googletagmanager|doubleclick|facebook|hotjar/i.test(absolute)) continue;
      resolved.push(absolute);
    } catch {}
  }

  return [...new Set(resolved)].slice(0, 30);
}

// ═══════════════════════════════════════════════════════════
//  EXTRACTION NEXT/NUXT DATA
// ═══════════════════════════════════════════════════════════

export function extractNextData(html) {
  const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextMatch) {
    try {
      const data = JSON.parse(nextMatch[1]);
      return {
        framework: 'Next.js',
        props: data.props,
        page: data.page,
        query: data.query,
        buildId: data.buildId
      };
    } catch {}
  }

  const nuxtMatch = html.match(/window\.__NUXT__\s*=\s*({[\s\S]*?})\s*(?:<\/script>|;\s*\n)/);
  if (nuxtMatch) {
    try {
      const cleaned = nuxtMatch[1].trim();
      return {
        framework: 'Nuxt',
        rawLength: cleaned.length,
        preview: cleaned.substring(0, 500)
      };
    } catch {}
  }

  return null;
}

// ═══════════════════════════════════════════════════════════
//  PROBE API
// ═══════════════════════════════════════════════════════════

export async function probeApiEndpoint(url, options = {}) {
  const { method = 'GET', headers = {}, body = null, timeoutMs = 15000 } = options;

  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchOptions = {
      method,
      headers: {
        'User-Agent': 'Scanner-Pro/4.0 (API Probe)',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        ...headers
      },
      signal: controller.signal
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      if (!fetchOptions.headers['Content-Type']) {
        fetchOptions.headers['Content-Type'] = 'application/json';
      }
    }

    const res = await request(url, fetchOptions);
    const rawBody = await res.body.arrayBuffer();
    const text = new TextDecoder('utf-8').decode(rawBody);

    const contentType = res.headers['content-type'] || '';
    let parsed = null;

    if (contentType.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
      try { parsed = JSON.parse(text); } catch {}
    }

    return {
      success: true,
      url,
      method,
      status: res.statusCode,
      statusText: getStatusText(res.statusCode),
      durationMs: Date.now() - start,
      headers: sanitizeHeaders(res.headers),
      contentType,
      size: rawBody.byteLength,
      preview: text.substring(0, 3000),
      isJSON: !!parsed,
      json: parsed ? summarizeJSON(parsed) : null,
      security: analyzeSecurity(res.headers, res.statusCode),
      apiHints: detectAPIHints(parsed, res.headers)
    };
  } catch (err) {
    return {
      success: false,
      url,
      method,
      error: err.code || err.message,
      errorType: classifyError(err),
      durationMs: Date.now() - start,
      hint: getErrorHint(err)
    };
  } finally {
    clearTimeout(timer);
  }
}

// ═══════════════════════════════════════════════════════════
//  SITEMAP.XML
// ═══════════════════════════════════════════════════════════

export async function fetchSitemap(baseUrl, options = {}) {
  const {
    maxSitemaps = 10,
    maxUrlsPerSitemap = 5000,
    timeoutMs = 20000,
    includeSubSitemaps = true
  } = options;

  const base = new URL(baseUrl);
  const origin = `${base.protocol}//${base.host}`;

  const candidates = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
    `${origin}/sitemap/sitemap.xml`,
    `${origin}/robots.txt`
  ];

  let sitemapUrl = null;
  let sitemapContent = null;

  for (const candidate of candidates) {
    try {
      const { buffer, contentType } = await downloadFile(candidate, timeoutMs);
      const text = buffer.toString('utf-8');

      if (candidate.endsWith('robots.txt')) {
        const match = text.match(/^Sitemap:\s*(\S+)/im);
        if (match) {
          const smUrl = match[1].trim();
          const { buffer: smBuffer } = await downloadFile(smUrl, timeoutMs);
          sitemapUrl = smUrl;
          sitemapContent = smBuffer.toString('utf-8');
          break;
        }
      } else {
        if (text.includes('<urlset') || text.includes('<sitemapindex') || contentType.includes('xml')) {
          sitemapUrl = candidate;
          sitemapContent = text;
          break;
        }
      }
    } catch {
      // Continue
    }
  }

  if (!sitemapUrl || !sitemapContent) {
    return {
      success: false,
      error: 'Aucun sitemap.xml trouvé',
      tried: candidates
    };
  }

  const parsed = parseSitemap(sitemapContent);

  if (parsed.type === 'index' && includeSubSitemaps) {
    const subSitemaps = parsed.sitemaps.slice(0, maxSitemaps);
    const allUrls = [];

    for (const subUrl of subSitemaps) {
      try {
        const { buffer } = await downloadFile(subUrl, timeoutMs);
        const subContent = buffer.toString('utf-8');
        const subParsed = parseSitemap(subContent);
        if (subParsed.urls) {
          allUrls.push(...subParsed.urls.slice(0, maxUrlsPerSitemap));
        }
      } catch (err) {
        console.warn(`⚠ Sous-sitemap ${subUrl} inaccessible: ${err.message}`);
      }
    }

    return {
      success: true,
      sitemapUrl,
      type: 'index',
      subSitemapsCount: parsed.sitemaps.length,
      subSitemapsUsed: subSitemaps.length,
      totalUrls: allUrls.length,
      urls: allUrls
    };
  }

  return {
    success: true,
    sitemapUrl,
    type: parsed.type,
    totalUrls: parsed.urls ? parsed.urls.length : 0,
    urls: parsed.urls || []
  };
}

function parseSitemap(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });

  if ($('sitemapindex').length > 0) {
    const sitemaps = [];
    $('sitemap > loc').each((_, el) => {
      const loc = $(el).text().trim();
      if (loc) sitemaps.push(loc);
    });
    return { type: 'index', sitemaps };
  }

  const urls = [];
  $('url').each((_, el) => {
    const loc = $(el).find('loc').first().text().trim();
    const lastmod = $(el).find('lastmod').first().text().trim();
    const changefreq = $(el).find('changefreq').first().text().trim();
    const priority = $(el).find('priority').first().text().trim();

    if (loc) {
      urls.push({
        url: loc,
        lastmod: lastmod || null,
        changefreq: changefreq || null,
        priority: priority ? parseFloat(priority) : null
      });
    }
  });

  return { type: 'urlset', urls };
}

export async function fetchRSS(baseUrl) {
  const base = new URL(baseUrl);
  const origin = `${base.protocol}//${base.host}`;

  const candidates = [
    `${origin}/feed`,
    `${origin}/feed.xml`,
    `${origin}/rss`,
    `${origin}/rss.xml`,
    `${origin}/atom.xml`,
    `${origin}/index.xml`
  ];

  for (const candidate of candidates) {
    try {
      const { buffer, contentType } = await downloadFile(candidate, 10000);
      if (!contentType.includes('xml') && !contentType.includes('rss')) continue;

      const text = buffer.toString('utf-8');
      const $ = cheerio.load(text, { xmlMode: true });
      const urls = [];

      $('item > link, entry > link').each((_, el) => {
        const loc = $(el).text().trim() || $(el).attr('href');
        if (loc) urls.push({ url: loc, source: 'rss' });
      });

      if (urls.length > 0) {
        return { success: true, feedUrl: candidate, urls };
      }
    } catch {}
  }

  return { success: false, error: 'Aucun flux RSS/Atom trouvé' };
}

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════

function getStatusText(code) {
  const map = {
    200: 'OK', 201: 'Created', 204: 'No Content',
    301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
    404: 'Not Found', 405: 'Method Not Allowed', 429: 'Too Many Requests',
    500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable'
  };
  return map[code] || '';
}

function sanitizeHeaders(headers) {
  const safe = {};
  const blocked = ['set-cookie', 'cookie', 'authorization'];
  Object.entries(headers).forEach(([k, v]) => {
    if (!blocked.includes(k.toLowerCase())) safe[k] = v;
  });
  return safe;
}

function summarizeJSON(obj) {
  const json = JSON.stringify(obj, null, 2);
  return {
    type: Array.isArray(obj) ? 'array' : typeof obj,
    length: Array.isArray(obj) ? obj.length : Object.keys(obj).length,
    keys: Array.isArray(obj) ? null : Object.keys(obj).slice(0, 30),
    sample: json.substring(0, 2500)
  };
}

function analyzeSecurity(headers, status) {
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

function detectAPIHints(parsed, headers) {
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

function classifyError(err) {
  const code = err.code || '';
  if (code.includes('CERT') || code.includes('SSL')) return 'TLS_CERTIFICATE';
  if (code.includes('TIMEOUT') || code.includes('ABORT')) return 'TIMEOUT';
  if (code.includes('ENOTFOUND')) return 'DNS_NOT_FOUND';
  if (code.includes('ECONNREFUSED')) return 'CONNECTION_REFUSED';
  if (code.includes('ECONNRESET')) return 'CONNECTION_RESET';
  return 'UNKNOWN';
}

function getErrorHint(err) {
  const type = classifyError(err);
  return {
    TLS_CERTIFICATE: 'Certificat auto-signé ou invalide. Essaie avec insecure: true (dev uniquement).',
    TIMEOUT: 'Le serveur ne répond pas dans les temps.',
    DNS_NOT_FOUND: 'Le nom de domaine ne résout pas. Vérifie /etc/hosts ou VPN.',
    CONNECTION_REFUSED: 'Le port est fermé ou le service down.',
    CONNECTION_RESET: 'La connexion a été coupée.',
    UNKNOWN: 'Erreur inconnue.'
  }[type] || 'Regarde le message d\'erreur complet.';
}