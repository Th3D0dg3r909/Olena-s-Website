// Treatments and appointment requests. Customers request an appointment through WhatsApp; Olena confirms it
// personally and enters it in her planner. Opening WhatsApp never reserves or confirms anything on this website.
(() => {
const language = document.documentElement.lang;
const copy = {
  nl: {
    request: 'Afspraak aanvragen via WhatsApp',
    message: treatment => 'Hallo Olena, ik wil graag een afspraak aanvragen' + (treatment ? ' voor ' + treatment + '.' : '. Gewenste behandeling: […].') +
      ' Mijn voorkeursdag is: […]. Mijn voorkeurstijd is: […]. Ik begrijp dat de afspraak pas vaststaat na jouw persoonlijke bevestiging.',
    unavailable: 'De behandelingen konden niet worden geladen. Bel of app Olena op 06 47238444.',
    choose: 'Kies een behandeling',
  },
  en: {
    request: 'Request an appointment via WhatsApp',
    message: treatment => 'Hello Olena, I would like to request an appointment' + (treatment ? ' for ' + treatment + '.' : '. My preferred treatment is: […].') +
      ' My preferred day is: […]. My preferred time is: […]. I understand that the appointment is only confirmed after your personal confirmation.',
    unavailable: 'The treatments could not be loaded. Please call or WhatsApp Olena on 06 47238444.',
    choose: 'Choose a treatment',
  },
  uk: {
    request: 'Надіслати запит на запис у WhatsApp',
    message: treatment => 'Вітаю, Олено! Хочу записатися на процедуру' + (treatment ? ' «' + treatment + '».' : '. Бажана процедура: […].') +
      ' Бажаний день: […]. Бажаний час: […]. Розумію, що запис буде остаточним лише після вашого особистого підтвердження.',
    unavailable: 'Не вдалося завантажити процедури. Зателефонуйте або напишіть Олені у WhatsApp: 06 47238444.',
    choose: 'Виберіть процедуру',
  },
}[language];
const select = document.querySelector('#request-service');
const requestLink = document.querySelector('#request-link');
const status = document.querySelector('#status');
let number = '31647238444';
let services = [];
// encodeURIComponent keeps treatment names with &, + or quotes intact in the WhatsApp link.
const whatsappLink = text => 'https://wa.me/' + number + '?text=' + encodeURIComponent(text);
function updateRequestLink() {
  const treatment = services.find(item => item.id === select.value);
  requestLink.href = whatsappLink(copy.message(treatment?.name));
}
function card(item) {
  const article = document.createElement('article');
  const category = document.createElement('p');
  category.className = 'treatment-category';
  category.textContent = item.category;
  const heading = document.createElement('h3');
  heading.textContent = item.name;
  const description = document.createElement('p');
  description.className = 'treatment-description';
  description.textContent = item.description;
  const price = document.createElement('strong');
  price.textContent = '€' + item.price + ' · ' + (language === 'uk' ? item.durationLabel.replace('min', 'хв') : item.durationLabel);
  const request = document.createElement('a');
  request.className = 'button treatment-request';
  request.href = whatsappLink(copy.message(item.name));
  request.target = '_blank';
  request.rel = 'noopener noreferrer';
  request.textContent = copy.request;
  request.setAttribute('aria-label', copy.request + ' — ' + item.name);
  article.append(category, heading, description, price, request);
  return article;
}
async function load() {
  const response = await fetch('/api/options?lang=' + language);
  if (!response.ok) throw new Error();
  const options = await response.json();
  if (/^\d{8,15}$/.test(options.whatsapp)) number = options.whatsapp;
  services = options.services;
  select.replaceChildren(new Option(copy.choose, ''), ...services.map(item => new Option(item.name + ' · €' + item.price, item.id)));
  document.querySelector('#services').replaceChildren(...services.map(card));
  for (const contact of document.querySelectorAll('[data-whatsapp]')) contact.href = 'https://wa.me/' + number;
  updateRequestLink();
}
select.addEventListener('change', updateRequestLink);
updateRequestLink();
load().catch(() => { status.textContent = copy.unavailable; });
})();
