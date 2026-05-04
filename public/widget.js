(function () {
  'use strict';

  const scriptTag = document.currentScript || (function () {
    const scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  const API_URL  = scriptTag.getAttribute('data-api-url')     || '/api/chat';
  const COLOR    = scriptTag.getAttribute('data-theme-color') || '#2a7d3f';
  const TITLE    = scriptTag.getAttribute('data-title')       || 'KWS Assistent';
  const SUBTITLE = scriptTag.getAttribute('data-subtitle')    || 'Online – Wie kann ich helfen?';
  const WELCOME  = scriptTag.getAttribute('data-welcome')     || 'Hallo! Ich bin der Assistent der Kletterwelt Sauerland. Wie kann ich dir helfen?';

  const STORAGE_KEY = 'kws_chat_history';
  const MAX_HISTORY = 10;
  const CONTACT_URL = API_URL.replace('/api/chat', '/api/contact-staff');

  // SVG Icons
  const ICON_CHAT = `<svg viewBox="0 0 24 24" fill="white" width="24" height="24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>`;
  const ICON_CLOSE = `<svg viewBox="0 0 24 24" fill="white" width="18" height="18"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
  const ICON_SEND = `<svg viewBox="0 0 24 24" fill="white" width="18" height="18"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;
  const ICON_BOT = `<svg viewBox="0 0 24 24" fill="white" width="16" height="16"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7H3a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2M7.5 13a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>`;

  // CSS laden
  const baseUrl = API_URL.replace('/api/chat', '');
  if (!document.querySelector('link[data-kws]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = baseUrl + '/widget.css';
    link.setAttribute('data-kws', '1');
    document.head.appendChild(link);
  }
  document.documentElement.style.setProperty('--kws-color', COLOR);

  // HTML
  const wrapper = document.createElement('div');
  wrapper.id = 'kws-chat-widget';
  wrapper.innerHTML = `
    <button id="kws-chat-bubble" aria-label="Chat öffnen">
      ${ICON_CHAT}
      <span id="kws-chat-badge"></span>
    </button>

    <div id="kws-chat-window" role="dialog" aria-label="${TITLE}">
      <div id="kws-chat-header">
        <div id="kws-chat-header-avatar">${ICON_BOT}</div>
        <div id="kws-chat-header-info">
          <div id="kws-chat-header-title">${TITLE}</div>
          <div id="kws-chat-header-subtitle">
            <span id="kws-online-dot"></span>${SUBTITLE}
          </div>
        </div>
        <button id="kws-chat-close" aria-label="Schließen">${ICON_CLOSE}</button>
      </div>

      <div id="kws-chat-messages" aria-live="polite"></div>

      <div id="kws-handoff-banner">
        📞 Für diese Anfrage empfehlen wir direkten Kontakt mit unserem Team.
        <button id="kws-handoff-contact-btn">Mitarbeiter schreiben ✉️</button>
      </div>

      <div id="kws-chat-input-area">
        <textarea id="kws-chat-input" placeholder="Deine Frage..." rows="1" maxlength="1000" aria-label="Nachricht"></textarea>
        <button id="kws-chat-send" disabled aria-label="Senden">${ICON_SEND}</button>
      </div>
      <div id="kws-chat-footer">Powered by KWS Bot</div>
    </div>
  `;
  document.body.appendChild(wrapper);

  const bubble        = document.getElementById('kws-chat-bubble');
  const chatWindow    = document.getElementById('kws-chat-window');
  const messagesEl    = document.getElementById('kws-chat-messages');
  const inputEl       = document.getElementById('kws-chat-input');
  const sendBtn       = document.getElementById('kws-chat-send');
  const closeBtn      = document.getElementById('kws-chat-close');
  const handoffBanner = document.getElementById('kws-handoff-banner');
  const badge         = document.getElementById('kws-chat-badge');

  let isOpen = false;
  let isLoading = false;
  let history = [];
  let unread = 0;

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function formatText(text) {
    return escapeHtml(text)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  function appendMessage(type, text) {
    const row = document.createElement('div');
    row.className = 'kws-row kws-row-' + type;

    if (type === 'bot') {
      const av = document.createElement('div');
      av.className = 'kws-avatar';
      av.innerHTML = ICON_BOT;
      row.appendChild(av);
    }

    const bubble2 = document.createElement('div');
    bubble2.className = 'kws-bubble kws-bubble-' + type;
    bubble2.innerHTML = formatText(text);
    row.appendChild(bubble2);

    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    if (type === 'bot' && !isOpen) {
      unread++;
      badge.textContent = unread;
      badge.style.display = 'flex';
    }
  }

  // Zeigt die Kontakt-Karte mit vorausgefülltem Formular
  function showContactCard(prefillText) {
    // Keine doppelten Karten
    if (document.getElementById('kws-contact-card')) return;

    const card = document.createElement('div');
    card.id = 'kws-contact-card';
    card.className = 'kws-contact-card';
    card.innerHTML = `
      <div class="kws-contact-card-header">✉️ Mitarbeiter kontaktieren</div>
      <p class="kws-contact-card-desc">Schreib uns – wir melden uns per E-Mail zurück.</p>
      <input type="email" id="kws-contact-email" class="kws-contact-input" placeholder="Deine E-Mail-Adresse *" />
      <textarea id="kws-contact-message" class="kws-contact-textarea" rows="4" maxlength="2000">${prefillText || ''}</textarea>
      <div class="kws-contact-actions">
        <button id="kws-contact-send-btn" class="kws-contact-btn-send">Absenden</button>
        <button id="kws-contact-cancel-btn" class="kws-contact-btn-cancel">Abbrechen</button>
      </div>
      <div id="kws-contact-status" class="kws-contact-status"></div>
    `;
    messagesEl.appendChild(card);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Letzten Bot-Kontext für den Server merken
    const lastBotMsg = [...messagesEl.querySelectorAll('.kws-bubble-bot')].slice(-2).map(el => el.innerText).join('\n');

    document.getElementById('kws-contact-cancel-btn').addEventListener('click', () => {
      card.remove();
    });

    document.getElementById('kws-contact-send-btn').addEventListener('click', async () => {
      const emailVal = document.getElementById('kws-contact-email').value.trim();
      const msgVal   = document.getElementById('kws-contact-message').value.trim();
      const statusEl = document.getElementById('kws-contact-status');

      if (!emailVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
        statusEl.textContent = 'Bitte eine gültige E-Mail-Adresse eingeben.';
        statusEl.className = 'kws-contact-status error';
        return;
      }
      if (!msgVal) {
        statusEl.textContent = 'Bitte eine Nachricht eingeben.';
        statusEl.className = 'kws-contact-status error';
        return;
      }

      const sendBtn2 = document.getElementById('kws-contact-send-btn');
      sendBtn2.disabled = true;
      sendBtn2.textContent = 'Wird gesendet…';

      try {
        const res = await fetch(CONTACT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userEmail: emailVal, message: msgVal, context: lastBotMsg }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          card.innerHTML = `
            <div class="kws-contact-success">
              <div class="kws-contact-success-icon">✅</div>
              <strong>Anfrage gesendet!</strong>
              <p>Wir melden uns so schnell wie möglich unter <em>${emailVal}</em>.</p>
            </div>
          `;
        } else {
          statusEl.textContent = data.error || 'Fehler beim Senden. Bitte versuche es erneut.';
          statusEl.className = 'kws-contact-status error';
          sendBtn2.disabled = false;
          sendBtn2.textContent = 'Absenden';
        }
      } catch {
        statusEl.textContent = 'Netzwerkfehler. Bitte versuche es erneut.';
        statusEl.className = 'kws-contact-status error';
        sendBtn2.disabled = false;
        sendBtn2.textContent = 'Absenden';
      }
    });

    // E-Mail bei Enter im E-Mail-Feld weiter springen
    document.getElementById('kws-contact-email').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); document.getElementById('kws-contact-message').focus(); }
    });
  }

  function showTyping() {
    const row = document.createElement('div');
    row.className = 'kws-row kws-row-bot';
    row.id = 'kws-typing';

    const av = document.createElement('div');
    av.className = 'kws-avatar';
    av.innerHTML = ICON_BOT;
    row.appendChild(av);

    const dots = document.createElement('div');
    dots.className = 'kws-bubble kws-bubble-bot kws-typing-dots';
    dots.innerHTML = '<span class="kws-dot"></span><span class="kws-dot"></span><span class="kws-dot"></span>';
    row.appendChild(dots);

    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function hideTyping() {
    const el = document.getElementById('kws-typing');
    if (el) el.remove();
  }

  function loadHistory() {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        history = JSON.parse(saved);
        history.forEach(m => appendMessage(m.role === 'user' ? 'user' : 'bot', m.content));
        return;
      }
    } catch {}
    appendMessage('bot', WELCOME);
  }

  function saveHistory() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history)); } catch {}
  }

  function toggleChat() {
    isOpen = !isOpen;
    chatWindow.classList.toggle('open', isOpen);
    if (isOpen) {
      unread = 0;
      badge.style.display = 'none';
      setTimeout(() => inputEl.focus(), 280);
    }
  }

  async function send() {
    const text = inputEl.value.trim();
    if (!text || isLoading) return;

    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtn.disabled = true;
    isLoading = true;
    handoffBanner.classList.remove('visible');

    appendMessage('user', text);
    history.push({ role: 'user', content: text });
    if (history.length > MAX_HISTORY * 2) history = history.slice(-MAX_HISTORY * 2);

    showTyping();

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: history.slice(0, -1) }),
      });
      hideTyping();
      const data = res.ok ? await res.json() : {};
      const reply = data.message || 'Entschuldigung, da ist etwas schiefgelaufen.';

      appendMessage('bot', reply);
      history.push({ role: 'assistant', content: reply });
      saveHistory();
      if (data.needsHandoff) handoffBanner.classList.add('visible');
      if (data.shouldOfferContact) {
        // Kleinen "Mitarbeiter fragen"-Button unter der Bot-Antwort einfügen
        const contactHint = document.createElement('div');
        contactHint.className = 'kws-contact-hint';
        contactHint.innerHTML = `<button class="kws-contact-hint-btn">✉️ Mitarbeiter direkt fragen</button>`;
        messagesEl.appendChild(contactHint);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        contactHint.querySelector('button').addEventListener('click', () => {
          contactHint.remove();
          showContactCard(text);
        });
      }

    } catch {
      hideTyping();
      appendMessage('bot', 'Der Assistent ist gerade nicht erreichbar. Bitte versuche es später erneut.');
    }

    isLoading = false;
    sendBtn.disabled = inputEl.value.trim().length === 0;
  }

  bubble.addEventListener('click', toggleChat);
  closeBtn.addEventListener('click', toggleChat);

  document.getElementById('kws-handoff-contact-btn').addEventListener('click', () => {
    handoffBanner.classList.remove('visible');
    const lastUserMsg = [...messagesEl.querySelectorAll('.kws-bubble-user')].slice(-1)[0]?.innerText || '';
    showContactCard(lastUserMsg);
  });
  sendBtn.addEventListener('click', send);

  inputEl.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(Math.max(this.scrollHeight, 80), 160) + 'px';
    sendBtn.disabled = this.value.trim().length === 0;
  });

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  document.addEventListener('click', e => {
    if (isOpen && window.innerWidth > 480 && !chatWindow.contains(e.target) && !bubble.contains(e.target)) {
      toggleChat();
    }
  });

  loadHistory();
})();
