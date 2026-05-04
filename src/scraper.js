const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://www.kletterwelt-sauerland.de';
const OUTPUT_FILE = path.join(__dirname, '../knowledge/website-live.md');

// Basis-Seiten die immer gescannt werden
const PAGES_TO_SCRAPE = [
  '/',
  '/aktuelles',
  '/news',
  '/events',
  '/wettkampf',
  '/termine',
  '/veranstaltungen',
  '/angebote',
];

// Max. Anzahl Artikel-Links die von /aktuelles etc. verfolgt werden
const MAX_ARTICLE_LINKS = 15;

// HTML-Tags deren Inhalt komplett ignoriert wird
const IGNORE_TAGS = ['script', 'style', 'nav', 'footer', 'head', 'iframe', 'noscript', 'svg', 'button'];

function cleanText(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Holt eine Seite und gibt HTML + $ zurück
async function fetchPage(url) {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KWSBot/1.0; +https://kletterwelt-sauerland.de)',
        'Accept-Language': 'de-DE,de;q=0.9',
      },
    });
    return cheerio.load(response.data);
  } catch {
    return null;
  }
}

// Extrahiert Links zu Artikeln/Unterseiten die zur selben Domain gehören
// Priorisiert WordPress-Artikel-URLs mit Datum im Pfad
function extractArticleLinks($, baseUrl) {
  const links = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    let fullUrl;
    if (href.startsWith('http')) {
      fullUrl = href;
    } else if (href.startsWith('/')) {
      fullUrl = BASE_URL + href;
    } else {
      return;
    }

    // Nur Links zur selben Domain, keine Anker, keine externen Links
    if (
      fullUrl.startsWith(BASE_URL) &&
      !fullUrl.includes('#') &&
      !fullUrl.match(/\.(pdf|jpg|jpeg|png|gif|zip|mp4|svg)$/i) &&
      fullUrl !== BASE_URL &&
      fullUrl !== BASE_URL + '/'
    ) {
      links.add(fullUrl);
    }
  });

  // WordPress-Artikel-Links (mit Datum im Pfad) nach vorne sortieren
  return [...links].sort((a, b) => {
    const aHasDate = /\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/?$/.test(a);
    const bHasDate = /\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/?$/.test(b);
    if (aHasDate && !bHasDate) return -1;
    if (!aHasDate && bHasDate) return 1;
    return 0;
  });
}

// Extrahiert Textinhalte aus einer geladenen Cheerio-Instanz
function extractSections($) {
  IGNORE_TAGS.forEach(tag => $(tag).remove());
  $('[style*="display:none"], [style*="display: none"], [hidden]').remove();

  const sections = [];
  const mainSelectors = ['main', 'article', '#content', '.content', '.entry-content', '.post-content', '.main', '#main', '.container', 'body'];

  let $main = null;
  for (const sel of mainSelectors) {
    if ($(sel).length) {
      $main = $(sel).first();
      break;
    }
  }
  if (!$main) $main = $('body');

  const seen = new Set();

  $main.find('h1, h2, h3, h4, p, li, .text, .description, .content-text').each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    const text = cleanText($(el).text());

    if (!text || text.length < 10) return;
    if (text.length < 20 && !['h1','h2','h3'].includes(tag)) return;
    if (seen.has(text)) return;
    seen.add(text);

    if (['h1','h2','h3','h4'].includes(tag)) {
      sections.push({ type: 'heading', level: tag, text });
    } else {
      sections.push({ type: 'text', text });
    }
  });

  return sections;
}

function sectionsToMarkdown(sections) {
  if (!sections || sections.length === 0) return '';
  const lines = [];
  let lastLine = '';

  sections.forEach(s => {
    if (s.type === 'heading') {
      const prefix = s.level === 'h1' ? '##' : s.level === 'h2' ? '###' : '####';
      const line = `${prefix} ${s.text}`;
      if (line !== lastLine) { lines.push(line); lastLine = line; }
    } else {
      if (s.text !== lastLine) { lines.push(s.text); lastLine = s.text; }
    }
  });

  return lines.join('\n').trim();
}

// Extrahiert Veröffentlichungsdatum aus WordPress-URLs wie /2026/03/30/slug/
function extractDateFromUrl(url) {
  const match = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
  if (!match) return null;
  const [, year, month, day] = match;
  const months = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  return {
    date: new Date(`${year}-${month}-${day}`),
    label: `${parseInt(day)}. ${months[parseInt(month)-1]} ${year}`,
  };
}

