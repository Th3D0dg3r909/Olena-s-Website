// Login form for Olena's planner. The session lives in an HttpOnly cookie set by the server;
// nothing about the login is kept in browser storage.
const form = document.querySelector('#login-form');
const status = document.querySelector('#login-status');
const language = document.documentElement.lang;
const params = new URLSearchParams(window.location.search);
const text = key => document.querySelector('[data-message="' + key + '"]').textContent;
const notice = key => { document.querySelector('[data-message="' + key + '"]').hidden = false; };
const state = document.body.dataset.state;
if (state === 'not-configured') {
  notice('not-configured');
  for (const control of form.elements) control.disabled = true;
} else if (state === 'expired' || params.get('expired') === '1') {
  notice('expired');
} else if (params.get('logged-out') === '1') {
  notice('logged-out');
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  status.textContent = text('busy');
  try {
    const response = await fetch('/api/auth/login?lang=' + language, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Olena-Request': '1' },
      body: JSON.stringify({ username: form.elements.username.value, password: form.elements.password.value }),
    });
    const result = await response.json();
    if (response.ok) {
      // Reload the planner address without the login notices, keeping the chosen language and day.
      const next = new URL(window.location.href);
      next.searchParams.delete('expired');
      next.searchParams.delete('logged-out');
      window.location.replace(next.pathname + next.search);
      return;
    }
    status.textContent = result.error;
    form.elements.password.value = '';
    form.elements.password.focus();
  } catch {
    status.textContent = text('network');
  } finally {
    button.disabled = false;
  }
});
