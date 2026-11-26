# Environments and launch on Olena's own domain

## Environments

| | Concept (now) | Production (later) |
| --- | --- | --- |
| Address | `https://olena.td909-creativedesign.nl` | Olena's own domain, not yet chosen |
| Purpose | Development and review | Approved public website |
| Search engines | Always excluded | Allowed only after approval |
| Database | Its own `DATABASE_PATH` | Its own `DATABASE_PATH`, never the concept file |
| Admin password | Its own | A new one, never copied from the concept site |

Each environment is a separate Hostinger website with its own environment variables and its own database file outside the deploy folders (`/home/<user>/domains/<domain>/data/bookings.sqlite`). Test appointments made on the concept site stay there.

### Hosting environment variables

| Variable | Concept | Production |
| --- | --- | --- |
| `ADMIN_PASSWORD` | Set (16+ characters) | New, different password (16+ characters) |
| `DATABASE_PATH` | `/home/u928885403/domains/olena.td909-creativedesign.nl/data/bookings.sqlite` | `/home/<user>/domains/<final domain>/data/bookings.sqlite` |
| `PUBLIC_URL` | `https://olena.td909-creativedesign.nl` | `https://<final domain>` |
| `ALLOW_INDEXING` | Not set | `true`, only at approved launch |
| `REDIRECT_TO_PUBLIC_URL` | Not set | `true` if `www` and non-`www` should end up on one address |
| `MAINTENANCE_MODE` | Not set | `true` until the launch: visitors see an “Opening soon” page |
| `MAINTENANCE_ACCESS_CODE` | Not set | A code of 12+ characters for people other than Olena who need to see the site before launch |
| `GOOGLE_PLACES_API_KEY`, `GOOGLE_PLACE_ID` | Set | Set (the same key can be used; restrict it in Google Cloud) |
| `WHATSAPP_NUMBER` | Optional (default 31647238444) | Optional, set if the business number changes |
| `ADMIN_USERNAME`, `ADMIN_SESSION_IDLE_MINUTES`, `ADMIN_SESSION_MAX_HOURS`, `REVIEWS_CACHE_MINUTES`, `BOOKING_RETENTION_MONTHS` | Optional | Optional |

Do not set `PORT` or `HOST` on Hostinger. Build settings: Node.js 24, application type Other, entry file `server.js`, npm, no build command.

## Admin password reset

There is no email recovery. The website administrator:
1. Opens hPanel → the website → Node.js → Environment variables.
2. Sets a new `ADMIN_PASSWORD` of at least 16 characters and saves; the app restarts.
3. Gives the new password to Olena over a secure channel (in person or by phone, not by email in plain text).

Changing the password signs out every existing session.

## Launch checklist

1. **Approval.** Olena approves the content, privacy statement and booking workflow on the concept site.
2. **Domain.** Olena registers or provides her domain; point it to Hostinger and add it as a separate website with HTTPS (SSL) enabled.
3. **Deploy.** Connect the same GitHub repository and branch, with the build settings above.
4. **Variables.** Set the production variables above, with a new admin password. Set `MAINTENANCE_MODE=true` (and optionally `MAINTENANCE_ACCESS_CODE`) so the new domain shows “Opening soon” while it is checked. Leave `ALLOW_INDEXING` unset for now.
5. **Data.** Decide which data moves:
   - If the concept database holds real appointments that must continue, stop new entries on the concept site, back up the file (download it from File Manager), and copy it to the production `DATABASE_PATH` before the first production start.
   - Otherwise start production with an empty database. Never copy test appointments.
   - Keep the backup until the production site has been checked.
6. **Checks on the production domain.**
   - The site loads over HTTPS without warnings; `http://` redirects to `https://` (Hostinger setting).
   - Log in, use the planner, log out; after logout the planner asks for login again.
   - In the browser's developer tools, the cookie `__Host-olena_admin` is `HttpOnly`, `Secure` and `SameSite=Strict`.
   - Opening `/api/admin/bookings` without logging in returns an error, not data.
   - Each treatment's WhatsApp button opens a chat with the right number and message in all three languages; the phone link works.
   - The page source contains `<link rel="canonical" href="https://<final domain>/...">`, and `/sitemap.xml` lists the six pages on the final domain.
7. **Open the site.** Remove `MAINTENANCE_MODE` (and `MAINTENANCE_ACCESS_CODE`) and save; the app restarts and everyone sees the website.
8. **Indexing.** After approval, set `ALLOW_INDEXING=true` on production only. Check that the response no longer has `X-Robots-Tag: noindex` and that `/robots.txt` names the sitemap. Optionally submit the sitemap in Google Search Console.
9. **Concept site.** Decide: keep it as a noindex review site with its own data, or redirect it to the final domain (set `PUBLIC_URL` to the final domain and `REDIRECT_TO_PUBLIC_URL=true` on the concept website). The concept site never gets `ALLOW_INDEXING`.
10. **Afterwards.** Update the Google Business profile and Instagram bio with the new address, and check that reviews still load.
