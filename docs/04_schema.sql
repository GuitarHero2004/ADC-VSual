-- Reference migration: PostgreSQL 16+. Review deployment role grants before use.

-- This is a specification artifact, not an applied production migration.

BEGIN;

CREATE SCHEMA va;

CREATE SEQUENCE va.event_sequence;

CREATE TABLE va.app_users (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  identity_subject text NOT NULL,
  display_name text,
  status text NOT NULL,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (identity_subject),
  CHECK (status IN ('active','disabled','anonymised'))
);

CREATE TABLE va.workspaces (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL,
  policy_version integer NOT NULL DEFAULT 1,
  content_retention_hours integer NOT NULL DEFAULT 24,
  audit_retention_days integer NOT NULL DEFAULT 30,
  workspace_kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('active','suspended','deleting')),
  CHECK (policy_version > 0),
  CHECK (content_retention_hours BETWEEN 1 AND 168),
  CHECK (audit_retention_days BETWEEN 1 AND 90),
  CHECK (workspace_kind IN ('personal','organisation'))
);

CREATE TABLE va.memberships (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id),
  UNIQUE (workspace_id, id),
  CHECK (role IN ('member','admin')),
  CHECK (status IN ('active','suspended'))
);

CREATE TABLE va.user_preferences (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  locale text NOT NULL,
  speech_mode text NOT NULL,
  speech_rate numeric(3,2) NOT NULL DEFAULT 1.00,
  contrast_mode text NOT NULL,
  text_scale_percent integer NOT NULL DEFAULT 100,
  reduced_motion boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz,
  confirmation_mode text NOT NULL,
  answer_detail text NOT NULL,
  auto_return boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id),
  UNIQUE (workspace_id, id),
  CHECK (locale IN ('vi-VN','en-US')),
  CHECK (speech_mode IN ('screen_reader','app_tts','silent')),
  CHECK (contrast_mode IN ('system','light','dark','high_contrast')),
  CHECK (speech_rate BETWEEN 0.5 AND 2.0),
  CHECK (text_scale_percent BETWEEN 100 AND 200),
  CHECK (version > 0),
  CHECK (confirmation_mode IN ('reversible_direct','confirm_all')),
  CHECK (answer_detail IN ('brief','detailed'))
);

CREATE TABLE va.origin_policies (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  origin text NOT NULL,
  read_allowed boolean NOT NULL DEFAULT true,
  vision_allowed boolean NOT NULL DEFAULT false,
  action_allowed boolean NOT NULL DEFAULT false,
  adapter_key text NOT NULL,
  policy_version integer NOT NULL DEFAULT 1,
  committed_action_allowed boolean NOT NULL DEFAULT false,
  force_confirmation boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, origin),
  UNIQUE (workspace_id, id),
  CHECK (origin ~ '^https://[^/]+$'),
  CHECK (policy_version > 0)
);

CREATE TABLE va.browser_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  client_session_key text NOT NULL,
  origin text NOT NULL,
  status text NOT NULL,
  last_activity_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, client_session_key),
  UNIQUE (workspace_id, id),
  CHECK (status IN ('active','paused','ended','expired')),
  CHECK (expires_at > created_at)
);

CREATE TABLE va.consent_grants (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  purpose text NOT NULL,
  notice_version text NOT NULL,
  granted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, session_id, id),
  CHECK (purpose IN ('structured_processing','voice_processing','visual_processing')),
  CHECK (expires_at > granted_at)
);

CREATE TABLE va.page_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  revision integer NOT NULL,
  document_key text NOT NULL,
  page_path text NOT NULL,
  adapter_key text NOT NULL,
  state_fingerprint text NOT NULL,
  source_mode text NOT NULL,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_complete boolean NOT NULL DEFAULT false,
  captured_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, session_id, revision),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, session_id, id),
  CHECK (revision > 0),
  CHECK (state_fingerprint ~ '^[0-9a-f]{64}$'),
  CHECK (source_mode IN ('structured','visual','mixed','unavailable')),
  CHECK (jsonb_typeof(state) = 'object'),
  CHECK (expires_at > captured_at)
);

