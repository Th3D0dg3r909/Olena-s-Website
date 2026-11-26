# Olena Skin Care Studio

Node.js-webapp voor een huidverzorgingsstudio in Leiden, in het Nederlands, Engels en Oekraïens. Klanten vragen een afspraak aan via WhatsApp; Olena bevestigt elke afspraak persoonlijk en zet hem in haar planner op `/admin`.

**Status:** `olena.td909-creativedesign.nl` is de concept- en reviewomgeving, geen productiesite. Zoekmachines worden daar buiten gehouden. De definitieve site komt later op Olena's eigen domein; zie [docs/LAUNCH.md](docs/LAUNCH.md).

## Starten en testen

Gebruik Node.js 24 of hoger. De app gebruikt de ingebouwde SQLite-module en heeft geen npm-afhankelijkheden.

```sh
ADMIN_PASSWORD='vervang-dit-door-een-lang-uniek-wachtwoord' npm start
```

Open http://localhost:3000. `npm test` draait de tests met tijdelijke databases; de browsertests draaien alleen als Playwright beschikbaar is.

| Variabele | Gedrag |
| --- | --- |
| `PORT`, `HOST` | Standaard 3000 en 0.0.0.0. Niet instellen op Hostinger. |
| `ADMIN_PASSWORD` | Minimaal 16 tekens. Ontbreekt het of is het te kort, dan draait de website gewoon door, is alleen inloggen uitgeschakeld en staat de reden in het log (zonder het wachtwoord). |
| `ADMIN_USERNAME` | Standaard `olena`. |
| `ADMIN_SESSION_IDLE_MINUTES` | Standaard 30 (5 tot 240). Uitloggen na zoveel minuten zonder activiteit. |
| `ADMIN_SESSION_MAX_HOURS` | Standaard 12 (1 tot 72). Een sessie duurt nooit langer. |
| `DATABASE_PATH` | Standaard `./data/bookings.sqlite`. Gebruik op hosting een blijvend pad buiten de uitrolmap en maak back-ups. Op Hostinger staat de app in `hbuilds/current/nodejs`, dat bij elke uitrol naar een nieuwe map wijst; gebruik daar `/home/<gebruiker>/domains/<domein>/data/bookings.sqlite`. Elke omgeving (concept en productie) heeft een eigen database. |
| `PUBLIC_URL` | Openbaar adres van deze omgeving, bijvoorbeeld `https://olena.td909-creativedesign.nl`. Zorgt voor canonical-links, hreflang en `/sitemap.xml`, bepaalt het toegestane adres voor beheerverzoeken en of cookies `Secure` zijn (bij `https`). |
| `ALLOW_INDEXING` | Alleen op de goedgekeurde productiesite `true`. Anders krijgt elke pagina `X-Robots-Tag: noindex, nofollow` en verbiedt `robots.txt` alles. |
| `REDIRECT_TO_PUBLIC_URL` | `true` stuurt verzoeken op een andere hostnaam met een 301 door naar `PUBLIC_URL`. Standaard uit. |
| `MAINTENANCE_MODE` | `true` zet de site op „Binnenkort open”: bezoekers zien een wachtpagina met contactgegevens (HTTP 503). Ingelogd op de planner ziet Olena de hele site, met een voorvertoningsbalk. |
| `MAINTENANCE_ACCESS_CODE` | Optioneel, minimaal 12 tekens. Met deze code op de wachtpagina krijgen anderen (zoals de websitebeheerder) 30 dagen toegang in die browser. Een nieuwe code maakt eerdere toegang ongeldig. |
| `COOKIE_SECURE` | Alleen zonder `PUBLIC_URL`: `false` voor lokaal testen over http. |
| `WHATSAPP_NUMBER` | Optioneel internationaal nummer met alleen cijfers. Standaard 31647238444, het nummer dat al op de website stond. |
| `REVIEWS_CACHE_MINUTES` | Standaard 60 (5 tot 1440). Zo lang worden Google-reviews in het geheugen bewaard. |
| `BOOKING_RETENTION_MONTHS` | Standaard 12 (1 tot 120). Afspraken worden zo lang na de afspraakdatum automatisch verwijderd. Pas bij een andere waarde ook de privacyverklaring aan. |

## Afspraken aanvragen

