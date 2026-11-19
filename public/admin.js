const status = document.querySelector('#status');
const list = document.querySelector('#bookings');
const labels = { pending: 'Pending', confirmed: 'Confirmed', declined: 'Declined' };
async function request(method, body, endpoint = 'bookings') {
  const response = await fetch('/api/admin/' + endpoint + '?lang=en', {
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
  if (!date.value) date.value = planning.today;
  render();
}
const view = document.querySelector('#calendar-view');
const calendar = document.querySelector('#calendar');
if (window.matchMedia('(max-width: 42rem)').matches) view.value = 'day';
const shortDate = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
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
  spacer.textContent = 'Time';
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
      cell.setAttribute('aria-label', shortDate.format(new Date(day)) + ' ' + time + (free ? ', manage availability' : ', unavailable'));
      if (free) {
        cell.textContent = '+';
        cell.addEventListener('click', () => {
          selectDay(day);
          const control = [...schedule.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === 'Block at ' + time);
          control?.focus();
        });
      }
      timeline.append(cell);
    }
    const entries = [
      ...bookings.filter(booking => booking.day === day && booking.status !== 'declined'),
      ...planning.blocked.filter(slot => slot.day === day).map(slot => ({ ...slot, duration: 60, status: 'blocked', name: 'Blocked' })),
    ];
    for (const entry of entries) {
      const offset = timeMinutes(entry.time) - 600;
      const duration = Math.min(entry.duration, 660 - offset);
      if (offset < 0 || duration <= 0) continue;
      const event = document.createElement('button');
      event.type = 'button';
      event.className = 'calendar-event ' + entry.status + ' start-' + offset + ' duration-' + duration;
      event.textContent = entry.time + ' · ' + entry.name;
      event.title = [entry.name, entry.service, entry.duration + ' min', labels[entry.status] || 'Blocked'].filter(Boolean).join(' · ');
      event.setAttribute('aria-label', event.title);
      event.addEventListener('click', () => {
        selectDay(day);
        const target = entry.id
          ? [...list.querySelectorAll('article')].find(card => card.dataset.bookingId === entry.id)
          : [...schedule.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === 'Unblock at ' + entry.time);
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
    badge.textContent = slot.blocked ? 'Blocked' : 'Available';
    button.textContent = slot.blocked ? 'Unblock' : 'Block';
    button.setAttribute('aria-label', button.textContent + ' at ' + slot.time);
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await request('PATCH', { ...slot, blocked: !slot.blocked }, 'planning');
        planningStatus.textContent = slot.blocked ? 'Time slot unblocked.' : 'Time slot blocked.';
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
  if (!slots.length) schedule.textContent = 'No available or blocked time slots for this date.';

  list.replaceChildren(...dailyBookings.map(booking => {
    const card = document.createElement('article');
    card.dataset.bookingId = booking.id;
    card.tabIndex = -1;
    const heading = document.createElement('h3');
    const details = document.createElement('p');
    const contact = document.createElement('a');
    heading.textContent = booking.service;
    details.textContent = [booking.time, booking.duration + ' min', booking.name].join(' · ');
    const badge = document.createElement('span');
    badge.className = 'planner-badge ' + booking.status;
    badge.textContent = labels[booking.status];
    contact.textContent = booking.phone || booking.email || '';
    contact.href = booking.phone ? 'tel:' + booking.phone.replace(/[^+0-9]/g, '') : 'mailto:' + encodeURIComponent(booking.email || '');
    card.append(badge, heading, details);
    if (contact.textContent) card.append(contact);
    if (['pending', 'confirmed'].includes(booking.status)) {
      const actions = document.createElement('div');
      for (const [next, label] of (booking.status === 'pending' ? [['confirmed', 'Confirm'], ['declined', 'Decline']] : [['declined', 'Cancel appointment']])) {
        const button = document.createElement('button');
        button.textContent = label;
        button.addEventListener('click', async () => {
          if (booking.status === 'confirmed' && !window.confirm('Cancel this appointment?')) return;
          for (const control of actions.children) control.disabled = true;
          try {
            await request('PATCH', { id: booking.id, status: next });
            status.textContent = 'Request updated.';
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
    return card;
  }));
  if (!dailyBookings.length) list.textContent = 'No requests or appointments on this date.';
}
const dayFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: 'UTC' });
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
load().catch(error => { status.textContent = error.message; });
