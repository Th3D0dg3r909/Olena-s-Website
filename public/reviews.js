const reviewButton = document.querySelector('#load-reviews');
const reviewStatus = document.querySelector('#reviews-status');
const container = document.querySelector('#google-reviews');
const en = document.documentElement.lang === 'en';
function safeURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}
function link(text, url) {
  const element = document.createElement('a');
  element.textContent = text;
  const href = safeURL(url);
  if (href) element.href = href;
  return element;
}
reviewButton.addEventListener('click', async () => {
  reviewButton.disabled = true;
  reviewStatus.textContent = en ? 'Loading Google reviews…' : 'Google-reviews laden…';
  try {
    const response = await fetch('/api/reviews?lang=' + (en ? 'en' : 'nl'));
    if (!response.ok) throw new Error();
    const data = await response.json();
    container.replaceChildren();
    if (typeof data.rating === 'number') {
      const summary = document.createElement('p');
      summary.textContent = data.rating + ' / 5 · ' + (data.count || 0) + (en ? ' Google reviews' : ' Google-reviews');
      container.append(summary);
    }
    for (const review of data.reviews) {
      const card = document.createElement('article');
      const author = document.createElement('p');
      if (safeURL(review.author?.photoUri)) {
        const avatar = document.createElement('img');
        avatar.src = review.author.photoUri;
        avatar.alt = '';
        avatar.width = 40;
        avatar.height = 40;
        avatar.referrerPolicy = 'no-referrer';
        author.append(avatar);
      }
      author.append(link(review.author?.displayName || (en ? 'Google reviewer' : 'Google-reviewer'), review.author?.uri));
      const rating = document.createElement('p');
      rating.textContent = review.rating + ' / 5';
      const text = document.createElement('p');
      text.textContent = review.text;
      if (review.language) text.lang = review.language;
      card.append(author, rating, text);
      if (review.published && !Number.isNaN(Date.parse(review.published))) {
        const date = document.createElement('p');
        date.textContent = new Intl.DateTimeFormat(en ? 'en-GB' : 'nl-NL', { dateStyle: 'medium' }).format(new Date(review.published));
        card.append(date);
      }
      card.append(link(en ? 'View review on Google Maps' : 'Bekijk review op Google Maps', review.url));
      container.append(card);
    }
    for (const attribution of data.attributions || []) {
      container.append(link(attribution.provider || 'Google Maps', attribution.providerUri));
    }
    if (data.url) container.append(link(en ? 'View all reviews on Google Maps' : 'Bekijk alle reviews op Google Maps', data.url));
    reviewStatus.textContent = data.reviews.length
      ? (en ? 'Reviews supplied by Google Maps, sorted by relevance.' : 'Reviews van Google Maps, gesorteerd op relevantie.')
      : (en ? 'No review texts are available.' : 'Er zijn geen reviewteksten beschikbaar.');
    reviewButton.hidden = true;
  } catch {
    reviewStatus.textContent = en ? 'Google reviews are currently unavailable. Please try again later.' : 'Google-reviews zijn momenteel niet beschikbaar. Probeer het later opnieuw.';
    reviewButton.disabled = false;
  }
});
