const { GoogleGenerativeAI } = require('@google/generative-ai');
const { loadKnowledge } = require('./knowledge');
const fs = require('fs');
const path = require('path');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Fallback-Themen wenn noch gar keine Wissensbasis existiert
const FALLBACK_TOPICS = [
  'Öffnungszeiten (regulär, Wochenende, Feiertage, Schulferien)',
  'Parkplätze (Anzahl, kostenlos/kostenpflichtig, Behindertenparkplätze)',
  'Anfahrt und Lage (Adresse, nächste Ausfahrt, ÖPNV)',
  'Bistro-Angebot (Speisen, Getränke, vegane Optionen)',
  'Team und Trainer (Namen, Qualifikationen)',
  'WLAN-Verfügbarkeit in der Halle',
  'Online-Buchung und Reservierung',
  'Garderoben und Schließfächer',
  'Duschen vorhanden (ja/nein, kostenlos?)',
  'Kindergeburtstag Details (Preise, Abläufe, Mindestalter)',
  'Firmenrabatte oder Gruppenpreise',
  'Jahresabo Details (Kündigung, Laufzeit)',
  'Behindertengerechter Zugang',
  'Haustiere erlaubt',
  'Fotografieren/Filmen in der Halle',
];

// KI analysiert die Wissensbasis und generiert eine individuelle Fragenliste
async function generateMissingTopics(existingKnowledge) {
  if (!existingKnowledge || existingKnowledge.trim().length < 100) {
    return FALLBACK_TOPICS;
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = `Du analysierst die Wissensbasis eines Chat-Bots für die Kletterwelt Sauerland (Kletter- und Boulderhalle in Altena).

AKTUELLE WISSENSBASIS:
${existingKnowledge.substring(0, 12000)}

AUFGABE:
Analysiere was in dieser Wissensbasis fehlt, lückenhaft oder veraltet sein könnte.
Erstelle eine Liste mit maximal 12 konkreten Fragen/Themen, die ein Mitarbeiter noch beantworten sollte, um den Bot besser zu machen.

Beachte dabei:
- Was würde ein Besucher der Kletterwelt fragen, das der Bot noch nicht beantworten kann?
- Welche Informationen sind unklar, unvollständig oder fehlen ganz?
- Welche typischen Kletterhallen-Themen sind noch nicht abgedeckt?
- Ignoriere Website-Artikel und Events – die werden automatisch gescannt.

Antworte NUR mit einer nummerierten Liste, ein Thema pro Zeile, ohne Einleitung oder Erklärung.
Beispielformat:
1. Thema A (Details was genau fehlt)
2. Thema B (Details was genau fehlt)`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // Zeilen parsen: "1. Thema..." → ["Thema...", ...]
    const topics = text
      .split('\n')
      .map(line => line.replace(/^\d+\.\s*/, '').trim())
      .filter(line => line.length > 5);

    if (topics.length >= 3) {
      console.log(`[Trainer] KI hat ${topics.length} offene Themen identifiziert.`);
      return topics;
    }
  } catch (err) {
    console.error('[Trainer] Themen-Generierung fehlgeschlagen, nutze Fallback:', err.message);
  }

  return FALLBACK_TOPICS;
}

