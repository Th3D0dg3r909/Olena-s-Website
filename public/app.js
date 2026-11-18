const form = document.querySelector('#booking');
const status = document.querySelector('#status');
const button = form.querySelector('button');
const { service, day, time } = form.elements;
let slots = [];
function updateTimes() {
  time.replaceChildren(...slots.filter(slot => slot.day === day.value).map(slot => new Option(slot.time)));
  button.disabled = !time.value;
}
async function load() {
  const response = await fetch('/api/options?service=' + encodeURIComponent(service.value));
  if (!response.ok) throw new Error();
  const options = await response.json();
  slots = options.slots;
  const previousDay = day.value;
  const previousService = service.value;
  service.replaceChildren(...options.services.map(item => new Option(item.name + ' · €' + item.price + ' · ' + item.durationLabel, item.id)));
  if ([...service.options].some(option => option.value === previousService)) service.value = previousService;
  const formatDay = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'full', timeZone: 'UTC' });
  day.replaceChildren(...[...new Set(slots.map(slot => slot.day))].map(value => new Option(formatDay.format(new Date(value)), value)));
  if ([...day.options].some(option => option.value === previousDay)) day.value = previousDay;
  document.querySelector('#services').replaceChildren(...options.services.map(item => {
    const card = document.createElement('article');
    const heading = document.createElement('h3');
    const description = document.createElement('p');
    heading.textContent = item.name;
    description.textContent = item.description;
    const category = document.createElement('p');
    category.textContent = item.category;
    const price = document.createElement('strong');
    price.textContent = '€' + item.price + ' · ' + item.durationLabel;
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.textContent = 'Kies ' + item.name.toLowerCase();
    choose.addEventListener('click', () => {
      service.value = item.id;
      changeService();
      window.location.hash = 'afspraak';
      day.focus({ preventScroll: true });
    });
    card.append(category, heading, description, price, choose);
    return card;
  }));
  const contact = document.querySelector('[data-whatsapp]');
  if (options.whatsapp) contact.href = 'https://wa.me/' + options.whatsapp;
  updateWhatsApp();
  updateTimes();
}
function updateWhatsApp() {
  const contact = document.querySelector('[data-whatsapp]');
  const bookingLink = document.querySelector('#whatsapp');
  const treatment = service.selectedOptions[0]?.textContent;
  const message = treatment
    ? 'Hallo Olena, ik wil graag meer weten over de behandeling ' + treatment + '.'
    : 'Hallo Olena, ik heb een vraag over de behandelingen.';
  const url = new URL(contact.href);
  url.searchParams.set('text', message);
  bookingLink.href = url.href;
}
let availabilityRequest = 0;
async function changeService() {
  updateWhatsApp();
  const requestId = ++availabilityRequest;
  button.disabled = true;
  time.replaceChildren();
  try {
    const response = await fetch('/api/options?service=' + encodeURIComponent(service.value));
    if (!response.ok) throw new Error();
    const options = await response.json();
    if (requestId !== availabilityRequest) return;
    slots = options.slots;
    const previous = day.value;
    const formatDay = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'full', timeZone: 'UTC' });
    day.replaceChildren(...[...new Set(slots.map(slot => slot.day))].map(value => new Option(formatDay.format(new Date(value)), value)));
    if ([...day.options].some(option => option.value === previous)) day.value = previous;
    updateTimes();
    status.textContent = slots.length ? '' : 'Geen beschikbare tijden voor deze behandeling.';
  } catch {
    if (requestId === availabilityRequest) status.textContent = 'Beschikbaarheid laden lukt momenteel niet.';
  }
}
service.addEventListener('change', changeService);
day.addEventListener('change', updateTimes);
form.addEventListener('submit', async event => {
  event.preventDefault();
  button.disabled = true;
  status.textContent = 'Aanvraag versturen…';
  try {
    const response = await fetch('/api/bookings', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Olena-Request': '1' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const result = await response.json();
    status.textContent = response.ok ? 'Je aanvraag is ontvangen. Olena neemt contact met je op.' : result.error;
    if (response.ok) {
      form.elements.name.value = '';
      form.elements.email.value = '';
    }
    if (response.ok || response.status === 409) await load().catch(() => {
      slots = [];
      time.replaceChildren();
      status.textContent += ' Vernieuw de pagina om de beschikbare tijden te zien.';
    });
  } catch {
    status.textContent = 'De aanvraag kon niet worden gecontroleerd. Vernieuw de pagina om de beschikbare tijden te zien.';
  } finally {
    button.disabled = !time.value;
  }
});
load().then(() => {
  if (!slots.length) status.textContent = 'Er zijn momenteel geen tijdsloten beschikbaar.';
}).catch(() => { status.textContent = 'Beschikbaarheid laden lukt momenteel niet.'; });
