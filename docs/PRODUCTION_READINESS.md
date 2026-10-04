# EduPulse Production Readiness

This checklist describes the production deployment and verification requirements for the live EduPulse application. It does not change Supabase project settings automatically.

## Completed application phases

Phases 11–16 provide live Supabase authentication and role access, student and guardian records, teacher assignments, attendance, fees and collections, parent communication and approvals, derived alerts, Student 360, and administration settings with integration metadata. Controlled SQL fixtures are for non-production verification only.

## Supabase migration order

The repository contains this migration history:

1. `001_core_tenancy.sql`
2. `002_profiles_roles.sql`
3. `003_teacher_assignments.sql`
4. `004_students_guardians.sql`
5. `005_rls_policies.sql`
6. `006_fix_rls_recursion_and_school_scope.sql`
7. `007_fix_rls_recursion_final.sql`
8. `008_fix_profiles_rls_from_live_catalog.sql`
9. `009_harden_profile_privileges.sql`
10. `010_fix_student_school_scope.sql`
11. `011_fix_student_scope_with_verified_helper.sql`
12. `012_fix_guardian_school_scope.sql`
13. `013_live_attendance.sql`
14. `014_live_fees.sql`
15. `015_live_parent_communication.sql`
16. `016_live_alerts.sql`
17. `017_live_administration.sql`
18. `018_harden_guardian_school_scope.sql`

Do not replay this list against a live project. Migration `010_fix_student_school_scope.sql` was historically superseded and must not be applied blindly. Prior phase verification records migrations `017` and `018` as applied and confirms their live behavior. This workspace is not linked to Supabase, so the CLI cannot independently read the remote migration ledger; confirm the target project's history in the Supabase dashboard before making any database changes. Do not apply controlled test-data SQL to production. Take a verified backup before any future migration, and do not edit migrations already applied to a live project.

## Environment variables

The browser build requires only these public configuration variable names:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Never put service-role credentials, provider secrets, passwords, or private integration tokens in `VITE_` variables, the browser bundle, local storage, or client-readable database tables. Test account password variables are local test configuration, must not be Vite-prefixed, and must not be deployed.

## Authentication and authorization requirements

- Disable public sign-up in the production Supabase Auth configuration; provision accounts through the approved administrative process.
- Configure only the production Auth providers and redirect URLs actually used by the application. Verify allowed origins and logout/session behavior in the Supabase dashboard.
- Keep application route checks as a UX safeguard, not as the authorization boundary. RLS and server-authorized RPC checks must enforce role, active status, tenant, and record scope.
- Ensure the login page clearly explains the password-recovery path; a self-service reset flow and provider delivery are not currently configured.
- Admin manages same-school settings; Principal has read-only access to same-school settings and the profile directory. User-management mutations remain Admin-only.
- Verify inactive accounts are rejected and protected requests fail closed.
- Do not enable or advertise Google/OAuth or another provider until it is configured and tested end to end.

## Build, lint, and deployment

From the application root:

```powershell
npm ci
npm run build
npm run lint
```

Deploy the generated `dist/` directory to the selected static hosting platform. Configure the host to serve `index.html` for application routes (SPA fallback), use HTTPS, and set the two required public environment variables in the deployment environment. Do not deploy `.env.local`, test fixtures, or test credentials.

## Release smoke tests

- [ ] Sign in as an active account for each production role; confirm landing page and navigation are role-appropriate.
- [ ] Attempt direct navigation to restricted routes and confirm redirect/denial without protected content flashing.
- [ ] Verify Students and Student 360, Attendance, Fees, Communication, Approval Center, Alerts, and Administration as allowed for each role; confirm Principal's Administration/profile views remain read-only.
- [ ] Confirm School A identities cannot read or mutate School B records across each domain; repeat for every production tenant.
- [ ] Verify fee payment and communication approval use their authorized RPC/transition paths; verify settings writes are restricted to allowed columns.
- [ ] Confirm failed live requests show an error and retry path, never demo data.
- [ ] Test desktop, tablet, and mobile layouts; keyboard navigation; form validation; loading, empty, error, and success states.
- [ ] Confirm local storage contains no business records, provider credentials, or obsolete demo state; account for the Supabase SDK session key and walkthrough preference above.
- [ ] Review production browser console and network responses for authorization errors, exposed secrets, and unexpected retries.
- [ ] Recheck audit fields and database backup/restore procedures after deployment.

## External integrations

Integration rows currently represent configuration metadata only. A `NOT_CONFIGURED` status means the provider is not configured; the UI does not perform provider health checks or deliver SMS, WhatsApp, or email. Do not change a status to imply a working connection unless server-side integration behavior has been implemented and verified. Store any future credentials only in an approved server-side secret store.

## Runtime browser storage

The application does not use local storage for business records or integration credentials. Current browser storage includes:

- `sb-<project-ref>-auth-token` — managed by Supabase JS to persist the signed-in Auth session. This is a session credential, not an integration secret. Keep the app protected against XSS, do not log it, and use a server-managed secure-cookie architecture if production policy prohibits browser-persisted access/refresh tokens.
- `walkthroughCompletedByRole` — non-sensitive onboarding-completion preference.

Legacy EduPulse settings and user cache keys must stay absent and must not be recreated.

## Backup, rollback, and post-deploy

1. Take and verify a restorable backup before applying database migrations.
2. Keep the previous frontend release available for rollback. Roll back the app independently only when it remains compatible with the applied schema.
3. Prefer additive, forward-compatible schema changes. Do not assume reverting the frontend reverses or safely undoes a database migration.
4. After deployment, verify Auth, role-specific routes, tenant isolation, critical writes, audit fields, error handling, and the live dashboard/alerts against controlled production-safe records.
5. Monitor application and Supabase logs for failed authorization, elevated error rates, and unexpected data access. Logs must not contain credentials or access tokens.

## Known warnings and release gate

The latest build emitted a Vite advisory for the 581.81 kB initial JavaScript chunk (164.78 kB gzip), despite separate lazy-loaded Attendance, Fees, Communication, and Student page chunks. Oxlint completed successfully with four React warnings. Review both warnings before release and continue bundle splitting only where it does not compromise behavior. Several live services still fetch unpaginated student/profile lists or full visible attendance, fee, and communication histories; monitor query volume and add bounded, RLS-preserving pagination/filtering before those datasets grow substantially.

**Phase 17 status:** complete. Migration `018_harden_guardian_school_scope.sql` was applied and verified; School A accounts returned zero School B `student_guardians` rows. The authenticated full-reload `/students` 503 flow now shows an explicit error and retry, and retry restores live data for Admin, Principal, Finance, and Teacher A. The source uses a single Supabase client; development HMR reuses it.

Phase completion and production release are separate gates. Before production launch, complete the target-project migration-ledger and backup checks, configure Vercel's production environment and Supabase Auth URLs, then run the deployed-domain smoke tests in [DEPLOYMENT.md](./DEPLOYMENT.md). The Vercel account currently has no EduPulse project, and the Supabase CLI is not linked to the target project; do not deploy or apply SQL until the intended Vercel project and production settings are confirmed.
