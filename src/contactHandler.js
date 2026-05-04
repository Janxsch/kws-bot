const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const DATA_DIR = path.join(__dirname, '../data');
const INQUIRIES_FILE = path.join(DATA_DIR, 'inquiries.json');

// Sicherstellen dass das data/ Verzeichnis existiert
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadInquiries() {
  try {
    if (fs.existsSync(INQUIRIES_FILE)) {
      return JSON.parse(fs.readFileSync(INQUIRIES_FILE, 'utf8'));
    }
  } catch {}
  return [];
}

function saveInquiry(entry) {
  const inquiries = loadInquiries();
  inquiries.push(entry);
  fs.writeFileSync(INQUIRIES_FILE, JSON.stringify(inquiries, null, 2), 'utf8');
}

async function sendStaffNotification(entry) {
  // SMTP nur senden wenn konfiguriert
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log('[Kontakt] SMTP nicht konfiguriert – nur gespeichert.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const staffEmail = process.env.SMTP_TO || 'info@kletterwelt-sauerland.de';

  await transporter.sendMail({
    from: `"KWS Bot" <${process.env.SMTP_USER}>`,
    to: staffEmail,
    replyTo: entry.userEmail,
    subject: `📬 Neue Besucheranfrage über den Chat-Bot`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px;">
        <div style="background: #2a7d3f; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h2 style="margin:0">📬 Neue Anfrage über den KWS Chat-Bot</h2>
        </div>
        <div style="background: #f9f9f9; padding: 20px; border: 1px solid #e0e0e0; border-radius: 0 0 8px 8px;">
          <p><strong>Von:</strong> <a href="mailto:${entry.userEmail}">${entry.userEmail}</a></p>
          <p><strong>Eingang:</strong> ${new Date(entry.timestamp).toLocaleString('de-DE')}</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 16px 0;">
          <p><strong>Nachricht:</strong></p>
          <blockquote style="background: white; border-left: 4px solid #2a7d3f; padding: 12px 16px; margin: 0; border-radius: 0 4px 4px 0;">
            ${entry.message.replace(/\n/g, '<br>')}
          </blockquote>
          ${entry.context ? `
          <hr style="border: none; border-top: 1px solid #ddd; margin: 16px 0;">
          <p style="color: #888; font-size: 13px;"><strong>Letzter Bot-Kontext:</strong><br>${entry.context.replace(/\n/g, '<br>')}</p>
          ` : ''}
          <hr style="border: none; border-top: 1px solid #ddd; margin: 16px 0;">
          <p style="color: #888; font-size: 12px;">
            Einfach auf diese E-Mail antworten – die Antwort geht direkt an ${entry.userEmail}.
          </p>
        </div>
      </div>
    `,
  });

  console.log(`[Kontakt] E-Mail an ${staffEmail} gesendet (von: ${entry.userEmail})`);
}

async function handleContactRequest({ userEmail, message, context }) {
  const entry = {
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    userEmail,
    message,
    context: context || null,
    status: 'neu',
  };

  // Speichern
  saveInquiry(entry);
  console.log(`[Kontakt] Anfrage gespeichert: ${userEmail}`);

  // E-Mail senden (falls SMTP konfiguriert)
  try {
    await sendStaffNotification(entry);
  } catch (err) {
    console.error('[Kontakt] E-Mail-Fehler:', err.message);
    // Kein throw – Speichern war erfolgreich, E-Mail ist optional
  }

  return entry;
}

module.exports = { handleContactRequest, loadInquiries };
