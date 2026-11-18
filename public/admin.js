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
function render() {
  const day = date.value;
  document.querySelector('#selected-day').textContent = day ? dayFormat.format(new Date(day)) : 'Choose a date';
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
    const heading = document.createElement('h3');
    const details = document.createElement('p');
    const email = document.createElement('a');
    heading.textContent = booking.service;
    details.textContent = [booking.time, booking.duration + ' min', booking.name].join(' · ');
    const badge = document.createElement('span');
    badge.className = 'planner-badge ' + booking.status;
    badge.textContent = labels[booking.status];
    email.textContent = booking.email;
    email.href = 'mailto:' + encodeURIComponent(booking.email);
    card.append(badge, heading, details, email);
    if (booking.status === 'pending') {
      const actions = document.createElement('div');
      for (const [next, label] of [['confirmed', 'Confirm'], ['declined', 'Decline']]) {
        const button = document.createElement('button');
        button.textContent = label;
        button.addEventListener('click', async () => {
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
    next.setUTCDate(next.getUTCDate() + Number(button.dataset.step));
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
