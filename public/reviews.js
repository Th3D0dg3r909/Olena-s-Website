(() => {
const reviewStatus = document.querySelector('#reviews-status');
const container = document.querySelector('#google-reviews');
const language = document.documentElement.lang;
const en = language === 'en';
const ukrainian = {" Google reviews": " відгуків Google", "Google reviewer": "Користувач Google", " out of 5 stars": " із 5 зірок", "View review on Google Maps": "Переглянути відгук у Google Maps", "View all reviews on Google Maps": "Усі відгуки в Google Maps", "Reviews supplied by Google Maps, sorted by relevance.": "Відгуки надано Google Maps і впорядковано за релевантністю.", "No review texts are available.": "Тексти відгуків недоступні.", "Google reviews are currently unavailable. Please try again later.": "Відгуки Google наразі недоступні. Спробуйте пізніше."};
const localized = (english, dutch) => language === 'uk' ? ukrainian[english] || english : en ? english : dutch;
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
async function loadReviews() {
  reviewStatus.textContent = localized("Loading Google reviews\u2026", "Google-reviews laden\u2026");
  try {
    const response = await fetch('/api/reviews?lang=' + language);
    if (!response.ok) throw new Error();
    const data = await response.json();
    container.replaceChildren();
    if (typeof data.rating === 'number') {
      const summary = document.createElement('p');
      summary.textContent = data.rating + ' / 5 · ' + (data.count || 0) + (localized(" Google reviews", " Google-reviews"));
      summary.className = 'review-summary';
      container.append(summary);
    }
    const grid = document.createElement('div');
    grid.className = 'review-grid';
    container.append(grid);
    for (const review of data.reviews) {
      const card = document.createElement('article');
      card.className = 'review-card';
      const author = document.createElement('p');
      author.className = 'review-author';
      if (safeURL(review.author?.photoUri)) {
        const avatar = document.createElement('img');
        avatar.src = review.author.photoUri;
        avatar.alt = '';
        avatar.width = 40;
        avatar.height = 40;
        avatar.referrerPolicy = 'no-referrer';
        author.append(avatar);
      }
      author.append(link(review.author?.displayName || (localized("Google reviewer", "Google-reviewer")), review.author?.uri));
      const rating = document.createElement('p');
      rating.className = 'review-stars';
      rating.setAttribute('aria-label', review.rating + (localized(" out of 5 stars", " van 5 sterren")));
      const stars = document.createElement('span');
      stars.setAttribute('aria-hidden', 'true');
      stars.textContent = '★'.repeat(Math.max(0, Math.min(5, Math.round(review.rating || 0))));
      rating.append(stars);
      const text = document.createElement('p');
      text.className = 'review-text';
      text.textContent = review.text;
      if (review.language) text.lang = review.language;
      card.append(author, rating, text);
      if (review.published && !Number.isNaN(Date.parse(review.published))) {
        const date = document.createElement('p');
        date.className = 'review-date';
        date.textContent = new Intl.DateTimeFormat(language === 'uk' ? 'uk-UA' : en ? 'en-GB' : 'nl-NL', { dateStyle: 'medium' }).format(new Date(review.published));
        card.append(date);
      }
      card.append(link(localized("View review on Google Maps", "Bekijk review op Google Maps"), review.url));
      grid.append(card);
    }
    for (const attribution of data.attributions || []) {
      container.append(link(attribution.provider || 'Google Maps', attribution.providerUri));
    }
    if (data.url) container.append(link(localized("View all reviews on Google Maps", "Bekijk alle reviews op Google Maps"), data.url));
    reviewStatus.textContent = data.reviews.length
      ? (localized("Reviews supplied by Google Maps, sorted by relevance.", "Reviews van Google Maps, gesorteerd op relevantie."))
      : (localized("No review texts are available.", "Er zijn geen reviewteksten beschikbaar."));
  } catch {
    reviewStatus.textContent = localized("Google reviews are currently unavailable. Please try again later.", "Google-reviews zijn momenteel niet beschikbaar. Probeer het later opnieuw.");
  }
}
loadReviews();

})();
