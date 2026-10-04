# EduPulse V1 Deployment

This guide deploys the existing Vite application to Vercel and connects it to
the configured Supabase project. It does not apply migrations or create
integration credentials.

## Prerequisites

- Access to the Vercel team that will own the EduPulse project.
- Access to the intended Supabase project and its Auth settings.
- Confirmed, restorable Supabase backup and a reviewed migration history.
- Production values for the public Supabase URL and anon/publishable key.
- Node.js 22.12+ (or 20.19+) for local builds; Vercel Node.js 24.x is verified
  with the installed Vite version.

Do not deploy `.env.local`, test account passwords, a service-role key, database
credentials, access/refresh tokens, or integration secrets. Test account
password variables are local-only and must not be added to Vercel.

## Vercel project settings

Create or select the EduPulse Vercel project with:

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Root directory | Repository root |
| Install command | `npm install` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node.js version | 24.x |

The application is a client-side SPA. [`vercel.json`](../vercel.json) rewrites
requests to the SPA entry point; Vercel serves existing static assets normally.
This supports direct route visits and refreshes, including `/students/:id`.

## Environment variables

Configure these names for the **Production** environment in Vercel:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

These are public browser configuration values. Never add `SUPABASE_SERVICE_ROLE_KEY`,
database passwords, `SUPABASE_TEST_*_PASSWORD`, Auth session tokens, or provider
secrets. Verify variable names and environment scope in the Vercel dashboard;
do not paste their values into logs, deployment notes, or source control.

## Supabase migration and Auth checks

The expected migration chain is `001` through `018`. Migration `010` was
historically superseded; do not apply it blindly or replay migrations already
recorded as applied. Earlier project verification records `017` and `018` as
applied and live RLS tests pass, but this workspace is not linked to Supabase,
so the CLI cannot independently read the remote migration ledger. Confirm the
target project's migration history in its dashboard before any database change.
No migration is part of this frontend deployment.

In Supabase Auth settings, before go-live:

1. Set **Site URL** to the Vercel-generated HTTPS production URL.
2. Add the deployed origin (and any intentionally used redirect paths) to
   **Redirect URLs**. Add preview or custom domains only if they are meant to
   be trusted Auth redirect destinations.
3. Keep public sign-up disabled and verify the production email/password
   provider settings.

EduPulse currently uses password login without a redirect-based callback.
Public signup is disabled in the application, and password recovery/delivery
is not configured; users must contact their administrator for account help.
The Site URL and redirect allowlist must be updated manually; deployment does
not modify Supabase dashboard settings.

## Deployment

1. Confirm the Vercel project is the intended EduPulse project and that its
   Production environment contains only the two required public variable names
   with the correct production values.
2. Confirm the production Supabase project, migration ledger, RLS checks,
   Auth settings, and backup status.
3. From the repository root, install and validate:

   ```powershell
   npm ci
   npm run build
   npm run lint
   ```

4. Deploy the production branch through the Vercel Git integration, or use the
   authenticated Vercel CLI after linking this directory to the confirmed
   project:

   ```powershell
   vercel link
   vercel --prod
   ```

5. Set Supabase **Site URL** and **Redirect URLs** to the resulting production
   domain, then run the smoke tests below.

Do not run a deployment from an unlinked directory if it would create or target
an unintended Vercel project.

## Post-deployment smoke tests

- Open the HTTPS root and `/login`; reload `/login` directly.
- While signed out, open `/dashboard`, `/students`, `/attendance`, `/fees`,
  `/communication`, `/approvals`, `/alerts`, and `/administration` directly;
  confirm the SPA loads and protected routes redirect to login.
- Sign in with approved accounts for Admin, Principal, Finance, and Teacher.
  Verify role-appropriate routes, live data, refresh/session restoration, and
  logout. Confirm Principal Administration is read-only and Finance/Teacher
  cannot access Administration.
- Verify Student 360, attendance, fees, communication approvals, alerts, and
  settings as allowed by role. Confirm denied roles cannot perform mutations.
- Confirm School A identities return no School B students, guardians,
  `student_guardians`, attendance, fees, communication, alerts, school/campus
  settings, or integration metadata. Confirm inactive accounts are denied.
- Test a controlled live-request failure and retry; confirm no demo fallback.
- Inspect production network responses and console for failed RLS requests,
  duplicate GoTrue warnings, unexpected retries, or secret values.
- Verify integration metadata remains `NOT_CONFIGURED` unless a real
  server-side provider integration has been implemented and tested. Email, SMS,
  and WhatsApp delivery are not connected by this release.

## Rollback

Use Vercel's Deployments page to promote the last known-good production
deployment. Keep the Supabase schema unchanged during a frontend rollback:
frontend rollback does not reverse database migrations. If a database change
is ever required, use a reviewed forward migration and a verified backup/
restore plan; do not edit or replay applied migration files.

## Domains

Use the Vercel-generated domain for the initial deployment. No custom EduPulse
domain is configured in source or Vercel project settings currently. A custom
domain can later be connected from **Vercel Project → Settings → Domains**;
after DNS is verified, add that HTTPS origin to Supabase Auth's Site URL or
Redirect URLs as appropriate.

## Known non-blocking warnings

- Vite reports that the initial JavaScript chunk is larger than 500 kB after
  minification; page chunks are separately lazy-loaded.
- Oxlint reports four existing React warnings: three `set-state-in-effect`
  warnings and one render-purity warning.
- Some live lists are currently unpaginated; monitor query volume as tenant
  data grows.