CREATE TABLE va.evidence_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  kind text NOT NULL,
  label text NOT NULL,
  source_pointer jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  quality text NOT NULL,
  expires_at timestamptz NOT NULL,
  purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, session_id, id),
  CHECK (kind IN ('dom_table','dom_control','page_text','visual_region')),
  CHECK (quality IN ('validated','partial','uncertain','conflicting')),
  CHECK (jsonb_typeof(source_pointer) = 'object'),
  CHECK (jsonb_typeof(payload) = 'object')
);

CREATE TABLE va.tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  request_text text NOT NULL,
  input_mode text NOT NULL,
  locale text NOT NULL,
  status text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  cancel_requested boolean NOT NULL DEFAULT false,
  terminal_code text,
  context_snapshot_id uuid,
  processing_budget_ms integer NOT NULL DEFAULT 90000,
  processing_used_ms integer NOT NULL DEFAULT 0,
  processing_started_at timestamptz,
  waiting_expires_at timestamptz,
  clarification_rounds integer NOT NULL DEFAULT 0,
  model_calls_used integer NOT NULL DEFAULT 0,
  deadline_at timestamptz NOT NULL,
  content_expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, session_id, id),
  CHECK (input_mode IN ('text','voice')),
  CHECK (locale IN ('vi-VN','en-US')),
  CHECK (status IN ('queued','capturing','interpreting','needs_clarification','awaiting_approval','executing','verifying','completed','partially_completed','cancelled','failed','unknown')),
  CHECK (version > 0),
  CHECK (processing_budget_ms > 0),
  CHECK (processing_used_ms >= 0),
  CHECK (clarification_rounds >= 0),
  CHECK (model_calls_used >= 0)
);

CREATE TABLE va.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  task_id uuid NOT NULL,
  sequence integer NOT NULL,
  role text NOT NULL,
  kind text NOT NULL,
  content text NOT NULL,
  generation_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, session_id, task_id, sequence),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, session_id, task_id, id),
  CHECK (sequence > 0),
  CHECK (role IN ('user','assistant','system')),
  CHECK (kind IN ('request','clarification','answer','approval_summary','status','error'))
);

CREATE TABLE va.claims (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  task_id uuid NOT NULL,
  message_id uuid NOT NULL,
  ordinal integer NOT NULL,
  claim_text text NOT NULL,
  basis text NOT NULL,
  calculation jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, session_id, task_id, message_id, ordinal),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, session_id, task_id, id),
  CHECK (ordinal > 0),
  CHECK (basis IN ('observed','computed','estimated','unknown')),
  CHECK (verification_status IN ('supported','limited','conflict','expired')),
  CHECK (jsonb_typeof(calculation) = 'object')
);

CREATE TABLE va.claim_evidence (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  task_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  relation text NOT NULL,
  ordinal integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, claim_id, evidence_id, relation),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, session_id, task_id, id),
  CHECK (relation IN ('supports','operand','contradicts')),
  CHECK (ordinal > 0)
);

CREATE TABLE va.action_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  task_id uuid NOT NULL,
  revision integer NOT NULL,
  base_snapshot_id uuid NOT NULL,
  plan_hash text NOT NULL,
  policy_version integer NOT NULL,
  summary text NOT NULL,
  risk_class text NOT NULL,
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  superseded_at timestamptz,
  authorisation_mode text NOT NULL,
  plan_kind text NOT NULL,
  reverses_step_result_id uuid,
  descriptor_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, session_id, task_id, revision),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, session_id, task_id, id),
  CHECK (revision > 0),
  CHECK (policy_version > 0),
  CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  CHECK (risk_class IN ('reversible','committed','prohibited')),
  CHECK (status IN ('draft','pending','approved','authorised','rejected','superseded','expired','executing','finished')),
  CHECK (authorisation_mode IN ('direct_request','explicit_confirmation')),
  CHECK (plan_kind IN ('normal','undo')),
  CHECK (descriptor_hash ~ '^[0-9a-f]{64}$'),
  CHECK ((plan_kind = 'normal' AND reverses_step_result_id IS NULL) OR (plan_kind = 'undo' AND reverses_step_result_id IS NOT NULL))
);

