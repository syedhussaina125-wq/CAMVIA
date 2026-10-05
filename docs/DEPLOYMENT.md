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

The expected migration chain is `001` through `019`. Migration `010` was
historically superseded; do not apply it blindly or replay migrations already
recorded as applied. Earlier project verification records `017` and `018` as
applied and live RLS tests pass. Migration `019_student_and_user_management.sql`
adds an audited, tenant-derived student-create RPC, school-admin user update
RPC, and an inactive-by-default Auth profile trigger. It has been authored but
must be reviewed and applied to the correct Supabase project before enabling
these features. This workspace is not linked to the app's Supabase project, so
the CLI cannot independently read the remote migration ledger or apply it.
Confirm the target project's migration history and backup before applying the
forward migration once.

Deploy `supabase/functions/manage-school-user` to that same Supabase project
after migration `019`. The function verifies the caller's JWT and active Admin
scope, uses the service-role key only inside the Edge Function to send Auth
invitations, and uses the caller-scoped RPC for school-bounded profile changes.
Never add `SUPABASE_SERVICE_ROLE_KEY` to Vercel or any `VITE_` variable. Verify
Supabase Auth invitation email delivery and redirect settings before inviting
real users; do not report an invitation as sent unless Supabase confirms it.
User deletion is intentionally implemented as deactivation to retain history.

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
2. Confirm the application URL points to the intended Supabase project.
   Review and apply migration `019` there, deploy the `manage-school-user`
   Edge Function, verify its server-only service-role configuration, and test
   invitation email delivery before exposing the user-management controls.
3. Confirm the production Supabase migration ledger, RLS checks, Auth settings,
   and backup status.
4. From the repository root, install and validate:

   ```powershell
   npm ci
   npm run build
   npm run lint
   ```

5. Deploy only the existing CAMVIA Vercel project through its Git integration,
   or use the authenticated Vercel CLI after linking this directory to that
   project:

   ```powershell
   vercel link
   vercel --prod
   ```

6. Set Supabase **Site URL** and **Redirect URLs** to the resulting production
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
