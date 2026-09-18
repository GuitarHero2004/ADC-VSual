# API, orchestration and integration contracts

Version 2.0 · Proposed contract freeze for parallel frontend/backend implementation

## 1. Contract rules

- All paths are under `/v1`; workspace context comes from verified identity plus `X-Workspace-ID`. A header alone is not authorisation.
- Every route validates active membership and, for session content, session ownership. Admin status does not grant conversation access.
- JSON is UTF-8; timestamps are RFC 3339 UTC strings; Entity IDs are UUID strings; bigint event cursors are decimal strings in JSON to avoid JavaScript precision loss. UI displays time using the chosen locale and explicit timezone where needed.
- Decimal business values use canonical decimal strings with an explicit scale/unit in evidence JSON, avoiding floating-point ambiguity. Counts can be integers. Money is not in the H0 fixture.
- Every response includes `request_id`; mutations require `Idempotency-Key` except where the route is intrinsically idempotent and documents its existing-record behaviour.
- Known foreign-tenant/foreign-owner IDs return the same 404 envelope as unknown IDs. Do not reveal resource existence.
- Errors follow `{error: {code, message, retryable, field_errors?, recovery?}, request_id}`. `message` is localised; `code` is stable.
- Unknown fields in security-bearing payloads are rejected. UI content is escaped text, never trusted HTML. Model outputs pass separate strict schemas.
- Bearer credentials stay in extension-owned context; no page bridge, query-string token or full-token logging. Real pilot auth should use an approved provider/PKCE flow. H0 can use pre-provisioned short-lived identities.
- Same-origin page cookies remain with the browser. The backend does not impersonate the website by copying those cookies.
- One active task per session is enforced in the database. Streaming reconnect does not create a second task.
- REST payloads are proposed implementation contracts. This pack does not claim an implemented API or generated OpenAPI validator.

## 2. Endpoint catalogue

### API-01 — bootstrap

**GET `/v1/me`**

- **Request:** Verified bearer identity and X-Workspace-ID; no body.
- **Response:** User display name, active workspace, preferences, policy version and support matrix. Includes workspace_kind and seeded/active tier, with core-quality parity.
- **Guards and semantics:** Return only memberships belonging to the caller. Do not expose coworker identities.
- **Persistence:** app_users, memberships, workspaces, user_preferences

### API-02 — updatePreferences

**PUT `/v1/preferences`**

- **Request:** locale, speech_mode, contrast_mode, text_scale_percent, speech_rate, reduced_motion, expected_version. Also confirmation_mode, answer_detail and auto_return.
- **Response:** Saved preference object and incremented version.
- **Guards and semantics:** 409 on stale version; speech and locale enums validated.
- **Persistence:** user_preferences

### API-03 — createSession

**POST `/v1/sessions`**

- **Request:** client_session_key, canonical origin, adapter_key, browser/extension version; no full URL.
- **Response:** session_id, status, expires_at, policy_version, capabilities.
- **Guards and semantics:** Idempotency required; origin must be allowed; user bound server-side.
- **Persistence:** browser_sessions, origin_policies, idempotency_records

### API-04 — grantConsent

**POST `/v1/sessions/{session_id}/consents`**

- **Request:** purpose, notice_version, explicit_acceptance=true.
- **Response:** consent_id, purpose, expires_at.
- **Guards and semantics:** One purpose per request; user must own session; notice version must be current.
- **Persistence:** consent_grants, audit_events

### API-05 — revokeConsent

**POST `/v1/consents/{consent_id}/revoke`**

- **Request:** expected_session_id.
- **Response:** revoked_at and affected task IDs/statuses.
- **Guards and semantics:** Revocation blocks dispatch immediately; repeated revoke returns existing result.
- **Persistence:** consent_grants, tasks, audit_events

### API-06 — createSnapshot

**POST `/v1/sessions/{session_id}/snapshots`**

- **Request:** SnapshotEnvelope v1 with revision, document_key, relevant state, extracted evidence.
- **Response:** snapshot_id, evidence_ids, state_fingerprint, accepted completeness and expiry.
- **Guards and semantics:** Validate payload and active consent; server recomputes fingerprint from canonical relevant state. Unique revision collision with different body is 409.
- **Persistence:** page_snapshots, evidence_items

### API-07 — createTask

**POST `/v1/sessions/{session_id}/tasks`**

- **Request:** request_text, input_mode, locale, optional snapshot_id, client_request_id.
- **Response:** 202 with task_id, version, status=queued and stream URL.
- **Guards and semantics:** One active task per session; body max 4000 characters; snapshot must belong to session and remain available.
- **Persistence:** tasks, messages, task_events, idempotency_records

### API-08 — getTask

