# EWB Singapore website

Static export of the Engineers Without Borders Singapore site (formerly on Wix),
hosted on Vercel. The site's forms post to a small Vercel function that stores
submissions in Supabase.

```
public/                 the site, served as-is (desktop pages + mobile variants under /m)
  assets/site.js        replaces Wix's runtime: menus, slideshows, lightboxes, form posting
  assets/media/         images (EWB's own uploads, plus our SVG icons and backdrops)
  assets/static/        page stylesheets and open-licensed Google Fonts
  assets/files/         PDFs (AGM minutes, newsletters)
  assets/fonts/         self-hosted open-licensed fonts, with their OFL licence texts
api/forms.ts            POST /api/forms → Supabase
lib/forms.ts            validation for each form (field names = HTML `name` attributes)
lib/handler.ts          request checks (origin, size, JSON) and responses
supabase/migrations/    database schema
scripts/wire-forms.py   one-off that connected the exported Wix forms to /api/forms
scripts/remove-wix-leftovers.py
                        one-off that stripped what the Wix export left behind (see below)
build-manifest.json     map of original Wix asset URLs to files under public/assets (not served)
```

## Forms → tables

| Form | Page | Table |
| --- | --- | --- |
| Membership "Sign Up" | home page pop-up, `/general-6/` (Volunteer) | `membership_applications` |
| Newsletter "Subscribe" | home page | `newsletter_subscribers` (one row per email) |
| Donation record | `/donate/` | `donations` (self-reported; set `verified_at` once matched to the bank statement) |
| "Have a question?" | `/stay-connected/` (Contact Us) | `contact_messages` |

`members` holds the member roster, seeded with the three people listed on the
Wix members forum (display names only; Wix didn't expose more).

Read submissions in the Supabase dashboard → Table Editor (export to CSV from
there). Nothing is readable with the publishable/anon key: RLS is on with no
policies and the public API roles have no table privileges. Only the function,
using the secret key, can write.

Spam protection: a hidden honeypot field (`website`), same-origin check, 16 KB
body limit, and strict validation (also enforced by table constraints).

## What was removed from the Wix export

`scripts/remove-wix-leftovers.py` (stages `meta`, `rename`, `remove`, `media`,
`fonts`) and `tests/site-hygiene.test.ts`, which fails if any of it comes back:

- Wix template titles/metadata ("Save Our Shores", "Business, tagline"), Wix
  URLs in JSON-LD, source maps and Pinterest attributes pointing at Wix's CDN.
- Asset folders named after Wix hosts, and "wix" in class names and CSS
  variables (renamed "ewb"; every page was screenshot-compared, pixel-identical).
- Placeholder events (Past Event 1/2, Trial Event, Donation Drive), the frozen
  Wix Groups forum and the Wix comment boxes on blog posts. Their old URLs
  redirect to the Events / Stay Connected pages (`vercel.json`).
- Images from Wix's media library (social icons, three stock backdrops, the 404
  illustration), which Wix licenses for Wix-hosted sites, replaced with our own SVGs.
- Fonts licensed through Wix: Avenir → Nunito Sans, Proxima Nova → Montserrat,
  DIN Next → Barlow (all OFL, self-hosted), Helvetica → the visitor's own
  Helvetica/Arial. Wix's Madefor → Nunito Sans. Belleza (OFL) is kept.

## Environment variables (Vercel, Production)

See `.env.example`. `SUPABASE_SECRET_KEY` is server-only; keep it marked
Sensitive. Preview deployments don't get it, so forms there return an error
rather than writing to the live tables.

## Development

```bash
npm install
npm test           # validator, handler, HTML-form contract and site-hygiene tests
npm run typecheck
npx vercel dev     # site + /api/forms locally (pull env first: npx vercel env pull)
```

Database changes: add a file under `supabase/migrations/`, then
`npx supabase db push` (after `npx supabase link --project-ref <ref>`).

## Pointing ewb.sg here

Vercel → Project → Settings → Domains → add `www.ewb.sg` and `ewb.sg`, then
update DNS as shown. Pages already declare `https://www.ewb.sg/...` as their
canonical URL.
