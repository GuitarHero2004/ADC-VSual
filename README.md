# RMIT ADC Browser Accessibility Agent

Hackathon project by **In Motion or Element**, for blind and low-vision users.
The assistant complements existing screen readers.

This milestone is a **voice test**: record up to 30 seconds, transcribe with
ElevenLabs Scribe v2, edit the text, and explicitly read it back with Flash v2.5.
Read-back repeats the supplied text. Page analysis, intelligent answers, browser
actions and wake-word activation are not implemented. No OpenAI configuration is
needed. App-generated speech and local recording cues are off by default.

## Install and run

Use **Node.js 24.x and npm 11.x** (`.nvmrc`, `packageManager` and engine checks
are authoritative). From the repository root:

```sh
npm ci --include=dev --include-workspace-root
npm run dev:web
```

Open <http://127.0.0.1:3000/voice>. On PowerShell, use `npm.cmd` if execution
policy blocks `npm.ps1`. Scripts do not require Unix shell utilities.

```sh
npm run dev:extension
```

This watches and writes `apps/extension/dist`; it does not inject a development
server into the extension. `npm run dev` starts both processes. Ctrl+C stops them.

## Configure the voice test

Create **`apps/web/.env.local`** using the names in `apps/web/.env.example`.
Real environment files are ignored; never commit credentials.

| Setting                                | Purpose                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Public HTTPS Supabase project origin                                                      |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public `sb_publishable_` Auth key                                                         |
| `ELEVENLABS_API_KEY`                   | Private backend key with transcription and speech access                                  |
| `ELEVENLABS_STT_MODEL`                 | `scribe_v2`                                                                               |
| `ELEVENLABS_TTS_MODEL`                 | `eleven_flash_v2_5`                                                                       |
| `ELEVENLABS_VOICE_ID`                  | An actual voice available to your account and API plan; evaluate Vietnamese pronunciation |
| `DATABASE_URL`                         | PostgreSQL connection for the restricted runtime role below                               |
| `VA_VOICE_WORKSPACE_ID`                | Existing active application workspace UUID                                                |
| `VOICE_ALLOWED_ORIGINS`                | Comma-separated exact extension origins, such as `chrome-extension://YOUR_EXTENSION_ID`   |