**GET `/v1/tasks/{task_id}`**

- **Request:** Task ID and owner context.
- **Response:** Task state, version, messages, claim summaries, pending plan and execution status.
- **Guards and semantics:** No raw provider traces. Missing/purged content is explicitly marked.
- **Persistence:** tasks, messages, claims, action_plans, executions

### API-09 — streamEvents

**GET `/v1/tasks/{task_id}/events`**

- **Request:** Accept: text/event-stream and Last-Event-ID or numeric after cursor.
- **Response:** SSE status events with monotonically increasing event_sequence.
- **Guards and semantics:** Use authenticated fetch streaming; never put bearer tokens in query strings. Replay only this task; heartbeat contains no user content.
- **Persistence:** task_events

### API-10 — answerClarification

**POST `/v1/tasks/{task_id}/clarifications`**

- **Request:** text, expected_task_version, clarification_id.
- **Response:** 202 with task version and resumed status.
- **Guards and semantics:** Only needs_clarification state, current prompt and owner; at most three rounds; ten-minute human wait maximum.
- **Persistence:** tasks, messages, task_events

### API-11 — getClaimEvidence

**GET `/v1/claims/{claim_id}/evidence`**

- **Request:** Claim ID.
- **Response:** Claim basis, scope, citations, source values, units, capture time, formula and availability.
- **Guards and semantics:** Return only same-owner session sources; no source text after expiry.
- **Persistence:** claims, claim_evidence, evidence_items, page_snapshots

### API-12 — getPlan

**GET `/v1/plans/{plan_id}`**

- **Request:** Plan ID.
- **Response:** PlanEnvelope v2 with actual pending descriptors, descriptor_hash, authorisation_mode, undo availability, plan hash and expiry. GET has no challenge-creation side effect.
- **Guards and semantics:** Only the current immutable plan can grant fresh authority; explicit decisions require a pending challenge. Historical or authorised plans can be inspected without enabling duplicate decisions. Superseded state disables all new grants.
- **Persistence:** action_plans, action_steps, confirmation_challenges, approvals, action_authorisations

### API-13 — decidePlan

**POST `/v1/plans/{plan_id}/decision`**

- **Request:** Current challenge_id + nonce, displayed_plan_hash and descriptor_hash. Keyboard/pointer submit an explicit decision. Voice uses a separately armed multipart recording (at most 5 seconds/512 KiB) with voice consent; the server derives the decision and ignores client-supplied yes text.
- **Response:** approval_id, decision, expiry, task_version and authorisation_id when approved.
- **Guards and semantics:** Lock task/plan/challenge, validate owner, descriptor/state/policy and expiry, and consume challenge once. An uncertain voice reply produces no approval/authorisation. A rejected decision never grants authority. Read-back must precede input capture. No speaker-biometric guarantee.
- **Persistence:** confirmation_challenges, approvals, action_authorisations, action_plans, tasks, audit_events, idempotency_records

### API-14 — claimExecution

**POST `/v1/plans/{plan_id}/claim-execution`**

- **Request:** authorisation_id, fresh_snapshot_id, plan_hash, descriptor_hash and client_instance_key.
- **Response:** execution_id, short-lived signed command envelope, lease_expires_at, receipt keys.
- **Guards and semantics:** Atomically consume valid direct-request or explicit-confirmation authorisation and create execution/outbox once. Direct mode must remain eligible and within exact user-message scope. Check fresh document/state/descriptor; an existing confirmation is mandatory for committed actions.
- **Persistence:** action_authorisations, executions, outbox_commands, step_results, tasks, audit_events

### API-15 — recordStepReceipt

**POST `/v1/executions/{execution_id}/steps/{step_id}/receipt`**

- **Request:** client_receipt_key, outcome, dispatched_at, before_snapshot_id, after_snapshot_id, bounded error_code.
- **Response:** Stored receipt, verification outcome, recovery_status/undo expiry and permitted next step or stop.
- **Guards and semantics:** Same plan/step/owner only; immutable duplicate receipt returns original; conflicting replay is 409. Fresh observation required for success.
- **Persistence:** step_results, verifications, executions, task_events

### API-16 — cancelTask

**POST `/v1/tasks/{task_id}/cancel`**

- **Request:** expected_task_version optional, reason=user_stop|session_ended|consent_revoked.
- **Response:** Cancellation acknowledgement, observed completed steps and remaining unknown effects.
- **Guards and semantics:** Cancellation is idempotent and must not fail solely due to a stale UI version. Local stop happens before network call.
- **Persistence:** tasks, executions, outbox_commands, task_events, audit_events

### API-17 — endSession

**POST `/v1/sessions/{session_id}/end`**