CREATE TABLE va.action_steps (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  task_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  ordinal integer NOT NULL,
  verb text NOT NULL,
  target jsonb NOT NULL DEFAULT '{}'::jsonb,
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  precondition jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_effect jsonb NOT NULL DEFAULT '{}'::jsonb,
  timeout_ms integer NOT NULL DEFAULT 10000,
  pending_descriptor jsonb NOT NULL DEFAULT '{}'::jsonb,
  undo_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, plan_id, ordinal),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, session_id, task_id, plan_id, id),
  CHECK (ordinal BETWEEN 1 AND 20),
  CHECK (verb IN ('focus','navigate_same_origin','set_filter','sort_table','fill_draft','commit_submit')),
  CHECK (jsonb_typeof(target) = 'object'),
  CHECK (jsonb_typeof(arguments) = 'object'),
  CHECK (jsonb_typeof(precondition) = 'object'),
  CHECK (jsonb_typeof(expected_effect) = 'object'),
  CHECK (timeout_ms BETWEEN 1000 AND 30000),
  CHECK (jsonb_typeof(pending_descriptor) = 'object'),
  CHECK (jsonb_typeof(undo_spec) = 'object')
);

CREATE TABLE va.approvals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  task_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  user_id uuid NOT NULL,
  decision text NOT NULL,
  approved_plan_hash text NOT NULL,
  method text NOT NULL,
  decided_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  challenge_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, plan_id),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, session_id, task_id, plan_id, id),
  UNIQUE (workspace_id, challenge_id),
  CHECK (decision IN ('approved','rejected','revoked')),
  CHECK (method IN ('keyboard','pointer','voice')),
  CHECK (approved_plan_hash ~ '^[0-9a-f]{64}$'),
  CHECK (expires_at > decided_at)
);

CREATE TABLE va.executions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  task_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  authorisation_id uuid NOT NULL,
  status text NOT NULL,
  dispatch_nonce text NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, plan_id),
  UNIQUE (workspace_id, authorisation_id),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, session_id, task_id, plan_id, id),
  UNIQUE (workspace_id, session_id, task_id, id),
  CHECK (status IN ('created','leased','running','verifying','succeeded','partial','cancelled','failed','unknown'))
);

CREATE TABLE va.step_results (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  task_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  step_id uuid NOT NULL,
  status text NOT NULL,
  before_snapshot_id uuid,
  after_snapshot_id uuid,
  client_receipt_key text NOT NULL,
  error_code text,
  dispatched_at timestamptz,
  finished_at timestamptz,
  recovery_status text NOT NULL,
  undo_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, execution_id, step_id),
  UNIQUE (workspace_id, client_receipt_key),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, session_id, task_id, plan_id, execution_id, id),
  UNIQUE (workspace_id, session_id, id),
  CHECK (status IN ('pending','dispatched','observed','failed','cancelled','unknown')),
  CHECK (recovery_status IN ('not_available','available','requested','restored','expired','unknown'))
);

CREATE TABLE va.verifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  task_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  step_result_id uuid NOT NULL,
  outcome text NOT NULL,
  checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text NOT NULL,
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, step_result_id),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, session_id, task_id, plan_id, execution_id, id),
  CHECK (outcome IN ('pass','fail','unknown')),
  CHECK (jsonb_typeof(checks) = 'object')
);

CREATE TABLE va.task_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  task_id uuid NOT NULL,
  event_sequence bigint NOT NULL DEFAULT nextval('va.event_sequence'),
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_sequence),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, session_id, task_id, id),
  CHECK (jsonb_typeof(payload) = 'object')
);

