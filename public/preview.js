// Access code form on the "opening soon" page. The server sets an HttpOnly preview cookie on success.
const form = document.querySelector('#preview-form');
if (form) {
  const status = document.querySelector('#preview-status');
  const text = key => document.querySelector('[data-message="' + key + '"]').textContent;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    status.textContent = text('busy');
    try {
      const response = await fetch('/api/preview?lang=' + document.documentElement.lang, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Olena-Request': '1' },
        body: JSON.stringify({ code: form.elements.code.value }),
      });
      const result = await response.json();
      if (response.ok) return window.location.reload();
      status.textContent = result.error;
      form.elements.code.value = '';
      form.elements.code.focus();
    } catch {
      status.textContent = text('network');
    } finally {
      button.disabled = false;
    }
  });
}