- **Request:** reason=user_closed|origin_changed|permission_revoked.
- **Response:** Ended session and cancellation summary.
- **Guards and semantics:** Terminates future capture/claim; does not erase content unless deletion requested separately.
- **Persistence:** browser_sessions, tasks, consent_grants

### API-18 — submitFeedback

**POST `/v1/tasks/{task_id}/feedback`**

- **Request:** outcome, optional reason/comment; maximum comment 1000 characters.
- **Response:** feedback_id and saved category.
- **Guards and semantics:** One feedback per user/task; no automatic research recording consent.
- **Persistence:** feedback

### API-19 — requestDeletion

**POST `/v1/deletions`**

- **Request:** scope=session|user_content, session_id when session scope.
- **Response:** 202 with deletion_id, access_blocked=true, deadline_at.
- **Guards and semantics:** Immediately block applicable content and cancel active tasks; owner-only.
- **Persistence:** deletion_requests, tasks, browser_sessions, audit_events

### API-20 — getDeletion

**GET `/v1/deletions/{deletion_id}`**

- **Request:** Deletion ID.
- **Response:** status, requested_at, deadline_at, completed_at and safe progress counters.
- **Guards and semantics:** No content is returned; failed steps remain visible and retryable internally.
- **Persistence:** deletion_requests

### API-21 — transcribe

**POST `/v1/sessions/{session_id}/transcriptions`**

- **Request:** Multipart audio, locale, voice consent ID, max 30 seconds/2 MiB.
- **Response:** Editable transcript and uncertain spans when provider supports them.
- **Guards and semantics:** Transient dictation only; no persistence of raw audio. This route cannot approve a plan. Voice confirmation uses the separate challenged input on API-13.
- **Persistence:** consent_grants; model usage linked to task once a task is created, otherwise aggregate ephemeral metrics

### API-22 — analyseVisual

**POST `/v1/tasks/{task_id}/visual-analysis`**

- **Request:** H0: bounded selected region, visual consent ID, related snapshot and question.
- **Response:** 202; final answer emitted through normal task/evidence channels.
- **Guards and semantics:** One region up to 2 MiB; selected-region redaction check; no raw persistence; estimated basis only. P1 may explicitly select browser-visible shared content; native/protected content stays unavailable.
- **Persistence:** evidence_items, messages, claims, model_calls

### API-23 — exportAnswer

**GET `/v1/tasks/{task_id}/export`**

- **Request:** P1: explicit export request and format=text|html.
- **Response:** Accessible local-download content with source context and uncertainty.
- **Guards and semantics:** Owner-only; expiry enforced; no outbound publishing.
- **Persistence:** messages, claims, claim_evidence, evidence_items

### API-24 — updateOriginPolicy

**PUT `/v1/policies/origins/{policy_id}`**

- **Request:** P1: read/vision/action flags, committed_action_allowed, force_confirmation, adapter_key and expected_policy_version.
- **Response:** New policy_version and updated policy.
- **Guards and semantics:** Admin-only; no wildcard expansion; policy version increment invalidates pending plans.
- **Persistence:** origin_policies, workspaces, audit_events

### API-25 — getHealth

**GET `/v1/health`**

- **Request:** No user payload.
- **Response:** Minimal liveness/build version; detailed provider health only on protected operator endpoint.
- **Guards and semantics:** Never return secrets, configured model keys, internal hostnames or tenant counts.
- **Persistence:** None

### API-26 — createConfirmationChallenge

**POST `/v1/plans/{plan_id}/confirmation-challenges`**

- **Request:** plan_hash, descriptor_hash, fresh_snapshot_id and UI read-back-ready acknowledgement.
- **Response:** challenge_id, nonce, expires_at and exact trusted descriptor to present.
- **Guards and semantics:** Explicit-confirmation plans only. Revoke prior pending challenges; 30-second maximum window after presentation; no capture until deliberate input gesture. The UI event does not prove cognitive comprehension.
- **Persistence:** confirmation_challenges, action_plans, audit_events

### API-27 — authoriseDirectRequest

**POST `/v1/plans/{plan_id}/authorisations`**

- **Request:** source_message_id, plan_hash, descriptor_hash and fresh_snapshot_id.
- **Response:** authorisation_id, mode=direct_request and expiry.
- **Guards and semantics:** Only an unambiguous user message whose exact operation/arguments match an adapter-proven reversible plan. Never accept page/model text as provenance. confirm_all or force_confirmation denies this route. Committed/prohibited operations cannot use it.
- **Persistence:** action_authorisations, action_plans, messages, audit_events

### API-28 — requestUndo

**POST `/v1/step-results/{step_result_id}/undo`**

