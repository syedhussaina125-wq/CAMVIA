---
milestone: camvia-buddy
version: 1.1.0
updated: 2026-11-26T16:53:00+05:00
---

# Roadmap

> **Current Phase:** 6 - Secure CAMVIA Buddy
> **Status:** executing

> **Priority override (2026-11-26):** Pause application-wide scale-readiness work. Work exclusively on CAMVIA Buddy and its directly required backend contracts, security, integrations, and UI. Preserve all existing scale-readiness changes; do not revert them. Resume Phases 1-5 only after the Buddy milestone or explicit reprioritization.

## Must-Haves (from SPEC)

- [ ] Preserve RLS and all current role/school/campus/teacher-assignment scopes.
- [ ] Keep Buddy read-only; navigation, filters, report generation, and message drafting do not mutate records.
- [ ] Authorize every data answer using the verified account and RLS.
- [ ] Keep model keys server-side and ground answers in bounded data retrieved for the current question.
- [ ] Do not trust model- or browser-supplied identity, school, campus, role, or authorization scope.
- [ ] Track implementation separately from authenticated runtime and performance verification.

---

## Phases

### Phase 1: Bounded roster and consumer migration
**Status:** ⏸ Suspended by Buddy priority override; existing changes preserved
**Objective:** Introduce a server-side roster page contract and migrate each full-roster consumer safely before removing the global full-roster fetch.
**Requirements:** REQ-01, REQ-05

**Verified groundwork:** Tenant filters and an active-roster index were added; the legacy full-roster request still downloads every page in groups of three; directory sorting is memoized; startup fee/communication reads now overlap with the roster request. The Student Directory now uses a separate bounded server-side page query, but the application still eagerly loads the global roster for other consumers. This directory migration is locally implemented but lacks authenticated runtime verification.

**Plans:**
- [x] Define and locally test an explicit-scope, bounded roster page/query contract.
- [x] Migrate Student Directory search, filters, sorting, and pagination to bounded reads.
- [x] Make Student 360 retrieve its base record directly by authorized ID and remove its roster dependency.
- [ ] Migrate Student 360 attendance, fee, and communication histories to bounded reads.
- [x] Add an RLS-enforced database aggregate for dashboard active-student and class/section/campus/gender counts; connect dashboard student KPI and distribution.
- [x] Add an RLS-enforced dashboard attendance aggregate for the executive attendance chart and daily attendance KPI.
- [ ] Migrate remaining dashboard attendance, fee, communication, approval, alert, and chart calculations to bounded aggregate queries.
- [ ] Migrate attendance, fees, communication, reports, and AI context to bounded queries or summaries.
- [ ] Remove the eager full-roster load only after no consumer requires it.

**Current roster/dashboard migration:** `fetchStudentRosterPage` requires organization and school IDs, optionally narrows by campus, accepts validated search/class/section/gender/status/page/sort inputs, caps pages at 100 rows, requests exact totals, and uses a unique ID tie-breaker. The directory queries this service directly, applies debounced search and combined filters server-side, shows exact totals and bounded pages, and ignores stale responses. Campus options are loaded separately under the authenticated session. Directory rows skip guardian and location relationship reads. Student 360 fetches its base record by ID under RLS and passes only that authorized student into fee/communication access helpers; its attendance/fee/communication history collections remain shared in-memory state and are not yet bounded. Dashboard migration has `get_dashboard_student_summary()` in migration `049_dashboard_student_summary.sql` and `get_dashboard_attendance_summary()` in migration `050_dashboard_attendance_summary.sql`; both are `SECURITY INVOKER` with row security enabled. The executive attendance chart and general dashboard daily attendance KPI now use the attendance summary; the KPI shows recording completion (recorded students / authorized active students) separately from the attendance rate. The chart preserves the existing rate and bucket calculations from database aggregates. Attendance attention/trend, fee, communication, approval, alert, and remaining calculations still consume shared full collections; the dashboard still waits for the global roster and legacy attendance load. Migrations `049` and `050` must be applied before these paths can load. Frontend build, lint, diff checks, the 5 dashboard contract/chart runtime tests (`deno test --no-check`), and the Edge Function type-check pass. The test file requires `--no-check` because Deno does not recognize the app's Vite `import.meta.env` type; frontend TypeScript validation passes in the build. SQL execution/plan validation and authenticated role/RLS parity remain outstanding. Browser 5173 is reachable at login only; no authenticated database or role-specific behavior was tested. No startup or 100k-student performance improvement is claimed.

