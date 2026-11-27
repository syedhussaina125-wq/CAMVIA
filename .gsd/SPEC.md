# SPEC.md — Scale Readiness and Secure CAMVIA Buddy

> **Status**: `FINALIZED`
>
> Scale-readiness and CAMVIA Buddy scope were approved on 2026-11-26. Implementation must preserve existing role, school, campus, and teacher-assignment access behavior.

## Vision

Make CAMVIA responsive and operable for a school with up to 10 campuses and 100,000 students by bounding routine data reads, avoiding unnecessary startup work, and validating database behavior at realistic scale without silently hiding historical records or weakening authorization.

Make CAMVIA Buddy a useful read-only question-answering interface for school information that the authenticated account is authorized to access, with authorization enforced by Supabase/RLS rather than client-supplied role or data.

## Goals

1. **Bound roster reads** — Add server-side search, filters, and pagination; migrate consumers before removing the shared full-roster load.
2. **Bound history reads** — Add scoped, paginated history access for attendance, fees, and communications while retaining access to older records.
3. **Reduce alert query cost** — Use query-plan evidence to replace broad or repeated alert work without changing alert meaning or visibility.
4. **Add safe warm-read caching** — Use short-lived in-memory, user/scope-aware caching only after read contracts are bounded; invalidate affected entries after mutations and never persist student or financial data in browser storage.
5. **Validate scale and behavior** — Check build/type/lint, role/RLS parity, query plans, browser transfers, and realistic concurrency before making production-readiness claims.
6. **Secure CAMVIA Buddy** — Route questions through authenticated server-side retrieval, enforce the active account's role and data scope, keep model credentials server-side, and ground answers only in bounded authorized results.

## Non-Goals (Out of Scope)

- Changing business rules, user roles, teacher assignment scope, archive/trash semantics, fee calculations, or alert meaning.
- Storing student, guardian, attendance, communication, or financial data in local storage or another durable client cache.
- Applying migrations to a production database or claiming production-scale readiness without access to the target database and representative load environment.
- Dropping historical records or silently truncating lists to make the application appear faster.
- Allowing Buddy to write school records, bypass row-level security, trust client-supplied authorization/context, or answer with unverified/invented school facts.

## Constraints

- RLS and server-authorized RPC checks remain the security boundary; client filters may narrow reads but must never grant access.
- Buddy must derive identity and role from a verified Supabase session/profile and retrieve school data through that user's RLS-bound session.
- Any model call must run server-side, use a server-managed secret, and receive only the bounded facts needed for the current question.
- Buddy must explain when data is missing, outside the user's scope, or unsupported; it must not imply that an answer covers records it did not retrieve.
- Preserve current accessible data and role-specific UX while migrating consumers in small, verifiable steps.
- Keep each implementation change bounded and run the narrowest applicable verification before proceeding.
- The current workspace has no verified link to the target Supabase project; database migrations, execution plans, RLS tests, and realistic load tests may require a separate staging environment.
- Existing full-roster consumers include attendance, fees, communication, reports, dashboards, Student 360, and AI context; they must be migrated or supplied with bounded replacements before the global roster is removed.

## Success Criteria

- [ ] Routine student-directory reads return only the requested page and preserve search/filter, sort, empty, retry, and role-scope behavior.
- [ ] Attendance, fee, and communication history can be browsed with bounded requests without losing access to older authorized records.
- [ ] Alerts remain semantically and authorization-equivalent while avoiding unbounded/repeated work demonstrated by query evidence.
- [ ] Warm reads can reuse only fresh, correctly scoped in-memory data; mutations and auth/scope changes cannot expose stale or cross-user data.
- [ ] Automated build, lint, and focused behavior tests pass after each phase.
- [ ] Staging verification records role/RLS results, query plans, realistic 10-campus/100,000-student load results, and cold/warm navigation measurements; readiness is not claimed before this evidence exists.
- [ ] Buddy routes through authenticated server-side retrieval; tests prove role, school, campus, and teacher-assignment isolation and read-only behavior.
- [ ] Buddy answers are grounded in bounded facts, do not expose unauthorized fields, and report unsupported or unavailable data clearly.
- [ ] No Gemini credential or school-data answer generation path remains in the browser bundle.

## Technical Requirements

| Requirement | Priority | Notes |
|-------------|----------|-------|
| Server-side filtering and pagination | Must-have | Keep page sizes bounded and preserve RLS. |
| Scoped history queries and summaries | Must-have | Keep all historical records discoverable through paging/date filters. |
| Alert query evidence | Must-have | Do not rewrite alert semantics based on assumptions alone. |
| Ephemeral scoped caching | Should-have | Add only after bounded read contracts; no durable business-data cache. |
| Realistic scale validation | Must-have | Requires a linked staging database and representative load environment. |
| Authenticated Buddy retrieval | Must-have | Use the verified account's RLS scope; do not trust role/context supplied by the browser. |
| Grounded Buddy answers | Must-have | Read-only allowlisted retrieval, bounded model context, server-side model credentials, and explicit missing-data behavior. |

---

*Last updated: 2026-11-26*