- **Request:** explicit user request_text, locale and current_snapshot_id.
- **Response:** 202 with new task_id and plan relation to original step; no immediate rollback.
- **Guards and semantics:** Owner/same session, original effect verified, inverse unexpired, current state matches expected after-state and no active conflicting task. Unknown original/inverse effects are not retried automatically.
- **Persistence:** tasks, messages, action_plans, action_steps, step_results, action_authorisations

### API-29 — getSourceTable

**GET `/v1/snapshots/{snapshot_id}/source-table`**

- **Request:** Snapshot ID and optional table/region key.
- **Response:** Semantic rows/columns, original values, units, filters, completeness and source timestamp.
- **Guards and semantics:** Owner/TTL checks. May work before any AI answer. For visual-only content return SOURCE_DATA_UNAVAILABLE, not fabricated rows; estimated interpretation is a separate view.
- **Persistence:** page_snapshots, evidence_items

### API-30 — getWorkspaceEntitlement

**GET `/v1/entitlements`**

- **Request:** Current authenticated workspace.
- **Response:** Tier, available administrative features, own seat state and shared core-quality statement.
- **Guards and semantics:** H0 uses seeded values. Do not expose other workers’ assignments or content to an ordinary member. Exact prices exist only if contracted, not inferred from the USD 50–60 planning range.
- **Persistence:** workspace_entitlements, seat_assignments

### API-31 — assignSeat

**PUT `/v1/seats/{user_id}`**

- **Request:** P1 administrator: status=active|released and expected_entitlement_version.
- **Response:** Assignment and workspace active-seat count.
- **Guards and semantics:** Verify admin and active target membership; lock entitlement while checking seat cap. Reassignments never move personal conversation history to an employer workspace.
- **Persistence:** workspace_entitlements, seat_assignments, memberships, audit_events

### API-32 — getAggregateUsage

**GET `/v1/reports/aggregate-usage`**

- **Request:** P1 administrator; bounded reporting period.
- **Response:** Workspace seat totals, aggregate usage/cost and system health; suppressed small-group breakdowns.
- **Guards and semantics:** No per-worker productivity score, transcript, URL history, disability category or raw business data. Do not label simple aggregation as guaranteed anonymity.
- **Persistence:** workspace_entitlements, seat_assignments, model_calls, audit_events


## 3. Canonical objects

### 3.1 SnapshotEnvelope v1

The client supplies redacted state; the server validates and recalculates the relevant-state fingerprint. An adapter is a declared extractor, not a guarantee that the host data itself is correct.

```json
{
  "schema_version": "1.0",
  "revision": 4,
  "document_key": "doc-random-opaque",
  "adapter_key": "orders-fixture@1",
  "captured_at": "2026-09-21T07:20:00Z",
  "page_path": "/orders",
  "source_mode": "structured",
  "is_complete": true,
  "state": {
    "title": "Completed orders",
    "metric": "completed_orders",
    "unit": "orders",
    "filters": {"region": "South", "year": 2026},
    "dataset_revision": "fixture-v1",
    "loading": false
  },
  "evidence": [
    {"client_key": "july", "kind": "dom_table", "label": "July 2026 completed orders",
     "source_pointer": {"table_key": "orders", "row_key": "2026-07", "column_key": "completed"},
     "payload": {"raw": "1,200", "value": "1200", "type": "integer", "unit": "orders", "parse_status": "valid"}},
    {"client_key": "august", "kind": "dom_table", "label": "August 2026 completed orders",
     "source_pointer": {"table_key": "orders", "row_key": "2026-08", "column_key": "completed"},
     "payload": {"raw": "900", "value": "900", "type": "integer", "unit": "orders", "parse_status": "valid"}}
  ]
}
```

**Validation:** origin derives from session; document key must match the bound tab; reject prohibited fields and oversized payloads; state must include metric/unit/filter semantics for calculations; client evidence keys are unique within the upload; unresolved parsing remains uncertain. For ordinary answers, captured state older than 30 seconds triggers a refresh before calling it current. Actions always revalidate relevant state immediately before dispatch, even under 30 seconds.

The payload is a product-defined extraction, not a raw browser accessibility-tree dump. H0 does not require the privileged Chrome debugger API.

### 3.2 AnswerEnvelope v1

```json
{
  "schema_version": "1.0",
  "task_id": "TASK_UUID",
  "scope": {"metric": "completed_orders", "region": "South", "periods": ["2026-07", "2026-08"]},
  "summary": "Completed orders decreased by 300, or 25 percent, from July to August.",
  "claims": [
    {
      "ordinal": 1,
      "basis": "computed",
      "text": "Completed orders decreased by 25 percent.",
      "evidence_ids": ["JULY_EVIDENCE_UUID", "AUGUST_EVIDENCE_UUID"],
      "calculation": {
        "operation": "percent_change",
        "baseline_evidence_id": "JULY_EVIDENCE_UUID",
        "current_evidence_id": "AUGUST_EVIDENCE_UUID",
        "baseline": "1200", "current": "900", "result": "-25", "unit": "percent"
      },
      "verification_status": "supported"
    }
  ],
  "limitations": [],
  "source_mode": "structured"
}
```

