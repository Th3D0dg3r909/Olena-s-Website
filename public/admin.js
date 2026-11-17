const status = document.querySelector('#status');
const list = document.querySelector('#bookings');
const labels = { pending: 'In behandeling', confirmed: 'Bevestigd', declined: 'Afgewezen' };
async function request(method, body) {
  const response = await fetch('/api/admin/bookings', {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Olena-Request': '1' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
async function load() {
  const bookings = await request('GET');
  list.replaceChildren(...bookings.map(booking => {
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
  if (!bookings.length) status.textContent = 'Er zijn nog geen aanvragen.';
}
load().catch(error => { status.textContent = error.message; });
