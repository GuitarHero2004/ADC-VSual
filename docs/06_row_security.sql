-- Optional reference security migration; apply after 04_schema.sql.
-- Run as schema owner. Provision a separate NOLOGIN/NOBYPASSRLS runtime role.
-- Application clients NEVER get database credentials or direct SQL access.
-- Trusted backend must SET LOCAL app.workspace_id / app.user_id after verified auth.
BEGIN;
CREATE FUNCTION va.current_workspace_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.workspace_id', true), '')::uuid $$;
CREATE FUNCTION va.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

ALTER TABLE va.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.app_users FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.app_users FOR ALL USING (id = va.current_user_id()) WITH CHECK (id = va.current_user_id());

ALTER TABLE va.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.workspaces FOR ALL USING (id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = workspaces.id AND m.user_id = va.current_user_id() AND m.status = 'active')) WITH CHECK (id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = workspaces.id AND m.user_id = va.current_user_id() AND m.status = 'active'));

ALTER TABLE va.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.memberships FOR ALL USING (workspace_id = va.current_workspace_id() AND user_id = va.current_user_id()) WITH CHECK (workspace_id = va.current_workspace_id() AND user_id = va.current_user_id());

ALTER TABLE va.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.user_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.user_preferences FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = user_preferences.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND user_id = va.current_user_id()) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = user_preferences.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND user_id = va.current_user_id());

ALTER TABLE va.origin_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.origin_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.origin_policies FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = origin_policies.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active')) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = origin_policies.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active'));

ALTER TABLE va.browser_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.browser_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.browser_sessions FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = browser_sessions.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND user_id = va.current_user_id()) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = browser_sessions.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND user_id = va.current_user_id());

ALTER TABLE va.consent_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.consent_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.consent_grants FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = consent_grants.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = consent_grants.workspace_id AND s.id = consent_grants.session_id AND s.user_id = va.current_user_id())) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = consent_grants.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = consent_grants.workspace_id AND s.id = consent_grants.session_id AND s.user_id = va.current_user_id()));

ALTER TABLE va.page_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.page_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.page_snapshots FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = page_snapshots.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = page_snapshots.workspace_id AND s.id = page_snapshots.session_id AND s.user_id = va.current_user_id())) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = page_snapshots.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = page_snapshots.workspace_id AND s.id = page_snapshots.session_id AND s.user_id = va.current_user_id()));

ALTER TABLE va.evidence_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.evidence_items FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.evidence_items FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = evidence_items.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = evidence_items.workspace_id AND s.id = evidence_items.session_id AND s.user_id = va.current_user_id())) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = evidence_items.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = evidence_items.workspace_id AND s.id = evidence_items.session_id AND s.user_id = va.current_user_id()));

ALTER TABLE va.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.tasks FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = tasks.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = tasks.workspace_id AND s.id = tasks.session_id AND s.user_id = va.current_user_id())) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = tasks.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = tasks.workspace_id AND s.id = tasks.session_id AND s.user_id = va.current_user_id()));

ALTER TABLE va.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.messages FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.messages FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = messages.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = messages.workspace_id AND s.id = messages.session_id AND s.user_id = va.current_user_id())) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = messages.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = messages.workspace_id AND s.id = messages.session_id AND s.user_id = va.current_user_id()));

ALTER TABLE va.claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.claims FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.claims FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = claims.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = claims.workspace_id AND s.id = claims.session_id AND s.user_id = va.current_user_id())) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = claims.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = claims.workspace_id AND s.id = claims.session_id AND s.user_id = va.current_user_id()));

ALTER TABLE va.claim_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.claim_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.claim_evidence FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = claim_evidence.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = claim_evidence.workspace_id AND s.id = claim_evidence.session_id AND s.user_id = va.current_user_id())) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = claim_evidence.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = claim_evidence.workspace_id AND s.id = claim_evidence.session_id AND s.user_id = va.current_user_id()));

ALTER TABLE va.action_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.action_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.action_plans FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = action_plans.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = action_plans.workspace_id AND s.id = action_plans.session_id AND s.user_id = va.current_user_id())) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = action_plans.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = action_plans.workspace_id AND s.id = action_plans.session_id AND s.user_id = va.current_user_id()));

ALTER TABLE va.action_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.action_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.action_steps FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = action_steps.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = action_steps.workspace_id AND s.id = action_steps.session_id AND s.user_id = va.current_user_id())) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = action_steps.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = action_steps.workspace_id AND s.id = action_steps.session_id AND s.user_id = va.current_user_id()));

ALTER TABLE va.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.approvals FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = approvals.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = approvals.workspace_id AND s.id = approvals.session_id AND s.user_id = va.current_user_id())) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = approvals.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = approvals.workspace_id AND s.id = approvals.session_id AND s.user_id = va.current_user_id()));