**Global roster consumer checklist:**

| Consumer | Previous behavior | Current behavior | Status / verification |
|---|---|---|---|
| Student Directory | Client-side filtering and pagination over the full shared roster. | Server-side page/search/class/section/campus/gender/status/sort query; exact totals; 50-row UI pages. | IMPLEMENTED — UNVERIFIED. Local tests/build/lint pass; authenticated query and RLS verification blocked. |
| Student 360 base record | Detail route also had access to global roster state. | Base student fetched directly by ID under RLS; detail no longer receives the global roster. Fee/communication helpers are narrowed to that one fetched record. | IMPLEMENTED — UNVERIFIED. Build passes; no authenticated browser check. Attendance/fee/communication history collections remain globally loaded. |
| Dashboard | Receives the full roster and uses it with full attendance, fees, and communication state to calculate KPIs, charts, and summaries. | Active-student distribution and executive attendance chart/daily KPI use RLS-scoped aggregate RPCs. Attendance attention/trend, fee, communication, approval, and alert calculations still consume shared state. | IN PROGRESS — frontend build/lint/diff, 5 Deno runtime tests (`--no-check`), and Edge Function type-check pass. SQL execution/plan and authenticated role/RLS parity remain unverified; apply migrations 049/050. Admission-date statistics have no matching student admission-date field and are not inferred from record creation time. |
| Attendance | Receives global roster state and attendance data. | No migration yet. | NOT STARTED. |
| Fees and Collections | Receives global roster state and fee state. | No migration yet. | NOT STARTED. |
| Communication and approvals | Receives global roster state for recipients. | No migration yet. | NOT STARTED. |
| Reports and statements | Receives global roster state. | No migration yet. | NOT STARTED. |
| CAMVIA Buddy | Server-side bounded student count/search exists; other legacy paths remain. | No full consumer migration to shared bounded contracts. | IN PROGRESS; staging and cross-domain work remain. |
| App shell / navigation / other roster users | Shared full-roster state remains in use. | No migration yet. | NOT STARTED; keep eager fetch until dependencies are migrated. |

---

### Phase 2: Bounded history data
**Status:** ⏸ Suspended by Buddy priority override; existing changes preserved
**Objective:** Paginate attendance, fee, and communication histories while preserving retrieval of older authorized records.
**Depends on:** Phase 1
**Requirements:** REQ-02

**Plans:**
- [ ] Replace broad history downloads with scoped page/date queries.
- [ ] Add summary reads for dashboard metrics where the database contract supports them.
- [ ] Verify ordering, totals, empty/error states, and history reachability.

---

### Phase 3: Evidence-based alert optimization
**Status:** ⏸ Suspended by Buddy priority override; existing changes preserved
**Objective:** Inspect live alert query plans and reduce unnecessary work without changing alert semantics or scope.
**Depends on:** Phase 2
**Requirements:** REQ-03

**Plans:**
- [ ] Capture query plans and identify dominant scans/aggregations.
- [ ] Add targeted indexes or revised query paths only when evidence supports them.
- [ ] Compare alert outputs and authorization across roles before and after.

---

### Phase 4: Scoped in-memory caching and startup flow
**Status:** ⏸ Suspended by Buddy priority override; existing changes preserved
**Objective:** Reuse fresh bounded reads for warm navigation while keeping authentication, scope changes, mutations, and explicit refreshes correct.
**Depends on:** Phases 1-3
**Requirements:** REQ-04

**Plans:**
- [ ] Define cache keys, freshness, and invalidation per bounded query.
- [ ] Add memory-only stale-while-revalidate behavior where UX permits.
- [ ] Verify sign-out, account/scope changes, mutation invalidation, and errors.

---

### Phase 5: Scale and release validation
**Status:** ⏸ Suspended by Buddy priority override; existing changes preserved
**Objective:** Produce evidence for behavior, security, query cost, transfers, and perceived startup/navigation under representative 10-campus/100,000-student load.
**Depends on:** Phases 1-4
**Requirements:** REQ-05

