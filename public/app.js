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
  const response = await fetch('/api/options');
  if (!response.ok) throw new Error();
  const options = await response.json();
  slots = options.slots;
  const previousDay = day.value;
  const previousService = service.value;
  service.replaceChildren(...options.services.map(item => new Option(item.name, item.id)));
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
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.textContent = 'Kies ' + item.name.toLowerCase();
    choose.addEventListener('click', () => {
      service.value = item.id;
      window.location.hash = 'afspraak';
      day.focus({ preventScroll: true });
    });
    card.append(heading, description, choose);
    return card;
  }));
  if (options.whatsapp) {
    const link = document.querySelector('#whatsapp');
    link.href = 'https://wa.me/' + options.whatsapp;
    link.hidden = false;
  }
  updateTimes();
}
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