The ID tokens in examples are explanatory placeholders, not valid UUIDs to submit to the API. Backend-issued final answers contain actual IDs. The model may propose claim structure, but the service replaces calculation results with computed values and validates source membership, scope and completeness. A claim cannot cite evidence from another session. Do not expose model chain-of-thought; expose sources and reproducible operations.

**Allowed calculation operations:** `lookup`, `difference`, `sum`, `minimum`, `maximum`, `percent_change`. Define percent change as `(current - baseline) / baseline × 100`; baseline zero is undefined. Rounding is display-only, maximum two decimal places by default; preserve exact decimal result/operands in the calculation record. Do not mix percent and percentage points.

### 3.3 PlanEnvelope v2

```json
{
  "schema_version": "2.0",
  "plan_id": "PLAN_UUID",
  "revision": 1,
  "task_id": "TASK_UUID",
  "session_id": "SESSION_UUID",
  "document_key": "doc-random-opaque",
  "origin": "https://demo.example",
  "adapter_key": "orders-fixture@1",
  "base_snapshot_id": "SNAPSHOT_UUID",
  "state_fingerprint": "SHA256_HEX",
  "policy_version": 1,
  "risk_class": "reversible",
  "authorisation_mode": "direct_request",
  "plan_kind": "normal",
  "reverses_step_result_id": null,
  "descriptor_hash": "SHA256_HEX",
  "expires_at": "2026-09-21T07:22:00Z",
  "steps": [
    {"ordinal": 1, "verb": "set_filter",
     "target": {"control_key": "region", "handle": "handle-for-current-document", "label": "Region"},
     "arguments": {"value": "South"},
     "precondition": {"selected_value": "North", "loading": false},
     "expected_effect": {"selected_value": "South", "dataset_region": "South", "loading": false},
     "pending_descriptor": {"verb": "set_filter", "origin": "https://demo.example", "control_key": "region", "current_value": "North", "proposed_value": "South"},
     "undo_spec": {"verb": "set_filter", "arguments": {"value": "North"}, "requires_current_value": "South", "expires_after_seconds": 300},
     "timeout_ms": 10000}
  ]
}
```

Plan digest input includes schema version, owner/workspace/session/task/plan IDs, revision, exact origin/document/adapter, relevant snapshot fingerprint, policy version, expiry, risk class, authorisation mode, plan kind/original receipt, descriptor hash and ordered steps including inverse guards. The server uses deterministic canonical UTF-8 JSON: recursively sorted object keys, preserved array order, no insignificant whitespace, no non-finite numbers; action arguments are strings/booleans/integers or recursively validated objects. The same shared serialiser supplies server digest tests and frontend verification fixtures. Do not independently improvise two canonicalisation implementations.

The adapter constructs each `pending_descriptor` from the actual locally resolved target and dispatch payload. Its canonical digest is `descriptor_hash`; the full plan digest binds that descriptor and every other authority-relevant field. The extension recomputes the descriptor immediately before dispatch and stops on a mismatch. Human-readable summary is generated from those validated fields in trusted extension UI. The plan’s canonical bytes and signed digest must match the displayed structured plan. A summary cannot omit an external effect; H0 blocks such effects entirely.

### 3.4 Command envelope and local receipt

The execution claim returns a short-lived server-signed envelope with `execution_id`, `authorisation_id`, `authorisation_mode`, `plan_id`, `plan_hash`, `descriptor_hash`, owner/session/document/origin, adapter version, allowed steps, issued/expiry times and a one-use nonce. Proposed signing default: a standard JWT implementation with ES256 and key rotation, verified through a pinned/configured server public key. Algorithm allowlist is fixed; do not accept `none` or a token-selected algorithm. Token TTL is the earliest of 60 seconds, session expiry, plan expiry and authorisation expiry. Store only the nonce digest server-side; never persist the bearer envelope in SQL logs.

The base snapshot fingerprint is checked before the first step. Later steps check their declared preconditions against the verified effects of earlier steps; expected changes from the authorised plan must not be mistaken for an unrelated stale page. Unexpected relevant changes still stop remaining steps.

Before each side effect, the client writes a local minimal receipt key, checks cancel state and validates the live target/precondition. A crashed worker must not replay a `dispatched` receipt. A new service-worker instance can re-read durable metadata and request status, but cannot infer an unacknowledged browser effect succeeded.

