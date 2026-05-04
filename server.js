require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { chat } = require('./src/agent');
const { generateEmailDraft, sendAutoReply } = require('./src/emailHandler');
const { loadKnowledge } = require('./src/knowledge');
const { startScheduledScraping, runScraper } = require('./src/scraper');
const { handleContactRequest, loadInquiries } = require('./src/contactHandler');
const { trainerChat, extractAndSaveKnowledge } = require('./src/trainer');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:5500', // Live Server für lokale Entwicklung
  process.env.ALLOWED_ORIGIN,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Erlaube Anfragen ohne Origin (z.B. direkte API-Aufrufe, Curl)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate-Limiting für Chat-Endpunkt
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 Minute
  max: 10,
  message: { error: 'Zu viele Anfragen. Bitte warte kurz und versuche es erneut.' },
});

// Admin-Authentifizierung
function requireAdmin(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Nicht autorisiert.' });
  }
  next();
}

// ──────────────────────────────────────────────
// API: Chat
// ──────────────────────────────────────────────
app.post('/api/chat', chatLimiter, async (req, res) => {
  const { message, history = [] } = req.body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Keine Nachricht erhalten.' });
  }

  if (message.length > 1000) {
    return res.status(400).json({ error: 'Nachricht zu lang (max. 1000 Zeichen).' });
  }

  try {
    const result = await chat(history, message.trim());
    res.json(result);
  } catch (err) {
    console.error('Chat-Fehler:', err.message);
    res.status(500).json({ error: 'Der Assistent ist gerade nicht erreichbar. Bitte versuche es später erneut.' });
  }
});

// ──────────────────────────────────────────────
// API: E-Mail Draft generieren
// ──────────────────────────────────────────────
app.post('/api/email-reply', requireAdmin, async (req, res) => {
  const { emailText } = req.body;

  if (!emailText || typeof emailText !== 'string' || emailText.trim().length === 0) {
    return res.status(400).json({ error: 'Kein E-Mail-Text erhalten.' });
  }

  try {
    const draft = await generateEmailDraft(emailText.trim());
    res.json({ draft });
  } catch (err) {
    console.error('E-Mail-Fehler:', err.message);
    res.status(500).json({ error: 'Fehler beim Generieren des Entwurfs.' });
  }
});

// ──────────────────────────────────────────────
// API: Kontaktformular (Auto-Reply)
// ──────────────────────────────────────────────
app.post('/api/contact', chatLimiter, async (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, E-Mail und Nachricht sind erforderlich.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Ungültige E-Mail-Adresse.' });
  }

  try {
    const fullMessage = `Von: ${name} <${email}>\n\n${message}`;
    const draft = await sendAutoReply(email, fullMessage);
    res.json({ success: true, message: 'Vielen Dank! Wir haben dir eine Antwort zugeschickt.' });
  } catch (err) {
    console.error('Auto-Reply-Fehler:', err.message);
    // Kein Fehler zurückgeben – Kontaktformular soll immer "erfolgreich" sein
    res.json({ success: true, message: 'Vielen Dank für deine Nachricht! Wir melden uns bald.' });
  }
});

// ──────────────────────────────────────────────
// API: Wissensbasis neu laden (Admin)
// ──────────────────────────────────────────────
app.get('/api/knowledge/reload', requireAdmin, (req, res) => {
  try {
    const knowledge = loadKnowledge();
    const wordCount = knowledge.split(/\s+/).filter(Boolean).length;
    res.json({ success: true, message: `Wissensbasis neu geladen (${wordCount} Wörter).` });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Laden der Wissensbasis.' });
  }
});

// ──────────────────────────────────────────────
// API: Besucher-Kontaktanfrage
// ──────────────────────────────────────────────
app.post('/api/contact-staff', chatLimiter, async (req, res) => {
  const { userEmail, message, context } = req.body;

  if (!userEmail || !message) {
    return res.status(400).json({ error: 'E-Mail und Nachricht sind erforderlich.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(userEmail)) {
    return res.status(400).json({ error: 'Ungültige E-Mail-Adresse.' });
  }

  if (message.length > 2000) {
    return res.status(400).json({ error: 'Nachricht zu lang (max. 2000 Zeichen).' });
  }

  try {
    await handleContactRequest({ userEmail, message, context });
    res.json({ success: true, message: 'Deine Anfrage wurde gesendet. Wir melden uns so schnell wie möglich per E-Mail!' });
  } catch (err) {
    console.error('Kontakt-Fehler:', err.message);
    res.status(500).json({ error: 'Fehler beim Senden der Anfrage.' });
  }
});

// ──────────────────────────────────────────────
// API: Trainings-Modus (Admin)
// ──────────────────────────────────────────────
app.post('/api/train/message', requireAdmin, async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: 'Keine Nachricht.' });
  try {
    const reply = await trainerChat(history, message);
    res.json({ message: reply });
  } catch (err) {
    console.error('Trainer-Fehler:', err.message);
    res.status(500).json({ error: 'Fehler im Trainings-Modus.' });
  }
});

app.post('/api/train/save', requireAdmin, async (req, res) => {
  const { history = [] } = req.body;
  if (history.length < 2) return res.status(400).json({ error: 'Zu wenig Gesprächsinhalt zum Speichern.' });
  try {
    const result = await extractAndSaveKnowledge(history);
    const knowledge = loadKnowledge();
    const wordCount = knowledge.split(/\s+/).filter(Boolean).length;
    res.json({
      success: true,
      filename: result.filename,
      message: `Wissen gespeichert! Wissensbasis hat jetzt ${wordCount} Wörter.`,
      preview: result.content.substring(0, 500),
    });
  } catch (err) {
    console.error('Trainer-Speicher-Fehler:', err.message);
    res.status(500).json({ error: 'Fehler beim Speichern des Wissens.' });
  }
});

// ──────────────────────────────────────────────
// API: Alle Anfragen anzeigen (Admin)
// ──────────────────────────────────────────────
app.get('/api/inquiries', requireAdmin, (req, res) => {
  try {
    const inquiries = loadInquiries();
    res.json({ count: inquiries.length, inquiries });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Laden der Anfragen.' });
  }
});

// ──────────────────────────────────────────────
// API: Website manuell neu scannen (Admin)
// ──────────────────────────────────────────────
app.post('/api/scrape', requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, message: 'Website-Scan gestartet. Dauert ca. 10–20 Sekunden.' });
    await runScraper();
  } catch (err) {
    console.error('Scraper-Fehler:', err.message);
  }
});

// Widget-Dateien aus /public servieren
app.get('/widget.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'widget.js'));
});

// Health-Check für Render.com
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`KWS Bot läuft auf Port ${PORT}`);
  const knowledge = loadKnowledge();
  if (knowledge) {
    const words = knowledge.split(/\s+/).filter(Boolean).length;
    console.log(`Wissensbasis geladen: ${words} Wörter`);
  } else {
    console.log('Wissensbasis ist leer – bitte Dateien in /knowledge/ hinzufügen');
  }

  // Website-Scraper starten (sofort + alle 4 Stunden)
  startScheduledScraping(4);
});