function buildTrainerSystemPrompt(openTopics, existingKnowledge) {
  const knowledgeSection = existingKnowledge
    ? existingKnowledge.substring(0, 12000)
    : null;

  return `Du bist ein intelligenter Wissens-Interviewer für den Chat-Assistenten der Kletterwelt Sauerland.

DEINE AUFGABE:
Du interviewst einen Mitarbeiter der Kletterwelt Sauerland, um die Wissensbasis des Chat-Bots zu erweitern. Du stellst EINE gezielte Frage auf einmal, hörst zu, bestätigst die Antwort kurz und stellst dann die nächste Frage.

STIL:
- Freundlich, kollegial, wie ein Gespräch unter Mitarbeitern
- Kurze Rückmeldungen ("Super, das hilft sehr!", "Perfekt!", "Gut zu wissen!")
- Dann sofort die nächste Frage
- Wenn eine Antwort unklar ist, kurz nachfragen
- NIEMALS mehrere Fragen auf einmal stellen

${openTopics.length > 0
  ? `DIESE THEMEN SOLL DU HEUTE ABFRAGEN (der Reihe nach, wichtigstes zuerst):\n${openTopics.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
  : 'ALLE THEMEN SIND GUT ABGEDECKT – frage ob es aktuelle Neuigkeiten oder Änderungen gibt.'}

VOLLSTÄNDIGE WISSENSBASIS ZUR REFERENZ (bereits bekannt – NICHT nochmal fragen):
${knowledgeSection ?? 'Noch keine Wissensbasis vorhanden – fange mit den Grundlagen an.'}

WICHTIG:
- Begrüße kurz und fang sofort mit Thema 1 aus der Liste an.
- Themen aus der Wissensbasis NIEMALS nochmal fragen.
- Frag nur was wirklich noch fehlt.
- Nach ca. 10–12 Fragen das Interview freundlich beenden und sagen, der Mitarbeiter kann speichern.`;
}

function buildExtractionPrompt(conversation) {
  return `Du bist ein Experte für Wissensmanagement. Extrahiere aus dem folgenden Interview-Gespräch zwischen einem KI-Interviewer und einem Mitarbeiter der Kletterwelt Sauerland alle neuen, konkreten Fakten.

INTERVIEW-GESPRÄCH:
${conversation}

AUFGABE:
Erstelle eine strukturierte Markdown-Datei mit allen gelernten Informationen.
- Verwende klare Überschriften (##)
- Nur konkrete Fakten, keine Vermutungen
- Formuliere so, als würdest du es einem Chat-Bot erklären der Kunden helfen soll
- Ignoriere allgemeine Aussagen, nur spezifische KWS-Infos
- Wenn etwas unklar oder widersprüchlich war, lass es weg

Antworte NUR mit dem Markdown-Inhalt, ohne Einleitung oder Erklärung.`;
}

async function trainerChat(conversationHistory, userMessage) {
  const knowledge = loadKnowledge();

  // Beim ersten Aufruf (leere History) die offenen Themen per KI generieren
  let openTopics;
  if (conversationHistory.length === 0) {
    openTopics = await generateMissingTopics(knowledge);
  } else {
    // In laufender Session: Fallback (Themen wurden schon im System-Prompt übergeben)
    openTopics = [];
  }

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: buildTrainerSystemPrompt(openTopics, knowledge),
  });

  const history = conversationHistory.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  // Gemini erfordert, dass die History mit 'user' beginnt.
  if (history.length > 0 && history[0].role === 'model') {
    history.unshift({ role: 'user', parts: [{ text: 'Starte das Interview.' }] });
  }

  const chatSession = model.startChat({ history });
  const result = await chatSession.sendMessage(userMessage);
  return result.response.text();
}

async function extractAndSaveKnowledge(conversationHistory) {
  // Gespräch als lesbaren Text formatieren
  const conversation = conversationHistory
    .map(msg => `${msg.role === 'assistant' ? '🤖 Interviewer' : '👤 Mitarbeiter'}: ${msg.content}`)
    .join('\n\n');

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const result = await model.generateContent(buildExtractionPrompt(conversation));
  const extractedMarkdown = result.response.text();

  // Datei speichern
  const date = new Date().toISOString().split('T')[0];
  const time = new Date().toTimeString().slice(0,5).replace(':','-');
  const filename = `training-${date}-${time}.md`;
  const filePath = path.join(__dirname, '../knowledge', filename);

  const header = `# Training-Session vom ${new Date().toLocaleDateString('de-DE')} um ${new Date().toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'})} Uhr\n\n_Automatisch aus einem Mitarbeiter-Interview extrahiert._\n\n`;
  fs.writeFileSync(filePath, header + extractedMarkdown, 'utf8');

  console.log(`[Trainer] Wissen gespeichert: ${filename}`);
  return { filename, content: header + extractedMarkdown };
}

module.exports = { trainerChat, extractAndSaveKnowledge };