```json
{
  "client_receipt_key": "CLIENT_UUID",
  "outcome": "observed",
  "before_snapshot_id": "BEFORE_UUID",
  "after_snapshot_id": "AFTER_UUID",
  "dispatched_at": "2026-09-21T07:20:15Z",
  "error_code": null
}
```

The server evaluates `expected_effect` using fresh evidence. A client’s `outcome=observed` is a receipt classification, not a request to mark the task completed. An expired lease prevents new dispatch but does not prevent the server from accepting and auditing a late receipt for an already-dispatched action.

### 3.5 Authority, confirmation and Undo objects

`AuthorisationEnvelope` returns `authorisation_id`, `plan_id`, `mode`, `plan_hash`, `descriptor_hash`, `source_message_id`, nullable `approval_id`, `policy_version`, `status` and `expires_at`. It is an informational object, not a bearer execution credential. API-14 issues the short-lived signed dispatch envelope after fresh checks.

`ConfirmationChallenge` returns `challenge_id`, a random nonce, descriptor and expiry. Store only its nonce digest. The UI first presents the exact pending descriptor, then deliberately arms the relevant response control. Uncertain speech records no decision; a fresh challenge can be offered without mutating the immutable plan. Expiry is at most 30 seconds after presentation and never beyond plan/session expiry. Reissuing a challenge revokes the previous pending one.

API-13 supports two explicit content types: keyboard/pointer JSON containing `decision`, `method`, challenge ID, nonce and displayed digests; or multipart voice containing a bounded audio part, voice-consent ID, challenge ID, nonce and displayed digests. The service derives a voice decision with a strict locale-aware yes/no parser and rejects mixed, uncertain or unrecognised replies. It does not trust a client-supplied transcript as a voice decision. No raw audio is persisted. A genuine deliberate user request is still necessary: this mechanism does not authenticate speakers or eliminate ambient speech captured inside the armed window. P1 committed actions require keyboard/pointer confirmation until the voice-confirmation gate is evaluated and explicitly enabled for that adapter.

`UndoAvailability` contains original receipt ID, status, expiry and a plain-language inverse description. API-28 creates a new user task/message and inverse plan; it does not synchronously mutate the page. The inverse follows the same authority, claim, observation and verification path. Original success remains historical even if Undo fails.

### 3.6 Source table and question starters

API-29 returns only permitted original structured values and their extraction context. It can be used without asking an AI question. Rows include stable source keys, display value, typed value or missing marker, units, current filters and completeness. An image interpretation is never relabelled a source table. `SOURCE_DATA_UNAVAILABLE` is the expected visual-only response; the image explanation remains available separately.

Contextual starters are optional suggestions derived from available fields, such as a value lookup, maximum with ties or a descriptive trend. Activating a starter creates a normal visible user request. It cannot silently grant an action. A trend describes observed data, not an unrequested forecast or causal conclusion.

## 4. Extension internal messages

Use a shared discriminated union with `schema_version`, `message_id`, `session_key`, `document_key`, `type` and a typed `payload`. All messages have maximum sizes. Sender extension identity, tab, frame and document are checked against the bound session. Disable external extension messaging in H0. Never forward arbitrary `window.postMessage` data into privileged handlers.

| Type | Direction | Purpose | Important check |
|---|---|---|---|
| PANEL_OPEN | Panel → worker | Bind selected tab and initialise UI | User gesture, supported origin |
| CAPABILITIES_REQUEST | Worker → adapter | Discover supported surface | Correct tab/document |
| CAPTURE_REQUEST | Worker → adapter | Read bounded selected structure | Active consent and policy |
| CAPTURE_RESULT | Adapter → worker | Redacted state/evidence | Schema, size, expected capture ID |
| CONTEXT_CHANGED | Adapter → worker | Invalidate stale handles/plans | Relevant-state debounce; no raw page content |
| EXECUTE_STEP | Worker → adapter | Run one packaged operation | Signed plan scope plus unique target and fresh preconditions |
| STEP_OBSERVATION | Adapter → worker | Report before/after state | Receipt key and step membership |
| STOP_TASK | Panel/worker → adapter | Prevent further dispatch | Immediate local cancellation wins races |
| FOCUS_RETURN | Panel → worker | Restore host position | Still-valid target or explained fallback |
| VOICE_CAPTURE_STOP | Focused panel → worker | End capture on release/blur | Does not by itself cancel a submitted task |
| CONFIRMATION_ARM | Trusted panel → worker | Deliberately open current challenge response window | Fresh challenge, read-back finished, owner gesture |
| UNDO_REQUEST | Panel → worker | Request guarded inverse | Valid receipt and fresh after-state; new task |

