# RMIT ADC Browser Accessibility Agent

Hackathon project by **In Motion or Element**: an on-demand browser assistant for
blind and low-vision users that complements existing screen readers.

This is the repository foundation. The web page, backend liveness route and
extension side-panel shell run locally. The panel supports an unsaved local
question draft and Clear; Send is visibly unavailable. No AI answers, orders
dashboard, page extraction, microphone capture, browser actions, sign-in flow
or database integration are implemented. Supabase web Auth client helpers and
session refresh are available for the next authentication step.

## Requirements and installation

Use **Node.js 24.x and npm 11.x** (verified with Node 24.17.0 / npm 11.13.0).
Use Chrome with the [Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
(114 or newer); use a current stable release
for manual testing. The public foundation and checks need no cloud account,
credentials or environment file.

From the repository root:

```sh
npm ci
npm run dev
```

On PowerShell, use `npm.cmd` instead of `npm` if script execution policy blocks
`npm.ps1`. All npm scripts work on Windows without Unix shell utilities.

`npm run dev` starts Next.js at <http://127.0.0.1:3000> and Vite's extension build
watcher. Ctrl+C stops both. To run them separately in two terminals:

```sh
npm run dev:web
npm run dev:extension
```

The watcher writes packaged extension files to `apps/extension/dist`; it does
not use a remote development script or hot-reload server inside the extension.
After changing extension code, reload the extension and reopen its panel.

## Load the extension

1. Run `npm run build --workspace @adc/extension` (or wait for the watcher build).
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Choose **Load unpacked**, then select the absolute directory
   `C:\ADC-VSual\apps\extension\dist` (adjust if cloned elsewhere).
4. Pin **Browser Accessibility Agent - Foundation** in the Extensions menu and
   click its toolbar button to open the side panel.
5. Alternatively, use **Alt+Shift+A**. If another extension owns that shortcut,
   assign it at `chrome://extensions/shortcuts`.

Only `sidePanel` permission is requested. There are no host permissions or
content scripts. Opening the panel does not connect to or inspect the active page.

## Verify

```sh
npm run typecheck
npm run lint
npm run format:check
npm run build
```

`npm run check` runs those four checks in order. `npm run format` formats only
implementation files; reference documents and existing research are excluded.
There is no unit-test suite yet; no product behaviour is claimed as tested.

Foundation verification completed: clean lockfile installation, type checks,
lint (including JSX accessibility rules), formatting, both production builds,
packaged extension file checks, and HTTP smoke checks in development and
production. Browser loading and NVDA checks were **not run** because no browser
was available in the implementation environment. npm audit reported zero
vulnerabilities. ESLint 9 is pinned for the current JSX accessibility plugin's
peer compatibility; npm reports its upstream deprecation warning.

To run the production web build after `npm run build`:

```sh
npm run start --workspace @adc/web
```

Open <http://127.0.0.1:3000> and <http://127.0.0.1:3000/v1/health>. The health route
returns `status`, `build_version` and a fresh `request_id`; it reports liveness
only, without contacting a database or provider.

Manual extension check: Tab to **Your question**, type a draft, Tab to **Clear
draft**, press Enter, and verify focus returns to the empty field with a
“Draft cleared” status. Send must remain disabled. Check visible focus, narrow
panel reflow and zoom. NVDA and actual unpacked-extension loading must be
verified manually; automated lint/build checks do not establish screen-reader
usability or accessibility conformance.

## Continuous integration

`.github/workflows/ci.yml` runs on pull requests targeting `main` and pushes to
`main`. It uses Node from `.nvmrc`, npm from `package.json`'s `packageManager`,
and `npm ci --include=dev --include-workspace-root` with the committed lockfile.
It runs the existing type, lint, formatting and build checks from the repository
root. Contracts are type-checked and bundled from source by both apps, so they
do not need a separate build. There are no tests yet; no placeholder test step
is included. No AI, database or Vercel credentials are needed.

For main branch protection, select **Foundation checks** (workflow **CI**) after
its first GitHub run. Reproduce the checks locally with:

```sh
npm ci --include=dev --include-workspace-root
npm run check
```

Deployment remains with Vercel's existing GitHub integration; CI only validates
the repository.

## Vercel builds

Keep **Framework Preset: Next.js**, **Root Directory: `apps/web`**, and
**Node.js Version: 24.x**. Keep **Include source files outside of the Root
Directory in the Build Step** enabled so the app can use the shared contracts,
root TypeScript configuration and workspace lockfile. Use the preset's default
build command and output directory.

`apps/web/vercel.json` sets the Install Command to
`npm ci --include=dev --include-workspace-root`. This overrides the dashboard's
Install Command. `--include=dev` keeps build tooling installed even when the
environment requests production-only dependencies; `--include-workspace-root`
includes the root's pinned TypeScript and React/Node type packages during an
app-scoped install. No package version changes or duplicate declarations are
needed. Next.js TypeScript checking remains enabled.

To verify from the repository root:

```sh
npm ci --include=dev --include-workspace-root
npm run build --workspace=@adc/web
npm run typecheck
npm run lint
```

## Supabase web Auth setup

`@supabase/supabase-js` and `@supabase/ssr` are dependencies of `@adc/web`.
To configure web session refresh, create `apps/web/.env.local` using the names
in `apps/web/.env.example` and your project's HTTPS URL and `sb_publishable_`
key. Set both `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, then restart the web dev server.
These values are intentionally public; never use a secret/service-role key.
Leave both unset for disconnected development. Partial or malformed
configuration raises an explicit error when used.

The helpers live in `apps/web/utils/supabase`: `client.ts` creates a browser Auth
client; `server.ts` exports an async `createClient()` using the current request's
cookies and is marked server-only. Next.js 16 uses `apps/web/proxy.ts` to run
`updateSession()` before web pages. It awaits `auth.getClaims()`, forwards cookie
changes to both rendering and the browser, and preserves the SDK's cache headers.
Static assets and `/v1` APIs are excluded; `/v1/health` stays dependency-free.
See the [Supabase SSR guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client).

This setup does not sign anyone in, protect routes, authenticate the extension
or authorize database access. Future protected routes must verify identity and
membership at the backend boundary. The quickstart's `todos` query is omitted:
our schema has no such table, and Supabase's ordinary database client does not
establish the transaction-local identity required by the `va` policies.

For Vercel, add the same two public variables under **Project Settings →
Environment Variables** for the intended environments and rebuild after changes.
Next.js embeds public variables at build time. No Vercel or Supabase dashboard
settings are changed by this setup. The optional agent-skills installer is not
required to run the application.

To verify the configured application's connection:

1. Locally, run `npm run dev:web`, then open
   <http://127.0.0.1:3000/v1/health/supabase>.
2. On Vercel, ensure the deployment includes this route and both public variables
   are set for its **Preview** or **Production** environment. Rebuild/redeploy
   after setting or changing them, then open
   `https://YOUR_DEPLOYMENT_DOMAIN/v1/health/supabase`. If deployment protection is
   enabled, sign in through Vercel's access prompt first.
3. Expect HTTP 200 with `configuration: "verified"`, `auth: "verified"`, and
   `database: "not_yet_implemented"`. HTTP 503 means configuration is absent or
   invalid; HTTP 502 means the Auth request failed or returned an unexpected
   response. `auth: "not_checked"` means configuration prevented the request.

This uncached endpoint reads [Supabase's public Auth settings](https://github.com/supabase/auth/blob/master/openapi.yaml)
using the application's existing publishable key. It returns only verification
statuses, a request ID and sanitized failure details. It verifies Auth
reachability and key acceptance, not user sign-in, session refresh or database
permissions. Database verification must wait for the backend's restricted access
path to be implemented. `/v1/health` continues to check application liveness only.

## Repository boundaries

- `apps/extension`: React + Vite, Chromium Manifest V3. Future capture and browser
  execution stay here.
- `apps/web`: Next.js App Router; synthetic demo website and the single backend.
  `/v1/health` reports liveness; `/v1/health/supabase` checks Auth connectivity.
  Product API routes are not implemented. Vercel is the intended host;
  its install command is configured in `apps/web/vercel.json`. No cloud resources
  are provisioned by this repository.
  Next.js agent-file generation is disabled to keep implementation notes here.
- `packages/contracts`: browser-safe Zod schemas and inferred types, plus the
  shared request-length bound. Next.js and Vite consume TypeScript source
  directly, so no separate package build/watch step is needed.
- `supabase/migrations`: reserved with `.gitkeep`; **no migrations exist or have
  been applied**. Supabase PostgreSQL is the selected database; the web Auth SDK
  is installed, but database access and identity-to-workspace mapping are pending.
- `docs`: unchanged product, API, database, SQL and RLS reference specifications.

App `.env.example` files contain commented placeholders only. Future local
configuration belongs in ignored app `.env.local` files. Never put provider
credentials, database credentials or privileged Supabase keys in `VITE_*` or
`NEXT_PUBLIC_*` variables, the contracts package or extension bundles.

The reference `va` RLS policies require the trusted backend to verify identity
and membership, map Supabase Auth to `va.app_users`, and set transaction-local
`app.user_id` / `app.workspace_id` for every database transaction. They require
a non-owner, non-`BYPASSRLS` runtime role with explicit limited grants. Direct
browser-side Supabase database calls and a privileged service role do not
provide this security model. Workspace membership, session ownership and action
authority still require backend checks.

The reference origin policy requires HTTPS. Plain HTTP localhost is sufficient
for this disconnected shell; use local HTTPS before enabling authenticated page
capture rather than silently weakening that policy. No foundation-blocking
specification contradiction was found. Future numerical answers must use
validated evidence and deterministic calculations; webpage content and model
output cannot grant action authority.

## Git workflow

Existing history is preserved. Develop each change on a separate branch, review
and merge it before starting the next feature. Supabase setup is on
`feat/supabase-auth-setup`; CI is currently on the separate `chore/ci-setup` branch.
`feat/grounded-read` remains pending: one typed question about actual captured
data from the synthetic orders dashboard, with inspectable evidence. No automatic
commit, push or merge is performed.
