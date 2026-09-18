---
type: Reference
created: 2026-09-18
updated: 2026-09-18
tags: [prototype, build, engineering, feasibility, canonical-surface]
alias: [build-reference]
version: 1.0
description: A self-contained engineering reference for the voice-driven browser accessibility agent — how buildable it is in the hackathon window, the tools, the architecture, the form factor, the demo shape, and the honest risks. Reference only, not a specification.
project: adc-hackathon-2026
---

# ADC 2026 Prototype Build Reference

## Reader's Note

This file is a reference, not a set of instructions. It is one input into how the prototype gets built, gathered before the event to show that the concept is buildable and to name the parts and the traps. It is not a specification and it does not bind any implementation choice.

If you are the engineer, or an agent working for the engineer, treat everything here as a starting signal. Own the implementation yourself. Discover the current state of the tools firsthand, verify every claim against what you actually see when you build, and make the calls that fit your stack and your time. Where this file recommends a path, that is a considered opinion to weigh, not a rule to follow. The concept and its trust model are in `core-baseline-context.md`. This file is how you might bring them to life.

---

## 1. The Verdict

The prototype is buildable and genuinely demoable inside the three-day window by one capable builder who is strong with AI-assisted coding and comfortable wiring APIs and open-source libraries. It needs no novel machine learning and no research-grade work in the core loop. You assemble it from mature, commodity parts.

No single open-source project does the whole thing the way the concept needs it, which is accessibility-tree-first perception, vision only as a named fallback, and action gated by whether it can be undone. But the gap to assemble that from parts is small, because every layer has a well-maintained pick that installs and wires in a day or less, and the overall pattern of read-the-structure, fall-back-to-vision, act-with-confirmation is what browser-automation tools already ship in 2026.

## 2. The Build Shape

The entire product is one loop. Hold a key, speak, transcribe the speech, read the page, decide what to do, read the action back, confirm, act, then report the outcome and speak it. Each stage is a service you wire in rather than build.

| Stage | The role it plays |
|---|---|
| Push-to-talk capture | A held hotkey opens the microphone, release ends the turn |
| Speech to text | The spoken request becomes text |
| Perceive the page | Read the real structure and data first, fall back to a screenshot only when there is no structure |
| Decide | A small model call turns the request plus the page state into a plan |
| Read back and confirm | For anything that cannot be easily undone, state the exact pending action and wait for yes |
| Act | Perform the real action on the page |
| Report | State the outcome from the page's new state, then speak it |

The two model calls in the middle stay small and schema-constrained so they return fast, which is what keeps the whole interaction feeling like a walkie-talkie rather than a wait.

## 3. The Two Perception Channels

This is where the product earns its difference from a screenshot describer, so it is worth the most care.

**The ground-truth channel, preferred.** Read the page's own structure and data. Three layers, tried in order. First the accessibility tree, which covers text, forms, navigation, labeled controls, and real tables. Second the charting library's own internal data, reached by running code in the page to pull the numbers straight out of Highcharts, Plotly, Chart.js, or D3. Third the network responses the page already fetched, cached as the page loads, so the true figures behind a chart are in hand independent of how the chart draws. When any of these return real data, the answer is exact and checkable rather than a guess.

**The vision fallback, only when it must.** When the content is drawn as pixels with no structure behind it, a canvas chart, an image, or shared-screen content, the structured read returns nothing, so the agent takes a screenshot of that region and sends it to a vision model to interpret.

The single highest-leverage piece of engineering in the whole system is the charting-library data extraction. When it works, chart question-answering becomes an exact table lookup instead of a visual estimate, and that is precisely the thing the incumbent does not do. It is a documented, well-trodden technique, well inside reach, and it deserves real preparation time against whatever dashboard the demo uses.

## 4. The Tooling Picks

Each layer has a lead pick and credible alternatives. These reflect the landscape as of September 2026 and should be re-checked at build time.

| Layer | Lead pick | Alternatives and notes |
|---|---|---|
| Browser read and action | Playwright, for its accessibility-tree snapshot and element actions | browser-use or Stagehand for messier pages. Avoid AGPL-licensed tools for a closed demo |
| Speech to text | Groq Whisper, for a fast round trip and a generous free tier | Deepgram or AssemblyAI for true low-latency streaming. whisper.cpp locally as an offline fallback |
| Vision for charts | A frontier vision model with a structured-output prompt | Self-hosting a chart-to-table model is not worth the time for three days |
| Text to speech | OpenAI text-to-speech, simplest and cheapest | ElevenLabs Flash for the most natural voice. A local voice as a network-outage fallback |
| Orchestration | A thin hand-rolled loop | Borrow the shape of a ready-made human-in-the-loop approval primitive rather than adopting a whole framework. Native computer-use APIs exist but are slower and less reliable than a scoped loop for a demo |

The one capability with no off-the-shelf library is the reversibility check that decides whether an action needs confirmation. That is a short rules table or a single model call. It is small in code and it is the load-bearing differentiator, so build it explicitly.

## 5. Form Factor

The strongest demo container is a **Chrome or Edge browser extension, loaded unpacked in developer mode**. It reads a real, logged-in dashboard's structure directly through a content script, it looks the most credible because it runs on an actual page rather than a re-hosted copy, it needs no store review, and it avoids a real restriction in current Chrome that blocks external tools from driving the user's normal browser. The chart-data extraction technique ports directly into the content script.

The considered alternative is a **desktop app driving a browser through Playwright**. It gives a cleaner ready-made accessibility-tree and action API and a true system-wide hotkey, and it suits a dedicated demo browser well. It is weaker for reading the user's own real browser tab, which needs extra plumbing, and it reads as slightly less like "it sees my actual screen." For a hackathon demo on a dashboard the team controls, the extension is the lower-risk, higher-credibility path.

