# CAMVIA Production Security Checklist

This checklist categorizes all security controls, verification items, and operational hardening requirements for the production CAMVIA deployment.

---

## CRITICAL (Pre-Release Gates — Must Pass Before Launch)

- [ ] **Public Sign-up Disabled**: Verify in Supabase Auth Dashboard that user sign-ups are disabled (`auth.disable_signup = true`).
- [ ] **No Service-Role Key on Frontend**: Confirm `SUPABASE_SERVICE_ROLE_KEY` is not present in Vercel environment variables, `.env.production`, or frontend bundle assets.
- [ ] **RLS Enforced on All 20 Tables**: Verify that all public schema tables have Row Level Security enabled and that zero tables have default permissive access.
- [ ] **Zero Table Grants to Anon Role**: Confirm `anon` role has all table permissions revoked in schema `public` via migration `021_production_security_hardening.sql`.
- [ ] **Cross-Tenant Boundary Enforcement**: Verify School A users receive 0 rows and 403 errors when attempting to query or mutate School B records across all operational domains (students, guardians, attendance, fees, communications, alerts).
- [ ] **Server-Side Admin Verification**: Ensure all user management actions (invite, edit, role change, email change, deactivate) are enforced server-side inside `manage-school-user` and `update_school_user` RPC.
- [ ] **Fixed search_path on all RPCs**: Verify all `SECURITY DEFINER` functions have explicit `set search_path = pg_catalog, public, auth` to prevent search path injection attacks.
- [ ] **Direct Mutation Revocation**: Ensure direct `insert`, `update`, and `delete` on `students`, `teacher_class_assignments`, `user_roles`, `organizations`, `schools`, `campuses`, and `integration_configs` are revoked from authenticated users.

---

## HIGH (Core Safeguards & Data Integrity)

- [ ] **Production Security Headers Active**: Verify Vercel serves `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `Permissions-Policy`.
- [ ] **Anti-Clickjacking Frame Ancestors**: Verify `frame-ancestors 'none'` in CSP and `X-Frame-Options: DENY` prevent unauthorized framing.
- [ ] **Generic Authentication Errors**: Confirm login failure returns generic `Invalid email or password.` message to eliminate user enumeration vectors.
- [ ] **Authentication Rate Limiting**: Confirm client-side backoff and lockout are active after 5 failed login attempts.
- [ ] **Edge Function CORS Hardened**: Ensure `manage-school-user` rejects unauthorized cross-origin requests and does not use unvalidated wildcard `*` headers.
- [ ] **Edge Function Payload Limit**: Confirm requests larger than 64KB to `manage-school-user` are rejected with HTTP 413.
- [ ] **Inactive Account Invalidation**: Verify inactive users are blocked at login and active sessions are revoked immediately when an account is marked `INACTIVE`.
- [ ] **CSV Import Hardening**: Verify CSV upload rejects files >2MB, enforces a maximum of 500 rows, validates MIME/extension, sanitizes formula injection characters (`=`, `+`, `-`, `@`), and validates field formats.
- [ ] **Deactivation Over Deletion**: Confirm user deletion is executed as account deactivation (`status = 'INACTIVE'`) to preserve institutional audit trails.

---

## MEDIUM (Hardening & Quality Assurance)

- [ ] **No Unsafe HTML Rendering**: Ensure zero instances of `dangerouslySetInnerHTML`, `innerHTML`, or raw HTML injection exist in the frontend code.
- [ ] **Trigger RPC Execution Revocation**: Confirm internal trigger functions (`set_updated_at`, `handle_new_user`, `set_administration_audit`) have execute permissions revoked from `public`, `anon`, and `authenticated`.
- [ ] **Strict Input Validation**: Confirm forms and RPCs reject negative fees, future attendance dates, malformed UUIDs, and oversized text inputs.
- [ ] **No Secrets in Logs**: Verify that client-side console logging and server-side Edge Function logs do not output passwords, session tokens, or JWTs.
- [ ] **Clean Production Build**: Confirm `npm run build` generates optimized production assets without missing type definitions or syntax warnings.
- [ ] **Clean Linter Execution**: Confirm `npm run lint` executes with zero errors.

---

## LOW (Hygiene & Defense-in-Depth)

- [ ] **Removal of Mock Fixtures**: Verify mock user fixture records and mock email lookups (`teacher@beaconhouse.edu`) are removed from production runtime execution.
- [ ] **Dependency Hygiene**: Confirm `npm audit` reports 0 vulnerabilities and high-risk packages are updated.
- [ ] **Storage Bucket Auditing**: If Supabase Storage is configured in the future, ensure buckets containing student records are `PRIVATE` with short-lived signed URLs.
- [ ] **AI Data Isolation**: Ensure Ask CAMVIA questions continue to be evaluated against the current user's RLS-filtered state, without direct dynamic SQL generation.

---

## OPERATIONAL (Ongoing Production Administration)

- [ ] **Verified Database Backups**: Confirm automated Supabase backups are active and test restoration procedures before applying schema migrations.
- [ ] **Migration Ledger Verification**: Never edit applied migrations. Apply forward migrations sequentially (`001` through `021`).
- [ ] **Auth Site URL Configuration**: Set **Site URL** in Supabase Auth to the production HTTPS domain and configure trusted redirect origins.
- [ ] **Credential Rotation Plan**: Maintain written procedures for rotating Supabase API keys, database passwords, and Vercel tokens in [`docs/SECURITY.md`](./SECURITY.md).
- [ ] **Periodic Audit Log Review**: Periodically inspect `public.user_management_audit` for unexpected role modifications or unusual account deactivations.
