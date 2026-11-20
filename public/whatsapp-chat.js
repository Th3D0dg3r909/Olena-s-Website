(() => {
  const messages = {
    nl: { open: 'Chat met Olena', close: 'Chat sluiten', title: 'Contact met Olena', greeting: 'Welkom! Heb je een vraag over een behandeling of je afspraak? Schrijf gerust een bericht.', label: 'Je bericht', placeholder: 'Waarmee kan ik je helpen?', continue: 'Verder in WhatsApp', note: 'WhatsApp opent met je bericht. Verstuur het daar om het gesprek met Olena te starten.' },
    en: { open: 'Chat with Olena', close: 'Close chat', title: 'Contact Olena', greeting: 'Welcome! Have a question about a treatment or your appointment? Feel free to write a message.', label: 'Your message', placeholder: 'How can I help you?', continue: 'Continue in WhatsApp', note: 'WhatsApp opens with your message. Send it there to start your conversation with Olena.' },
    uk: { open: 'Написати Олені', close: 'Закрити чат', title: 'Зв’язатися з Оленою', greeting: 'Вітаю! Маєте запитання про процедуру чи свій запис? Напишіть повідомлення.', label: 'Ваше повідомлення', placeholder: 'Чим можу допомогти?', continue: 'Продовжити у WhatsApp', note: 'WhatsApp відкриється з вашим повідомленням. Надішліть його там, щоб почати розмову з Оленою.' }
  };
  const t = messages[document.documentElement.lang] || messages.nl;
  const widget = document.createElement('div');
  widget.className = 'whatsapp-widget';
  // This markup contains only our fixed translations. User messages are used only in a URL.
  widget.innerHTML = `<button class="whatsapp-launcher" type="button" aria-expanded="false" aria-controls="whatsapp-panel"><span aria-hidden="true">✉</span> ${t.open}</button>
    <div id="whatsapp-panel" class="whatsapp-panel" role="dialog" aria-labelledby="whatsapp-title" aria-describedby="whatsapp-note" hidden>
      <div class="whatsapp-heading"><div><span class="whatsapp-eyebrow">Olena Skin Care Studio</span><h2 id="whatsapp-title">${t.title}</h2></div><button class="whatsapp-close" type="button" aria-label="${t.close}">×</button></div>
      <p class="whatsapp-greeting">${t.greeting}</p>
      <label for="whatsapp-message">${t.label}</label><textarea id="whatsapp-message" rows="3" maxlength="1500" placeholder="${t.placeholder}" aria-describedby="whatsapp-note"></textarea>
      <a class="button whatsapp-continue" target="_blank" rel="noopener noreferrer">${t.continue} ↗</a><p id="whatsapp-note">${t.note}</p>
    </div>`;
  document.body.append(widget);
  const launcher = widget.querySelector('.whatsapp-launcher');
  const panel = widget.querySelector('.whatsapp-panel');
  const input = widget.querySelector('textarea');
  const link = widget.querySelector('.whatsapp-continue');
  const updateLink = () => {
    // The booking script updates this contact link when WHATSAPP_NUMBER is configured.
    const contact = document.querySelector('[data-whatsapp]');
    const url = new URL(contact?.href || 'https://wa.me/31647238444');
    url.search = '';
    url.searchParams.set('text', input.value.trim() || t.placeholder);
    link.href = url.href;
  };
  const close = (restoreFocus = true) => {
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    if (restoreFocus) launcher.focus();
  };
  launcher.addEventListener('click', () => {
    if (!panel.hidden) return close();
    updateLink();
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    input.focus({ preventScroll: true });
  });
  widget.querySelector('.whatsapp-close').addEventListener('click', () => close());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) close();
  });
  document.addEventListener('click', event => {
    if (!panel.hidden && !widget.contains(event.target)) close(false);
  });
  input.addEventListener('input', updateLink);
  link.addEventListener('click', updateLink);
  updateLink();
})();
