# Broutelogistics

Freight and parcel website with live shipment tracking, a staff console, a quote/contact form and an optional AI chat assistant.

- **Public site** (GitHub Pages): tracking, services, enquiry form, chat, privacy and terms pages.
- **Backend** (Supabase, free tier is enough to start): Postgres database, staff login, row-level security.
- **No build step and no third-party scripts.** Plain HTML, CSS and JavaScript, strict Content-Security-Policy.

## How it is secured

| Concern | How it is handled |
|---|---|
| Who can see shipments | Visitors can only call `track_shipment()` with an exact tracking number. It returns status and history, **never** names or contact details. They cannot list or search shipments. |
| Guessing tracking numbers | Numbers look like `BRT-7K3M9QXD2P` (10 random characters, ~8e14 combinations). |
| Who can create or edit | Only signed-in users listed in `public.admins`. Enforced in the database (RLS + `is_admin()`), not in the browser. |
| History integrity | `shipment_events` is append-only. Shipments always start as "Created". Delivered and Cancelled shipments are locked. There is no delete. |
| Spam | Honeypot field, per-email limit in the database. Add a CAPTCHA if you get abuse (see below). |
| XSS | All rendering uses `textContent`; CSP blocks inline scripts and styles. |
| Secrets | Only the public anon/publishable key is in the site. The AI key lives in a server-side secret. |

## Project structure

```
index.html  admin.html  privacy.html  terms.html  404.html
assets/css/styles.css
assets/js/config.js   <- YOU EDIT THIS (Supabase URL/key, company details)
assets/js/api.js      Supabase client (fetch-based, no library)
assets/js/main.js     public site logic        assets/js/admin.js   staff console
assets/js/utils.js    helpers                  assets/js/legal.js
supabase/schema.sql   database: tables, RLS, functions
supabase/functions/chat/index.ts   optional AI chat function
scripts/set-domain.sh sets your domain in robots.txt / sitemap.xml
tests/api.test.js     client tests (node tests/api.test.js)
.github/workflows/pages.yml        test + deploy to GitHub Pages
```

## Setup (about 15 minutes)

### 1. Create the database
1. Create a free project at <https://supabase.com>.
2. Open **SQL Editor**, paste all of `supabase/schema.sql`, and click **Run**.

### 2. Create your staff login
1. **Authentication -> Users -> Add user**: your email and a strong password, tick *Auto Confirm User*.
2. **Authentication -> Sign In / Providers**: turn **off** "Allow new users to sign up".
3. In the SQL Editor run (use your email):
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'you@yourdomain.com';
   ```
4. Turn on 2FA/MFA for the account if your plan supports it.

### 3. Configure the site
Edit `assets/js/config.js`:
- `supabaseUrl` and `supabaseAnonKey` from **Project Settings -> API** (the anon/publishable key only; never a service_role or secret key).
- `company`: your real email, phone, address and hours. Empty fields are hidden. These also appear on the privacy and terms pages.

If your Supabase URL is not `*.supabase.co` (custom domain), add it to `connect-src` in the `<meta http-equiv="Content-Security-Policy">` tag of `index.html` and `admin.html`.

### 4. Optional: AI chat assistant
Tracking-number lookups in chat already work from your database. For general questions:
```bash
supabase functions deploy chat --no-verify-jwt
supabase secrets set ANTHROPIC_API_KEY=your-key SITE_URL=https://your-domain.com
```
Then set `chatEndpoint` in `config.js` to `https://<project>.supabase.co/functions/v1/chat`. If you leave it empty, the chat falls back to built-in answers. (You can swap the provider by editing the function.) Set a spending limit with your AI provider.

### 5. Publish on GitHub Pages
1. Push this folder to a GitHub repository (branch `main`).
2. **Settings -> Pages -> Source: GitHub Actions** (the included workflow runs the tests and deploys).
3. Add your custom domain in **Settings -> Pages** (recommended), enable "Enforce HTTPS", then run `sh scripts/set-domain.sh https://your-domain.com` and commit.
4. In Supabase **Authentication -> URL Configuration**, set the Site URL to your domain.

If you deploy as a project site (`user.github.io/repo/`), change the absolute paths in `404.html` to include `/repo/`.

## Daily use

1. Open `https://your-domain.com/admin.html` and sign in.
2. **New shipment** generates the tracking number to give your customer.
3. **Manage** a shipment to record each checkpoint (status, location, note). Customers see updates immediately.
4. **Enquiries** shows messages from the contact form; tick "Handled" when done.

## Before you go live (checklist)

- [ ] Real company contact details in `config.js`.
- [ ] Have the privacy policy and terms reviewed by a qualified professional for your country and business. They are sensible starting templates, not legal advice.
- [ ] Supabase sign-ups disabled; only your staff are in `public.admins`.
- [ ] Custom domain with HTTPS, `set-domain.sh` run.
- [ ] Test end to end: create a shipment, track it from your phone, update it, deliver it.
- [ ] Supabase: enable backups appropriate to your plan.

## Not included (recommended next)

- Email/SMS notifications on status changes (e.g. a Supabase Edge Function plus Resend/Twilio, triggered after `add_shipment_event`).
- CAPTCHA (Cloudflare Turnstile) on the enquiry form if spam appears.
- Social-share image (`og:image`), privacy-friendly analytics, multiple staff roles, editing a shipment's details after creation.

## Tests

```bash
node tests/api.test.js
```
Tests the client against a mock of the Supabase API (tracking, login, admin check, token refresh, error handling). The SQL in `supabase/schema.sql` should be exercised on your own Supabase project during the end-to-end test above.

## License

MIT, see `LICENSE`.