Elke behandeling heeft een knop **Afspraak aanvragen via WhatsApp**. Die opent WhatsApp met een vooraf ingevuld, aanpasbaar bericht met de behandeling en ruimte voor voorkeursdag en -tijd. De klant verstuurt het bericht zelf. De website maakt daarbij niets aan en reserveert niets; WhatsApp-berichten komen niet automatisch in de planner. Bij de knoppen en de contactgegevens staat: „Ik reageer op berichten tussen 09.00 en 21.00 uur, meestal binnen 4 uur.” Het telefoonnummer staat erbij als alternatief.

Het vroegere publieke boekingsadres `/api/bookings` geeft nu 410 en kan geen afspraken meer maken. Bestaande afspraken blijven in de database staan.

## Planner en inloggen

Olena logt in op `/admin` met gebruikersnaam en wachtwoord. Het wachtwoord wordt met scrypt gecontroleerd; de sessie staat in een `HttpOnly`, `Secure`, `SameSite=Strict`-cookie (`__Host-olena_admin`), waarvan de server alleen een hash bewaart. Sessies verlopen na 30 minuten zonder activiteit en na uiterlijk 12 uur; uitloggen maakt de sessie op de server ongeldig. Na 5 mislukte pogingen vanaf één adres, of 20 in totaal, wordt inloggen 15 minuten geblokkeerd. Verzoeken vanaf andere websites worden geweigerd. Er is geen registratie en geen standaardwachtwoord.

In de planner zet Olena bevestigde afspraken (tot een jaar vooruit, ook in geblokkeerde tijd), blokkeert of geeft ze tijd vrij, stelt ze opruimtijd per behandeling in en kan ze klantgegevens verwijderen. De planner controleert werktijden (dinsdag, donderdag en zaterdag, start 10.00–19.00 uur, klaar om 21.00 uur), behandelduur en opruimtijd, en voorkomt overlappende afspraken.

**Wachtwoord vergeten:** er is geen herstel per e-mail. De websitebeheerder stelt in hPanel een nieuw `ADMIN_PASSWORD` in (minimaal 16 tekens) en slaat op; de app herstart, alle bestaande sessies vervallen en Olena logt in met het nieuwe wachtwoord, dat de beheerder haar via een veilig kanaal geeft. Er is geen tweestapsverificatie (MFA).

## Inhoud

De 28 behandelingen met prijzen, behandelduur en teksten in drie talen staan in `services.json`; de paginateksten staan in `public/index*.html`, `public/privacy*.html` en de vertaalbestanden. Olena kan deze nog niet zelf aanpassen: wijzigingen lopen via de repository. Het sfeerbeeld in de hero (`public/studio.webp`, `public/studio-mobile.webp`) is geen foto van de studio zelf; het label „Sfeerbeeld” geeft dat aan. De sectie „Olena en haar werk” toont zes foto's van Olena uit de map Photos in Google Drive (`public/photos/`, WebP in 600 en 1200 pixels breed, 4:5). Elk `.webp`-bestand in die map wordt automatisch geserveerd; plaats alleen foto's waarvoor toestemming is van iedereen die herkenbaar in beeld is.

## Privacy

De privacyverklaring staat op `/privacy` in drie talen en is gelinkt vanuit het aanvraagblok en de footer. Laat Olena de tekst controleren. Afspraken worden dagelijks verwijderd zodra ze ouder zijn dan `BOOKING_RETENTION_MONTHS`; verlopen geblokkeerde tijden en sessies worden ook opgeruimd. Met **Klantgegevens verwijderen** in de planner verwijdert Olena een afspraak met naam en telefoonnummer definitief. De database overschrijft verwijderde gegevens direct (`secure_delete`).

## Caching

Bestanden die met `?v=` worden gelinkt, bewaart de browser een jaar. De server zet bij het starten elke `?v=` op de inhoudshash van het bestand. Pagina's worden bij elk bezoek gecontroleerd; planner en API worden nooit bewaard.

## Google reviews

Set GOOGLE_PLACES_API_KEY and GOOGLE_PLACE_ID in Hostinger. Enable Places API (New) and billing in Google Cloud. Restrict the key to Places API (New) and, where hosting permits, its outbound IP. Reviews load on page load, are not stored in the database and are kept in memory for REVIEWS_CACHE_MINUTES, so Google is called at most about once per language per period; each call may incur charges. Set an appropriate request quota in Google Cloud. If Google is unavailable, the reviews section shows a short message and the rest of the site works normally.
