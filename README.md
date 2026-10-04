# EWB Singapore website

Static export of the Engineers Without Borders Singapore site (formerly on Wix),
hosted on Vercel. The site's forms post to a small Vercel function that stores
submissions in Supabase.

```
public/                 the site, served as-is (desktop pages + mobile variants under /m)
  assets/site.js        replaces Wix's runtime: menus, slideshows, lightboxes, form posting
api/forms.ts            POST /api/forms → Supabase
lib/forms.ts            validation for each form (field names = HTML `name` attributes)
lib/handler.ts          request checks (origin, size, JSON) and responses
supabase/migrations/    database schema
scripts/wire-forms.py   one-off that connected the exported Wix forms to /api/forms
build-manifest.json     map of original Wix asset URLs to files under public/assets
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

## Environment variables (Vercel, Production)

See `.env.example`. `SUPABASE_SECRET_KEY` is server-only; keep it marked
Sensitive. Preview deployments don't get it, so forms there return an error
rather than writing to the live tables.

## Development

```bash
npm install
npm test           # validator, handler and HTML-form contract tests
npm run typecheck
npx vercel dev     # site + /api/forms locally (pull env first: npx vercel env pull)
```

Database changes: add a file under `supabase/migrations/`, then
`npx supabase db push` (after `npx supabase link --project-ref <ref>`).

## Pointing ewb.sg here

Vercel → Project → Settings → Domains → add `www.ewb.sg` and `ewb.sg`, then
update DNS as shown. Pages already declare `https://www.ewb.sg/...` as their
canonical URL.
