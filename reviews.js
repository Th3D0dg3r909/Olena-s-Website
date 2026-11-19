export async function getReviews(language) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const placeId = process.env.GOOGLE_PLACE_ID;
  if (!key || !placeId) return { status: 503, data: { error: 'Reviews are not connected yet.' } };
  const response = await fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(placeId) + '?languageCode=' + language, {
    headers: {
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'rating,userRatingCount,googleMapsUri,reviews,attributions',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return { status: 502, data: { error: 'Google reviews are temporarily unavailable.' } };
  const data = await response.json();
  return {
    status: 200,
    data: {
      rating: data.rating, count: data.userRatingCount, url: data.googleMapsUri,
      attributions: data.attributions || [],
      reviews: (data.reviews || []).slice(0, 5).map(review => ({
        rating: review.rating,
        text: review.originalText?.text || review.text?.text || '',
        language: review.originalText?.languageCode || review.text?.languageCode,
        author: review.authorAttribution,
        url: review.googleMapsUri,
        published: review.publishTime,
      })),
    },
  };
}
