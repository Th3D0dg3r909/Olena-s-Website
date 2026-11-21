# Olena Skin Care Studio

Nederlandstalige Node.js-webapp voor een huidverzorgingsstudio in Leiden. Klanten boeken direct met hun naam en telefoonnummer. Nieuwe afspraken worden automatisch bevestigd. Olena beheert de afspraken via `/admin`.

## Starten

Gebruik Node.js 24 of hoger. De app gebruikt de ingebouwde SQLite-module en heeft geen npm-afhankelijkheden.

```sh
ADMIN_PASSWORD='vervang-dit-door-een-lang-uniek-wachtwoord' npm start
```

Open http://localhost:3000. Voor `/admin` is de gebruikersnaam `olena`. Zonder `ADMIN_PASSWORD` is beheer uitgeschakeld. Online boeken is beschikbaar zodra de app draait. Gebruik op hosting HTTPS en stel het wachtwoord in via de omgevingsvariabelen van de host.

| Variabele | Gedrag |
| --- | --- |
| `PORT` | Standaard 3000. |
| `HOST` | Standaard 0.0.0.0. |
| `ADMIN_PASSWORD` | Minimaal 16 tekens. |
| `DATABASE_PATH` | Standaard `./data/bookings.sqlite`. Gebruik op hosting een blijvend schrijfbaar pad buiten de uitrolmap en maak back-ups. |
| `WHATSAPP_NUMBER` | Optioneel internationaal nummer met alleen cijfers. |
| `REVIEWS_CACHE_MINUTES` | Standaard 60 (5 tot 1440). Zo lang worden Google-reviews in het geheugen bewaard. |
| `BOOKING_RETENTION_MONTHS` | Standaard 12 (1 tot 120). Boekingen worden zo lang na de afspraakdatum automatisch verwijderd. Pas bij een andere waarde ook de privacyverklaring aan. |

## Boekingen

Een boeking wordt direct bevestigd en reserveert de maximale behandelduur uit services.json. Starttijden zijn per kwartier beschikbaar op dinsdag, donderdag en zaterdag tussen 10.00 en 19.00 uur. Behandelingen eindigen uiterlijk om 21.00 uur. Geblokkeerde tijdsloten duren een uur. Annuleren geeft de tijd weer vrij.

Tegen nepboekingen kan één bezoeker online maximaal 3 afspraken per uur en 6 per dag boeken, en staan per telefoonnummer maximaal 2 toekomstige afspraken. Een verborgen formulierveld houdt automatische invullers tegen. Olena kan in de planner zonder deze limieten afspraken toevoegen, tot een jaar vooruit en ook in geblokkeerde tijd. Dubbele afspraken blijven onmogelijk.

De website vraagt naam en telefoonnummer. De bevestiging verschijnt direct op de website met boekingsnummer. Bestaande boekingen en e-mailadressen blijven in de database beschikbaar. Boekingen van vóór de duurmigratie behouden een duur van 60 minuten.

De 27 behandelingen en hun Nederlandse en Engelse teksten staan in services.json. De website biedt beide talen. De beheerplanner gebruikt Engels. Het sfeerbeeld in de hero toont een gezichtsbehandeling met hoofdmassage in warm kaarslicht (`public/studio.webp`, 1179 × 763, en `public/studio-mobile.webp`, 640 breed); het label „Sfeerbeeld” geeft aan dat het geen foto van de studio zelf is.

Gebruik voor DATABASE_PATH een blijvend pad en maak back-ups.

## Privacy

De privacyverklaring staat op `/privacy` in het Nederlands, Engels en Oekraïens (`public/privacy*.html`) en is gelinkt vanuit het boekingsformulier en de footer. Laat Olena de tekst controleren. Boekingen worden dagelijks en bij het starten van de server verwijderd zodra ze ouder zijn dan `BOOKING_RETENTION_MONTHS`; verlopen geblokkeerde tijdsloten worden ook opgeruimd. Op verzoek van een klant kan Olena in de planner met **Klantgegevens verwijderen** een afspraak met naam en telefoonnummer definitief verwijderen; een toekomstige afspraak geeft daarbij de tijd weer vrij. De database overschrijft verwijderde gegevens direct (`secure_delete`).

## Caching

Bestanden die met `?v=` worden gelinkt, bewaart de browser een jaar. De server zet bij het starten elke `?v=` in de pagina's op de inhoudshash van het bestand, zodat een gewijzigd bestand altijd een nieuw adres krijgt. Pagina's en vertaalbestanden worden bij elk bezoek gecontroleerd en alleen opnieuw gedownload als ze zijn veranderd. Planner en API worden nooit bewaard.

## Google reviews

Set GOOGLE_PLACES_API_KEY and GOOGLE_PLACE_ID in Hostinger. Enable Places API (New) and billing in Google Cloud. Restrict the key to Places API (New) and, where hosting permits, its outbound IP. Reviews load automatically on page load and are not stored in the database. They are kept in memory for REVIEWS_CACHE_MINUTES and shared between visitors, so Google is called at most about once per language per period; each call may incur charges. Set an appropriate request quota in Google Cloud. Test the configured business before publishing.