An adapter may receive a mutation event caused by the assistant’s own action. It must reconcile that event with the in-flight expected effect, not indiscriminately invalidate the completed step; unexpected relevant mutations still stop remaining steps.

## 5. Idempotency, transactions and concurrency

### 5.1 Mutating HTTP request handling

1. Authenticate and derive owner/workspace before looking up the key.
2. Canonicalise route/body and calculate a request hash.
3. Insert or lock `(workspace_id, user_id, route_key, idempotency_key)`.
4. Same key and different hash → `409 IDEMPOTENCY_CONFLICT`.
5. Completed same request → return stored response IDs/codes, never re-run it.
6. In-progress or uncertain request → expose current status; do not run a second copy.
7. Commit the domain mutation and response record in the same database transaction when possible.

No database transaction can atomically encompass a third-party page click. This design separates server deduplication from browser uncertainty instead of claiming exactly-once external effects.

### 5.2 Authority transactions

**Direct reversible request (API-27):** lock task → plan; validate current owner, consent, policy, fresh snapshot, pending state and expiry. Read the immutable user-role `source_message_id` under the same task scope. Match operation, resolved target, argument and requested scope exactly; require an adapter-proven inverse. Reject ambiguity, new choices, `confirm_all`, forced confirmation, committed effects and prohibited operations. Insert one direct authorisation, mark the plan authorised and record a minimal audit/event. The model's risk classification alone is insufficient.

**Explicit decision (API-13):** lock task → plan → current challenge. Validate owner, active session/membership, displayed plan/descriptor hashes, fresh state, policy and time. Consume the nonce once; insert one approval decision. An approved result creates its linked explicit authorisation in the same transaction; rejection creates none. Uncertain voice creates neither decision nor authority. Idempotent retries return the original result. A rejected plan cannot execute or silently replan itself.

After a plan change, create a new revision and revoke old pending challenges/unused authorisations. Never extend expiry or rewrite a digest in place. All paths that also lock a challenge and authorisation use the same order: task → plan → challenge (if any) → authorisation.

### 5.3 Execution claim transaction

Lock task → plan → challenge (explicit mode, if needed) → authorisation. Validate same owner/session/document and fresh relevant state. Recheck authority mode, exact digests, consent, policy, expiry and cancel flag; explicit mode must point to an approved decision and consumed challenge, and committed actions must use explicit mode. Atomically consume authority, create the unique execution, pending receipts/outbox and state/audit events. A consumed authorisation cannot create another execution.

The extension independently verifies the signed envelope, actual local descriptor, target identity and precondition before dispatch. A claim is permission to attempt the exact operation, not evidence of completion.

Outbox delivery may retry transport. An already dispatched receipt key must not repeat the page action. A lost lease or receipt means inspect/report unknown; it does not permit another claim for the same authority.

**Undo transaction:** lock the original task/receipt and current session-task gate. Require a verified original effect, valid inverse, no conflicting active task and unexpired content. Create the inverse task/message/plan linked to the original receipt and set recovery status requested. Validate current after-state again during claim and local dispatch. Mark restored only when the inverse's expected effect is verified. A compare-and-set guards concurrent Undo requests; never hold database locks while calling a provider or waiting for the browser.

### 5.4 Receipt and verification transaction

Lock execution and step result. Verify exact plan/step ancestry. If receipt already exists with equal contents, return it; if different, reject. Persist after-snapshot and run typed postcondition checks. Write verification and task event. For a multi-step plan, release the next step only if the previous required step passed and no cancellation/policy change occurred. Terminal completion requires all required checks passed.

### 5.5 Retention and cancellation races

Deletion access-blocking takes precedence over queued work and evidence retrieval. A worker checks current task/session/consent immediately before provider dispatch and action claim, not only when the job was queued. A cancellation during a non-cancellable provider call suppresses the late result. Deletion of an in-flight task leaves enough minimal metadata to reconcile any uncertain browser effect while purging content.

## 6. Streaming contract

Public event types: `task.created`, `capture.started`, `capture.completed`, `clarification.required`, `answer.ready`, `plan.ready`, `confirmation.required`, `approval.recorded`, `authorisation.granted`, `execution.started`, `step.observed`, `verification.completed`, `task.completed`, `task.cancelled`, `task.failed`, `task.unknown`, `content.expired`, `undo.available`, `undo.completed`.

Events contain object IDs, status, safe codes and task version. Final answer content is fetched from the authenticated task endpoint; it is not copied into a long-retained operational stream. On reconnect, the UI sends the last numeric cursor. Cursor gaps are allowed. Deduplicate by event sequence and never repeat an already-announced terminal event. If replay has expired, return `410 EVENT_HISTORY_EXPIRED` and instruct a fresh task-state fetch.

