// Browser checks with Playwright. Skipped when Playwright is not installed.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer, temporaryDatabase } from './helpers.mjs';

let playwright = null;
try {
  playwright = createRequire(import.meta.url)('playwright');
} catch {}
const PASSWORD = 'synthetic test password 42';
const screenshots = process.env.SCREENSHOT_DIR;
const expected = {
  nl: {
    button: 'Afspraak aanvragen via WhatsApp',
    treatment: 'PRX-T33 Gezicht + Hals',
    message: 'Hallo Olena, ik wil graag een afspraak aanvragen voor PRX-T33 Gezicht + Hals. Mijn voorkeursdag is: […]. Mijn voorkeurstijd is: […]. Ik begrijp dat de afspraak pas vaststaat na jouw persoonlijke bevestiging.',
    response: 'Ik reageer op berichten tussen 09.00 en 21.00 uur, meestal binnen 4 uur.',
  },
  en: {
    button: 'Request an appointment via WhatsApp',
    treatment: 'PRX-T33 Face + Neck',
    message: 'Hello Olena, I would like to request an appointment for PRX-T33 Face + Neck. My preferred day is: […]. My preferred time is: […]. I understand that the appointment is only confirmed after your personal confirmation.',
    response: 'I reply to messages between 09:00 and 21:00, usually within 4 hours.',
  },
  uk: {
    button: 'Надіслати запит на запис у WhatsApp',
    treatment: 'PRX-T33 обличчя + шия',
    message: 'Вітаю, Олено! Хочу записатися на процедуру «PRX-T33 обличчя + шия». Бажаний день: […]. Бажаний час: […]. Розумію, що запис буде остаточним лише після вашого особистого підтвердження.',
    response: 'Я відповідаю на повідомлення з 09:00 до 21:00, зазвичай протягом 4 годин.',
  },
};
const messageOf = href => {
  const url = new URL(href);
  assert.equal(url.origin + url.pathname, 'https://wa.me/31647238444');
  return url.searchParams.get('text');
};

