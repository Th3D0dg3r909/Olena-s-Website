async function initializePlanner() {
const language = document.documentElement.lang;
const locale = { nl: 'nl-NL', en: 'en-GB', uk: 'uk-UA' }[language];
let dictionary = {};
if (language !== 'en') {
  const response = await fetch('/planner-translations.json');
  if (!response.ok) throw new Error();
  dictionary = (await response.json())[language] || {};
}
const t = text => dictionary[text] || text;
const status = document.querySelector('#status');
const list = document.querySelector('#bookings');
const labels = { pending: t("Pending"), confirmed: t("Confirmed"), declined: t("Declined") };
async function request(method, body, endpoint = 'bookings') {
  const response = await fetch('/api/admin/' + endpoint + '?lang=' + language, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Olena-Request': '1' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
const date = document.querySelector('#planning-day');
const schedule = document.querySelector('#planning-slots');
const planningStatus = document.querySelector('#planning-status');
let planning;
let bookings = [];

async function load() {
  [bookings, planning] = await Promise.all([request('GET'), request('GET', undefined, 'planning')]);
  if (!date.value) {
    const selected = new URLSearchParams(window.location.search).get('day');
    date.value = selected && /^\d{4}-\d{2}-\d{2}$/.test(selected) && !Number.isNaN(Date.parse(selected)) ? selected : planning.today;
  }
  render();
}
const view = document.querySelector('#calendar-view');
const calendar = document.querySelector('#calendar');
if (window.matchMedia('(max-width: 42rem)').matches) view.value = 'day';
const shortDate = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
function shiftDay(day, amount) {
  const next = new Date(day);
  next.setUTCDate(next.getUTCDate() + amount);
  return next.toISOString().slice(0, 10);
}
function timeMinutes(time) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}
function selectDay(day) {
  date.value = day;
  date.dispatchEvent(new Event('change'));
}
function renderCalendar() {
  const start = view.value === 'week'
    ? shiftDay(date.value, -((new Date(date.value).getUTCDay() + 6) % 7))
    : date.value;
  const days = Array.from({ length: view.value === 'week' ? 7 : 1 }, (_, index) => shiftDay(start, index));
  calendar.className = 'calendar-board ' + view.value;
  calendar.replaceChildren();
  document.querySelector('#selected-day').textContent = view.value === 'week'
    ? shortDate.format(new Date(start)) + ' – ' + shortDate.format(new Date(days[6]))
    : dayFormat.format(new Date(start));
  const axis = document.createElement('div');
  axis.className = 'calendar-axis';
  const spacer = document.createElement('div');
  spacer.className = 'calendar-heading';
  spacer.textContent = t("Time");
  axis.append(spacer);
  for (let hour = 10; hour < 21; hour++) {
    const label = document.createElement('div');
    label.className = 'calendar-hour-label';
    label.textContent = hour + ':00';
    axis.append(label);
  }
  calendar.append(axis);
  for (const day of days) {
    const column = document.createElement('div');
    column.className = 'calendar-column';
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'calendar-heading' + (day === date.value ? ' selected-day' : '');
    header.textContent = shortDate.format(new Date(day));
    header.setAttribute('aria-pressed', String(day === date.value));
    header.addEventListener('click', () => selectDay(day));
    const timeline = document.createElement('div');
    timeline.className = 'calendar-timeline';
    for (let hour = 10; hour < 21; hour++) {
      const time = hour + ':00';
      const free = planning.free.some(slot => slot.day === day && slot.time === time);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'calendar-hour';
      cell.disabled = !free;
      cell.setAttribute('aria-label', shortDate.format(new Date(day)) + ' ' + time + (free ? t(", manage availability") : t(", unavailable")));
      if (free) {
        cell.textContent = '+';
        cell.addEventListener('click', () => {
          selectDay(day);
          const control = [...schedule.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === t("Block") + t(" at ") + time);
          control?.focus();
        });
      }
      timeline.append(cell);
    }
    const entries = [
      ...bookings.filter(booking => booking.day === day && booking.status !== 'declined'),
      ...planning.blocked.filter(slot => slot.day === day).map(slot => ({ ...slot, duration: 60, status: 'blocked', name: t("Blocked") })),
    ];
    for (const entry of entries) {
      const offset = timeMinutes(entry.time) - 600;
      const duration = Math.min(entry.duration + (entry.buffer || 0), 660 - offset);
      if (offset < 0 || duration <= 0) continue;
      const event = document.createElement('button');
      event.type = 'button';
      event.className = 'calendar-event ' + entry.status + ' start-' + offset + ' duration-' + duration;
      event.textContent = entry.time + ' · ' + entry.name;
      event.title = [entry.name, entry.service, entry.duration + t(" min") + ' + ' + (entry.buffer || 0) + t(" min") + ' ' + t('cleanup'), labels[entry.status] || t("Blocked")].filter(Boolean).join(' · ');
      event.setAttribute('aria-label', event.title);
      event.addEventListener('click', () => {
        selectDay(day);
        const target = entry.id
          ? [...list.querySelectorAll('article')].find(card => card.dataset.bookingId === entry.id)
          : [...schedule.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === t("Unblock") + t(" at ") + entry.time);
        target?.focus();
      });
      timeline.append(event);
    }
    column.append(header, timeline);
    calendar.append(column);
  }
}
view.addEventListener('change', () => { if (planning && date.value) renderCalendar(); });
function render() {
  const day = date.value;
  if (!day) return;
  document.querySelector('#sidebar-date').textContent = shortDate.format(new Date(day));
  for (const link of document.querySelectorAll('.language-switch a')) {
    const url = new URL(link.href);
    url.searchParams.set('day', day);
    link.href = url.href;
  }
  renderCalendar();
  const dailyBookings = bookings.filter(booking => booking.day === day).sort((a, b) => a.time.localeCompare(b.time));
  schedule.replaceChildren();
  const slots = [
    ...planning.free.map(slot => ({ ...slot, blocked: false })),
    ...planning.blocked.map(slot => ({ ...slot, blocked: true })),
  ].filter(slot => slot.day === day).sort((a, b) => a.time.localeCompare(b.time));
  for (const slot of slots) {
    const button = document.createElement('button');
    const row = document.createElement('div');
    row.className = 'planner-slot';
    const time = document.createElement('strong');
    time.textContent = slot.time;
    const badge = document.createElement('span');
    badge.className = 'planner-badge ' + (slot.blocked ? 'blocked' : 'free');
    badge.textContent = slot.blocked ? t("Blocked") : t("Available");
    button.textContent = slot.blocked ? t("Unblock") : t("Block");
    button.setAttribute('aria-label', button.textContent + t(" at ") + slot.time);
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await request('PATCH', { ...slot, blocked: !slot.blocked }, 'planning');
        planningStatus.textContent = slot.blocked ? t("Time slot unblocked.") : t("Time slot blocked.");
        await load();
      } catch (error) {
        planningStatus.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    row.append(time, badge, button);
    schedule.append(row);
  }
  if (!slots.length) schedule.textContent = t("No available or blocked time slots for this date.");

  list.replaceChildren(...dailyBookings.map(booking => {
    const card = document.createElement('article');
    card.dataset.bookingId = booking.id;
    card.tabIndex = -1;
    const heading = document.createElement('h3');
    const details = document.createElement('p');
    const contact = document.createElement('a');
    heading.textContent = booking.service;
    details.textContent = [booking.time, booking.duration + t(" min") + ' + ' + (booking.buffer || 0) + t(" min") + ' ' + t('cleanup'), booking.name].join(' · ');
    const badge = document.createElement('span');
    badge.className = 'planner-badge ' + booking.status;
    badge.textContent = labels[booking.status];
    contact.textContent = booking.phone || booking.email || '';
    contact.href = booking.phone ? 'tel:' + booking.phone.replace(/[^+0-9]/g, '') : 'mailto:' + encodeURIComponent(booking.email || '');
    card.append(badge, heading, details);
    if (contact.textContent) card.append(contact);
    if (['pending', 'confirmed'].includes(booking.status)) {
      const actions = document.createElement('div');
      for (const [next, label] of (booking.status === 'pending' ? [['confirmed', t("Confirm")], ['declined', t("Decline")]] : [['declined', t("Cancel appointment")]])) {
        const button = document.createElement('button');
        button.textContent = label;
        button.addEventListener('click', async () => {
          if (booking.status === 'confirmed' && !window.confirm(t("Cancel this appointment?"))) return;
          for (const control of actions.children) control.disabled = true;
          try {
            await request('PATCH', { id: booking.id, status: next });
            status.textContent = t("Request updated.");
            await load();
          } catch (error) {
            status.textContent = error.message;
            for (const control of actions.children) control.disabled = false;
          }
        });
        actions.append(button);
      }
      card.append(actions);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delete-booking';
    remove.textContent = t('Delete client details');
    remove.setAttribute('aria-label', t('Delete client details') + ' — ' + booking.name + ', ' + booking.time);
    remove.addEventListener('click', async () => {
      const upcoming = booking.status !== 'declined' && booking.day >= planning.today;
      const question = t('Permanently delete this booking with the name and phone number of the client? This cannot be undone.') +
        (upcoming ? '\n\n' + t('This appointment has not taken place yet. Its time becomes available again.') : '');
      if (!window.confirm(question)) return;
      remove.disabled = true;
      try {
        await request('DELETE', { id: booking.id });
        status.textContent = t('Client details deleted.');
        await load();
      } catch (error) {
        status.textContent = error.message;
        remove.disabled = false;
      }
    });
    card.append(remove);
    return card;
  }));
  if (!dailyBookings.length) list.textContent = t("No requests or appointments on this date.");
}
const dayFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' });
for (const button of document.querySelectorAll('[data-step]')) {
  button.addEventListener('click', () => {
    if (!planning) return;
    const next = new Date(date.value || planning.today);
    next.setUTCDate(next.getUTCDate() + Number(button.dataset.step) * (view.value === 'week' ? 7 : 1));
    date.value = next.toISOString().slice(0, 10);
    date.dispatchEvent(new Event('change'));
  });
}
document.querySelector('#today').addEventListener('click', () => {
  if (!planning) return;
  date.value = planning.today;
  date.dispatchEvent(new Event('change'));
});
date.addEventListener('change', () => {
  planningStatus.textContent = '';
  status.textContent = '';
  if (planning) render();
});
const manualPanel = document.querySelector('#manual-appointment');
const manualForm = document.querySelector('#manual-booking');
const manualStatus = document.querySelector('#manual-status');
const manualSave = manualForm.querySelector('button');
let availabilitySequence = 0;
let savingAppointment = false;
async function refreshManualAvailability() {
  const sequence = ++availabilitySequence;
  manualSave.disabled = true;
  manualForm.elements.time.replaceChildren();
  if (!manualForm.elements.service.value || !manualForm.elements.day.value) return;
  manualStatus.textContent = t('Loading available times…');
  try {
    const response = await fetch('/api/admin/availability?lang=' + language + '&service=' + encodeURIComponent(manualForm.elements.service.value) + '&day=' + encodeURIComponent(manualForm.elements.day.value));
    if (!response.ok) throw new Error(t('Could not load available times.'));
    const times = await response.json();
    if (sequence !== availabilitySequence) return;
    manualForm.elements.time.replaceChildren(...times.map(time => new Option(time, time)));
    manualStatus.textContent = times.length ? '' : t('No available times for this date and treatment.');
    manualSave.disabled = savingAppointment || !times.length;
  } catch (error) {
    if (sequence === availabilitySequence) manualStatus.textContent = error.message;
  }
}
manualPanel.addEventListener('toggle', () => {
  if (!manualPanel.open) return;
  manualForm.elements.day.value = date.value || planning?.today || '';
  refreshManualAvailability();
});
manualForm.elements.service.addEventListener('change', refreshManualAvailability);
manualForm.elements.day.addEventListener('change', refreshManualAvailability);
manualForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (savingAppointment || manualSave.disabled) return;
  savingAppointment = true;
  const values = Object.fromEntries(new FormData(manualForm));
  manualSave.disabled = true;
  for (const control of manualForm.elements) control.disabled = true;
  manualStatus.textContent = t('Saving appointment…');
  try {
    await request('POST', values);
    manualForm.reset();
    manualPanel.open = false;
    date.value = values.day;
    status.textContent = t('Appointment added.');
    await load().catch(() => {
      status.textContent += ' ' + t('Could not load the planner. Please refresh the page.');
    });
  } catch (error) {
    // Keep client details while refreshing a time that may have just been booked.
    await refreshManualAvailability();
    manualStatus.textContent = error.message;
  } finally {
    savingAppointment = false;
    for (const control of manualForm.elements) control.disabled = false;
    manualSave.disabled = !manualForm.elements.time.value;
  }
});
async function loadBuffers() {
  const services = await request('GET', undefined, 'buffers');
  const previousService = manualForm.elements.service.value;
  manualForm.elements.service.replaceChildren(...services.map(service => new Option(
    service.name + ' · ' + service.duration + t(' min') + ' + ' + service.buffer + t(' min') + ' ' + t('cleanup'), service.id
  )));
  if (previousService) manualForm.elements.service.value = previousService;
  if (manualPanel.open) await refreshManualAvailability();
  const container = document.querySelector('#buffer-settings');
  container.replaceChildren();
  for (const service of services) {
    const form = document.createElement('form');
    const label = document.createElement('label');
    label.textContent = service.name + ' · ' + t('Cleanup minutes');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '120';
    input.step = '1';
    input.required = true;
    input.value = service.buffer;
    label.append(input);
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = t('Save');
    form.append(label, save);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      save.disabled = true;
      const message = document.querySelector('#buffer-status');
      try {
        await request('PATCH', { id: service.id, buffer: Number(input.value) }, 'buffers');
        message.textContent = t('Cleanup time saved for new bookings.');
        await load();
      } catch (error) {
        message.textContent = error.message;
      } finally {
        save.disabled = false;
      }
    });
    container.append(form);
  }
}
loadBuffers().catch(error => { document.querySelector('#buffer-status').textContent = error.message; });
load().catch(error => { status.textContent = error.message; });

}
initializePlanner().catch(() => {
  document.querySelector('#status').textContent = {
    nl: 'De planner kon niet worden geladen. Vernieuw de pagina.',
    en: 'Could not load the planner. Please refresh the page.',
    uk: 'Не вдалося завантажити планувальник. Оновіть сторінку.'
  }[document.documentElement.lang];
});