## 7. Error catalogue and UX

| Code | HTTP | Meaning | User recovery | Retry policy |
|---|---:|---|---|---|
| UNAUTHENTICATED | 401 | Missing/expired identity | Sign in again | No automatic action retry |
| NOT_FOUND | 404 | Missing or inaccessible object | Return to own session | Do not reveal ownership |
| CONSENT_REQUIRED | 403 | Purpose not authorised | Review purpose notice | No silent grant |
| ORIGIN_BLOCKED | 403 | Policy/permission excludes origin | Use supported page or ask admin | No permission bypass |
| UNSUPPORTED_SURFACE | 422 | No supported read path | Explain missing capability | No guessed capture |
| UNSUPPORTED_ACTION | 422 | Verb/target/effect outside supported scope | Continue manually | No generated substitute action |
| AMBIGUOUS_VALUE | 422 | Number/unit/metric cannot be resolved | Clarify | Read-only retry after correction |
| INCOMPLETE_SOURCE | 422 | Missing/partial data | Narrow or load source | No extrapolation |
| SOURCE_CONFLICT | 422 | Sources disagree | Inspect and choose intended scope | No silent source preference |
| STALE_CONTEXT | 409 | Relevant page state changed | Capture and authorise a new plan under current policy | Old authority cannot be reused |
| PLAN_EXPIRED | 409 | Plan/authority window closed | Generate current plan | No expiry extension in place |
| POLICY_CHANGED | 409 | Permissions changed | Re-evaluate under current policy | New plan required |
| TASK_ALREADY_ACTIVE | 409 | One active task already exists | Continue or stop that task | No hidden parallel task |
| IDEMPOTENCY_CONFLICT | 409 | Key reused for different body | Generate key for genuinely new request | Do not alter existing result |
| TARGET_AMBIGUOUS | 409 | Element cannot be uniquely resolved | Inspect/replan | No coordinate guess |
| CONTENT_EXPIRED | 410 | Stored content unavailable | Capture fresh source | Do not display stale verification |
| PAYLOAD_TOO_LARGE | 413 | Limit exceeded | Select smaller region | No hidden truncation |
| RATE_LIMITED | 429 | Call/tenant limit reached | Wait per Retry-After | Reads only within budget |
| BUDGET_EXCEEDED | 422 | Task call/time budget exhausted | Start narrower task | No further provider calls |
| PROVIDER_TIMEOUT | 504 | Read/interpretation timed out | Deliberate retry | At most one read retry within budget |
| EXECUTION_UNKNOWN | 409 | Possible side effect lacks reliable receipt | Read-only inspection | Never automatic action replay |
| TASK_EXPIRED | 410 | Clarification/session deadline passed | New task | Cannot revive terminal task |

Additional v2 errors: `CONFIRMATION_REQUIRED` (409; direct route disallowed), `CHALLENGE_EXPIRED` (409; request a fresh challenge), `DECISION_UNCLEAR` (422; no decision recorded), `DESCRIPTOR_MISMATCH` (409; recapture/replan), `UNDO_UNAVAILABLE` (409; explain expiry/state/verification reason), `SOURCE_DATA_UNAVAILABLE` (422; offer separately labelled visual interpretation), and `SEAT_LIMIT_REACHED` (409; administrator resolves capacity). None permits an automatic action retry.

## 8. Frontend/backend integration handoffs

| Handoff | Producer | Consumer | Shared fixture required |
|---|---|---|---|
| Capability + capture | FE adapter | BE ingestion | Valid complete table; partial table; prohibited field |
| Grounded answer | BE | FE evidence view | Observed, computed, estimated, conflict and expired claim |
| Pending plan | BE | FE approval | Valid, expired, stale and superseded plan |
| Direct intent | FE user message + adapter descriptor | BE authority policy | Exact scope, ambiguity, injected source and confirm_all |
| Explicit decision | FE challenged input | BE authorisation | Keyboard/pointer/voice, reject, unclear, stale, duplicate and wrong hash |
| Undo | FE current state | BE inverse planner | Valid restoration, user edit, expiry and unknown outcome |
| Source access | FE adapter → BE | FE semantic table | Original data, missing values, ties and visual-only unavailable |
| Signed execution | BE | FE executor | Correct and wrong origin/document/adapter/signature |
| Observation receipt | FE | BE verifier | Passed effect, no effect, partial and unknown |
| Status stream | BE | FE | Reconnect, duplicate event, terminal event and expiry |
| Deletion | FE request + BE purge | Both | Access blocked before async purge completes |

Freeze these shapes before parallel implementation. Frontend mocks must use the same examples and schemas as backend tests. Replacing a mock with a live route is an explicit integration checkpoint, not a visual-only demo change.