describe('in the browser', { skip: !playwright && 'Playwright is not installed' }, () => {
  const database = temporaryDatabase();
  let server;
  let browser;
  before(async () => {
    server = await startServer({ ADMIN_PASSWORD: PASSWORD }, database.path);
    browser = await playwright.chromium.launch();
  });
  after(async () => {
    await browser?.close();
    await server?.stop();
    database.remove();
  });
  async function page(options = {}) {
    const context = await browser.newContext(options);
    // WhatsApp itself is never contacted during tests.
    await context.route('https://wa.me/**', route => route.fulfill({ status: 200, body: 'WhatsApp' }));
    await context.route('https://api.whatsapp.com/**', route => route.fulfill({ status: 200, body: 'WhatsApp' }));
    return context.newPage();
  }

  for (const [language, text] of Object.entries(expected)) {
    test('WhatsApp requests in ' + language + ' never create an appointment', async () => {
      const tab = await page();
      const writes = [];
      tab.context().on('request', request => { if (request.method() !== 'GET') writes.push(request.method() + ' ' + request.url()); });
      await tab.goto(server.url + '/?lang=' + language);
      const prx = tab.locator('#services article').filter({ has: tab.getByRole('heading', { name: text.treatment, exact: true }) });
      await prx.waitFor();
      const link = prx.locator('a.treatment-request');
      assert.equal((await link.textContent()).trim(), text.button);
      assert.equal(messageOf(await link.getAttribute('href')), text.message);
      assert.equal(await link.getAttribute('target'), '_blank');

      // The request panel: a general message first, then the selected treatment.
      assert.match(messageOf(await tab.locator('#request-link').getAttribute('href')), /\[…\]/);
      await tab.selectOption('#request-service', 'treatment-28');
      assert.equal(messageOf(await tab.locator('#request-link').getAttribute('href')), text.message);
      assert.equal(await tab.locator('#afspraak .response-time').textContent(), text.response);
      assert.equal(await tab.locator('#contact .response-time').textContent(), text.response);
      assert.equal(await tab.locator('#afspraak a[href="tel:+31647238444"]').count(), 1);

      const [popup] = await Promise.all([tab.waitForEvent('popup'), link.click()]);
      assert.match(popup.url(), /^https:\/\/wa\.me\/31647238444\?text=/);
      await tab.waitForTimeout(300);
      assert.deepEqual(writes, [], 'opening WhatsApp sends nothing to the website');
      await tab.context().close();
    });
  }

  test('treatment names with special characters are encoded safely', async () => {
    const tab = await page();
    await tab.goto(server.url + '/?lang=en');
    const card = tab.locator('#services article', { hasText: 'Deep Cleansing & Hydration Facial' });
    assert.match(messageOf(await card.locator('a.treatment-request').getAttribute('href')), /for Deep Cleansing & Hydration Facial\./);
    for (const href of await tab.locator('a.treatment-request').evaluateAll(links => links.map(link => link.href))) {
      assert.doesNotThrow(() => messageOf(href));
      assert.ok(!/[\s&]/.test(new URL(href).search.slice(6)), 'text parameter is fully encoded');
    }
    await tab.context().close();
  });

  for (const [label, options] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { ...(playwright?.devices['iPhone 13'] || {}) }]]) {
    test(label + ' layout has no horizontal scrolling and shows the full PRX-T33 description', async () => {
      const tab = await page(options);
      for (const path of ['/?lang=en', '/?lang=uk', '/', '/privacy?lang=en', '/admin?lang=uk']) {
        await tab.goto(server.url + path);
        await tab.waitForTimeout(300);
        assert.equal(await tab.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, path);
      }
      await tab.goto(server.url + '/?lang=en');
      const description = tab.locator('#services article').filter({ has: tab.getByRole('heading', { name: 'PRX-T33 Face', exact: true }) }).locator('.treatment-description');
      await description.waitFor();
      assert.equal(await description.textContent(), 'No-needle biorevitalizing peel for instant glow, smoother fine lines, and long-lasting lift.');
      assert.equal(await description.evaluate(element => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1), true);
      if (screenshots) {
        await description.locator('xpath=..').screenshot({ path: screenshots + '/prx-' + label + '.png' });
        await tab.locator('#afspraak').screenshot({ path: screenshots + '/request-' + label + '.png' });
      }
      await tab.context().close();
    });
  }

  test('the photo section shows six photos of Olena in every language', async () => {
    const tab = await page({ viewport: { width: 1280, height: 900 } });
    for (const language of ['nl', 'en', 'uk']) {
      await tab.goto(server.url + '/?lang=' + language);
      const photos = tab.locator('#olena .photo-grid img');
      assert.equal(await photos.count(), 6);
      await tab.locator('#olena').scrollIntoViewIfNeeded();
      await tab.waitForFunction(() => [...document.querySelectorAll('#olena img')].every(image => image.complete && image.naturalWidth > 0));
      for (const alt of await photos.evaluateAll(images => images.map(image => image.alt))) assert.ok(alt.length > 20, alt);
      assert.equal(await tab.locator('#olena figcaption').count(), 6);
    }
    if (screenshots) await tab.locator('#olena').screenshot({ path: screenshots + '/gallery-desktop.png' });
    await tab.context().close();
  });

  test('login, planner, logout and expired sessions in the interface', async () => {
    const tab = await page({ viewport: { width: 1280, height: 900 } });
    await tab.goto(server.url + '/admin?lang=nl');
    assert.equal(await tab.locator('h1').textContent(), 'Inloggen planner');
    await tab.fill('input[name=username]', 'olena');
    await tab.fill('input[name=password]', 'not the password!');
    await tab.click('#login-form button');
    await tab.waitForFunction(() => document.querySelector('#login-status').textContent.includes('onjuist'));
    if (screenshots) await tab.screenshot({ path: screenshots + '/login-nl.png' });
    await tab.fill('input[name=password]', PASSWORD);
    await tab.click('#login-form button');
    await tab.waitForSelector('#calendar .calendar-column');
    const cookies = await tab.context().cookies();
    assert.equal(cookies.length, 1);
    assert.equal(cookies[0].httpOnly, true);
    assert.deepEqual(await tab.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie]), [0, 0, '']);
    await tab.click('#logout');
    await tab.waitForSelector('[data-message="logged-out"]:not([hidden])');
    assert.equal(await tab.locator('#bookings').count(), 0);

    // A session the server no longer knows is reported as expired.
    await tab.setExtraHTTPHeaders({ cookie: '__Host-olena_admin=' + 'x'.repeat(43) });
    await tab.goto(server.url + '/admin?lang=en');
    assert.equal(await tab.locator('[data-message="expired"]').isVisible(), true);
    await tab.context().close();
  });

  test('missing admin configuration shows a helpful message', async () => {
    const other = temporaryDatabase();
    const unconfigured = await startServer({}, other.path);
    try {
      const tab = await page();
      await tab.goto(unconfigured.url + '/admin?lang=uk');
      assert.equal(await tab.locator('[data-message="not-configured"]').isVisible(), true);
      assert.match(await tab.locator('[data-message="not-configured"]').textContent(), /не налаштовано/);
      assert.equal(await tab.locator('#login-form button').isDisabled(), true);
      await tab.context().close();
    } finally {
      await unconfigured.stop();
      other.remove();
    }
  });
});
