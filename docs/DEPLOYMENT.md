# CAMVIA Deployment

This guide deploys the existing Vite application to Vercel and connects it to
the configured Supabase project. It does not apply migrations or create
integration credentials.

## Prerequisites

- Access to the Vercel team that owns the CAMVIA project.
- Access to the intended Supabase project and its Auth settings.
- Confirmed, restorable Supabase backup and a reviewed migration history.
- Production values for the public Supabase URL and anon/publishable key.
- Node.js 22.12+ (or 20.19+) for local builds; Vercel Node.js 24.x is verified
  with the installed Vite version.

Do not deploy `.env.local`, test account passwords, a service-role key, database
credentials, access/refresh tokens, or integration secrets. Test account
password variables are local-only and must not be added to Vercel.

## Vercel project settings

Create or select the CAMVIA Vercel project with:

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

The repository migration inventory and application guidance are maintained in
[PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md). Migration `010` was
historically superseded and `021` has no file; do not replay migrations already
recorded as applied. Earlier project verification records `017` and `018` as
applied, but the live ledger for later migrations has not been verified.
Confirm the target project's migration history and backup before applying only
outstanding forward migrations in order. Review migrations `029` and `030`
together and apply them in sequence if outstanding. Migration `031` adds
attendance Trash metadata and RPCs; it is not required for active attendance
reads, which use only columns present in the base attendance schema. This
workspace adds migration `032` to validate attendance dates in the configured
school timezone and return invalid submissions separately from authorization
failures. Review and apply `032` only if it is outstanding. This workspace is
not linked to the app's Supabase project, so the CLI cannot
independently read the remote migration ledger or apply changes.

Migration `033` supports per-student attendance drafts and blocks ordinary
saves from altering finalized sessions; finalized updates must use the audited
correction RPC. Verify it is outstanding and review it before applying.

Deploy `supabase/functions/manage-school-user` and
`supabase/functions/purge-expired-trash` to that same Supabase project after
reviewing their required server-only configuration and matching schema
migrations. The user-management function verifies the caller's JWT and active
Admin scope, uses the server-only secret key for Auth invitations, and uses
caller-scoped RPCs for school-bounded profile changes. Never add server
credentials to Vercel or any `VITE_` variable. Verify invitation delivery and
the scheduled purge workflow in a controlled environment before relying on
them in production. User deletion is intentionally implemented as deactivation
to retain history.

In Supabase Auth settings, before go-live:

1. Set **Site URL** to the Vercel-generated HTTPS production URL.
2. Add the deployed origin (and any intentionally used redirect paths) to
   **Redirect URLs**. Add preview or custom domains only if they are meant to
   be trusted Auth redirect destinations.
3. Keep public sign-up disabled and verify the production email/password
   provider settings.

CAMVIA currently uses password login without a redirect-based callback.
Public signup is disabled in the application. New school accounts use the
Supabase Auth invitation flow and set their own password; delivery depends on
the target project's configured Auth email provider. The Site URL and redirect
allowlist must be updated manually; deployment does not modify Supabase
dashboard settings.

## Deployment

1. Confirm the Vercel project is the existing CAMVIA project and that its
   Production environment contains only the two required public variable names
   with the correct production values.
2. Confirm the application URL points to the intended Supabase project. Check
   that project's migration ledger and verified backup before applying any
   schema changes. Review all migration files newer than the project's last
   applied migration and apply only outstanding migrations in order. Migration
   `010` is historically superseded, `021` has no file, and migrations `029`
   and `030` must be applied in sequence if outstanding. Migration `031`
   enables attendance Trash workflows but is not required to load active
   attendance. Migration `032` aligns attendance date validation with the
   school's configured timezone. Do not infer the deployed schema from
   filenames or this workspace's history.
3. Deploy the `manage-school-user` and `purge-expired-trash` Edge Functions
   after confirming their required server-only secrets are configured. Test
   user invitation delivery and the purge workflow in a controlled environment
   before relying on them in production.
4. Confirm the production Supabase migration ledger, RLS checks, Auth settings,
   scheduled workflow secrets, and backup status.
5. From the repository root, install and validate:

   ```powershell
   npm ci
   npm run build
   npm run lint
   ```

6. Deploy only the existing CAMVIA Vercel project through its Git integration,
   or use the authenticated Vercel CLI after linking this directory to that
   project:

   ```powershell
   vercel link
   vercel --prod
   ```

7. Set Supabase **Site URL** and **Redirect URLs** to the resulting production
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

Use the Vercel-generated domain for the initial deployment. No custom CAMVIA
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