A plain web page cannot read another site's content at all, and a native mobile app is the wrong shape for a browser agent and carries a microphone that is unreliable in the current simulator. Neither fits.

For the trigger, a browser-scoped hotkey is enough because the demo already has the browser in focus. For the vision fallback screenshot, the silent tab-capture path avoids a picker dialog interrupting the flow, so reserve it for the cases where the structured read comes back empty.

## 6. What Is Demoable, And The Distribution Reality

A shipped mobile app is not possible in this window and is not needed. Apple's enrollment and identity checks alone run one to two weeks before review even begins, which is longer than the whole hackathon. The same logic makes a public store listing irrelevant for any container.

The demo runs locally. A Chrome extension loads unpacked from a folder, instantly, with no review, which is normal hackathon practice and reads as finished rather than unpolished. A desktop build runs directly on the machine that built it with no signing or notarization, because those are only needed to hand a build to other people's machines. The deliverable is the source folder plus the deck and the video, never a store link.

## 7. The Hero Demo

One clean sequence carries the whole pitch. A blind analyst is working with a screen reader and reaches a sales chart the reader cannot read.

1. **The gap, shown first.** The screen reader hits the chart and produces nothing useful, silence or a flat "image." This is established before the agent speaks, so the contrast is earned.
2. **Perceive.** The analyst holds the key and asks for the top region and the trend. The agent reads the real data behind the chart and speaks a structural answer, for example that one region leads and is up on the quarter.
3. **Ask.** The analyst holds the key again and asks to filter to that region only.
4. **Confirm first.** The agent reads back the exact pending change, reconstructed from the real control it is about to operate, and waits for a clear yes.
5. **Act and close the loop.** The dashboard visibly updates as the agent speaks, and it reports a new number that only exists after the filter, which proves it re-read the real page rather than reciting a script.

Three beats make judges believe it. The screen reader failing before the agent speaks, the pause to read back and confirm which a screenshot describer has no equivalent for, and the final answer citing a number that could only come from the page's new state. Record a clean take of this against the real working build as soon as the loop works once, so live latency or network trouble cannot sink the live run.

## 8. The Trust Layer, In Code

The trust model in the concept baseline maps onto concrete, small mechanics.

The confirmation read-back is built from the real pending action, not from the model's own words. Resolve the intended action to a concrete page element first, then compose the read-back from that element's real role, name, and value plus the verb. This is a design discipline to hold from the start rather than a hard technical problem, and it is the mechanic that most separates the product from a describer.

Reversibility, not importance, decides when to gate. Reads, navigation, and filters run directly. Anything that cannot be easily undone, a submit, a send, a delete, a purchase, is read back and waits for yes. Sensitive fields, passwords, card numbers, and bank details, never autofill and stay manual by rule. Every action reports its outcome, and a stop reports what already happened.

## 9. The Hard Parts And Honest Risks

Three things are genuinely hard or easy to overclaim, and all three matter for how the concept is positioned as much as for how it is built.

**Reading arbitrary charts by vision is unsolved.** Vision-only chart reading degrades badly on complex or unlabeled charts, even for the best models. The structured channel solves this exactly for charts built on a known library, which is why the demo dashboard should be one the team prepares and verifies in advance. In the deck, be clear about which answers are verified ground truth and which are best-effort visual estimates. That honesty is a stronger position than a claim that breaks under a judge's own chart.

**Latency comes from the model calls, not the voice.** Speech to text and text to speech are both fast by design. The risk is two unconstrained model calls plus a slow full-page read turning a quick exchange into a multi-second wait. Keep the calls small and schema-locked, read only the region in question, and stream the spoken answer sentence by sentence from the first tokens.

**Screen-reader coexistence should not be overclaimed.** Cleanly lowering a screen reader's audio while the agent speaks is an open problem the screen-reader makers themselves have not fixed at the operating-system layer. Position the product honestly as summoned on demand and never talking over the reader by design, name the audio-layer gap as a known industry problem, and do not claim it is solved. Judges in this field will know the difference.

## 10. The Parts List

| Component | Priority |
|---|---|
| Held-hotkey push-to-talk trigger | Must have |
| Microphone capture, streamed | Must have |
| Streaming speech to text | Must have |
| Browser read through the accessibility tree | Must have |
| Charting-library data extraction | Must have, the core differentiator |
| Vision fallback on a screenshot | Must have, for one deliberate case |
| The router that picks structured versus vision | Must have |
| Request-parsing model call | Must have |
| Decision model call | Must have |
| Reversibility rules table | Must have, the safety story |
| Read-back built from the real pending element | Must have, the trust differentiator |
| Sensitive-field blocklist | Must have |
| Outcome reporting from the page's new state | Must have |
| Streaming text to speech | Must have |
| A prepared, verified demo dashboard | Must have, highest-leverage prep |
| One deliberately unlabeled visual for the fallback | Must have |
| Network-response capture as a second ground-truth source | Nice to have |
| Operating-system audio ducking under a screen reader | Out of scope, unsolved upstream |
| General navigation across arbitrary sites | Out of scope for the demo, roadmap |
| A shipped mobile or store-listed app | Out of scope, ruled out by review timelines |

## Prior Art Worth Reading

A cluster of accessibility-agent projects from earlier 2026 hackathons is worth reading for architecture rather than cloning, since none combine accessibility-tree-first grounding, push-to-talk only, confirm-before-irreversible-action, and true chart-data reading. Names to look up include Sally, X-Ray, and Spectra, alongside the mainstream browser-automation projects Playwright, browser-use, and Stagehand. Wispr Flow is the closest existing product for the interaction shape, a menu-bar desktop app with a native hotkey helper. The product here copies its hold-to-talk trigger and adds screen reading, action, and confirmation on top.
