# CAMVIA Buddy Implementation Checklist

**Priority:** Active  
**Mode:** Read-only school administration copilot  
**Updated:** 2026-11-26  
**Rule:** Build/test status is not authenticated runtime verification.

Status definitions: `NOT STARTED`, `IN PROGRESS`, `IMPLEMENTED — UNVERIFIED`, `VERIFIED`, `BLOCKED`.

## Stage 1 — Intelligence foundation

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Authenticated server-side request path | IMPLEMENTED — UNVERIFIED | `ask-camvia` verifies Supabase user/profile; authenticated staging acceptance remains outstanding. |
| Central structured query planner | IN PROGRESS | Shared Gemini request transport with domain schemas covers student count/search, attendance summary/search, fee summary, and dashboard summary; more domains/operations and centralized prompt construction remain. |
| Multi-domain tool registry | IN PROGRESS | Shared allowlist/parser covers students, attendance, fees, and dashboard summary; remaining domains still use legacy handlers. |
| Schema validation and allowlisted fields/operations | IN PROGRESS | Student, attendance, fee, and dashboard parsers reject unknown fields/operations; add equivalent validators and execution authorization for remaining modules. |
| Permission-scoped execution through caller RLS | IMPLEMENTED — UNVERIFIED | Caller token is used; role, school, campus, and teacher-assignment isolation need authenticated tests. |
| Grounded structured responses | IN PROGRESS | Existing responses are text; add validated component schema and renderer. |
| Unsupported-filter and failure behavior | IN PROGRESS | Student unsupported cases are explicit; general domain coverage and network/migration distinction need work. |
| Read-only enforcement | IN PROGRESS | Existing prompt guard is regex-based; add centralized action allowlist and tests. |
| Prompt-injection resistance | IN PROGRESS | System prompt treats user/data as untrusted; adversarial tests and retrieved-content handling remain. |
| Model secret, bounded context, timeout, rate limit | IMPLEMENTED — UNVERIFIED | Server-side Gemini key lookup, 4 KB facts cap, timeouts, per-process user rate limit; deployment/configuration and distributed limits unverified. |

## Stage 2 — Core school intelligence

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Student count/search | IMPLEMENTED — UNVERIFIED | Bounded page, exact count, allowlisted fields and sort; live account/RLS behavior unverified. |
| Student details and authorized identifiers | IN PROGRESS | Named student/guardian lookup now filters by name in the database, uses caller RLS, applies optional class/section filters, and caps returned candidates at 101. Exact duplicate handling and authenticated behavior remain unverified. |
| Student partial-name matching | IMPLEMENTED — UNVERIFIED | Substring filters exist; escaping, multiple matches, and real data need runtime verification. |
| Genuine typo-tolerant matching | NOT STARTED | Do not label approximate matches as exact; schema/index and migration need evaluation. |
| Father/mother/guardian/contact filters | NOT STARTED | Current student planner explicitly rejects unsupported filters; schema-backed relationship queries needed. |
| Admission, duplicate, incomplete-profile intelligence | NOT STARTED | Verify actual schema and business definitions first. |
| Student grouping, comparison, pagination and exports | IN PROGRESS | Search pagination exists; grouping, comparisons, context paging, and exports remain. |
| Attendance intelligence | IN PROGRESS | Structured summary and paginated status search support one school-timezone date with optional class/section filters; caller-RLS `SECURITY INVOKER` RPCs calculate counts and separate rate from recording completion. Migration 051 and authenticated results are unverified. Named-student historical session loading within their class remains unbounded. Period summaries, missing-session detection, leave, consecutive absences, comparison, and broader operations remain. |
| Attendance rate vs recording completion | IMPLEMENTED — UNVERIFIED | Buddy summary returns eligible/recorded/unmarked counts and the Edge Function computes rate separately from recording completion; migration 051 and attendance eligibility semantics need authenticated verification. |
| Fees and collections intelligence | IN PROGRESS | Fee summary now uses a caller-RLS `SECURITY INVOKER` aggregate RPC (migration 052) for outstanding, collected, overdue amounts and invoice/student counts. SQL `numeric` arithmetic is returned as decimal strings; student/payment lists, date-range filters, financial parity, and authenticated RLS remain unverified. |
| Dashboard intelligence | IN PROGRESS | Buddy now reuses the caller-RLS student aggregate (migration 049) and today's attendance summary (migration 051) based on a validated focus plan. Student distributions are count-only; permission behavior, RPC execution, and authenticated results remain unverified. Fees, communication, approvals, and other dashboard metrics are not included. |

