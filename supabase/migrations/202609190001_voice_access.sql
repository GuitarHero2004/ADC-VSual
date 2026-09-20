-- Apply through the existing trusted migration/identity administration path.
-- This is the reference identity subset, not the complete product schema.
-- No Auth users, memberships, runtime passwords or application content are seeded.
BEGIN;

CREATE SCHEMA IF NOT EXISTS va;

CREATE TABLE IF NOT EXISTS va.app_users (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  identity_subject text NOT NULL UNIQUE,
  display_name text,
  status text NOT NULL CHECK (status IN ('active','disabled','anonymised')),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS va.workspaces (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','suspended','deleting')),
  policy_version integer NOT NULL DEFAULT 1 CHECK (policy_version > 0),
  content_retention_hours integer NOT NULL DEFAULT 24 CHECK (content_retention_hours BETWEEN 1 AND 168),
  audit_retention_days integer NOT NULL DEFAULT 30 CHECK (audit_retention_days BETWEEN 1 AND 90),
  workspace_kind text NOT NULL CHECK (workspace_kind IN ('personal','organisation')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS va.memberships (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES va.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES va.app_users(id),
  role text NOT NULL CHECK (role IN ('member','admin')),
  status text NOT NULL CHECK (status IN ('active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id),
  UNIQUE (workspace_id, id)
);

CREATE OR REPLACE FUNCTION va.current_workspace_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.workspace_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION va.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

ALTER TABLE va.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.app_users FORCE ROW LEVEL SECURITY;
ALTER TABLE va.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE va.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.memberships FORCE ROW LEVEL SECURITY;

-- Preserve reference policies when they already exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'va' AND tablename = 'app_users' AND policyname = 'owner_scope') THEN
    CREATE POLICY owner_scope ON va.app_users FOR ALL
      USING (id = va.current_user_id()) WITH CHECK (id = va.current_user_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'va' AND tablename = 'memberships' AND policyname = 'owner_scope') THEN
    CREATE POLICY owner_scope ON va.memberships FOR ALL
      USING (workspace_id = va.current_workspace_id() AND user_id = va.current_user_id())
      WITH CHECK (workspace_id = va.current_workspace_id() AND user_id = va.current_user_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'va' AND tablename = 'workspaces' AND policyname = 'owner_scope') THEN
    CREATE POLICY owner_scope ON va.workspaces FOR ALL
      USING (id = va.current_workspace_id() AND EXISTS (
        SELECT 1 FROM va.memberships m WHERE m.workspace_id = workspaces.id
          AND m.user_id = va.current_user_id() AND m.status = 'active'
      ))
      WITH CHECK (id = va.current_workspace_id() AND EXISTS (
        SELECT 1 FROM va.memberships m WHERE m.workspace_id = workspaces.id
          AND m.user_id = va.current_user_id() AND m.status = 'active'
      ));
  END IF;
END
$$;

-- Metadata only: no transcript, audio, token, email or provider response.
-- The service holds a per-user transaction advisory lock while checking and reserving.
-- At most 30 attempts are retained per user; older metadata is pruned on their next attempt.
CREATE TABLE va.voice_request_usage (
  user_id uuid NOT NULL REFERENCES va.app_users(id),
  workspace_id uuid NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, request_id),
  FOREIGN KEY (workspace_id, user_id) REFERENCES va.memberships(workspace_id, user_id)
);
CREATE INDEX voice_request_usage_time ON va.voice_request_usage(user_id, created_at);

ALTER TABLE va.voice_request_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE va.voice_request_usage FORCE ROW LEVEL SECURITY;
-- Counting across the caller's workspaces prevents resetting their budget by switching workspace.
CREATE POLICY voice_usage_read ON va.voice_request_usage FOR SELECT
  USING (user_id = va.current_user_id());
CREATE POLICY voice_usage_prune ON va.voice_request_usage FOR DELETE
  USING (user_id = va.current_user_id() AND created_at <= clock_timestamp() - interval '24 hours');
CREATE POLICY voice_usage_insert ON va.voice_request_usage FOR INSERT
  WITH CHECK (user_id = va.current_user_id() AND workspace_id = va.current_workspace_id()
    AND EXISTS (SELECT 1 FROM va.memberships m WHERE m.user_id = va.current_user_id()
      AND m.workspace_id = va.current_workspace_id() AND m.status = 'active'));

REVOKE ALL ON va.voice_request_usage FROM PUBLIC;

-- Provision a dedicated non-owner NOSUPERUSER NOBYPASSRLS login, or a login inheriting
-- a NOLOGIN runtime role; neither may inherit the schema/table owner or an elevated role.
-- Substitute the provisioned runtime role below; do not use Supabase postgres/service_role.
-- GRANT USAGE ON SCHEMA va TO va_voice_api;
-- GRANT SELECT ON va.app_users, va.workspaces, va.memberships TO va_voice_api;
-- GRANT SELECT, DELETE ON va.voice_request_usage TO va_voice_api;
-- GRANT INSERT (user_id, workspace_id, request_id) ON va.voice_request_usage TO va_voice_api;
-- GRANT EXECUTE ON FUNCTION va.current_user_id(), va.current_workspace_id() TO va_voice_api;
-- The runtime receives no identity/membership writes, no UPDATE and no DDL grants.

COMMIT;
