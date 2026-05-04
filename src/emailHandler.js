const { GoogleGenerativeAI } = require('@google/generative-ai');
const { loadKnowledge } = require('./knowledge');
const nodemailer = require('nodemailer');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateEmailDraft(incomingEmail) {
  const knowledge = loadKnowledge();

  const prompt = `Du bist der E-Mail-Assistent der Kletterwelt Sauerland.
Erstelle eine professionelle, freundliche Antwort auf die folgende eingehende E-Mail.

REGELN:
- Antworte NUR basierend auf der Wissensbasis unten
- Wenn du etwas nicht beantworten kannst, schreibe: "Zu Ihrer Frage werden wir uns intern abstimmen und uns in Kürze bei Ihnen melden."
- Verwende "Sie" (formell)
- Unterschreibe mit: "Mit freundlichen Grüßen,\nDas Team der Kletterwelt Sauerland"
- Kein Subject in der Antwort, nur der E-Mail-Text

## WISSENSBASIS:
${knowledge || 'Keine Informationen hinterlegt. Verweise auf Rückmeldung des Teams.'}

## EINGEHENDE E-MAIL:
${incomingEmail}

## ANTWORT-ENTWURF:`;

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendAutoReply(toEmail, originalMessage) {
  const draft = await generateEmailDraft(originalMessage);

  const transporter = createTransporter();
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: toEmail,
    subject: 'Danke für deine Nachricht – Kletterwelt Sauerland',
    text: draft,
  });

  return draft;
}

module.exports = { generateEmailDraft, sendAutoReply };
