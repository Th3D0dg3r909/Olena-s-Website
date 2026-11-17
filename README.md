# Olena Skin Care Studio

Nederlandstalige Node.js-webapp voor een huidverzorgingsstudio in Leiden. Klanten vragen een tijdslot aan. Olena beheert de aanvragen via `/admin`.

## Starten

Gebruik Node.js 24 of hoger. De app gebruikt de ingebouwde SQLite-module en heeft geen npm-afhankelijkheden.

```sh
ADMIN_PASSWORD='vervang-dit-door-een-lang-uniek-wachtwoord' npm start
```

Open http://localhost:3000. Voor `/admin` is de gebruikersnaam `olena`. Zonder `ADMIN_PASSWORD` zijn aanvragen en beheer uitgeschakeld. Gebruik op hosting HTTPS en stel het wachtwoord in via de omgevingsvariabelen van de host.

| Variabele | Gedrag |
| --- | --- |
| `PORT` | Standaard 3000. |
| `HOST` | Standaard 0.0.0.0. |
| `ADMIN_PASSWORD` | Minimaal 16 tekens. |
| `DATABASE_PATH` | Standaard `./data/bookings.sqlite`. Gebruik op hosting een blijvend schrijfbaar pad buiten de uitrolmap en maak back-ups. |
| `WHATSAPP_NUMBER` | Optioneel internationaal nummer met alleen cijfers. |

## Boekingen

Een aanvraag reserveert het tijdslot. Afwijzen geeft het weer vrij. Bevestigingen en afwijzingen worden opgeslagen. Olena mailt klanten handmatig vanuit het beheer. Elke afspraak gebruikt één blok van een uur.

Pas vóór publicatie de voorbeeldbehandelingen en beschikbaarheid in `server.js` aan. De testagenda toont eerstvolgende beschikbare tijden tot 28 dagen vooruit, maandag tot en met vrijdag van 10.00 tot 17.00 uur. Vul de echte prijzen, contactgegevens, beelden en privacytekst aan met Olena.
