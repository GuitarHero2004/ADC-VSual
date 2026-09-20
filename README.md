# VSual — RMIT ADC browser companion

Hackathon project by **In Motion or Element**, for blind and low-vision users.
The assistant complements existing screen readers.

VSual answers bounded questions about the rendered **synthetic `/orders` dashboard**.
Allow page processing, type a question (or review an ElevenLabs transcript), then
select **Ask VSual**. The configured model through Avis interprets the comparison; application code calculates
the answer from captured rows and exposes the evidence. English and Vietnamese are
supported. Browser actions, other websites and wake words are outside this feature.

The separate **`/voice` setup** remains a labelled speech test: its read-back repeats
supplied text. In the companion, **Read answer** speaks the validated answer instead.
App speech and recording cues are off by default; text and evidence work without TTS.

## Companion interface

The extension is the working interface: **Current page → Your question → Ask VSual
→ Answer → View evidence**. The page status distinguishes unsupported pages,
missing page access and processing consent; account and workspace access remain
separate. Recording fills an editable question and never submits it. The example
question also only fills the input. Enter inserts a newline; use **Ask VSual** to
submit. **Go to answer** moves focus deliberately; an arriving answer does not.

**Settings** contains the actual assigned shortcut, optional microphone setup,
interface/recording language, answer speech and playback speed. Both interfaces
use a light theme with large default text (22.5px body, 25px answers), without
appearance controls. Browser zoom and operating-system forced colours remain
available. **Back to companion** restores focus to Settings without clearing the
question or answer. Website **Language** changes English/Vietnamese without
leaving the current page or restarting sign-in.

Language and speech preferences are local and separate for the website and
extension. English/Vietnamese interface changes do not translate source evidence.
New users have app speech off; existing explicit speech choices are preserved.
Secondary help is expandable; labels, status messages and evidence remain
available to keyboard and screen-reader users.

The homepage introduces the supported scope; **Get started** opens `/voice` with
practical extension setup and an optional website voice test. There is no published
store-install link or claimed automatic website/extension connection. `/orders`
keeps its synthetic English source table and capture identifiers unchanged.

## Install and run

Use **Node.js 24.x and npm 11.x** (`.nvmrc`, `packageManager` and engine checks
are authoritative). From the repository root:

```sh
npm ci --include=dev --include-workspace-root
npm run dev:web
```

Open <http://127.0.0.1:3000/orders>; use `/voice` for speech setup. On PowerShell, use `npm.cmd` if execution
policy blocks `npm.ps1`. Scripts do not require Unix shell utilities.

```sh
npm run dev:extension
```

This watches and writes `apps/extension/dist`; it does not inject a development
server into the extension. `npm run dev` starts both processes. Ctrl+C stops them.

## Configure the backend and extension

Create **`apps/web/.env.local`** using the names in `apps/web/.env.example`.
Real environment files are ignored; never commit credentials.

| Setting                                | Purpose                                                                                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Public HTTPS Supabase project origin                                                                                                                |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public `sb_publishable_` Auth key                                                                                                                   |
| `ELEVENLABS_API_KEY`                   | Private backend key with transcription and speech access                                                                                            |
| `ELEVENLABS_STT_MODEL`                 | `scribe_v2`                                                                                                                                         |
| `ELEVENLABS_TTS_MODEL`                 | `eleven_flash_v2_5`                                                                                                                                 |
| `ELEVENLABS_VOICE_ID`                  | An actual voice available to your account and API plan; evaluate Vietnamese pronunciation                                                           |
| `DATABASE_URL`                         | PostgreSQL connection for the restricted runtime role below                                                                                         |
| `VA_VOICE_WORKSPACE_ID`                | Existing active application workspace UUID                                                                                                          |
| `VOICE_ALLOWED_ORIGINS`                | Comma-separated exact extension origins, such as `chrome-extension://YOUR_EXTENSION_ID`                                                             |
| `AVIS_API_KEY`                         | Private Avis key for question interpretation; not needed for table inspection or voice setup                                                        |
| `AVIS_API_BASE_URL`                    | Avis HTTPS compatibility base: `https://api.avis.xyz/api/openai/v1`                                                                                 |
| `AVIS_AI_MODEL`                        | Exact model ID available through your Avis account; must support Responses Structured Outputs                                                       |
| `GROUNDED_ALLOWED_ORIGINS`             | Exact dashboard origins, comma separated; required in production                                                                                    |
| `AUTH_SITE_URL`                        | Exact website origin for website Google callbacks, with no trailing slash; local default `http://127.0.0.1:3000`, required in production for Google |
| `GOOGLE_AUTH_ENABLED`                  | Server capability flag; set `true` only after Google/Supabase configuration. Otherwise email/password remains available                             |