Provider configuration is read when used, not during imports or builds. Missing
settings produce a recoverable setup error. There is no default/sample voice,
provider fallback, webhook or realtime connection. A voice appearing in your
account does not prove your plan permits API synthesis with it.
ElevenLabs blocks Voice Library voices through the API on its Free plan, even
when a voice can be previewed on its website. Choose an account-available Default
voice for Free-plan testing and evaluate its Vietnamese pronunciation, or arrange
the required plan for the selected library voice. Provider payment/access rejection
is shown as `PROVIDER_ACCESS_REQUIRED` with English/Vietnamese guidance; text is
preserved and requests are not retried automatically. See
[ElevenLabs Voice Library restrictions](https://elevenlabs.io/docs/eleven-creative/voices/voice-library).

Set these public build settings in **`apps/extension/.env.local`**, following its
example: `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, and
`VITE_SUPABASE_PUBLISHABLE_KEY`. Use `http://127.0.0.1:3000` locally or your deployed
HTTPS backend origin. Rebuild and reload after changes. The manifest derives
host permissions from these configured hosts; Chromium host permissions cannot
restrict ports, while application requests use the configured port. No provider
key or database credential belongs in `NEXT_PUBLIC_*`, `VITE_*`, browser storage,
or extension files.

### Database and existing-account access

The sign-in form requires an **application user in this project's Authentication
→ Users**, using that user's email/password. A Supabase dashboard login or database
password does not authenticate an app user. This milestone provides sign-in only;
it does not create accounts. The form reports safe Auth error codes for an invalid
login, unconfirmed email, disabled password sign-in, or rate limiting. Database
workspace access is checked separately after successful sign-in.

The supplied `va` policies require backend-verified identity and transaction-local
`app.user_id` / `app.workspace_id`. The browser uses Supabase **Auth only**, never
direct database queries. There is no service-role access in the application.

Through your trusted database administration/migration process:

1. Review and apply `supabase/migrations/202609190001_voice_access.sql`.
   It creates only the reference identity tables if absent and a small usage
   metadata table. It does not apply the complete product schema or seed accounts.
   Existing identity tables/policies are reused. Applying the migration is a
   separate administrator step; builds and commits do not apply it.
2. Create a dedicated `va_voice_api` login with `NOSUPERUSER NOCREATEDB
NOCREATEROLE NOINHERIT NOBYPASSRLS`, a strong password, and no owner/elevated role
   memberships. Apply the precise limited grants at the end of the migration.
   Do not use `postgres`, an owner role, or `service_role` as the runtime login.
3. Map an existing Supabase account to an active `va.app_users` row whose
   `identity_subject` equals the Supabase Auth UUID. Create/reuse an active
   workspace and active membership. Through trusted identity administration, set
   the account's **`app_metadata.va_user_id`** to the application user UUID.
   `user_metadata` is user-editable and is never accepted as this mapping.
4. Set `DATABASE_URL` and `VA_VOICE_WORKSPACE_ID`, then sign out and back in.

For example, the following identity provisioning block runs only in the trusted
Supabase SQL administration context after migration. Replace both UUID
placeholders. It preserves disabled/suspended records rather than reactivating
them. Administrator credentials never enter the app or `.env.local`.

```sql
DO $$
DECLARE
  subject uuid := '<existing-supabase-auth-user-uuid>';
  workspace uuid := '<application-workspace-uuid>';
  app_user uuid;
BEGIN
  IF NOT EXISTS (SELECT FROM auth.users WHERE id = subject) THEN
    RAISE EXCEPTION 'Choose an existing Auth account';
  END IF;
  INSERT INTO va.app_users (identity_subject, status)
    VALUES (subject::text, 'active') ON CONFLICT (identity_subject) DO NOTHING;
  SELECT id INTO app_user FROM va.app_users
    WHERE identity_subject = subject::text AND status = 'active';
  IF app_user IS NULL THEN RAISE EXCEPTION 'Account is not active'; END IF;
  INSERT INTO va.workspaces (id, name, status, workspace_kind)
    VALUES (workspace, 'Voice test', 'active', 'personal') ON CONFLICT (id) DO NOTHING;
  IF NOT EXISTS (SELECT FROM va.workspaces WHERE id = workspace AND status = 'active') THEN
    RAISE EXCEPTION 'Workspace is not active';
  END IF;
  INSERT INTO va.memberships (workspace_id, user_id, role, status)
    VALUES (workspace, app_user, 'member', 'active')
    ON CONFLICT (workspace_id, user_id) DO NOTHING;
  IF NOT EXISTS (SELECT FROM va.memberships
    WHERE workspace_id = workspace AND user_id = app_user AND status = 'active') THEN
    RAISE EXCEPTION 'Membership is not active';
  END IF;
  UPDATE auth.users SET raw_app_meta_data = jsonb_set(
    coalesce(raw_app_meta_data, '{}'::jsonb), '{va_user_id}', to_jsonb(app_user::text), true
  ) WHERE id = subject;
END $$;
```

For Vercel, use the host/port from **Supabase Connect → Transaction pooler**,
the custom-role username `va_voice_api.YOUR_PROJECT_REF`, and that role's password
(URL-encoded). Direct connections use username `va_voice_api`. Use verified TLS.
Keep `?sslmode=verify-full` in `DATABASE_URL`. The backend bundles Supabase's
public Root 2021 CA and verifies both the certificate chain and hostname; no
certificate download or additional environment variable is needed at runtime.
It normalizes the URL's SSL setting before configuring `pg`, which otherwise
overwrites the supplied CA. Conflicting SSL options are rejected. Restart the
local web server after changing `DATABASE_URL` because its connection pool is cached.
See [Supabase certificate guidance](https://supabase.com/docs/guides/platform/ssl-enforcement).
The driver uses unnamed queries, explicit transactions and transaction-scoped
advisory locks, compatible with transaction pooling. See
[Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).
The backend rejects owner/bypass roles, missing forced RLS, mismatched identities
and inactive memberships before any ElevenLabs call.

Limits are **6 attempts per rolling minute and 30 per rolling 24 hours per user**,
across workspaces, using this same database. Duplicate request IDs are rejected.
Failed/cancelled provider attempts count, and old metadata is pruned on the next
attempt. This is a durable limit across Vercel instances, not an in-memory counter.
The application stores no recordings, transcripts or generated audio in Supabase.

## Build and load the extension

Use current Chrome or Edge on Windows (Chromium 116+):

```sh
npm run build --workspace=@adc/extension
```

1. Open `chrome://extensions` or `edge://extensions`; enable **Developer mode**.
2. Choose **Load unpacked** and select `C:\ADC-VSual\apps\extension\dist`
   (adjust to your checkout).
3. Copy its extension ID into the backend's `VOICE_ALLOWED_ORIGINS` as
   `chrome-extension://ID`, then restart the backend or redeploy.
4. Pin **Browser Accessibility Agent - Voice test**. Its toolbar button opens
   the side panel. Sign in using an existing account; web sign-in does not sign
   the extension in. Tokens stay in trusted extension session storage and are
   cleared on logout/browser-session end.
5. The panel displays the actual shortcut. **Alt+Shift+A** is suggested; change
   it at `chrome://extensions/shortcuts` or `edge://extensions/shortcuts`.
   It is browser-scoped toggle activation, not global hold-to-talk.
6. Start recording and grant microphone permission. If the side panel cannot
   show permission setup, use its **Open microphone setup** button to open the
   same extension UI in a tab, grant permission there, then return to the panel.
   Website permission does not establish extension permission.

Shortcut: idle → open/start; recording → finish/transcribe; pending request →
cancel; speaking → stop. A readiness/acknowledgement handshake handles cold workers
and new panels. Escape cancels within the extension or web voice surface. No
content scripts, page access, offscreen document or background microphone exist.
Reload the extension and reopen the panel after any build/configuration change.

## Vercel

Keep **Framework Preset: Next.js**, **Root Directory: `apps/web`**, **Node: 24.x**,
and **Include source files outside of the Root Directory in the Build Step**
enabled. Keep default build/output settings. `apps/web/vercel.json` sets:

```sh
npm ci --include=dev --include-workspace-root
```

This preserves the existing Vercel TypeScript dependency fix. TypeScript checking
remains enabled. Set web environment variables for the intended Preview/Production
environment: mark `ELEVENLABS_API_KEY` and `DATABASE_URL` **Sensitive/Secret**;
model names and voice ID are configuration. Changed variables require a new
deployment; public settings are embedded at build time. The extension must point
to that HTTPS deployment and its origin must be allowed by the backend.

Vercel preview protection may reject an extension before the application receives
the request. An HTML protection response is reported separately from an expired
Supabase session. Use an appropriately accessible deployment for extension tests;
do not put a Vercel bypass token in the extension. Existing Vercel GitHub integration
owns deployment; GitHub Actions has no deployment job or Vercel token.

## Verify

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

`npm run check` runs all five. Shared contracts and voice UI export TypeScript
source; Next/Vite bundle them directly, so there is no prerequisite package build.
Tests use Node 24's runner and mocked provider/Auth/database/browser interfaces:
no credits or live credentials are needed. They cover authorization, RLS context,
rate reservations, Unicode/input limits, final chunks, delayed microphone
permission, stale responses, cancellation, playback reuse and logout cleanup.
They do not substitute for real PostgreSQL RLS/concurrency or browser tests.

CI runs on PRs targeting `main` and pushes to `main`, using the committed lockfile
and declared Node/npm versions. Branch-protection check: **Foundation checks**
(workflow **CI**). Reference specifications are excluded from formatting.

To serve the production build:

```sh
npm run start --workspace=@adc/web
```

`/v1/health` is liveness only. `/v1/health/supabase` makes a read-only Auth settings
request; `configuration/auth: verified` confirms reachability, not user sign-in
or database access. It reports `database: not_checked` explicitly. A successful
build or client initialisation is not a connection test.

An optional developer-only synthesis smoke check uses the configured voice/model
and writes an ignored synthetic MP3 to `apps/web/out/elevenlabs-smoke.mp3`:

```sh
npm run check:elevenlabs --workspace=@adc/web
```

Each invocation uses quota. This is not an authenticated end-to-end application
test. Ordinary read-back is only triggered by user actions, keeps the latest audio
in session memory, and reuses it for Repeat/speed changes. Editing text/language
invalidates cached audio. Stop is local and immediate; cancellation cannot promise
to reverse provider billing. The application does not claim provider zero retention;
recordings and text are sent to ElevenLabs under its
[privacy policy](https://elevenlabs.io/privacy-policy).

### Manual acceptance sequence (local or deployed)

1. Complete configuration/access setup above. On Vercel, open
   `https://YOUR_DEPLOYMENT/voice`; for the extension rebuild with that backend URL.
   Sign in on each surface independently. Confirm the signed-out flow cannot call
   voice endpoints, and invalid/expired sessions ask for sign-in once.
2. Use only Tab, Shift+Tab, Enter/Space and Escape. Check visible focus, 200–400%
   zoom, narrow panel reflow and essential English/Vietnamese interface strings.
   With NVDA, verify labels, concise state announcements and no per-second timer
   or transcript-reading interruptions. Keep app speech off for screen-reader use.
3. Deny microphone access, recover through permission settings/setup, then allow.
   Cancel while permission is pending and verify no late recording starts. Start,
   finish, cancel, reach 30 seconds, and close the panel; check the microphone
   indicator stops. Cancel must never upload; Finish must include the final word.
4. Reload the extension so its worker/panel starts cold. Test toolbar opening and
   every shortcut state, including cancelling a pending transcription/generation.
5. Record Vietnamese, English and mixed speech, including:
   “Lọc doanh thu tháng chín.”, “Compare Q3 revenue with Q2.” and
   “Doanh thu là một triệu hai trăm năm mươi nghìn đồng.”
   Review real returned text. Try silence, permission errors, quota and network errors.
6. Enable app speech, edit the transcript or type text, then Read back. Test Stop,
   Play/Repeat and every speed. Network tools should show no new `/speak` request
   for Repeat/speed changes. Editing text/language must require fresh synthesis.
   Test `09/10/2026`, `1.250,50 ₫`, `1,250.50 USD`, `Q3` and mixed-language text.
   The application preserves digits; assess provider pronunciation manually.
7. Sign out while recording, requesting permission, generating and speaking.
   Pending work/audio must clear, including other open extension setup documents.

### Review checkpoint and unfinished work

This is an implementation checkpoint, with live voice acceptance still pending.
The latest full `npm run check` passed type checking, linting, formatting, all
**110 mocked tests**, and web/extension production builds. Browser bundle checks
found no server credentials or bundled database CA. These checks do not establish
that a user can complete the live voice flow.

Local live verification completed:

- One Scribe v2 transcription of a previous synthetic English audio sample
  returned the expected sentence. This was a provider check, not a microphone test.
- A read-only database connection verified TLS, the restricted runtime role,
  required grants and forced RLS. Unscoped reads returned no rows. The project
  owner reported applying the migration and account/workspace provisioning
  separately; authenticated membership and usage reservations still need testing.

Resume these unfinished steps on a follow-up branch:

- [ ] Resolve TTS voice/plan access and verify audible read-back. The last live
      Flash request failed with **HTTP 402 `payment_required`** for the configured
      Voice Library voice; no audio was returned. No alternative voice was selected
      or verified by that check. Keep text usable while this remains blocked.
- [ ] Complete an authenticated `/voice` session and extension session, confirming
      workspace membership and database usage reservations through the real routes.
- [ ] Run the manual acceptance sequence above in Chrome or Edge on Windows:
      microphone allowed/denied, cold shortcut activation, Finish, Cancel, Stop,
      Repeat, speed changes, session expiry and logout. These browser checks are
      unrun; mocked tests cover the underlying state and request handling.
- [ ] Check keyboard-only use, NVDA announcements, zoom and narrow-panel layout.
- [ ] Evaluate Vietnamese, English, mixed-language speech and pronunciation of
      dates, currency and decimals with the chosen voice.
- [ ] Configure the deployed backend and extension origin, then repeat acceptance
      against Vercel. All implementation-time live checks were local; production
      has not been verified.

The implementation currently uses **one server-configured voice**. Per-language
voice selection is deferred, not required to validate the existing flow. Voice
cloning, wake-word activation, OpenAI, page analysis and website actions remain
outside this milestone.

## Code boundaries and next integration

- `apps/web`: the single Next.js backend and web setup UI. `/api/voice/transcribe`
  and `/api/voice/speak` validate and authenticate requests, reserve usage, and call
  small server-only `transcribeAudio` / `synthesiseSpeech` functions.
- `apps/extension`: React side panel owns capture/editing/playback; service worker
  owns browser command coordination. Auth uses the existing Supabase account.
- `packages/contracts`: browser-safe runtime schemas and inferred types.
- `packages/voice-ui`: one recording/playback controller and bilingual UI shared
  by both apps, with an authenticated fetch transport.
- `supabase/migrations`: the minimal identity/RLS and usage-metadata migration.
- `docs` and `core-context`: unchanged reference specifications/prototype material.

This milestone follows the current prompt's `/api/voice/*` endpoints, recorded
toggle interaction and ElevenLabs provider choice. Broader `/v1` task/session,
hold-to-talk and reasoning requirements in older references remain future work.
Uploads are capped at 3 MiB plus 64 KiB multipart overhead (below Vercel's request
limit); header/signature screening does **not** verify audio duration. The UI enforces
30 seconds. TTS counts at most 1,000 Unicode code points, preserves supplied text,
uses MP3, a 30-second provider timeout and no automatic retries. See the official
[STT](https://elevenlabs.io/docs/api-reference/speech-to-text/convert),
[TTS](https://elevenlabs.io/docs/api-reference/text-to-speech/convert),
[authentication](https://elevenlabs.io/docs/api-reference/authentication) and
[model](https://elevenlabs.io/docs/overview/models) documentation.

The later reasoning feature should explicitly submit the **reviewed editable text**
(`VoiceController.getSnapshot().text`) alongside permitted extension evidence to its
own authenticated backend route. After validating the reasoning result, pass its
answer text to `synthesiseSpeech` (or the existing `/api/voice/speak` transport).
There is deliberately no automatic transcript-to-reasoning callback today.
Numerical answers must use validated evidence and deterministic calculations;
model/page content must never grant action authority.

Commit this checkpoint on `feat/voice-foundation` for review. After it is merged
into the team's integration branch, create `feat/voice-playback-completion` from
that updated branch to finish the acceptance steps above. Keep the later
`feat/grounded-read` feature separate.
No automatic commit, push, merge or deployment is part of these scripts.