CREATE TABLE va.model_calls (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  task_id uuid NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer NOT NULL,
  estimated_cost_usd numeric(12,6),
  rate_card_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, session_id, task_id, id),
  CHECK (status IN ('started','succeeded','failed','timeout','invalid_output','cancelled')),
  CHECK (input_tokens >= 0),
  CHECK (output_tokens >= 0),
  CHECK (latency_ms >= 0),
  CHECK (estimated_cost_usd >= 0)
);

CREATE TABLE va.feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  task_id uuid NOT NULL,
  user_id uuid NOT NULL,
  outcome text NOT NULL,
  reason text,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, task_id, user_id),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, session_id, task_id, id),
  CHECK (outcome IN ('helpful','partly_helpful','not_helpful'))
);

CREATE TABLE va.audit_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  actor_user_id uuid,
  event_type text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  request_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE va.idempotency_records (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  route_key text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL,
  response_code integer,
  response_body jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id, route_key, idempotency_key),
  UNIQUE (workspace_id, id),
  CHECK (status IN ('in_progress','completed','unknown')),
  CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(response_body) = 'object')
);

CREATE TABLE va.outbox_commands (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  task_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  status text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL,
  lease_expires_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, execution_id),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, session_id, task_id, id),
  CHECK (status IN ('pending','leased','delivered','cancelled','dead')),
  CHECK (jsonb_typeof(payload) = 'object'),
  CHECK (attempts >= 0)
);

CREATE TABLE va.deletion_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  session_id uuid,
  scope text NOT NULL,
  status text NOT NULL,
  requested_at timestamptz NOT NULL,
  deadline_at timestamptz NOT NULL,
  completed_at timestamptz,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  CHECK (scope IN ('session','user_content')),
  CHECK (status IN ('queued','running','completed','failed')),
  CHECK ((scope = 'session' AND session_id IS NOT NULL) OR (scope = 'user_content' AND session_id IS NULL)),
  CHECK (jsonb_typeof(progress) = 'object')
);

CREATE TABLE va.confirmation_challenges (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  task_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  user_id uuid NOT NULL,
  nonce_hash text NOT NULL,
  descriptor_hash text NOT NULL,
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, nonce_hash),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, session_id, task_id, plan_id, id),
  CHECK (status IN ('pending','consumed','revoked','expired')),
  CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  CHECK (descriptor_hash ~ '^[0-9a-f]{64}$'),
  CHECK (expires_at > created_at)
);

CREATE TABLE va.action_authorisations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  task_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  user_id uuid NOT NULL,
  mode text NOT NULL,
  source_message_id uuid NOT NULL,
  approval_id uuid,
  plan_hash text NOT NULL,
  descriptor_hash text NOT NULL,
  policy_version integer NOT NULL,
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, plan_id),
  UNIQUE (workspace_id, approval_id),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, session_id, task_id, plan_id, id),
  CHECK (mode IN ('direct_request','explicit_confirmation')),
  CHECK (status IN ('granted','consumed','revoked','expired')),
  CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  CHECK (descriptor_hash ~ '^[0-9a-f]{64}$'),
  CHECK (policy_version > 0),
  CHECK ((mode = 'direct_request' AND approval_id IS NULL) OR (mode = 'explicit_confirmation' AND approval_id IS NOT NULL))
);

CREATE TABLE va.workspace_entitlements (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  tier text NOT NULL,
  status text NOT NULL,
  seat_limit integer NOT NULL,
  agreed_price_per_seat numeric(10,2),
  currency text NOT NULL,
  admin_features jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_at timestamptz NOT NULL,
  expires_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id),
  UNIQUE (workspace_id, id),
  CHECK (tier IN ('individual','employer','enterprise')),
  CHECK (status IN ('trial','active','suspended')),
  CHECK (seat_limit > 0),
  CHECK (agreed_price_per_seat >= 0),
  CHECK (currency ~ '^[A-Z]{3}$'),
  CHECK (jsonb_typeof(admin_features) = 'object'),
  CHECK (version > 0)
);