Provider configuration is read when used, not during imports or builds. Missing
settings produce a recoverable setup error. There is no default/sample voice,
provider fallback, webhook or realtime connection. Local development allows
`http://127.0.0.1:3000` and `http://localhost:3000` dashboard origins by default.
Use the exact deployed origin for Vercel Preview/Production; wildcards are rejected.
All three Avis settings are required; there is no default model. The existing OpenAI
SDK connects to Avis using these settings. `OPENAI_API_KEY`, `OPENAI_MODEL` and
`OPENAI_BASE_URL` are not used and cannot silently select another provider.
HTTPS endpoints must have no credentials, query or fragment, and redirects are rejected.
See [Avis OpenAI compatibility](https://docs.avis.xyz/api-reference/introduction/openai-compatibility).
A voice appearing in your
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
`VITE_SUPABASE_PUBLISHABLE_KEY`. Optional `VITE_ORDERS_ORIGINS` is a comma-separated
list of exact dashboard origins; it defaults to the API origin. Only `/orders` on
those origins is supported, and the backend allowlist must agree.
Use `http://127.0.0.1:3000` locally or your deployed
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
and inactive memberships before any provider call. Grounded answers reuse this
existing access model and usage table; this branch adds no migration.

Limits are **6 attempts per rolling minute and 30 per rolling 24 hours per user**,
across workspaces, shared by Avis and voice calls using this same database.
Duplicate request IDs are rejected.
Failed/cancelled provider attempts count, and old metadata is pruned on the next
attempt. This is a durable limit across Vercel instances, not an in-memory counter.
The application stores no recordings, questions, snapshots, answers or generated
audio in Supabase. Only the existing access and bounded usage metadata is retained.

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
4. Pin **VSual - Accessible browser companion**. Its toolbar button opens
   the side panel. Choose **Sign in on the VSual website**, complete sign-in in the
   opened tab, and choose **Return to VSual**. Account identity and workspace
   access are reported separately. No token copying or automatic recording occurs.
5. **Settings** displays the actual shortcut. **Alt+Shift+A** is suggested; change
   it at `chrome://extensions/shortcuts` or `edge://extensions/shortcuts`.
   It is browser-scoped toggle activation, not global hold-to-talk.
6. Optionally record and grant microphone permission; typed questions need neither.
   If the side panel cannot show permission setup, use **Settings → Open microphone
   setup in a tab** to open the
   same extension UI in a tab, grant permission there, then return to the panel.
   Website permission does not establish extension permission.

Shortcut: idle → open/start recording; recording → finish/transcribe; pending
request → cancel; speaking → stop. The toolbar opens without recording. A
readiness/acknowledgement handshake handles cold workers and new panels. Escape
cancels within the companion or web voice surface; in extension Settings it returns
to the companion. A narrowly matched content script
reads the orders table only after permission and an explicit capture/Ask action.
There is no offscreen document or background microphone.
Reload the extension and reopen the panel after any build/configuration change.

If **Allow page processing** is disabled, select the exact supported `/orders`
address shown beside the permission controls, then choose **Check active page**.
With the local example configuration this is `http://127.0.0.1:3000/orders`;
`localhost`, `/voice` and the home page do not match that configured address.
The panel follows active-tab navigation without reading page content. After
reloading the extension, reload the orders page too so its content script is ready.

## Accessible sign-in

Start from the extension's **Sign in on the VSual website** button. The opened
`/auth/sign-in` page supports labelled email/password fields, password managers,
paste, Show password, English/Vietnamese feedback, Cancel and Google when enabled.
It displays the account being connected. A website account is shown separately;
it is never silently imported into the extension. Use **Sign out and change
account** to replace an extension account. Authentication does not grant workspace
membership: a signed-in user without access receives an explicit explanation.

The worker creates a five-minute attempt and owns the new tab. The page obtains
an extension-held random proof through targeted `chrome.runtime.sendMessage`;
the worker checks the exact configured origin, `/auth/sign-in` path, recipient,
top frame, owned tab, attempt, proof and expiry. The URL carries only public attempt
identifiers. Email/password commands go directly to Supabase through the worker;
no extension access/refresh token is returned to the website, DOM, content script
or URL. There is no database handoff or new migration. Concurrent submissions,
expired/replayed attempts and callbacks after cancellation are rejected.

For extension Google sign-in, the worker owns `launchWebAuthFlow`, the original
PKCE verifier and the single code exchange. Supabase returns a one-use PKCE code
to the exact browser callback; the worker exchanges it with the recorded flow ID.
For ordinary website Google sign-in, the existing Supabase cookie client owns its
verifier; `/auth/callback` consumes short-lived non-secret flow metadata and exchanges
once into website cookies. These are independent sessions, not two clients sharing
one refresh token. No Google service scopes beyond identity are requested.

Extension credentials and pending attempts live only in trusted
`chrome.storage.session`. The worker coordinates refresh on validation/protected
requests, with one in-flight refresh per session and no panel refresh loops.
Closing/reopening the panel or suspending the worker retains sign-in. Browser
restart, extension reload/update or disabling it may clear sign-in. Questions,
capture consent, evidence and audio remain panel-session data. Only non-sensitive
language/voice preferences persist on the device. Offline validation preserves
credentials but blocks protected work until Retry succeeds; revoked sessions require
sign-in. Provider requests are never silently replayed after uncertain failures.

Logout immediately clears extension work and credentials, invalidates pending
attempts/refreshes, then attempts Supabase **local-session** revocation. The website
remains signed in independently. Offline/unconfirmed revocation is reported;
already issued JWTs may remain valid until expiry. Old callbacks cannot reconnect
the account. Return restores the original tab/window where possible; reopening a
closed panel may still require the pinned VSual button or shortcut. Signing in
never starts the microphone, captures a page or submits an old question.

### Google configuration (manual; not applied by this branch)

The stable Preview origin supplied for this project is
`https://web-git-dev-anhminhnts2004-9847s-projects.vercel.app`.
Use these exact destinations; do not add `*.vercel.app` or arbitrary return URLs.

| Where                                                    | Setting and value                                                                                                                                                                                                                       |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Cloud OAuth client                                | Application type **Web application** (Supabase handles Google's callback)                                                                                                                                                               |
| Google authorised JavaScript origins                     | `http://127.0.0.1:3000` and `https://web-git-dev-anhminhnts2004-9847s-projects.vercel.app`                                                                                                                                              |
| Google authorised redirect URI                           | `https://yvhrbfyriauyyxyazqlo.supabase.co/auth/v1/callback` — Google's return to Supabase, **not** VSual's callback                                                                                                                     |
| Google consent/audience                                  | Identity scopes only (`openid`, email, profile). If the OAuth app is in Testing, add the intended testers                                                                                                                               |
| Supabase → Authentication → Sign In / Providers → Google | Enable Google; enter that Web client ID and client secret **here only**; retain nonce/refresh-token protections                                                                                                                         |
| Supabase → URL Configuration → Redirect URLs             | `http://127.0.0.1:3000/auth/callback`; `https://web-git-dev-anhminhnts2004-9847s-projects.vercel.app/auth/callback`; `https://gnceohmhjehhlkfbhlhdhaheimilkocd.chromiumapp.org/auth`                                                    |
| Supabase Site URL                                        | Use the intended stable website origin; for this Preview journey: `https://web-git-dev-anhminhnts2004-9847s-projects.vercel.app`                                                                                                        |
| Local `apps/web/.env.local`                              | `AUTH_SITE_URL=http://127.0.0.1:3000`; `GOOGLE_AUTH_ENABLED=true` **after** provider setup; existing Supabase/database/workspace/origin settings above                                                                                  |
| Vercel Preview environment                               | `AUTH_SITE_URL=https://web-git-dev-anhminhnts2004-9847s-projects.vercel.app`; `GOOGLE_AUTH_ENABLED=true` after setup. Keep Next.js preset and `apps/web` root; redeploy after environment changes                                       |
| Extension `apps/extension/.env.local`                    | `VITE_API_BASE_URL` equals local origin or that exact Preview origin; existing public Supabase settings stay unchanged. Rebuild and reload                                                                                              |
| Backend `VOICE_ALLOWED_ORIGINS`                          | Include `chrome-extension://gnceohmhjehhlkfbhlhdhaheimilkocd`; use the actual installed ID if different                                                                                                                                 |
| Production later                                         | Once an exact production origin is chosen, add that origin to Google's origins, its `/auth/callback` to Supabase, and set production `AUTH_SITE_URL`/extension backend/origin allowlists accordingly. No production hostname is assumed |

The extension callback is generated by `chrome.identity.getRedirectURL('auth')`;
another unpacked install/Edge ID needs its own exact callback and backend origin
entry. Never put a Google client secret in VSual env files or extension bundles.
`GOOGLE_AUTH_ENABLED` is a deployment capability flag, not a live provider check.
When false/missing, the page explains that Google is unavailable and offers email.
Vercel Preview protection is separate from Supabase auth; an HTML protection
response must be resolved through deployment access settings, not a token embedded
in the extension. See [Supabase Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google),
[redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls), and
[Chrome identity](https://developer.chrome.com/docs/extensions/reference/api/identity).

### Authentication acceptance

Accessible-auth baseline verification on Node 24.17.0 / npm 11.13.0: clean `npm ci` and
`npm run check` passed (302 tests, typecheck, lint, formatting and both builds).
The mocked integration exercises website commands, the actual extension session
manager/Supabase SDK, backend identity/workspace checks, grounded evidence,
session restoration and logout. Production-server HTTP checks returned 200 for
sign-in/orders/config and 401 for signed-out access, grounded-read, STT and TTS.
Configured server secrets were absent from both browser build outputs. The Vite
build reports advisory `use client` directive warnings for shared React components;
both production builds still complete successfully.

Automated tests mock Supabase, browser APIs, database and providers. A read-only
Supabase Auth settings check confirmed Google and email providers are enabled;
the maintainer subsequently reported Google sign-in working during local testing.
The detailed browser acceptance sequence below, NVDA, password-manager integration
and focus/zoom checks still require manual verification. No browser automation
surface was available during that earlier implementation to independently verify
the interactive journey.

1. Start the web server and build/load the extension as above. Open `/orders`.
   Choose extension Sign in, enter an existing provisioned user's credentials on
   the website, then Return. Verify the account and workspace status. Test an
   invalid password and an existing account without membership separately.
2. Ask the canonical orders question below, inspect both evidence rows, close and
   reopen the panel, grant page-processing permission again, and ask again. Closing
   the panel retains authentication, not its sensitive question/evidence state.
3. Stop the service worker from browser extension tools and reopen the panel;
   sign-in should survive. Restart the browser/reload the extension; fresh sign-in
   may be required. Keep website and extension open across access-token expiry;
   each must refresh its own session without repeated sign-in prompts.
4. Cancel sign-in, close its tab, retry, and complete an older Google window late:
   only the current attempt may connect. Test Google success, cancellation and an
   unprovisioned Google account after configuration. A website signed in as A must
   not silently replace extension B or bypass explicit sign-in.
5. Disconnect the network during validation: Retry and Sign out stay available,
   credentials survive recovery, protected work stays blocked. Revoke the session
   through your existing account controls: retry should require sign-in.
6. Sign out while recording, requesting an answer, generating/playing speech or
   refreshing; old text/audio must never return. Switch A→B and confirm no captured
   data, drafts, consent or evidence from A remains. Signed-out requests must fail
   before Avis/ElevenLabs. Confirm website logout scope stays independent.
7. Repeat with keyboard only and NVDA on Windows: Tab/Shift+Tab, Enter/Space,
   Escape, Show password, password-manager fill/paste, EN/VI errors, visible focus,
   200–400% zoom and a narrow panel. No spoken password or app speech is required.

## Ask about captured orders

1. Sign into the extension and open the configured `/orders` page. Choose the
   interface language independently from the recording language.
2. Select **Allow page processing**. Permission lasts only for this signed-in panel
   session and origin; withdraw it to cancel work and clear captured data.
3. Enter **“Compare completed orders in the South for August and July.”** or
   **“So sánh số đơn hoàn thành ở miền Nam tháng 8 với tháng 7 năm 2026.”**
   Recording only fills editable question text; review it before **Ask VSual**.
4. Expect a decrease of **300 orders (25%)**, from July 1,200 to August 900 in 2026.
   **View evidence** shows both original values, row identifiers and the calculation.
5. Expand **Inspect the source table without AI**. **Capture source table** also
   works when Avis is unavailable. **Return to page** attempts to restore the
   original usable focus target, otherwise the supported page heading.
6. Optionally enable app speech in **Settings**. **Read answer** becomes
   **Stop speech** while preparing/playing, then **Read again** when audio is
   available. Read again and speed changes reuse session audio. Evidence expands
   below the answer without hiding playback controls; **Close evidence** returns
   focus to its disclosure. **Ask another question** returns to the editable input.

Supported questions compare completed-order counts for one region and two months.
An explicit baseline is respected; neutral comparisons use the earlier month.
Missing/ambiguous scope needs clarification; causes, revenue, forecasts and actions
are unsupported. A zero baseline produces an absolute difference with percentage
unavailable. Answers describe captured synthetic page data, not verified business
records. The original question also passes conservative scope checks; these do not
claim universal natural-language understanding.

`POST /api/grounded-read` verifies the existing Supabase identity and workspace,
validates at most **1,000 Unicode code points, 100 rows and 128 KiB**, checks the
source origin/fingerprint and a capture age of at most 30 seconds, then reserves
the shared durable usage limit. The model receives the question and bounded scope
context, without row counts, tools or browser authority. One Responses Structured
Outputs call uses `store: false`, a 35-second timeout and no automatic retries.
Validated interpretation selects actual rows; deterministic integer/rational math
and English/Vietnamese templates generate the answer. `store: false` is not a
provider zero-retention guarantee. Questions and bounded context go through Avis
to its configured upstream provider. Avis documents request payloads in its usage
records; upstream field/retention behavior depends on the resolved provider.
See [Avis usage records](https://docs.avis.xyz/api-reference/introduction/use)
and [compatibility](https://docs.avis.xyz/api-reference/introduction/openai-compatibility).

This focused endpoint and transient evidence implement this milestone without
the broader reference documents' persisted `/v1` task/session workflow. Reference
documents remain unchanged. Session, tab/document, request and snapshot checks
prevent late responses replacing current work. Relevant page changes mark previous
data stale and stop pending work; nothing automatically resubmits. Cancellation
cannot guarantee that a provider stopped processing or reverse its charge.

## Vercel

Keep **Framework Preset: Next.js**, **Root Directory: `apps/web`**, **Node: 24.x**,
and **Include source files outside of the Root Directory in the Build Step**
enabled. Keep default build/output settings. `apps/web/vercel.json` sets:

```sh
npm ci --include=dev --include-workspace-root
```

This preserves the existing Vercel TypeScript dependency fix. TypeScript checking
remains enabled. Set web environment variables for the intended Preview/Production
environment: mark `AVIS_API_KEY`, `ELEVENLABS_API_KEY` and `DATABASE_URL`
**Sensitive/Secret**; `AVIS_API_BASE_URL`, `AVIS_AI_MODEL`, speech model names and
voice ID are configuration. Set the exact
`GROUNDED_ALLOWED_ORIGINS` and `VOICE_ALLOWED_ORIGINS` for each environment, plus
the existing Supabase/workspace settings above. Changed variables require a new
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
permission, actual DOM mutation, deterministic calculations, model refusals,
stale responses, cancellation, playback reuse and logout cleanup.
They do not substitute for real PostgreSQL RLS/concurrency or browser tests.

### Companion UI: keyboard and NVDA check

Use Chrome or Edge on Windows with NVDA running. Keep app speech off initially.
These steps exercise the installed extension; a web preview does not verify its
permissions, activation or messaging. Configure an existing account and the local
or deployed backend as above.

1. Open the extension from its toolbar, find the actual shortcut in **Settings**,
   return to the companion, then try that shortcut. Confirm browser-scoped
   activation, predictable focus and reachable recording cancellation.
2. Identify account/workspace status and **Current page**. If signed out, complete
   the website sign-in using Tab, Shift+Tab, Enter/Space and a password manager or
   Google, then **Return to VSual**. Verify the correct account and separate
   workspace access. Open the supported `/orders` page and choose **Allow page
   processing**; permission alone must not capture/upload anything.
3. Enter the canonical comparison below using only the keyboard. Enter adds a
   newline; **Ask VSual** submits once. The microphone can remain denied or unused.
4. Hear the brief result status without losing focus. Use **Go to answer**, then
   **View evidence**. Read both source rows, the calculation and capture time.
   **Close evidence** returns focus to its disclosure.
5. Enable app speech deliberately in **Settings**, return, choose **Read answer**
   and **Stop speech**. **Read again** and playback-speed changes must reuse the
   generated audio; check that the browser sends no additional synthesis request.
6. Select **Ask another question**. Confirm focus returns to the editable question
   and another explicit Ask is needed. Do not expect conversation memory.
7. Choose **Record question**, speak, then **Stop recording**. Review and edit the
   transcript before asking; stopping recording must never submit automatically.
   Repeat using **Cancel recording** and confirm no transcription upload occurs.
8. Deny microphone permission or disconnect the network. Retain the typed question,
   hear a useful error and retry deliberately. Cancel pending work and sign out
   during a request; late text, answers or audio must not return.
9. Change EN/VI language and speech preferences. Return from **Settings** and
   verify draft/answer preservation and visible focus on its trigger. Check a narrow
   panel, 200% browser zoom, long labels and Windows contrast themes. On the website,
   repeat using **Language** while email is entered; sign-in must not
   restart. Read the English orders source unchanged in the Vietnamese interface.
10. Navigate or select another tab. Earlier evidence must be cleared or explicitly
    marked as previous context, playback must stop, and no page content should be
    transmitted automatically. Return to the supported page and ask deliberately.

Focused automated coverage includes settings focus/persistence, retained drafts,
unchanged captured source evidence across language changes, explicit
transcript submission and existing cancellation/authentication boundaries. Local
rendered checks in Chrome 153 covered the fixed light palette (including a dark
system preference), large default text, 320/1280-CSS-pixel layouts, Vietnamese,
200% text with spacing overrides, and emulated forced colours.
The actual unpacked extension and service worker were loaded in a disposable
profile: keyboard Settings navigation, preference persistence on reload, real
website sign-in handoff and cancellation passed without entering credentials or
calling a billable provider. This exercised the extension document in a tab, not
the docked side panel or physical shortcut activation. NVDA, actual microphone
permissions, live OAuth, audible speech and the full authenticated extension journey
still require the manual sequence above. Automated checks do not establish WCAG
conformance or screen-reader usability.

CI runs on PRs targeting `main` or `dev` and pushes to either, using the committed lockfile
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

The following opt-in **developer provider checks** make one live Avis request each,
using a synthetic English or Vietnamese comparison. They verify the actual
Structured Outputs response and deterministic calculation, cost provider quota,
and are never run by CI. They do not test sign-in, workspace reservations, page
capture or the complete extension flow. No questions, output text or keys are logged.

```sh
npm run check:avis --workspace=@adc/web
npm run check:avis --workspace=@adc/web -- --vi
```

Avis credit/spend-limit failures are distinguished from upstream access/rate-limit
errors. The application preserves the question and makes no automatic retry;
see [Avis errors](https://docs.avis.xyz/api-reference/introduction/errors).

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

### Grounded-read acceptance (all real-browser steps currently not run)

Run the journey in the companion panel, then check:

- [ ] Windows Chrome/Edge: cold shortcut, toolbar without microphone activation,
      initial focus, sign-in, allow/withdraw permission and unsupported-page refusal.
- [ ] English and Vietnamese questions: both cited rows, period direction, capture
      time, Go to answer, evidence disclosure/Close evidence and Return to page focus.
- [ ] In browser DevTools, change the displayed August cell from `900` to `1,050`.
      Old evidence must become stale; a fresh Ask must show a decrease of **150
      (12.5%)**. Changing the rendered DOM this way is also covered by automated tests.
- [ ] During a request, Cancel, change tab, navigate, edit the relevant table or
      sign out. Late responses must not appear; no automatic provider retry occurs.
- [ ] Deny page permission: no capture/upload. Missing Avis configuration: honest
      setup error, question preserved, source inspection still available.
- [ ] Keyboard-only and NVDA: labels, brief announcements, no unexpected focus move
      on answer arrival, semantic evidence, 200–400% zoom and narrow-panel reflow.
- [ ] Reviewed STT populates a question without submitting. Read answer speaks the
      answer, Stop speech is immediate, Read again/speed add no TTS calls, and TTS
      failure leaves evidence usable. Expand evidence and the source table while
      speaking or generating speech; Stop speech must remain available. Repeat
      with app speech disabled.
- [ ] Repeat against the configured Vercel Preview/Production origin, separately
      checking deployment protection, Supabase sign-in and workspace access.

Automated tests mock providers and browser interfaces; they are not live acceptance.
No browser automation surface or NVDA was available during the earlier grounded-read
implementation; current UI checks are recorded separately above.
On 20 September 2026, the configured Avis model passed one live English and one live
Vietnamese synthetic provider check: both returned valid structured interpretations,
then application code calculated the expected decrease of 300 orders (25%). These
checks did not exercise application sign-in, database reservations or browser capture.
The automated tests, type checking, lint, formatting and both production builds
passed. No deployment was performed for this branch.

Earlier voice verification recorded one successful synthetic English STT provider
check and a restricted TLS/RLS database read check. The last recorded live TTS check
failed with **HTTP 402 `payment_required`** for the configured Voice Library voice.
Account voice/plan access, authenticated end-to-end reservations, audible playback,
microphone permissions, Vietnamese/mixed-language pronunciation and deployed voice
acceptance remain unverified here. The current implementation uses one configured
voice; per-language selection and cloning are deferred.

## Code boundaries

- `apps/web`: `/orders`, `/voice`, the single backend, existing Auth/database access,
  and `/api/grounded-read`. `utils/grounded` separates model interpretation, scope
  checks, deterministic math and HTTP validation. Existing `/api/voice/*` routes
  provide recorded transcription and optional speech.
- `apps/extension`: the side panel owns question/capture/playback state; the orders
  content script reads only the supported page through trusted extension messages.
  The service worker retains browser command coordination. Tokens never enter the
  target page or content script.
- `packages/contracts`: browser-safe runtime schemas and inferred types.
- `packages/voice-ui`: one recording/playback controller and bilingual UI shared
  by both apps, with an authenticated fetch transport.
- `supabase/migrations`: the minimal identity/RLS and usage-metadata migration.
- `docs` and `core-context`: unchanged reference specifications/prototype material.

Voice uploads remain capped at 3 MiB plus 64 KiB multipart overhead (below Vercel's request
limit); header/signature screening does **not** verify audio duration. The UI enforces
30 seconds. TTS counts at most 1,000 Unicode code points, preserves supplied text,
uses MP3, a 30-second provider timeout and no automatic retries. See the official
[STT](https://elevenlabs.io/docs/api-reference/speech-to-text/convert),
[TTS](https://elevenlabs.io/docs/api-reference/text-to-speech/convert),
[authentication](https://elevenlabs.io/docs/api-reference/authentication) and
[model](https://elevenlabs.io/docs/overview/models) documentation.

`GroundedPanel` submits reviewed `VoiceController` text only through an explicit
Ask. Its answer controller sends only the validated answer text through the existing
`/api/voice/speak` transport. This is the bounded integration point for later
reasoning work. Model/page content never grants action authority.

Review this work on `feat/companion-ui`, based on `dev` at accessible-auth merge
`721a5e1`. Merge a reviewed feature before starting a separate follow-up branch
for broader scope or pending acceptance. When committing a completed feature,
split changes into focused commits with concise messages that explain their purpose
to technical and non-technical readers. Keep related tests with their implementation.
Use this approach for subsequent feature branches as well.
No automatic commit, push, merge or deployment is part of these scripts.
