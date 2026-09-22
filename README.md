# VSual — RMIT ADC browser companion

Hackathon project by **In Motion or Element**, for blind and low-vision users.
The assistant complements existing screen readers.

VSual answers bounded questions about **structured HTML articles/information pages**
and the rendered **synthetic `/orders` dashboard**. This branch also implements
**captured browser-view questions**, with live use gated on model-route verification.
Type and select **Ask VSual**, or deliberately record a question
and pause for five seconds to submit automatically. The configured model through
Avis answers from captured article excerpts. For orders comparisons, it interprets
the question and application code calculates from the captured rows. English and Vietnamese are
supported. Google/Microsoft file retrieval, arbitrary spreadsheet calculations,
browser actions, automatic arrival summaries and wake words remain outside this feature.

The separate **`/voice` setup** remains a labelled speech test: its read-back repeats
supplied text. In the companion, **Read answer** speaks the validated answer instead.
Companion answer speech defaults ON for new preferences; recording cues and the
standalone voice test remain optional. Text and evidence work with Speech OFF.

## Visual page reading

`feat/visual-page-read` starts from updated `dev` at `60d0b13` (structured-page-read
PR #13). It reuses the trusted floating frame/side panel, authentication, workspace
checks, usage reservations, question controller, Avis integration and speech player.
There are no new browser permissions, database migrations or hosted services.

An explicit **Ask VSual** chooses a local reading method. Supported article prose
and orders questions keep their existing readers. Questions about visual content,
or eligible HTTP(S) views without supported article structure, use one viewport
image. Opening, expanding or checking the companion never takes a screenshot or
calls a provider. A first-use visual-processing notice explains transmission through
Avis, private/unsaved content, exclusions, temporary scrolling and retention.
Acknowledgement is remembered in trusted `chrome.storage.session` for the signed-in
extension session; it does not submit a draft. This is separate from browser access.
Use the browser-toolbar button on the source tab if capture access is missing;
granting access preserves the question and requires a fresh deliberate Ask.

The primary visual path does not require `main`/`article` or a still DOM. It describes
one captured moment, including legible labels and apparent patterns. It cannot
retrieve a whole workbook/document, watch a video, open files, or calculate from
arbitrary pictured numbers. Visual evidence has image IDs, bounded regions and
readable descriptions; these are model interpretations, **not independent factual
verification**. Source, capture time and omissions remain readable with Speech OFF.

This is on-demand reading of the live browser: each submitted visual question takes
a fresh capture. The model receives the actual image pixels with the question, so
it can summarise readable content, explain a diagram or describe a chart's apparent
pattern; it is not restricted to transcribing labels. It does not continuously
watch changes. Scroll to the relevant content and ask again to read another view.
The original source remains authoritative: valid image references establish where
the interpretation points, not that every observation is correct.

An explicit whole-page visual question can use up to four overlapping images only
on positively identified finite document-like pages using the top-level vertical
scroller. Interactive calendars, grids, presentations, videos, nested scrolling
and virtualised views are not auto-scrolled. Oversized scope is refused before
capture; **Read current view** and, where eligible, **Read first portion** are separate
deliberate actions. Nothing silently truncates into a claimed full-file answer.
Scrolling, pointer/touch or navigation keys from the user cancel temporary capture;
cleanup does not pull the user back after takeover. Passive clocks/canvas updates
do not require a current-view task to wait for DOM stability.

The worker checks source/window/tab before and after every screenshot, including
away-and-back races. During capture, one compact Cancel surface replaces private
companion content while keeping controllers mounted. Known private controls,
unsupported frames and VSual regions are blacked out in the encoded pixels, with
a 6 CSS-pixel outward margin. Chromium closed-shadow inspection prevents the
companion iframe escaping masking when a page removes its host marker. Intended
document editors require a structural policy, not a hostname exception. Inspection
is bounded to 20,000 nodes and 200 mask rectangles and fails closed when unavailable.
These measures do not guarantee removal of every private fact from page content.

`VISUAL_LIMITS` defines: one default/four maximum images, 20% overlap, at least one
second between screenshot starts and one capture batch per extension. Preparation
is capped at 2 seconds, scroll settling at 1 second, each screenshot call at 2
seconds and capture at 15 seconds. Raw images are capped at 24 MP; each output at
2 MP, 2,000 px on its longest edge and 512 KiB. Total outputs are capped at 8 MP /
2 MiB and serialized requests at 3 MiB. Encoding uses JPEG quality 0.85 once; there
is no repeated quality ladder. Backend time is capped at 25 seconds, model at 20,
initial speech preparation at 15 and the submitted task at 60 seconds (STT is
separate). One model call and at most one initial TTS call; no automatic paid retries.

The verified-profile budget is at most 8,192 total input tokens, including at most
6,144 image tokens, and 768 output tokens. The existing `gpt-6-astra` route uses
explicit `original` image detail and its documented 32-pixel patch calculation /
1.2 multiplier; text uses a conservative UTF-8 byte bound plus framing allowance.
See [official image token accounting](https://developers.openai.com/api/docs/guides/images-vision).
The lower applicable bound wins, so a request can fail before its image-count
ceiling. Answer/speech text remains capped at 1,000 Unicode code points. The backend
decodes raster bytes using Sharp and validates actual format, dimensions, hashes,
coverage and evidence references before accepting results. URLs are never fetched.
Capture preflight checks projected image tokens before scrolling; an explicit first
portion uses the smaller affordable tile count. The backend additionally checks the
complete question/instruction/schema budget, which may require a still smaller view.

Images remain transient in the capture/request path, never in rendered page DOM,
conversation state, browser storage, database, buckets or routine logs. Accepted
answer metadata/evidence and the latest audio remain session-local. End/logout,
resource navigation and invalidation cancel pending work; stale results cannot
appear or speak. Accepted source-bound speech may still continue across tabs under
the existing rules. Repeat reuses cached audio at 0.9×; Speech OFF makes no TTS call.
Provider retention remains unverified; no zero-retention claim is made. The bounded
synthetic image-forwarding check below passed, but does not establish compatibility
with every browser application or document.

### Visual configuration and current verification gate

Reuse `AVIS_API_KEY`, `AVIS_API_BASE_URL`, `AVIS_AI_MODEL`, Supabase, restricted
database/workspace and `VOICE_ALLOWED_ORIGINS` in `apps/web/.env.local`. The extension
keeps its existing `VITE_API_BASE_URL`; it never receives provider keys. One added
server-only configuration value is `AVIS_VISUAL_VERIFIED_ROUTE`, a non-secret hash
printed only after the opt-in synthetic check passes:

```sh
npm run check:avis:visual --workspace=@adc/web
```

This spends quota on **one** request containing two generated test images, with no
retry. It is not a real-browser/authentication test and never runs in CI. Set the
successful printed hash locally or in the intended Vercel environment, then restart
or redeploy. A changed URL/model/profile invalidates it. Do not fabricate a hash to
bypass verification. Builds and structured readers work without this setting.

The initial 22 September 2026 compatibility attempt was **inconclusive**: the smoke
question's “Do not calculate anything” disclaimer tripped our calculation filter.
After the filter/prompt correction, one explicitly authorised follow-up request
**passed** against the configured Avis `gpt-6-astra` route: two generated 600×240
PNG images, unpredictable image-only labels, strict JSON, and matching evidence.
Application request reference: `a9223562-cbaa-49a7-91b6-d10b69603dee`; upstream
response ID: `resp_0d962352e98249a9016ab1f4c0f164819786e98934262ed773`; HTTP 200 in
approximately six seconds. The adapter made exactly one request with retries off,
4,130 bounded input tokens and the unchanged 768-token output cap. This establishes
that synthetic route check, not website authentication, browser capture, Google
Docs compatibility or speech. No environment files were changed. Do not repeat
this paid check just to reconfirm the same route.
Automated provider/lifecycle and actual encoded-pixel tests use synthetic data and
mocks; they do not establish Edge compatibility.
The completion review adds an integration test from question submission through real
masking/resizing, HTTP validation and the Avis adapter. It inspects the exact JPEG
sent to the provider mock at 2× and 4× pixel scales, checking excluded private pixels,
retained document text and absence of payload logging. This is controlled geometry,
not an actual Edge zoom test. Browser APIs, authentication and providers are mocked.
Regression fixes cover Stop and review after the silence timer fires, worker loss
after capture, incidental iframe-loading updates, speech deadlines, overflowing
private controls and non-orders table routing. Current-view cleanup never moves page
scroll/focus; deliberate scrolling retains guarded restoration.

The latest integration pass ran `npm run check` successfully: type checking, lint,
formatting, **655 tests** (318 extension, 268 web, 69 voice) and both production builds.
Asynchronous hashing tests use bounded condition waits under parallel load; their
cancellation assertions and production deadlines remain intact. The built
visual endpoint rejected anonymous same-origin requests with 401 and originless
requests with 403, both with `no-store`. A scan of 29 browser-output files found none
of the three configured server credential literals. These are local checks, not
Vercel or authenticated visual acceptance. The extension build retains the existing
non-failing shared-component `use client` bundler warnings.

The Google Docs follow-up fixes a failed structured-page probe dropping independently
checked screenshot-access metadata. Missing structured document metadata also no
longer invalidates an otherwise unchanged visual source. Actual document/resource
changes and access loss still invalidate work. Completed request errors remain
visible after later context checks instead of becoming a misleading cancellation.
The reported historical 502 has not been reproduced or attributed to a specific
provider failure.

If a visual request fails, expand **Request details** for its reference ID. The
local web terminal (or Vercel function logs) emits a `visual_request_failed` entry
for server errors with the application request ID, stage, bounded reason/code,
status, elapsed time, dispatch flag, validated image dimensions/byte totals and
safe provider metadata. Upstream HTTP status and allowlisted error/request IDs are
included when available; the model response ID is separate from VSual's reference.
`X-Client-Request-Id` associates the single upstream attempt with VSual's request.
Use these fields to distinguish no dispatch, an upstream HTTP failure, output
limit, malformed answer or evidence rejection after an HTTP 200. Diagnostics never
copy raw error bodies, images, prompts, source URLs, credentials or arbitrary
provider headers. Do not share request headers, image bodies, document text or
credentials. After updating, restart the web server, reload the extension, and
refresh source tabs before retesting.
HTTP metadata is captured before the SDK parses the body, so malformed HTTP-200
JSON/envelopes retain their status and are reported as `invalid_response` rather
than looking like a request with no response. Both SDK response helpers share one
cached request; regression tests assert one dispatch and cancellation precedence.

The integration investigation confirmed Edge's registered unpacked path is
`apps/extension/dist`, whose production-mode build points to `http://127.0.0.1:3000`.
The matching workspace Next development server is reachable and compiles the
latest diagnostics. However, Edge's in-memory extension revision and the version
that handled the original 502 could not be proven: the original request reference
is unavailable and no matching failure event is in the retained development log.
Reload the extension before a new test. No claim is made that the historical
Google Docs 502 is fixed; a new correlated browser request is still required.

The user subsequently reported a successful browser test on the non-sensitive
two-image fixture: the answer correctly identified `ALPHA-8533` and `BETA-9459` and
acknowledged the unreadable redacted region. This is **user-reported synthetic
browser success**, separate from the adapter check above. The browser version,
request reference and evidence controls were not independently observed. Real
Google Docs, chart interpretation and audible playback remain to be verified.

### Test visual reading locally

1. Use Node 24 / npm 11. From the root: `npm ci --include=dev --include-workspace-root`,
   then `npm run dev:web`. In another terminal run
   `npm run build --workspace=@adc/extension`.
2. Load/reload `apps/extension/dist` at `edge://extensions` or `chrome://extensions`
   (Developer mode → Load unpacked), then refresh source tabs. Public backend
   configuration changes require rebuilding and reloading. Check the actual
   extension ID against `VOICE_ALLOWED_ORIGINS`; Google sign-in also needs that
   ID's exact Supabase callback (see [Google configuration](#google-configuration-manual-not-applied-by-this-branch)). Sign in through VSual
   and confirm workspace access.
3. Complete the opt-in model check/configuration above before expecting visual answers.
   Use a synthetic/non-sensitive HTML page first. Activate VSual with its browser
   toolbar button, keep Speech OFF, type “Describe the current screen”, acknowledge
   the visual notice, and confirm acknowledgement alone sends nothing. Select Ask.
4. Check source/capture time, readable image evidence and explicit omitted-content
   information. Then enable Speech, ask once, Stop during generation/playback and
   Repeat. Repeat must add no TTS request. Typed answers must survive audio failure.
5. On a finite long article, ask about the “entire page screenshot”. Check preflight
   refusal when too long; choose a narrower option deliberately. Cancel or interact
   during scrolling and verify position restoration/takeover and preserved draft.
6. Test a tab switch and away/back during capture, resource query/hash navigation,
   End, logout and account changes. No old answer/audio may become current. Test
   shortcut cancellation during capture and access recovery without recording.
7. Test recording with five-second silence, continued-speech timer reset and Stop
   and review, including immediately after automatic transcription starts: the
   transcript must remain editable without submitting. Recheck `/orders`
   deterministic comparison and `/reading-demo` prose/table routing.
8. Repeat with keyboard only, NVDA, 200% text and narrow layout. Check focus returns
   to a usable control after capture; only brief status is live-announced. Try
   English/Vietnamese questions and assess pronunciation separately.

After the synthetic labels test, use non-sensitive content to test interpretation:

- Document: “Summarise the main points visible on this screen and preserve any
  qualifications.”
- Chart: “Describe the apparent trend in this chart. Identify the labels supporting
  your answer and anything too unclear to read. Do not calculate.”
- Diagram: “Explain how the items in this diagram relate, using its visible labels.”
- Table: “Read the visible column headings and describe any obvious missing values
  or ambiguous units. Do not calculate or claim to check hidden rows.”

Inspect the source time and supporting descriptions against the displayed content.
Scroll to a different region and ask another question: it should capture that new
view, not reuse the earlier screenshot. A successful labels test does not establish
correct chart reasoning, complete-document coverage or exact spreadsheet analysis.

Actual Edge matrix for this implementation session (no browser automation surface
was available; all rows below are **not performed**, not claims of support):

| Target                    | Intended coverage                             | Outstanding check                                 |
| ------------------------- | --------------------------------------------- | ------------------------------------------------- |
| YouTube                   | One current frame/page view; no video summary | Moving content, overlay masks, source freshness   |
| Google / Outlook Calendar | Current visible calendar                      | Labels/occlusions; no automatic scrolling         |
| Drive / OneDrive          | Current file-list/view                        | No automatic file opening or file retrieval       |
| Google Docs / Word web    | Capturable current document region            | Editor policy, unsaved text notice, privacy masks |
| Sheets / Excel web        | Visible cells/chart labels                    | Virtualised grids; no arbitrary arithmetic        |
| Slides / PowerPoint web   | Visible slide                                 | No traversal of the presentation                  |
| HTTPS PDF viewer          | Only if capture and masking are available     | Viewer injection may be blocked; fail honestly    |
| Ordinary HTTP(S) page     | Current view; eligible bounded scroll         | Permissions, zoom/geometry, user takeover         |

`file://`, browser-internal pages and DOM-inaccessible viewers without a verified
masking policy are unavailable. Apart from the user-reported synthetic result above,
independent browser authentication-to-visual-answer checks remain pending. Live
microphone, audible playback, pronunciation, keyboard/reflow and NVDA checks are
also pending.
Subsequent milestones may add user-selected text-PDF parsing, bounded scanned-PDF
rendering/OCR, separately authorised Google/Microsoft file retrieval, exact-range
spreadsheet analysis with deterministic calculations, and authorised calendar/media
retrieval. Screenshot support does not implement any of those capabilities or
guarantee access to YouTube transcripts.

## Structured page reading

Open the floating VSual button on the source tab. This checks structure using any
site permission the browser has already granted, including the configured local
demo host. It does not request new site access. If access is missing, activate
VSual using its **browser toolbar button** on that tab; the status updates
automatically. **Check active page** performs a fresh access/structure check.
An in-page button click does not itself grant `activeTab`. This branch
adds `activeTab` and `scripting`; it does not expand the previous floating UI's site
matches or backend host permissions. Toolbar/command activation injects the reader
into the top-level document and checks structure only. Opening a toolbar/panel,
rechecking structure or loading preferences never
captures source text or calls the model. The existing command remains an explicit
record/finish/cancel/stop toggle; the toolbar button opens without recording.

There is no separate **Allow page processing** step or stored processing grant.
**Ask VSual**, an explicit source-inspection action, or a deliberately started
recording that reaches silence submission authorises that task's processing.
A brief, nonblocking notice explains the data handling: asking sends the question
and captured article text through Avis to the configured model; source inspection
captures locally without calling the model. Orders retain their existing bounded
question/scope interpretation and deterministic calculation path.
Browser site access, supported page structure, authentication and workspace access
remain separate requirements. Granting missing browser access never submits an
existing draft automatically. There is no promise of access until the computer
shuts down: extension sign-in and active-tab following are browser-session state
and can clear on browser restart or extension reload. A subsequent deliberate task
still has no additional processing-approval gate.
Excluding forms does **not** guarantee that rendered prose has no private
information. Our application does not persist content, transcripts or audio;
provider retention follows its own policies and zero retention has not been established.

Supported extraction is deliberately conservative: one identifiable `main`/main
landmark or standalone `article`, containing headings, paragraphs and lists. Main
regions containing multiple articles are rejected. There is no whole-`body` fallback.
Navigation/chrome, forms and input values, editable regions, hidden/script/style
content and VSual's interface are excluded. Tables, frames, canvas, diagrams,
collapsed content and detectable pagination/unloaded content are disclosed as
limitations; the reader does not expand or traverse them. Unrecognised application
internals, closed shadow roots and content not present in the DOM are not read.
Google Docs/Sheets/Slides, Gmail and PDF views can have unsupported structured text.
The visual fallback above is separate and bounded; it does not add their resource
readers or whole-file OCR. Another permission click cannot enable file retrieval.
The snapshot may include text below the viewport and is never described as a
screenshot, full website, full file or proof of all visible content.

**Ask VSual captures the current supported page automatically** when browser access is available;
there is no separate required capture step. The recorded-question silence flow
uses the same capture-on-submit path. **Inspect source (optional, no AI) → Capture
page content** shows the included sections, readable blocks and omissions without
sending them to the model. Asking captures again and validates source
freshness before accepting the answer. For **Explain this section**, choose a
captured section or name a heading explicitly; scrolling and the screen-reader
cursor do not identify a section. The answer identifies its source and model-input
sections separately from the snapshot's coverage. **Supporting excerpts** displays
the exact referenced blocks in the trusted extension frame, outside live regions.

`POST /api/structured-read` reuses the existing authenticated backend, workspace
membership, durable usage reservation, CORS and provider error reporting. Orders
continue using `/api/grounded-read` and their deterministic calculation adapter.
Structured requests never use the orders row schema. Page text is untrusted evidence,
with no tools or action authority. References are checked against the selected
snapshot/section; an answer without supporting references is rejected. Digit-based
numbers in answers must match literal tokens in cited text. This is reference and
literal validation, **not proof that every model paraphrase is semantically correct**.
Users can inspect the source excerpts. Arbitrary calculations are unsupported.

Shared `STRUCTURED_LIMITS` applies ceilings of 20,000 Unicode code points across
source text/metadata, 512 KiB serialized JSON, 6,000 model-input tokens, 600 output
tokens and 1,000 Unicode code points in answer/speech text. A client task and backend
request each have a 45-second deadline; the provider stage has a 35-second timeout.
The existing voice routes retain their own bounded recording/provider limits.
Each submitted question makes at most one model call and one initial automatic TTS
call. Repeat uses cached audio. There are no paid retry loops.

The configured `gpt-6-astra` model's availability and 1,050,000-token context were
confirmed through a read-only Avis model-list request. Its documented 128,000-token
output maximum exceeds this feature's 600-token ceiling. Only that verified model
profile is enabled for structured reading; other models give a lazy setup error.
No provider is called on page load or during builds. Existing `AVIS_API_KEY`,
`AVIS_API_BASE_URL`, `AVIS_AI_MODEL`, Supabase, database/workspace and allowed extension
origin settings are reused; no new secret, database migration or cloud service is needed.

Input budgeting conservatively counts UTF-8 bytes of instructions, question/evidence
JSON and output schema, plus a 1,024-token framing reserve for the verified byte-level
tokenizer family. This is an upper-bound guard, not an exact character/token ratio.
It can reject a page well below the separate extraction ceiling. Select a shorter
section or page after a budget error; nothing is silently truncated to fit the model
and no extra model calls are made. Capture truncation uses whole blocks and reports
partial coverage. Model limits: [official model profile](https://developers.openai.com/api/docs/models/gpt-6-astra);
tokenizer background: [OpenAI tiktoken](https://github.com/openai/tiktoken).

The existing companion controller owns one active content task. The backend retains
per-user quota/idempotency; this is not a new distributed cross-device task scheduler.
Browser access and each captured source remain bound to the relevant browser
tab/window/document/resource; no application processing grants are stored.
Navigation, relevant source mutations, logout, account changes and End invalidate
work and audio. Source changes during recording disarm automatic submission. A
remaining text draft requires deliberate review and revalidation. Page content,
questions and answers are excluded from routine usage logs.

Local acceptance sequence (Node 24 and npm 11):

1. From the repository root run `npm ci --include=dev --include-workspace-root`,
   `npm run dev:web`, and in another terminal `npm run build --workspace=@adc/extension`.
2. Reload/load `apps/extension/dist` at `chrome://extensions` or `edge://extensions`,
   then refresh open tabs. The manifest changes require extension reload.
3. Open `http://127.0.0.1:3000/reading-demo`, a synthetic article with a deliberately
   excluded table. Open the floating button: its structure should be checked using
   the existing local-backend host permission. Sign in; no processing-approval
   button is required.
   On a site without existing access, select the pinned **VSual browser toolbar
   button**; the page status should update without another manual check.
   Opening, checking access and sign-in must not capture source text or ask.
4. Start with Speech OFF. Type “What should the facilitator share before the meeting?”
   and select **Ask VSual**. Check the source label and exact supporting excerpts.
   Inspect the source and confirm that the attendance table's cells are not captured.
5. Ask “How many people attended the morning session?” The table is outside coverage;
   VSual should explain that the captured text does not supply that answer. Select
   “Before the meeting” and ask “Explain this section.” Try a Vietnamese question.
6. Enable Speech and submit once. Text/evidence must appear while audio is preparing.
   Test Stop during preparation/playback and Read again without another TTS call.
7. Record deliberately: continued speech resets the five-second silence timer;
   **Stop and review** preserves manual submission. Change tabs or navigate during
   recording or a pending answer and confirm no obsolete question/answer/audio is used.
8. Repeat using only the keyboard and NVDA, with Speech OFF and ON, a narrow panel
   and 200% text. End/reopen must not replay or submit anything. Sign-out clears work.
9. Open another article on the same origin, switch between its tab and the first
   article, and navigate within the site. After deliberate opening, VSual follows
   the active source without an approval step. An already accepted answer and its
   preparing/playing speech may continue in the original floating frame when only
   the active tab changes. The new tab shows the remote speech status and Stop;
   it must not present the old answer as evidence for the new page. A new Ask,
   recording or Read action stops the old speech. Navigation or relevant changes
   to the original source stop it too. No new page is captured until you ask or
   inspect it. End disables following for that window.
10. Visit an unsupported Docs/Gmail/PDF view: confirm an honest limitation and no
    processing-approval button presented as the solution. Recheck the canonical
    `/orders` comparison and the manual `/voice` setup page.

Automated tests mock providers. **Historical browser checks below predate the
latest removal of processing approval and cross-tab speech continuity.** Those
latest behaviours are covered by mocked lifecycle/UI tests only; no desktop
automation, microphone, audible playback or NVDA check was performed for this
revision. Run `npm run check` for the current complete automated checks and builds.

An earlier isolated Chrome 153 check with the unpacked,
unmodified build exercised the floating Open button, real existing-permission
lookup, scripting injection and capture, with mocked auth/answer HTTP. No standby
injection/capture, a fresh Check active page probe, the then-required approval flow,
draft preservation, Ask without prior source inspection, readable excerpts,
excluded form/table/canvas content, Speech OFF, stale-answer rejection, End and
320px/200% text reflow passed. No toolbar-handler simulation was used in this
follow-up check. Missing browser permission is covered by mocks; physical
toolbar/hotkey granting remains unverified. A native Tab event moved focus, but the
complete keyboard/NVDA journey, physical microphone/permission, pronunciation,
live Google and live model answers remain unrun. A build or model-list lookup does
not verify them. Historical floating checks below refer to the earlier baseline.

A further historical Chrome 153 run verified active-tab following, the earlier
stored-approval behaviour, single-page navigation with Chrome's original-document
message metadata, unsupported-page guidance and End across new and previously
opened tabs. Only the deliberately submitted question captured text: the capture
count stayed at one throughout the navigation checks, with Speech OFF and zero
TTS calls. The latest frame also passed 320px viewport/200% text reflow and a native
Tab focus smoke check. Auth/model/audio HTTP remained mocked. That earlier
`npm run check` passed typechecking, lint, formatting, tests and both builds.
The extension had existing non-failing shared-component `use client`
warnings. A literal scan of that build's 30 browser output files found none of the three
configured private values checked; no values were printed.

## Companion interface

Ordinary HTTP/HTTPS pages now contain a **floating VSual companion**, subject to
browser site access. Its circular logo button has an accessible **Open VSual
companion** name and status description. Insertion does not capture page content,
start the microphone, call an AI provider or move focus. Activate it to open the
companion. Article reading requires browser access and a deliberate task as
described above; unsupported structures remain unavailable.
The floating surface uses a rounded white card, blue logo launcher and pale
section cards, with large text and visible keyboard focus. Its styling is scoped
to the floating document; the side-panel fallback and voice setup page retain
their existing presentation.
The extension toolbar button opens this floating interface on a registered web
page; the existing shortcut retains its record/finish/cancel/stop behaviour.

Choose **Sign in to VSual** inside the companion. Email/password entry, account
state, sign-out and settings remain inside its extension-owned frame. Google uses
Chrome's secure authentication window and returns to the same companion; Google
credentials are never embedded in the page. Existing website and side-panel sign-in
remain fallback journeys. Browser microphone permission/setup may also require
browser UI outside the frame. No recording starts on sign-in.

**Collapse** keeps the same draft, answer, evidence and audio cache and returns to
the launcher when idle. During recording, processing or playback, a compact toolbar
keeps status, **Stop and review**, **Cancel recording** and **Stop speech** available
as appropriate. **End** stops recording, timers, requests and
playback, clears transient content and removes the frame; it does not sign out.
Use the extension button or shortcut to deliberately reopen a fresh companion.
Settings remain behind **Settings**. The frame moves away from focused page
controls and scrolls when the viewport cannot fit the enlarged interface.
After a deliberate Open or browser activation, VSual follows the active tab in
that browser window, preserving expanded/collapsed presentation. Following checks
structure using existing browser access only; it never captures text, records,
submits, starts a new speech request or moves focus automatically. Passive launcher insertion does not
enable following. End disables following for the window until deliberate reopening.
It also collapses earlier companion surfaces in that window; returning to an old
tab does not reopen its expanded interface.
Switching tabs cancels pending questions and stops/disarms recording and its
silence submission. An already accepted, valid answer can retain its current or
preparing speech in the original floating frame. The new tab exposes that remote
speech's status and **Stop speech** without copying its answer/evidence into the
new source. A new Ask, recording or explicit Read action takes over and stops the
old speech. Returning to the original tab does not replay or submit anything.
Navigation, relevant changes to the original source, closing/discarding that tab,
End, logout and account changes stop and clear its work. Closing the owning frame
or reconnecting its worker also ends audio: no background audio host is introduced.
The side-panel fallback retains its stop-and-clear behaviour on tab changes.
Browser-session sign-in is independent of the floating frame's transient content.

The frame is an extension document (`floating.html`), not page DOM or a Chrome
action popup. Only that document holds questions, answers, evidence and audio;
the isolated content script receives layout/focus instructions only. The worker
binds it to the exact source URL, tab, top-level document, frame document and a
fresh bootstrap identifier. Capture/verification always targets that document.
No tokens travel through page messages; no `window.postMessage` bridge is used.
The existing worker still owns authentication and refresh in trusted session
storage. Shadow DOM is used for layout isolation, not as the security boundary.
The host uses a non-modal manual popover in the document's top layer, with a fixed
z-index fallback. This does not cover browser chrome, other applications, restricted
browser pages, the browser's PDF viewer, or every fullscreen/later modal surface.
A page can remove or block an embedded frame. VSual does not repeatedly reinsert
it or compete with later page dialogs. VSual `/auth/*` pages are excluded.

The metadata-only floating content script now matches HTTP/HTTPS pages and exposes
`floating.html`/assets to those pages. Chrome may request broader site access when
loading/updating the extension. No new environment variable is needed. The separate
orders content script and worker still enforce the configured exact origin/port
and `/orders` path before extraction. Our frame is outside the extraction surface.
Rebuild/reload the extension **and refresh already-open tabs** after updating.
The current side panel remains the fallback on restricted/unregistered tabs,
and is available from floating
**Settings → Open side panel**. That switch stops work; drafts/answers are not
transferred between surfaces. Microphone capture stays in the existing
extension-document voice controller. Use **Microphone setup** if permission is
needed; a host Permissions Policy may still require the side-panel fallback.
While mounted, a metadata-only 20-second heartbeat keeps its worker binding alive;
it performs no capture, authentication or provider request. Close stops it.
Unexpected worker reconnection starts a fresh frame without resuming old work;
after failed reconnection or extension reload, refresh the page. Navigation replaces
the frame binding and clears old transient work; it never reuses a previous page's
answer. Source capability and browser access are checked again without a separate
processing-approval step. This is a browser interface, not an always-on-top desktop
application; it cannot follow or read native applications outside the browser.

The generated logo lives at `apps/extension/src/assets/vsual-logo.png`. It was made
with the built-in image generator from this brief: a cobalt-blue circular VSual
mark, bold white V with an integrated speech symbol, transparent corners, no text.

Historical floating-baseline verification used mocked providers in CI. The Chrome 153 unpacked-frame
check additionally exercised native frame/auth-message binding and actual orders
capture/verification with mocked account, answer and audio responses. Collapse,
cached Repeat, Speech OFF, End removal, native toolbar duplicate activation and
fresh reopening, 40-second idle preservation, keyboard Settings/language/Escape
and a 302px frame with text enlarged to twice its default size passed. A further
launcher check passed Enter-to-open, collapse focus restoration and Vietnamese
launcher reflow at twice the default text size. This does not
verify live account access, microphone permission prompts, a physical microphone,
audible pronunciation, NVDA or Edge. Use the manual sequence below for those.
The circular/all-sites/inline-auth update passed a further Chrome 153 check:
80px circular launcher, native top-layer popover without focus stealing, actual
inline form and worker authentication against mocked Auth HTTP, no extra sign-in
tab, empty-field validation, Google-unavailable recovery, native orders capture,
cached Repeat, sign-out and End. A second local origin/port with an ordinary
maximum-z-index overlay stayed below VSual, had page processing blocked, and passed
320px viewport/200% text checks. Real Google login and microphone use remain manual.
That baseline's `npm run check` passed tests, typecheck, lint, formatting and both
production builds. The extension
build retains the existing non-failing shared-component `use client` warnings.
A scan of 27 browser output files found none of the three configured private
values checked; no values were printed.

Floating acceptance on Windows:

1. Start the web app and build/load the extension using the commands below. Open
   `http://127.0.0.1:3000/orders` (or the configured orders origin), then refresh.
   Confirm one small VSual launcher, unchanged page focus and no recording/request.
2. Open VSual, choose Sign in to VSual and enter email/password in the floating form
   (or complete Google's secure window). Read the brief processing notice;
   no extra approval step is required.
   Turn Speech OFF in Settings. Type the canonical July/August comparison and
   choose Ask VSual; inspect the answer and its two evidence rows.
3. Collapse/reopen: draft and answer stay; no request or narration repeats. Enable
   Speech, submit again, then Stop and Read again. Repeat must not call TTS again.
4. Allow/deny microphone permission. Record while compact; pause five seconds,
   then test continued speech resetting the timer. Test Stop and review separately:
   the transcript waits for Ask VSual. Cancel discards it. Speech stops before recording.
5. During recording, transcription, an answer request and TTS, choose End, navigate
   away, or sign out. No late text/audio may return. End keeps sign-in; reopening
   starts with empty transient content; sign-in may remain valid for the browser session.
6. Reopen using the extension button and the assigned shortcut; test a cold worker
   and repeated activation. Check the side-panel/microphone-setup fallback.
7. Repeat with Tab/Shift+Tab, Enter/Space and Escape, then NVDA. Check English and
   Vietnamese, visible focus, no full-answer live-region duplication, a narrow
   viewport, 200% zoom/text and page controls near each corner of the toolbar.
8. Visit another ordinary website: the launcher and sign-in/settings do not capture
   that page. Reading requires browser access and supported article structure.
   Switch tabs during recording or a pending question: it cancels/disarms. Switch
   tabs after an answer is accepted: preparing/playing speech continues, with a
   remote Stop control on the new tab. Stop it there, then repeat and start a new
   Ask or recording; the old speech must stop. Close the original source tab while
   it speaks and confirm playback ends. Return/reopen must not replay old audio.

The extension is the working interface: **Current page → Your question → Ask VSual
→ Answer → View evidence**. The page status distinguishes unsupported pages,
missing browser access and supported structure; account and workspace access remain
separate. Starting **Record question** enables automatic submission after five
seconds of silence following detected sound. Continued speech resets that timer
and stays in the same recording, with one transcription request. **Stop and review**
manually finishes for transcript review instead; **Cancel recording** discards it.
Typed/example questions still require **Ask VSual**. Enter inserts a newline.
**Go to answer** moves focus deliberately; an arriving answer does not.

The countdown is visible but is not spoken every second into the microphone.
The optional recording cue plays after microphone tracks stop. Nothing is submitted
automatically before sound is detected. The existing 30-second cap finishes for
review, and the 3 MiB limit still discards oversized recordings. Silence detection
uses local audio levels, not speaker identification: quiet voices, background
noise and screen-reader audio need device testing. If local audio analysis is
unavailable, use **Stop and review** and **Ask VSual**. Empty/failed transcriptions,
cancellation, account/page changes and missing browser access never auto-submit.
Browser access granted later does not submit a previously held transcript. Only
nonempty silence-finished transcripts may automatically ask once; all existing
authentication, workspace and page checks still apply. This confirmed voice flow
supersedes the earlier requirement to review every recorded question. `/voice`
remains a manual test and never asks the assistant.

**Settings** contains the actual assigned shortcut, optional microphone setup,
interface/recording language and one **Speech on** control. Companion speech uses
a fixed **0.9×** playback rate with no speed selector. Both interfaces
use a light theme with large default text (22.5px body, 25px answers), without
appearance controls. Browser zoom and operating-system forced colours remain
available. **Back to companion** restores focus to Settings without clearing the
question or answer. Website **Language** changes English/Vietnamese without
leaving the current page or restarting sign-in.

Language and speech preferences are local and separate for the website and
extension. English/Vietnamese interface changes do not translate source evidence.
New companion users have speech ON. Saved ON/OFF choices are preserved, including
legacy OFF values: older defaults were saved without recording whether the user
chose them, so they cannot safely be changed to ON. Enable Speech manually if
desired. Preferences load before the companion can ask or speak; if storage is
unavailable, speech stays OFF until explicitly enabled for that visit.
Secondary help is expandable; labels, status messages and evidence remain
available to keyboard and screen-reader users.

The homepage introduces the supported scope; **Get started** opens `/voice` with
practical extension setup and an optional website voice test. There is no published
store-install link or claimed automatic website/extension connection. `/orders`
keeps its synthetic English source table and capture identifiers unchanged.

### Automatic answer speech

After **Ask VSual** or a silence-finished voice question, the validated answer or clarification appears
before audio preparation. It is read once when Speech is ON. The final edited
question determines English/Vietnamese output, with a direct language request
taking precedence and English as the ambiguous-language fallback. The existing
Avis interpretation request resolves `answer_language`; deterministic templates
produce that language without a translation request. UI and recording language
settings do not select the answer language. Source evidence stays unchanged.

**Stop speech** cancels audio preparation/playback immediately and retains the
answer. **Read again** reuses cached audio; **Play answer** does the same when the
browser blocks automatic playback. **Read answer** or **Retry speech** explicitly
generates audio when none is cached. Turning Speech OFF stops audio; turning it
back ON affects future answers and does not read an existing answer automatically.
The setting controls VSual only, not NVDA.

The grounded controller reserves each fresh response once before asynchronous
speech work. Old/restored answers, rerenders and UI-language changes cannot claim
it again. Cancellation, new questions/recordings, logout, context invalidation and
panel disposal prevent late playback. Only the latest answer audio in an owning
companion document is kept in memory. New answers and invalidated source/session
contexts release it; a floating tab switch alone may retain accepted answer speech
in its original document. Remote status/Stop does not transfer audio or evidence to
the newly active page. Nothing is stored in a database or browser preference storage.

`COMPANION_PLAYBACK_RATE` is applied only by the browser player, including Repeat;
pitch is preserved. ElevenLabs receives normal per-request speed `1`, without
changing the shared voice settings. The configured `eleven_flash_v2_5` model reports
English/Vietnamese support. The configured voice is accessible but its verified
language samples do not include Vietnamese: pronunciation still needs a listening
check. Unsupported-language/provider failures preserve text and offer recovery.
No environment variables or paid-plan changes are required.

Deploy the backend and rebuild/reload the extension together: grounded requests
now omit UI `language`, and validated responses include `answer_language` (`en` or
`vi`). Automatic speech defaults here supersede the older reference-document
default; Speech OFF retains the screen-reader journey. `/voice` remains manual.

Historical automatic-voice verification: `npm run check` passed tests, strict
type checking, lint, formatting and both production builds on Node 24.17.0 / npm
11.13.0. Two explicit synthetic Avis requests (English/Vietnamese) passed the new
language contract and deterministic evidence checks. Read-only ElevenLabs model
and configured-voice metadata requests succeeded; no live TTS was generated.
The built browser bundles contained none of the three configured server secrets
checked (values were not printed).

Silence submission is covered by deterministic recorder/clock tests and the actual
React companion harness: resumed sound resets the deadline, final chunks are kept,
only one automatic question is claimed, manual Stop/30-second expiry stay review-
only, and cancellation, page changes or account switches reject late transcripts.
Audio-analysis setup timeout and suspension fall back to manual controls. No live
provider calls were made to test this addition.
That earlier built extension also passed a Chrome check with native Web Audio and
MediaRecorder fed synthetic sound: a three-second pause followed by more sound
reset the countdown; subsequent silence produced one recording upload, one
question and one reply playback. Microphone tracks and audio analysis were
released. Authentication, transcription, answer and playback responses were
controlled test substitutes; this does not verify a real microphone or spoken
recognition. Real quiet/noisy-room and NVDA checks remain pending.

In that historical check, Chrome 153 loaded the actual unpacked extension, service worker and orders content
script in a disposable profile. Controlled authentication/answer/Audio mocks
verified automatic playback, Stop, cached Repeat/autoplay recovery, mute, language
metadata, visible evidence while TTS is pending and no replay after document
reload. Keyboard Settings/language navigation and 320px EN/VI reflow passed;
the real signed-out `/voice` page made no billable request on load. These are not
live authentication or audible-speech checks. NVDA, microphone, docked-panel close/
shortcut behaviour, live authenticated end-to-end use and pronunciation remain
manual; use the sequence below. Mixed/unaccented/explicit-language model decisions
are covered by controlled contract tests and instructions, not a live language
evaluation suite.

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

Limits are per account, across workspaces and website/extension sessions, shared
by transcription, grounded answers and speech using the same database:

| Server mode                           | Rolling 60 seconds | Rolling 24 hours |
| ------------------------------------- | -----------------: | ---------------: |
| Local development (`npm run dev:web`) |        30 requests |   1,000 requests |
| Production or automated test defaults |         6 requests |      30 requests |

Optional **server-only** `VOICE_REQUESTS_PER_MINUTE` (1–600) and
`VOICE_REQUESTS_PER_DAY` (1–10,000) override these values. Put explicit local
overrides in `apps/web/.env.local` and restart the web server. Invalid values fail
closed; zero, fractional and unlimited values are not supported. Builds do not
need these variables. For heavier testing on the stable Vercel Preview, set
`VOICE_REQUESTS_PER_MINUTE=30` and `VOICE_REQUESTS_PER_DAY=1000` in the intended
Preview environment and redeploy. This task does not change Vercel settings.
`npm run start` serves production mode, so use explicit overrides if testing that
mode locally. No browser/extension setting can override the backend limits.

A full recorded question and spoken answer normally reserves **three requests**:
one transcription, one answer and one speech generation. Typed questions skip
transcription; Speech OFF skips automatic speech generation; cached Repeat costs
no additional request. These are application attempts, not a provider credit or
currency counter. Raising them does not add ElevenLabs/Avis credits or change
provider throttling, and more successful calls can consume more provider credits.

Duplicate request IDs are rejected. Failed or cancelled calls after a usage slot
has been reserved still count; rejected authentication/input/configuration and
already-limited requests do not reserve another slot. The counter does not reset
at midnight, sign-out, browser reload or server restart. Each entry ages out of its
rolling window. Old metadata is pruned on the next successful reservation. This
is a durable limit across Vercel instances, not an in-memory counter.

An application 429 now uses `APP_RATE_LIMITED` and returns validated counts,
configured thresholds, the limiting window(s), an estimated earliest retry time,
and `Retry-After`. The retry calculation covers both windows and enough expiring
entries to recover even if a limit was lowered below existing usage. The UI shows
which step was blocked, the count snapshot, the retry date/time in the device's
time zone and how counting works. It does not retry automatically; other activity
on the same account can change availability. Detailed counts are readable outside
the brief live status announcement.

`PROVIDER_RATE_LIMITED` means the speech provider or answer provider throttled the
request; no exact reset time or remaining provider allowance is invented.
`QUOTA_EXHAUSTED` reports the provider's credit/spending limitation. Legacy
`RATE_LIMITED` responses honestly say that the source was not identified. A text
answer remains available when only its speech step fails. Server rate-limit logs
contain bounded operational metadata, never transcripts, audio or credentials.
Backend and extension must be updated together for these precise error details.
The limit notices were checked in the actual unpacked Chrome 153 extension with
mocked authentication/API responses and real orders-page capture: correct counts
and retry time, preserved answer/evidence after a speech limit, EN/VI details
outside live regions, and no horizontal overflow at 320 px with 200% text.
Those checks made no provider requests; live limits and NVDA remain manual checks.
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
   the floating companion on ordinary permitted web pages. Choose **Sign in to
   VSual** and complete its inline form; Google uses its secure browser window.
   The side panel remains a fallback on restricted pages. Account identity and
   workspace access are reported separately. No token copying or automatic recording occurs.
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
reads the orders table only with browser access and a capture/Ask action or a
deliberately started question recording that finishes after silence.
There is no offscreen document or background microphone.
Reload the extension and reopen the panel after any build/configuration change.

If page reading is unavailable, check **Current page**. Missing browser access
requires the VSual browser toolbar button on that tab; **Check active page**
rechecks access and structure without capturing. Unsupported structure needs a
supported source, not a processing-approval click. For synthetic orders, use the
exact configured origin and `/orders` path: the local example is
`http://127.0.0.1:3000/orders`; `localhost`, `/voice` and the home page do not match
that orders address. Structured article reading has its separate bounded support
described above. After reloading the extension, refresh open source pages too.

## Accessible sign-in

The floating companion's **Sign in to VSual** opens email/password controls in the
extension frame. Its five-minute attempt is bound to that frame's browser-supplied
tab/frame/document identity and epoch. Only the worker calls Supabase and owns
tokens/refresh. Cancel, End and navigation invalidate pending results; closing an
unrelated page cannot cancel another frame's sign-in. Completed sessions survive
closing the companion. Google uses the same worker PKCE owner and a secure browser
identity window. No new callback or environment variable is required.

For the preserved side-panel fallback, **Sign in on the VSual website** opens a
`/auth/sign-in` page with labelled email/password fields, password managers,
paste, Show password, English/Vietnamese feedback, Cancel and Google when enabled.
It displays the account being connected. A website account is shown separately;
it is never silently imported into the extension. Use **Sign out and change
account** to replace an extension account. Authentication does not grant workspace
membership: a signed-in user without access receives an explicit explanation.

For that website fallback, the worker creates a five-minute attempt and owns the new tab. The page obtains
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
restart, extension reload/update or disabling it may clear sign-in and tab following.
Questions, evidence and audio remain transient data in their owning companion
document; accepted answer audio may continue across tab switches only as described
above. There is no stored processing-approval grant. Only non-sensitive
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

Historical accessible-auth baseline verification on Node 24.17.0 / npm 11.13.0:
clean `npm ci` and `npm run check` passed tests, typecheck, lint, formatting and both builds.
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
   reopen the panel and ask again without a processing-approval step. Closing
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
   data, drafts, pending work or evidence from A remains. Signed-out requests must fail
   before Avis/ElevenLabs. Confirm website logout scope stays independent.
7. Repeat with keyboard only and NVDA on Windows: Tab/Shift+Tab, Enter/Space,
   Escape, Show password, password-manager fill/paste, EN/VI errors, visible focus,
   200–400% zoom and a narrow panel. No spoken password or app speech is required.

## Ask about captured orders

1. Sign into the extension and open the configured `/orders` page. Choose the
   interface language independently from the recording language.
2. Check that browser access and the orders source are available. The brief notice
   explains processing; there is no separate Allow step. Opening VSual alone does
   not capture anything. End clears captured content without signing out.
3. Enter **“Compare completed orders in the South for August and July.”** or
   **“So sánh số đơn hoàn thành ở miền Nam tháng 8 với tháng 7 năm 2026.”**
   For hands-free submission after activation, choose **Record question**, speak,
   then pause for five seconds. To review instead, select **Stop and review** before
   the countdown ends and then **Ask VSual** when ready.
4. Expect a decrease of **300 orders (25%)**, from July 1,200 to August 900 in 2026.
   **View evidence** shows both original values, row identifiers and the calculation.
5. Expand **Inspect the source table without AI**. **Capture source table** also
   works when Avis is unavailable. **Return to page** attempts to restore the
   original usable focus target, otherwise the supported page heading.
6. With **Speech on** in **Settings**, each new answer reads automatically.
   Use **Stop speech** while preparing/playing, then **Read again** when audio is
   available. Read again uses the same audio at 0.9×. Evidence expands
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

Use Chrome or Edge on Windows with NVDA running. Check the actual Speech state;
new preferences default ON and a saved OFF remains OFF.
These steps exercise the installed extension; a web preview does not verify its
permissions, activation or messaging. Configure an existing account and the local
or deployed backend as above.

1. Open the extension from its toolbar, find the actual shortcut in **Settings**,
   return to the companion, then try that shortcut. Confirm browser-scoped
   activation, predictable focus and reachable recording cancellation.
2. Identify account/workspace status and **Current page**. If signed out, complete
   the floating sign-in using Tab, Shift+Tab, Enter/Space and a password manager or
   Google's secure window. Verify the correct account and separate
   workspace access. Open the supported `/orders` page and review the processing
   notice; opening/checking the source must not capture/upload anything. There is
   no processing-approval control to find.
3. Enter the canonical comparison below using only the keyboard. Enter adds a
   newline; **Ask VSual** submits once. The microphone can remain denied or unused.
4. Hear the brief result status without losing focus. Use **Go to answer**, then
   **View evidence**. Read both source rows, the calculation and capture time.
   **Close evidence** returns focus to its disclosure.
5. With Speech ON, submit an English and a Vietnamese question, independently of
   UI language. The answer should display immediately and play once at 0.9×.
   Stop during preparation and playback; the answer/evidence must remain.
   **Read again** must send no new synthesis request. If autoplay is blocked,
   **Play answer** must reuse the generated audio directly from that interaction.
6. Select **Ask another question**. Confirm focus returns to the editable question
   and another Ask or deliberate recording is needed. Do not expect conversation memory.
7. Choose **Record question**, speak part of a question, pause for less than five
   seconds, then continue. Confirm the countdown resets, all speech stays in one
   recording, and five seconds of silence sends one complete transcript and asks
   once. During a second recording select **Stop and review**: this must leave the
   transcript for manual review and Ask. **Cancel recording** discards without
   upload. Test initial silence, the 30-second cap, soft speech and background
   noise. Cancel during transcription, sign out or change source tabs; late
   transcripts must never ask. Missing browser access must hold the text for review.
8. Deny microphone permission or disconnect the network. Retain the typed question,
   hear a useful error and retry deliberately. Cancel pending work and sign out
   during a request; late text, answers or audio must not return.
9. Change EN/VI language and speech preferences. Return from **Settings** and
   verify draft/answer preservation and visible focus on its trigger. Check a narrow
   panel, 200% browser zoom, long labels and Windows contrast themes. On the website,
   repeat using **Language** while email is entered; sign-in must not
   restart. Read the English orders source unchanged in the Vietnamese interface.
10. Navigate the source page: earlier evidence and speech must be invalidated.
    Separately, switch tabs after accepting an answer: the floating companion's
    preparing/playing speech may continue from its original frame; the new tab
    must identify remote speech and offer Stop without showing old evidence as
    current. Start a new Ask or recording to stop old speech. Pending questions and
    recording must cancel/disarm on a tab switch. No new page content is transmitted
    automatically. Return to the source without replay, then ask deliberately.

Also turn Speech OFF and complete the full typed/NVDA journey. The answer remains
normal readable text; our polite status regions must not announce its full text
again. OFF then ON must not speak an old answer. Close/reopen the panel and confirm
no old audio resumes. Check an edited transcript that changes languages, unaccented
Vietnamese, mixed language, an English question containing a Vietnamese name, and
explicit requests such as “Answer in English” / “Trả lời bằng tiếng Việt”.

Focused automated coverage includes settings focus/persistence, retained drafts,
unchanged captured source evidence across language changes, manual and silence-
finished transcript submission and existing cancellation/authentication boundaries. Local
historical rendered checks in Chrome 153 covered the fixed light palette (including a dark
system preference), large default text, 320/1280-CSS-pixel layouts, Vietnamese,
200% text with spacing overrides, and emulated forced colours.
During that earlier check, the actual unpacked extension and service worker were loaded in a disposable
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
      initial focus, sign-in, first Ask without extra processing approval,
      browser-access denial/recovery and unsupported-page refusal.
- [ ] English and Vietnamese questions: both cited rows, period direction, capture
      time, Go to answer, evidence disclosure/Close evidence and Return to page focus.
- [ ] In browser DevTools, change the displayed August cell from `900` to `1,050`.
      Old evidence must become stale; a fresh Ask must show a decrease of **150
      (12.5%)**. Changing the rendered DOM this way is also covered by automated tests.
- [ ] During a request, Cancel, change tab, navigate, edit the relevant table or
      sign out. Late responses must not appear; no automatic provider retry occurs.
- [ ] Deny browser site access: no capture/upload. Missing Avis configuration: honest
      setup error, question preserved, source inspection still available.
- [ ] Keyboard-only and NVDA: labels, brief announcements, no unexpected focus move
      on answer arrival, semantic evidence, 200–400% zoom and narrow-panel reflow.
- [ ] Reviewed STT populates a question without submitting. New answers speak once
      when Speech is ON; Stop is immediate, Read again adds no TTS calls, and TTS
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
That earlier verification also passed automated tests, type checking, lint,
formatting and both production builds. Run `npm run check` to verify the current
checkout. No deployment is performed as part of this feature implementation.

Earlier voice verification recorded one successful synthetic English STT provider
check and a restricted TLS/RLS database read check. That earlier live TTS check
failed with **HTTP 402 `payment_required`** for the then-configured Voice Library
voice. Current read-only metadata checks confirm the configured premade voice is
accessible, but do not establish successful synthesis. Authenticated reservations, audible playback,
microphone permissions, Vietnamese/mixed-language pronunciation and deployed voice
acceptance remain unverified here. The current implementation uses one configured
voice; per-language selection and cloning are deferred.

## Code boundaries

- `apps/web`: `/orders`, `/voice`, the single backend, existing Auth/database access,
  and `/api/grounded-read`. `utils/grounded` separates model interpretation, scope
  checks, deterministic math and HTTP validation. Existing `/api/voice/*` routes
  provide recorded transcription and optional speech.
- `apps/extension`: the floating extension frame and side-panel fallback reuse the
  same companion/voice controllers. The orders content script reads only the
  supported page through trusted extension messages. The worker binds floating
  requests to their source document and retains authentication/command ownership.
  Tokens never enter the target page or content script.
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

`GroundedPanel` submits typed/reviewed `VoiceController` text through an explicit
Ask, or claims a silence-finished recording once through the existing automatic
submission path. Its answer controller sends only validated answer text through the existing
`/api/voice/speak` transport. This is the bounded integration point for later
reasoning work. Model/page content never grants action authority.

Review this work on `feat/visual-page-read`, based on updated `dev` at structured-page-read
merge `60d0b13` (PR #13), which includes floating companion and automatic voice replies. Merge a reviewed feature before starting a separate follow-up branch
for broader scope or pending acceptance. When committing a completed feature,
split changes into focused commits with concise messages that explain their purpose
to technical and non-technical readers. Keep related tests with their implementation.
Use this approach for subsequent feature branches as well.
No automatic commit, push, merge or deployment is part of these scripts.