ALTER TABLE va.executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.executions FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.executions FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = executions.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = executions.workspace_id AND s.id = executions.session_id AND s.user_id = va.current_user_id())) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = executions.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = executions.workspace_id AND s.id = executions.session_id AND s.user_id = va.current_user_id()));

ALTER TABLE va.step_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.step_results FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.step_results FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = step_results.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = step_results.workspace_id AND s.id = step_results.session_id AND s.user_id = va.current_user_id())) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = step_results.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = step_results.workspace_id AND s.id = step_results.session_id AND s.user_id = va.current_user_id()));

ALTER TABLE va.verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.verifications FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.verifications FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = verifications.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = verifications.workspace_id AND s.id = verifications.session_id AND s.user_id = va.current_user_id())) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = verifications.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = verifications.workspace_id AND s.id = verifications.session_id AND s.user_id = va.current_user_id()));

ALTER TABLE va.task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.task_events FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.task_events FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = task_events.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = task_events.workspace_id AND s.id = task_events.session_id AND s.user_id = va.current_user_id())) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = task_events.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = task_events.workspace_id AND s.id = task_events.session_id AND s.user_id = va.current_user_id()));

ALTER TABLE va.model_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.model_calls FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.model_calls FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = model_calls.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = model_calls.workspace_id AND s.id = model_calls.session_id AND s.user_id = va.current_user_id())) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = model_calls.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = model_calls.workspace_id AND s.id = model_calls.session_id AND s.user_id = va.current_user_id()));

ALTER TABLE va.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.feedback FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = feedback.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = feedback.workspace_id AND s.id = feedback.session_id AND s.user_id = va.current_user_id())) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = feedback.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = feedback.workspace_id AND s.id = feedback.session_id AND s.user_id = va.current_user_id()));

ALTER TABLE va.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.audit_events FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = audit_events.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND actor_user_id = va.current_user_id()) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = audit_events.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND actor_user_id = va.current_user_id());

ALTER TABLE va.idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.idempotency_records FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.idempotency_records FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = idempotency_records.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND user_id = va.current_user_id()) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = idempotency_records.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND user_id = va.current_user_id());

ALTER TABLE va.outbox_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.outbox_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.outbox_commands FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = outbox_commands.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = outbox_commands.workspace_id AND s.id = outbox_commands.session_id AND s.user_id = va.current_user_id())) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = outbox_commands.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = outbox_commands.workspace_id AND s.id = outbox_commands.session_id AND s.user_id = va.current_user_id()));

ALTER TABLE va.deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.deletion_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.deletion_requests FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = deletion_requests.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND user_id = va.current_user_id()) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = deletion_requests.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND user_id = va.current_user_id());

ALTER TABLE va.confirmation_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.confirmation_challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.confirmation_challenges FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = confirmation_challenges.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = confirmation_challenges.workspace_id AND s.id = confirmation_challenges.session_id AND s.user_id = va.current_user_id())) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = confirmation_challenges.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = confirmation_challenges.workspace_id AND s.id = confirmation_challenges.session_id AND s.user_id = va.current_user_id()));

ALTER TABLE va.action_authorisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.action_authorisations FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.action_authorisations FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = action_authorisations.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = action_authorisations.workspace_id AND s.id = action_authorisations.session_id AND s.user_id = va.current_user_id())) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = action_authorisations.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND EXISTS (SELECT 1 FROM va.browser_sessions s WHERE s.workspace_id = action_authorisations.workspace_id AND s.id = action_authorisations.session_id AND s.user_id = va.current_user_id()));

ALTER TABLE va.workspace_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.workspace_entitlements FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.workspace_entitlements FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = workspace_entitlements.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active')) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = workspace_entitlements.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active'));

ALTER TABLE va.seat_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.seat_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON va.seat_assignments FOR ALL USING (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = seat_assignments.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND user_id = va.current_user_id()) WITH CHECK (workspace_id = va.current_workspace_id() AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.workspace_id = seat_assignments.workspace_id AND m.user_id = va.current_user_id() AND m.status = 'active') AND user_id = va.current_user_id());

-- Grants are intentionally not executed: deployment must provision an actual role.
-- Example least-privilege starting point (replace va_api with the provisioned role):
-- GRANT USAGE ON SCHEMA va TO va_api;
-- GRANT SELECT ON ALL TABLES IN SCHEMA va TO va_api;
-- GRANT USAGE, SELECT ON SEQUENCE va.event_sequence TO va_api;
-- Grant INSERT/UPDATE only on required operational tables, not app_users,
-- memberships, workspaces, origin_policies, workspace_entitlements or
-- seat_assignments for the ordinary member runtime.
-- Grant INSERT, SELECT only on audit_events; no UPDATE/DELETE to the API role.
-- A distinct controlled retention/identity administration path is required.
-- RLS does not grant table privileges, replace service authorisation or stop
-- a trusted backend from choosing a context. Never expose SET context to users.
COMMIT;