**Plans:**
- [ ] Apply outstanding migrations only in a verified staging project and test role/RLS parity.
- [ ] Run realistic seed/load tests and record p50/p95 query and navigation measurements.
- [ ] Record known limitations and block production-readiness claims if evidence is missing.

---

### Phase 6: Secure CAMVIA Buddy
**Status:** 🔄 Active priority
**Objective:** Let users ask natural-language questions about authorized school information while keeping retrieval read-only, role-scoped, bounded, and verifiable.
**Depends on:** Verified user identity and existing RLS; no dependency on completing the suspended application-wide migrations.
**Requirements:** REQ-06

**Verified groundwork:** The active UI sends questions to the authenticated `ask-camvia` Edge Function; browser-side role/context answer generation and the client Gemini key path were removed. The function verifies the user/profile, uses caller-scoped Supabase access, applies a rate limit, grounds model phrasing in server-computed facts with a 4 KB context cap, supports an allowlisted student count/search planner, and retains legacy read-only handlers for several other domains. Domain coverage remains uneven, some paths use unbounded reads, the response is text-only, and conversational context is not implemented. Migration `048` and a Supabase `GEMINI_API_KEY` secret remain required for admissions and model-assisted phrasing. Runtime and role-account acceptance tests remain outstanding.

**Current local implementation slice:** The allowlisted query registry now covers student count/search, attendance summary and paginated present/absent/late search, fee summary, and dashboard summary. Attendance uses model-generated, schema-validated single-day plans with optional class/section filters, resolves relative dates against the school timezone, and executes caller-RLS `SECURITY INVOKER` aggregate/search RPCs. Summary results distinguish attendance rate from recording completion; search returns exact totals and deterministic 50-row pages. Fee summaries use migration 052 to aggregate invoice items and non-voided payments in SQL `numeric`, returning exact decimal strings for outstanding, collected, and overdue totals plus invoice/student counts; optional class/section filters are validated and applied server-side. Unsupported fee lists/date ranges are explicitly declined. Dashboard plans call the caller-RLS student aggregate (049) for count-only class/section/campus/gender distributions, and the 051 attendance aggregate for today's school-timezone attendance; focus is validated and attendance access is checked against the role. Student aggregate parity, role restrictions, campus-name visibility, and authenticated results remain unverified. Student count/search remains bounded with exact totals and allowlisted sorting. Single-student/guardian lookups issue a server-side, RLS-scoped name query capped at 101 candidates; named-student attendance scopes sessions by campus/class/section. Legacy report-derived attendance/fee paths and named-student session history still have broad reads. Several other legacy domain handlers do not yet share the planner. Frontend lint/build, planner strict TypeScript check, 20 parser tests under a Node test shim, Edge TypeScript syntax transpilation, and `git diff --check` pass. Deno and authenticated database access are unavailable, so official Edge tests/type-check, migrations 051/052 SQL execution, RLS parity, role/campus isolation, financial parity, and latency remain unverified. This is not full multi-domain registry support.

**Migration 050 status:** The user reports that 049 applied successfully and that 050 failed because `current_user_organization_id()` is missing. The local 050 SQL has been corrected to rely on `SECURITY INVOKER` plus existing RLS and no longer references the missing tenant helpers. The corrected migration has not yet been retried; do not mark it verified or deploy it to production.

**Migration 051 status:** Added `051_camvia_buddy_attendance_summary.sql` for Buddy-only attendance summary and paginated status-search RPCs. Both are `SECURITY INVOKER` with row security enabled; neither uses service-role access or accepts school/tenant identifiers from the model. Apply only after confirming the intended development/staging project; SQL execution and authenticated teacher/campus RLS tests are pending.

**Migration 052 status:** Added `052_camvia_buddy_fee_summary.sql` for Buddy-only fee aggregates. The RPC is `SECURITY INVOKER`, enables row security, applies optional class/section filters server-side, excludes voided invoices/payments, clamps outstanding balances at zero per invoice, and returns exact decimal strings. It has not been applied or tested against a database; finance-role RLS, timezone-sensitive overdue semantics, and parity with existing application calculations remain unverified.

