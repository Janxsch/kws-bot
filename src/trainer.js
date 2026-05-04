const { GoogleGenerativeAI } = require('@google/generative-ai');
const { loadKnowledge } = require('./knowledge');
const fs = require('fs');
const path = require('path');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Themen die der Bot systematisch abfragt
const TRAINING_TOPICS = [
  'Öffnungszeiten (regulär, Wochenende, Feiertage, Schulferien)',
  'Parkplätze (Anzahl, kostenlos/kostenpflichtig, Behindertenparkplätze)',
  'Anfahrt und Lage (Adresse, nächste Ausfahrt A45, ÖPNV)',
  'Bistro-Angebot (Speisen, Getränke, Öffnungszeiten, vegane Optionen)',
  'Team und Trainer (Namen, Qualifikationen, feste Ansprechpartner)',
  'WLAN-Verfügbarkeit in der Halle',
  'Online-Buchung und Reservierung (gibt es das, wie funktioniert es)',
  'Garderoben und Schließfächer (vorhanden, Kosten, Schloss mitbringen?)',
  'Duschen vorhanden (ja/nein, kostenlos?)',
  'Kindergeburtstag Details (Preise, genaue Abläufe, Mindestalter, was mitbringen)',
  'Firmenrabatte oder Gruppenpreise',
  'Jahresabo Details (Kündigung, Laufzeit, Vorteile)',
  'Behindertengerechter Zugang',
  'Haustiere erlaubt',
  'Fotografieren/Filmen in der Halle (erlaubt?)',
  'Aktuelle Highlights oder Besonderheiten der Halle',
  'Was macht KWS besonders im Vergleich zu anderen Hallen in der Region',
  'Typische Besucher: Wer kommt zu euch? Familien, Sportler, Schulen?',
];

function buildTrainerSystemPrompt(existingKnowledge) {
  return `Du bist ein intelligenter Wissens-Interviewer für den Chat-Assistenten der Kletterwelt Sauerland.

DEINE AUFGABE:
Du interviewst einen Mitarbeiter der Kletterwelt Sauerland, um die Wissensbasis des Chat-Bots zu erweitern. Du stellst EINE gezielte Frage auf einmal, hörst zu, bestätigst die Antwort kurz und stellst dann die nächste Frage.

STIL:
- Freundlich, kollegial, wie ein Gespräch unter Mitarbeitern
- Kurze Rückmeldungen ("Super, das hilft sehr!", "Perfekt!", "Gut zu wissen!")
- Dann sofort die nächste Frage
- Wenn eine Antwort unklar ist, kurz nachfragen
- NIEMALS mehrere Fragen auf einmal stellen

THEMEN DIE NOCH FEHLEN ODER UNKLAR SIND:
${TRAINING_TOPICS.map((t, i) => `${i + 1}. ${t}`).join('\n')}

BEREITS BEKANNTE INFORMATIONEN (diese Themen NICHT nochmal fragen):
${existingKnowledge ? existingKnowledge.substring(0, 3000) + '...' : 'Noch keine Wissensbasis vorhanden.'}

WICHTIG:
- Fange mit einer Begrüßung an und starte dann mit dem wichtigsten fehlenden Thema: Öffnungszeiten.
- Arbeite die Liste systematisch durch aber frag nur was wirklich noch fehlt.
- Wenn du das Gefühl hast, genug für heute gelernt zu haben (nach ca. 10-15 Fragen), beende das Interview freundlich und sage dem Mitarbeiter er kann die Session speichern.`;
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

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: buildTrainerSystemPrompt(knowledge),
  });

  const history = conversationHistory.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  // Gemini erfordert, dass die History mit 'user' beginnt.
  // Falls die erste Nachricht vom Modell stammt (z.B. Begrüßung), entfernen wir führende 'model'-Nachrichten.
  while (history.length > 0 && history[0].role === 'model') {
    history.shift();
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