CREATE TABLE va.seat_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  entitlement_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL,
  assigned_at timestamptz NOT NULL,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id),
  UNIQUE (workspace_id, id),
  CHECK (status IN ('active','released'))
);

ALTER TABLE va.memberships ADD CONSTRAINT fk_001 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.memberships ADD CONSTRAINT fk_002 FOREIGN KEY (user_id) REFERENCES va.app_users (id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.user_preferences ADD CONSTRAINT fk_003 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.user_preferences ADD CONSTRAINT fk_004 FOREIGN KEY (workspace_id, user_id) REFERENCES va.memberships (workspace_id, user_id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.origin_policies ADD CONSTRAINT fk_005 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.browser_sessions ADD CONSTRAINT fk_006 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.browser_sessions ADD CONSTRAINT fk_007 FOREIGN KEY (workspace_id, user_id) REFERENCES va.memberships (workspace_id, user_id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.browser_sessions ADD CONSTRAINT fk_008 FOREIGN KEY (workspace_id, origin) REFERENCES va.origin_policies (workspace_id, origin) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.consent_grants ADD CONSTRAINT fk_009 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.consent_grants ADD CONSTRAINT fk_010 FOREIGN KEY (workspace_id, session_id) REFERENCES va.browser_sessions (workspace_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.consent_grants ADD CONSTRAINT fk_011 FOREIGN KEY (workspace_id, user_id) REFERENCES va.memberships (workspace_id, user_id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.page_snapshots ADD CONSTRAINT fk_012 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.page_snapshots ADD CONSTRAINT fk_013 FOREIGN KEY (workspace_id, session_id) REFERENCES va.browser_sessions (workspace_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.evidence_items ADD CONSTRAINT fk_014 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.evidence_items ADD CONSTRAINT fk_015 FOREIGN KEY (workspace_id, session_id) REFERENCES va.browser_sessions (workspace_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.evidence_items ADD CONSTRAINT fk_016 FOREIGN KEY (workspace_id, session_id, snapshot_id) REFERENCES va.page_snapshots (workspace_id, session_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.tasks ADD CONSTRAINT fk_017 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.tasks ADD CONSTRAINT fk_018 FOREIGN KEY (workspace_id, session_id) REFERENCES va.browser_sessions (workspace_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.tasks ADD CONSTRAINT fk_019 FOREIGN KEY (workspace_id, session_id, context_snapshot_id) REFERENCES va.page_snapshots (workspace_id, session_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.messages ADD CONSTRAINT fk_020 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.messages ADD CONSTRAINT fk_021 FOREIGN KEY (workspace_id, session_id) REFERENCES va.browser_sessions (workspace_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.messages ADD CONSTRAINT fk_022 FOREIGN KEY (workspace_id, session_id, task_id) REFERENCES va.tasks (workspace_id, session_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.claims ADD CONSTRAINT fk_023 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.claims ADD CONSTRAINT fk_024 FOREIGN KEY (workspace_id, session_id) REFERENCES va.browser_sessions (workspace_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.claims ADD CONSTRAINT fk_025 FOREIGN KEY (workspace_id, session_id, task_id) REFERENCES va.tasks (workspace_id, session_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.claims ADD CONSTRAINT fk_026 FOREIGN KEY (workspace_id, session_id, task_id, message_id) REFERENCES va.messages (workspace_id, session_id, task_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.claim_evidence ADD CONSTRAINT fk_027 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.claim_evidence ADD CONSTRAINT fk_028 FOREIGN KEY (workspace_id, session_id) REFERENCES va.browser_sessions (workspace_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.claim_evidence ADD CONSTRAINT fk_029 FOREIGN KEY (workspace_id, session_id, task_id) REFERENCES va.tasks (workspace_id, session_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.claim_evidence ADD CONSTRAINT fk_030 FOREIGN KEY (workspace_id, session_id, task_id, claim_id) REFERENCES va.claims (workspace_id, session_id, task_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.claim_evidence ADD CONSTRAINT fk_031 FOREIGN KEY (workspace_id, session_id, evidence_id) REFERENCES va.evidence_items (workspace_id, session_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.action_plans ADD CONSTRAINT fk_032 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.action_plans ADD CONSTRAINT fk_033 FOREIGN KEY (workspace_id, session_id) REFERENCES va.browser_sessions (workspace_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.action_plans ADD CONSTRAINT fk_034 FOREIGN KEY (workspace_id, session_id, task_id) REFERENCES va.tasks (workspace_id, session_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.action_plans ADD CONSTRAINT fk_035 FOREIGN KEY (workspace_id, session_id, base_snapshot_id) REFERENCES va.page_snapshots (workspace_id, session_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.action_steps ADD CONSTRAINT fk_036 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.action_steps ADD CONSTRAINT fk_037 FOREIGN KEY (workspace_id, session_id) REFERENCES va.browser_sessions (workspace_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.action_steps ADD CONSTRAINT fk_038 FOREIGN KEY (workspace_id, session_id, task_id) REFERENCES va.tasks (workspace_id, session_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.action_steps ADD CONSTRAINT fk_039 FOREIGN KEY (workspace_id, session_id, task_id, plan_id) REFERENCES va.action_plans (workspace_id, session_id, task_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.approvals ADD CONSTRAINT fk_040 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.approvals ADD CONSTRAINT fk_041 FOREIGN KEY (workspace_id, session_id) REFERENCES va.browser_sessions (workspace_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.approvals ADD CONSTRAINT fk_042 FOREIGN KEY (workspace_id, session_id, task_id) REFERENCES va.tasks (workspace_id, session_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.approvals ADD CONSTRAINT fk_043 FOREIGN KEY (workspace_id, session_id, task_id, plan_id) REFERENCES va.action_plans (workspace_id, session_id, task_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.approvals ADD CONSTRAINT fk_044 FOREIGN KEY (workspace_id, user_id) REFERENCES va.memberships (workspace_id, user_id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.executions ADD CONSTRAINT fk_045 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.executions ADD CONSTRAINT fk_046 FOREIGN KEY (workspace_id, session_id) REFERENCES va.browser_sessions (workspace_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.executions ADD CONSTRAINT fk_047 FOREIGN KEY (workspace_id, session_id, task_id) REFERENCES va.tasks (workspace_id, session_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.executions ADD CONSTRAINT fk_048 FOREIGN KEY (workspace_id, session_id, task_id, plan_id) REFERENCES va.action_plans (workspace_id, session_id, task_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.step_results ADD CONSTRAINT fk_049 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.step_results ADD CONSTRAINT fk_050 FOREIGN KEY (workspace_id, session_id) REFERENCES va.browser_sessions (workspace_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.step_results ADD CONSTRAINT fk_051 FOREIGN KEY (workspace_id, session_id, task_id) REFERENCES va.tasks (workspace_id, session_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.step_results ADD CONSTRAINT fk_052 FOREIGN KEY (workspace_id, session_id, task_id, plan_id) REFERENCES va.action_plans (workspace_id, session_id, task_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.step_results ADD CONSTRAINT fk_053 FOREIGN KEY (workspace_id, session_id, task_id, plan_id, execution_id) REFERENCES va.executions (workspace_id, session_id, task_id, plan_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.step_results ADD CONSTRAINT fk_054 FOREIGN KEY (workspace_id, session_id, task_id, plan_id, step_id) REFERENCES va.action_steps (workspace_id, session_id, task_id, plan_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.step_results ADD CONSTRAINT fk_055 FOREIGN KEY (workspace_id, session_id, before_snapshot_id) REFERENCES va.page_snapshots (workspace_id, session_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.step_results ADD CONSTRAINT fk_056 FOREIGN KEY (workspace_id, session_id, after_snapshot_id) REFERENCES va.page_snapshots (workspace_id, session_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.verifications ADD CONSTRAINT fk_057 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.verifications ADD CONSTRAINT fk_058 FOREIGN KEY (workspace_id, session_id) REFERENCES va.browser_sessions (workspace_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.verifications ADD CONSTRAINT fk_059 FOREIGN KEY (workspace_id, session_id, task_id) REFERENCES va.tasks (workspace_id, session_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.verifications ADD CONSTRAINT fk_060 FOREIGN KEY (workspace_id, session_id, task_id, plan_id) REFERENCES va.action_plans (workspace_id, session_id, task_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.verifications ADD CONSTRAINT fk_061 FOREIGN KEY (workspace_id, session_id, task_id, plan_id, execution_id) REFERENCES va.executions (workspace_id, session_id, task_id, plan_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.verifications ADD CONSTRAINT fk_062 FOREIGN KEY (workspace_id, session_id, task_id, plan_id, execution_id, step_result_id) REFERENCES va.step_results (workspace_id, session_id, task_id, plan_id, execution_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.task_events ADD CONSTRAINT fk_063 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.task_events ADD CONSTRAINT fk_064 FOREIGN KEY (workspace_id, session_id) REFERENCES va.browser_sessions (workspace_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.task_events ADD CONSTRAINT fk_065 FOREIGN KEY (workspace_id, session_id, task_id) REFERENCES va.tasks (workspace_id, session_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.model_calls ADD CONSTRAINT fk_066 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.model_calls ADD CONSTRAINT fk_067 FOREIGN KEY (workspace_id, session_id) REFERENCES va.browser_sessions (workspace_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.model_calls ADD CONSTRAINT fk_068 FOREIGN KEY (workspace_id, session_id, task_id) REFERENCES va.tasks (workspace_id, session_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.feedback ADD CONSTRAINT fk_069 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.feedback ADD CONSTRAINT fk_070 FOREIGN KEY (workspace_id, session_id) REFERENCES va.browser_sessions (workspace_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.feedback ADD CONSTRAINT fk_071 FOREIGN KEY (workspace_id, session_id, task_id) REFERENCES va.tasks (workspace_id, session_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.feedback ADD CONSTRAINT fk_072 FOREIGN KEY (workspace_id, user_id) REFERENCES va.memberships (workspace_id, user_id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.audit_events ADD CONSTRAINT fk_073 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.audit_events ADD CONSTRAINT fk_074 FOREIGN KEY (actor_user_id) REFERENCES va.app_users (id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.idempotency_records ADD CONSTRAINT fk_075 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.idempotency_records ADD CONSTRAINT fk_076 FOREIGN KEY (workspace_id, user_id) REFERENCES va.memberships (workspace_id, user_id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.outbox_commands ADD CONSTRAINT fk_077 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.outbox_commands ADD CONSTRAINT fk_078 FOREIGN KEY (workspace_id, session_id) REFERENCES va.browser_sessions (workspace_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.outbox_commands ADD CONSTRAINT fk_079 FOREIGN KEY (workspace_id, session_id, task_id) REFERENCES va.tasks (workspace_id, session_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.outbox_commands ADD CONSTRAINT fk_080 FOREIGN KEY (workspace_id, session_id, task_id, execution_id) REFERENCES va.executions (workspace_id, session_id, task_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.deletion_requests ADD CONSTRAINT fk_081 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.deletion_requests ADD CONSTRAINT fk_082 FOREIGN KEY (workspace_id, user_id) REFERENCES va.memberships (workspace_id, user_id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.deletion_requests ADD CONSTRAINT fk_083 FOREIGN KEY (workspace_id, session_id) REFERENCES va.browser_sessions (workspace_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.confirmation_challenges ADD CONSTRAINT fk_084 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.confirmation_challenges ADD CONSTRAINT fk_085 FOREIGN KEY (workspace_id, session_id) REFERENCES va.browser_sessions (workspace_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.confirmation_challenges ADD CONSTRAINT fk_086 FOREIGN KEY (workspace_id, session_id, task_id) REFERENCES va.tasks (workspace_id, session_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.confirmation_challenges ADD CONSTRAINT fk_087 FOREIGN KEY (workspace_id, session_id, task_id, plan_id) REFERENCES va.action_plans (workspace_id, session_id, task_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.confirmation_challenges ADD CONSTRAINT fk_088 FOREIGN KEY (workspace_id, user_id) REFERENCES va.memberships (workspace_id, user_id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.approvals ADD CONSTRAINT fk_089 FOREIGN KEY (workspace_id, session_id, task_id, plan_id, challenge_id) REFERENCES va.confirmation_challenges (workspace_id, session_id, task_id, plan_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.action_authorisations ADD CONSTRAINT fk_090 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.action_authorisations ADD CONSTRAINT fk_091 FOREIGN KEY (workspace_id, session_id) REFERENCES va.browser_sessions (workspace_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.action_authorisations ADD CONSTRAINT fk_092 FOREIGN KEY (workspace_id, session_id, task_id) REFERENCES va.tasks (workspace_id, session_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.action_authorisations ADD CONSTRAINT fk_093 FOREIGN KEY (workspace_id, session_id, task_id, plan_id) REFERENCES va.action_plans (workspace_id, session_id, task_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.action_authorisations ADD CONSTRAINT fk_094 FOREIGN KEY (workspace_id, user_id) REFERENCES va.memberships (workspace_id, user_id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.action_authorisations ADD CONSTRAINT fk_095 FOREIGN KEY (workspace_id, session_id, task_id, source_message_id) REFERENCES va.messages (workspace_id, session_id, task_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.action_authorisations ADD CONSTRAINT fk_096 FOREIGN KEY (workspace_id, session_id, task_id, plan_id, approval_id) REFERENCES va.approvals (workspace_id, session_id, task_id, plan_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.executions ADD CONSTRAINT fk_097 FOREIGN KEY (workspace_id, session_id, task_id, plan_id, authorisation_id) REFERENCES va.action_authorisations (workspace_id, session_id, task_id, plan_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.action_plans ADD CONSTRAINT fk_098 FOREIGN KEY (workspace_id, session_id, reverses_step_result_id) REFERENCES va.step_results (workspace_id, session_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.workspace_entitlements ADD CONSTRAINT fk_099 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.seat_assignments ADD CONSTRAINT fk_100 FOREIGN KEY (workspace_id) REFERENCES va.workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.seat_assignments ADD CONSTRAINT fk_101 FOREIGN KEY (workspace_id, entitlement_id) REFERENCES va.workspace_entitlements (workspace_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE va.seat_assignments ADD CONSTRAINT fk_102 FOREIGN KEY (workspace_id, user_id) REFERENCES va.memberships (workspace_id, user_id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX ix_browser_sessions_1 ON va.browser_sessions (workspace_id, user_id, created_at);

CREATE INDEX ix_consent_grants_1 ON va.consent_grants (workspace_id, session_id, purpose);

CREATE INDEX ix_page_snapshots_1 ON va.page_snapshots (expires_at);

CREATE INDEX ix_evidence_items_1 ON va.evidence_items (workspace_id, session_id, snapshot_id);

CREATE INDEX ix_evidence_items_2 ON va.evidence_items (expires_at);

CREATE INDEX ix_tasks_1 ON va.tasks (workspace_id, session_id, created_at);

CREATE INDEX ix_task_events_1 ON va.task_events (workspace_id, task_id, event_sequence);

CREATE INDEX ix_audit_events_1 ON va.audit_events (workspace_id, created_at);

CREATE INDEX ix_idempotency_records_1 ON va.idempotency_records (expires_at);

CREATE INDEX ix_outbox_commands_1 ON va.outbox_commands (status, available_at);

CREATE UNIQUE INDEX ux_one_active_task_per_session ON va.tasks (workspace_id, session_id) WHERE status IN ('queued','capturing','interpreting','needs_clarification','awaiting_approval','executing','verifying');

-- CHECK constraints deliberately do not encode mutable time or cross-row state transitions.

-- Plan/approval state transitions, membership checks and consent expiry are enforced transactionally by the service.

COMMIT;