**Priority checklist:** See [`CAMVIA_BUDDY_CHECKLIST.md`](./CAMVIA_BUDDY_CHECKLIST.md). It distinguishes partial implementation from verification and is the active work tracker.

**Student intelligence status:**

| Requirement | Status | Evidence / limitation |
|---|---|---|
| Bounded server-side roster page service contract | IMPLEMENTED — UNVERIFIED | Explicit tenant scope, page/filters/order/total contract and local parser/filter tests. Live database and RLS behavior untested. |
| Student directory consumer migration | IMPLEMENTED — UNVERIFIED | Directory no longer uses the global roster for result rows; page/query is bounded, but authenticated database and browser tests remain outstanding. |
| Other full-roster consumer migration | NOT STARTED | Dashboard, attendance, fees, communication, reports, and related routes still depend on shared roster state. |
| Reusable validated plan and tool registry | IN PROGRESS | Validated tools cover student count/search, single-day attendance summary/status search, fee summary, and dashboard summary; remaining modules and live database execution are unverified. |
| Count and search by name, class, section, gender, status, campus, Student ID/Code | IMPLEMENTED — UNVERIFIED | Bounded page query and focused local tests; authenticated functional testing remains blocked. |
| Pagination, sorting, exact totals, zero-result messaging | IMPLEMENTED — UNVERIFIED | Local implementation and schema tests; no staging result comparison. |
| Partial-name matching | IMPLEMENTED — UNVERIFIED | Case-insensitive substring query; typo-tolerant matching is not implemented. |
| Admission number/date and father/mother/guardian-contact filters | NOT STARTED | No verified schema/query support; currently rejected explicitly. |
| Duplicate detection, incomplete profiles, grouping/aggregation, details, combined filters beyond allowlist | NOT STARTED | Not implemented in this query slice. |
| English, Urdu, and Roman Urdu structured query coverage | IN PROGRESS | English/Roman Urdu intent handling exists; functional language coverage is unverified and Urdu support remains unverified. |
| Attendance, fees, communications, approvals, alerts, reports, and conversation context on shared registry | IN PROGRESS | Single-day attendance summary/status search, fee aggregate summary, and core dashboard aggregates are now in the shared allowlist; other attendance operations, fee history/lists, remaining domains, and conversation context still use legacy handlers or are unimplemented. |
| Page-aware navigation, exports, form preparation/actions, proactive/voice/reaction UX | NOT STARTED | No completed implementation evidence for the full specification. |
| Authenticated role, school/campus isolation, read-only and RLS verification | BLOCKED | Requires authorized staging credentials/environment; no production deployment or test performed. |
| 10-campus/100,000-student performance evidence | BLOCKED | No representative staging dataset, query plans, or authorized load tests available. |

**Plans:**
- [x] Replace client-side role/context authorization and browser Gemini calls with authenticated server-side requests.
- [x] Add a schema-validated query plan and allowlisted tool registry for bounded student counts and searches.
- [x] Add schema-backed student filters, bounded search paging/sorting, and explicit refusal for known unsupported student filters.
- [x] Add a validated single-day attendance summary tool and caller-RLS aggregate contract (migration 051; execution unverified).
- [x] Add a validated fee summary tool and exact-decimal caller-RLS aggregate contract (migration 052; execution unverified).
- [x] Reuse caller-RLS student and daily attendance aggregates for validated dashboard summaries (execution unverified).
- [ ] Extend the shared registry and executors to the remaining school domains; preserve school, campus, and teacher-assignment scope.
- [ ] Return only bounded facts needed for each question and generate grounded answers with a server-managed model secret.
- [ ] Add focused authorization, read-only, missing-data, and answer-grounding tests.
- [ ] Verify the function with role-specific staging accounts before enabling broad school-data Q&A.

---

## Progress Summary

| Phase | Status | Plans | Complete |
|-------|--------|-------|----------|
| 1-5 | ⏸ Suspended; preserve completed work | — | — |
| 6 | 🔄 Active CAMVIA Buddy priority | 3/7 | — |

---

## Timeline

| Phase | Started | Completed | Duration |
|-------|---------|-----------|----------|
| 1 | 2026-11-26 | — | — |
| 2 | — | — | — |
| 3 | — | — | — |
| 4 | — | — | — |
| 5 | — | — | — |
| 6 | — | — | — |