async function runScraper() {
  console.log('[Scraper] Starte Website-Scan:', BASE_URL);

  const timestamp = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  const results = [];
  const visitedUrls = new Set();

  // 1. Basis-Seiten scannen + Artikel-Links sammeln
  const articleLinks = new Set();

  for (const pagePath of PAGES_TO_SCRAPE) {
    const url = BASE_URL + pagePath;
    if (visitedUrls.has(url)) continue;
    visitedUrls.add(url);

    const $ = await fetchPage(url);
    if (!$) {
      console.log(`[Scraper] – ${url} (nicht erreichbar)`);
      continue;
    }

    // Artikel-Links von dieser Seite sammeln
    const links = extractArticleLinks($, url);
    links.forEach(l => articleLinks.add(l));

    // Inhalt der Seite selbst extrahieren
    const sections = extractSections($);
    const md = sectionsToMarkdown(sections);
    if (md.length > 50) {
      results.push({ label: pagePath === '/' ? 'Startseite' : pagePath, content: md });
      console.log(`[Scraper] ✓ ${url} (${sections.length} Abschnitte)`);
    } else {
      console.log(`[Scraper] – ${url} (kein Inhalt)`);
    }
  }

  // 2. Artikel-Unterseiten folgen (die noch nicht besucht wurden)
  let articleCount = 0;
  for (const articleUrl of articleLinks) {
    if (visitedUrls.has(articleUrl)) continue;
    if (articleCount >= MAX_ARTICLE_LINKS) break;
    visitedUrls.add(articleUrl);
    articleCount++;

    const $ = await fetchPage(articleUrl);
    if (!$) continue;

    const sections = extractSections($);
    const md = sectionsToMarkdown(sections);
    if (md.length > 100) {
      const urlPath = articleUrl.replace(BASE_URL, '');
      const dateInfo = extractDateFromUrl(urlPath);
      const now = new Date();

      let dateNote = '';
      if (dateInfo) {
        const isPast = dateInfo.date < now;
        dateNote = isPast
          ? `> ⚠️ Artikel vom ${dateInfo.label} – dieser Beitrag ist bereits veröffentlicht worden und beschreibt möglicherweise vergangene Events.\n\n`
          : `> 📅 Artikel vom ${dateInfo.label} – dieser Beitrag ist aktuell.\n\n`;
      }

      results.push({ label: urlPath, content: dateNote + md });
      console.log(`[Scraper] ✓ ${articleUrl} (Artikel${dateInfo ? ', ' + dateInfo.label : ''}, ${sections.length} Abschnitte)`);
    }
  }

  // 3. Ausgabe schreiben
  if (results.length === 0) {
    const errorContent = `# Aktuelle Website-Inhalte (Kletterwelt Sauerland)\n\n_Zuletzt gescannt: ${timestamp}_\n\n> Scan konnte keine Inhalte abrufen. Bitte direkt auf www.kletterwelt-sauerland.de nachschauen oder anrufen: 0 23 51 / 879 911 2\n`;
    fs.writeFileSync(OUTPUT_FILE, errorContent, 'utf8');
    console.log('[Scraper] Keine Inhalte – Fallback geschrieben.');
    return;
  }

  let output = `# Aktuelle Website-Inhalte (Kletterwelt Sauerland)\n\n`;
  output += `_Automatisch gescannt am ${timestamp} – Quelle: www.kletterwelt-sauerland.de_\n\n`;
  output += `> Enthält aktuelle Events, Wettkämpfe, Ankündigungen und Artikel direkt von der Website.\n\n`;

  for (const r of results) {
    output += `---\n\n## ${r.label}\n\n${r.content}\n\n`;
  }

  fs.writeFileSync(OUTPUT_FILE, output, 'utf8');
  const wordCount = output.split(/\s+/).filter(Boolean).length;
  console.log(`[Scraper] ✅ website-live.md aktualisiert (${wordCount} Wörter, ${results.length} Seiten/Artikel)`);
}

// Automatisches Intervall: alle 4 Stunden neu scannen
function startScheduledScraping(intervalHours = 4) {
  runScraper().catch(err => console.error('[Scraper] Fehler:', err.message));

  const intervalMs = intervalHours * 60 * 60 * 1000;
  setInterval(() => {
    runScraper().catch(err => console.error('[Scraper] Fehler:', err.message));
  }, intervalMs);

  console.log(`[Scraper] Läuft alle ${intervalHours} Stunden automatisch.`);
}

module.exports = { runScraper, startScheduledScraping };
