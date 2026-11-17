const status = document.querySelector('#status');
const list = document.querySelector('#bookings');
const labels = { pending: 'In behandeling', confirmed: 'Bevestigd', declined: 'Afgewezen' };
async function request(method, body, endpoint = 'bookings') {
  const response = await fetch('/api/admin/' + endpoint, {
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
  const dailyBookings = bookings.filter(booking => booking.day === day);
  schedule.replaceChildren();
  const slots = [
    ...planning.free.map(slot => ({ ...slot, blocked: false })),
    ...planning.blocked.map(slot => ({ ...slot, blocked: true })),
  ].filter(slot => slot.day === day).sort((a, b) => a.time.localeCompare(b.time));
  for (const slot of slots) {
    const button = document.createElement('button');
    button.textContent = slot.time + (slot.blocked ? ' · Vrijgeven' : ' · Blokkeren');
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await request('PATCH', { ...slot, blocked: !slot.blocked }, 'planning');
        planningStatus.textContent = slot.blocked ? 'Tijdslot vrijgegeven.' : 'Tijdslot geblokkeerd.';
        await load();
      } catch (error) {
        planningStatus.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    schedule.append(button);
  }
  if (!slots.length) schedule.textContent = 'Geen vrije of geblokkeerde tijdsloten voor deze datum.';

  list.replaceChildren(...dailyBookings.map(booking => {
    const card = document.createElement('article');
    const heading = document.createElement('h3');
    const details = document.createElement('p');
    const email = document.createElement('a');
    heading.textContent = booking.service;
    details.textContent = [booking.day, booking.time, booking.name, labels[booking.status]].join(' · ');
    email.textContent = booking.email;
    email.href = 'mailto:' + encodeURIComponent(booking.email);
    card.append(heading, details, email);
    if (booking.status === 'pending') {
      const actions = document.createElement('div');
      for (const [next, label] of [['confirmed', 'Bevestigen'], ['declined', 'Afwijzen']]) {
        const button = document.createElement('button');
        button.textContent = label;
        button.addEventListener('click', async () => {
          for (const control of actions.children) control.disabled = true;
          try {
            await request('PATCH', { id: booking.id, status: next });
            status.textContent = 'Aanvraag bijgewerkt.';
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
  if (!dailyBookings.length) list.textContent = 'Geen aanvragen of afspraken op deze datum.';
}
date.addEventListener('change', () => {
  planningStatus.textContent = '';
  status.textContent = '';
  if (planning) render();
});
load().catch(error => { status.textContent = error.message; });