## Stage 3 — Administrative modules

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Communication history and delivery intelligence | IN PROGRESS | Legacy status counts exist; some paths fetch all messages. Add bounded/date-filtered counts and history. |
| Message drafting and translation | NOT STARTED | Draft generation only; sending/mutation remains prohibited. |
| Alerts | IN PROGRESS | Legacy active alert count exists; bounded summaries, details, and explanation grounding remain. |
| Approval Center | IN PROGRESS | Communication approval-status counts exist; request detail/history/navigation needs implementation. Approval/rejection remain prohibited. |
| Administration and permissions | NOT STARTED | Add least-privilege read-only directory/configuration tools; never reveal secrets. |
| Trash intelligence | NOT STARTED | Add authorized read-only counts/search/navigation; restore and permanent deletion remain prohibited. |

## Stage 4 — Context and interaction

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Structured conversation context | NOT STARTED | No validated server-side cohort/result context; avoid storing full records. |
| Follow-up filters, pronouns and pagination | NOT STARTED | Revalidate prior references and authorization each turn. |
| Context invalidation by auth/school/campus/permission/new chat/expiry | NOT STARTED | Required before context reuse. |
| Page-aware validated context | NOT STARTED | Route/selection may guide interpretation only; backend must independently authorize. |
| Interactive tables, charts, KPI cards, alerts | NOT STARTED | Current `AskCamviaResponse` is text-only; define validated components and functional controls. |
| Authorized record navigation | NOT STARTED | Use existing routes and backend-authorized identifiers. |
| Mobile, keyboard and reduced-motion behavior | IN PROGRESS | Existing page exists; full assistant responsive/accessibility acceptance not performed. |

## Stage 5 — Reports and experience

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| CSV export | NOT STARTED | Complete authorized result set, bounded/streamed, server-safe. |
| Excel export | NOT STARTED | Complete authorized result set and resource limits. |
| PDF export | NOT STARTED | Complete authorized result set and resource limits. |
| Voice input/output | NOT STARTED | No verified browser/language support. |
| Automatic Buddy reactions | IN PROGRESS | Existing Buddy character/visuals exist; event-driven state transitions and ordinary-user controls need verification. |
| Conversation history/new/clear/copy/retry/stop | IN PROGRESS | Existing chat hook stores UI messages; persistent history and required controls need review. |
| Suggested questions from current page/capabilities | IN PROGRESS | Existing role suggestions; page-aware authorized suggestions not implemented. |

## Stage 6 — Security and acceptance

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Authentication and role isolation | IMPLEMENTED — UNVERIFIED | Server verifies active profile and checks role-domain allowlist; staging tests remain. |
| Organization/school/campus isolation | BLOCKED | Depends on authenticated staging test accounts and RLS verification. |
| Teacher assignment restrictions | IMPLEMENTED — UNVERIFIED | RLS and assignment filtering exist in legacy paths; test each query/tool. |
| Record/field-level restrictions and soft-delete rules | IN PROGRESS | Review each registry tool and relationship; test trashed/archived records. |
| Prompt-injection and prohibited-write tests | IN PROGRESS | Add query/data injection and all mutation-intent cases. |
| Edge Function type-check and local tests | BLOCKED | Deno is unavailable, so official Deno test/type-check could not run. Structured planner test bodies passed under a Node shim; standalone planner strict type-check, Edge syntax transpilation, frontend lint/build, and diff checks passed. |
| Authenticated browser/runtime acceptance | BLOCKED | No authenticated staging session available. |
| Live Gemini planner/configuration verification | BLOCKED | Secret presence/value and live model behavior not verified; never expose the secret. |
| Query plans, latency, request cost and representative scale evidence | BLOCKED | No authorized staging database/seed/load-test environment. |
| Migration 048 | IMPLEMENTED — UNVERIFIED | Required for admission summary; environment application needs confirmation. |
| Migration 049 | IMPLEMENTED — UNVERIFIED | User reports it applied successfully; no independent schema/RLS verification. |
| Migration 050 | IMPLEMENTED — UNVERIFIED | Updated to remove unavailable `current_user_organization_id()` / `current_user_school_id()` dependencies; retry in the intended environment and verify RLS behavior. |
| Migration 051 | IMPLEMENTED — UNVERIFIED | Adds Buddy-only attendance summary and paginated search RPCs with `SECURITY INVOKER` and row security; apply only in the confirmed dev/staging project, then test teacher/campus RLS and calculation parity. |
| Migration 052 | IMPLEMENTED — UNVERIFIED | Adds a Buddy-only database-side fee summary with `SECURITY INVOKER` and row security; apply only in confirmed development/staging, then verify finance-role RLS and parity with established invoice/payment rules. |
| Production deployment | BLOCKED | Not authorized. |

## Current acceptance status

- Local implementation is partial; the full Buddy specification is not complete.
- No production deployment has occurred.
- Do not claim end-to-end verification or 100,000-student readiness.
