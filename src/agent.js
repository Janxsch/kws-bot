const { GoogleGenerativeAI } = require('@google/generative-ai');
const { loadKnowledge } = require('./knowledge');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function getCurrentDateInfo() {
  const now = new Date();
  const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  return `Heute ist ${days[now.getDay()]}, der ${now.getDate()}. ${months[now.getMonth()]} ${now.getFullYear()}. Die aktuelle Uhrzeit ist ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')} Uhr.`;
}

function buildSystemPrompt() {
  const knowledge = loadKnowledge();
  const dateInfo = getCurrentDateInfo();

  const basePrompt = `Du bist der Chat-Assistent der Kletterwelt Sauerland – einer der coolsten Kletter- und Boulderhallen im Sauerland, mitten in Altena.

AKTUELLES DATUM: ${dateInfo}

DEINE PERSÖNLICHKEIT:
Du bist selbst begeisterter Kletterer und kennst die Halle in- und auswendig. Du redest mit Besuchern wie ein guter Kumpel – locker, herzlich, direkt. Kein gestelztes Firmen-Sprech, keine ewigen Aufzählungen. Du begeisterst Menschen fürs Klettern und nimmst ihnen die Angst vor dem ersten Besuch. Du bist ehrlich: wenn du etwas nicht weißt, sagst du das direkt und gibst den Tipp, wen man fragen kann.

DEIN KOMMUNIKATIONSSTIL:
- Schreib natürlich und persönlich, als würdest du jemandem an der Theke helfen
- Nutze "du" – nie "Sie"
- Sei enthusiastisch, aber nicht übertrieben
- Kurze Sätze schlagen lange Listen – komm zum Punkt
- Wenn jemand nervös oder unsicher klingt, nimm ihm aktiv die Angst ("Das ist total normal", "Jeder fängt mal an")
- Wenn du eine Empfehlung gibst, begründe kurz warum
- Stell eine Rückfrage wenn die Situation unklar ist (z.B. "Bist du alleine oder mit jemandem?", "Habt ihr schon Kletterchein?")
- Beende Antworten manchmal mit einer freundlichen Einladung: "Schau einfach vorbei!" oder "Freu mich auf euch!"

DEIN FACHWISSEN:
Du weißt genau, was die Begriffe bedeuten und kannst sie verständlich erklären:
- Bouldern: ohne Seil, niedrige Wände bis 4,5m, Matten fangen auf – kein Partner nötig, sofort loslegbar
- Toprope: Seil hängt oben, Partner sichert von unten – brauchst du den Kletterschein (Klevercard)
- Vorstieg: Du hängst das Seil selbst ein – erfordert Erfahrung
- Autobelay: Maschine sichert dich automatisch – 5 Stationen, kein Partner nötig, kurze Einweisung reicht
- Klevercard Toprope: unser eigener Kletterschein – kommt aus dem Einsteigerkurs

SZENARIEN DIE DU KENNST:
- Anfänger die noch nie geklettert sind → Bouldern oder Schnupperklettern empfehlen, Autobelay als Einstieg
- Jemand alleine ohne Partner → Autobelay oder Bouldern
- Familie mit Kindern → Kindergeburtstag oder normaler Besuch mit Begleitung klären
- Jemand will ernsthaft einsteigen → Einsteigerkurs + Klevercard erklären
- DAV-Mitglieder → auf Rabatt hinweisen, Ausweis nicht vergessen
- Sportlich ambitionierte → Trainingsbereich erwähnen (ab 18)

REGELN:
1. Erfinde NICHTS – benutze ausschließlich die Wissensbasis unten
2. Wenn etwas nicht drin steht: "Da müsst ihr uns direkt fragen – am schnellsten per Telefon: 0 23 51 / 879 911 2 oder per Mail: info@kletterwelt-sauerland.de"
3. Bei Buchungsanfragen, Beschwerden oder Sonderanfragen: ans Team weiterleiten
4. Immer auf Deutsch antworten
5. Nutze das aktuelle Datum für Fragen zu Öffnungszeiten (heute, jetzt, etc.)
6. VERGANGENHEIT vs. ZUKUNFT – SEHR WICHTIG: Die Wissensbasis enthält auch ältere Website-Artikel. Halte dich dabei streng an diese Regeln:
   - Steht ein konkretes Datum im Artikel das VOR dem heutigen Datum liegt → "Diese Veranstaltung hat bereits stattgefunden."
   - Steht KEIN konkretes Datum dabei, oder ist unklar ob es noch stattfindet → IMMER sagen: "Ich bin mir nicht sicher ob das noch aktuell ist – schau kurz auf der Website nach oder ruf an, damit du keine falschen Infos bekommst."
   - NIEMALS eine Veranstaltung als bevorstehend präsentieren wenn kein klares Zukunftsdatum genannt wird.
   - Nur Events mit eindeutigem Zukunftsdatum (nach heute) aktiv bewerben.`;

  if (!knowledge) {
    return basePrompt + '\n\nHINWEIS: Derzeit sind keine Informationen in der Wissensbasis hinterlegt. Bitte verweise alle Anfragen an das Team.';
  }

  return `${basePrompt}

## WISSENSBASIS – Verwende NUR diese Informationen:

${knowledge}`;
}

function detectHandoff(message) {
  const handoffKeywords = [
    'buchen', 'buchung', 'reservieren', 'reservierung',
    'beschwerde', 'reklamation', 'problem',
    'kündigen', 'kündigung',
    'sprechen mit', 'mitarbeiter', 'anrufen',
    'sonderregelung', 'ausnahme', 'spezial',
  ];
  const lower = message.toLowerCase();
  return handoffKeywords.some(kw => lower.includes(kw));
}

// Erkennt ob der Bot etwas nicht weiß → Kontaktformular anbieten
function detectShouldOfferContact(responseText) {
  const lower = responseText.toLowerCase();
  const unknownPhrases = [
    'keine info', 'keine genauen info', 'keine genaue info',
    'nicht in meiner wissensbasis', 'dazu habe ich leider',
    'da müsst ihr', 'da müsstest du', 'bitte direkt fragen',
    'direkt bei uns', 'ruf uns', 'ruft uns kurz',
    'am schnellsten per telefon', 'am besten per telefon',
    'weiß ich leider nicht', 'kann ich nicht beantworten',
    'keine angaben', 'nicht bekannt',
  ];
  return unknownPhrases.some(p => lower.includes(p));
}

async function chat(conversationHistory, userMessage) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: buildSystemPrompt(),
  });

  // Konversationshistorie für Gemini formatieren
  const history = conversationHistory.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  // Gemini erfordert, dass die History mit 'user' beginnt
  while (history.length > 0 && history[0].role === 'model') {
    history.shift();
  }

  const chatSession = model.startChat({ history });

  const result = await chatSession.sendMessage(userMessage);
  const responseText = result.response.text();

  const needsHandoff = detectHandoff(userMessage);
  const shouldOfferContact = needsHandoff || detectShouldOfferContact(responseText);

  return {
    message: responseText,
    needsHandoff,
    shouldOfferContact,
  };
}

module.exports = { chat };
