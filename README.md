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

## Boekingen

Een boeking wordt direct bevestigd en reserveert de maximale behandelduur uit services.json. Starttijden zijn per kwartier beschikbaar op dinsdag, donderdag en zaterdag tussen 10.00 en 19.00 uur. Behandelingen eindigen uiterlijk om 21.00 uur. Geblokkeerde tijdsloten duren een uur. Annuleren geeft de tijd weer vrij.

De website vraagt naam en telefoonnummer. De bevestiging verschijnt direct op de website met boekingsnummer. Bestaande boekingen en e-mailadressen blijven in de database beschikbaar. Boekingen van vóór de duurmigratie behouden een duur van 60 minuten.

De 27 behandelingen en hun Nederlandse en Engelse teksten staan in services.json. De website biedt beide talen. De beheerplanner gebruikt Engels. Het neutrale gegenereerde sfeerbeeld toont handdoeken en verzorgingsaccessoires.

Gebruik voor DATABASE_PATH een blijvend pad en maak back-ups. Stem de privacytekst af met Olena voordat klanten de website gebruiken.

## Google reviews

Set GOOGLE_PLACES_API_KEY and GOOGLE_PLACE_ID in Hostinger. Enable Places API (New) and billing in Google Cloud. Restrict the key to Places API (New) and, where hosting permits, its outbound IP. Reviews load automatically on page load and are not stored in the database. Each load calls Google and may incur charges. Set an appropriate request quota in Google Cloud. Test the configured business before publishing.
