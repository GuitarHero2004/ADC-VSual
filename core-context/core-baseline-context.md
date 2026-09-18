---
type: Reference
created: 2026-09-18
updated: 2026-09-18
tags: [core-context, baseline, research, canonical-surface]
alias: [baseline-context]
version: 1.0
description: Consolidated team baseline — background research, landscape, market, the fundamental problem, Vietnamese evidence and named cases, and the current open-ended product idea; the shared context every downstream lane starts from.
project: adc-hackathon-2026
---

# ADC 2026 Core Baseline Context

**Purpose.** This is the shared baseline for the team. It holds the background research, the landscape, the market, the fundamental problem, the Vietnamese evidence, and the idea in its current open-ended form. Every downstream lane, go-to-market, product, prototype, and pitch, starts from this document so we all reason from the same facts. It is deliberately light on implementation, because we have not settled that yet. The numbers and cases here are also the raw material for the presentation deck.

**Status.** Living baseline as of 18 September 2026. The idea is committed in direction, open in shape. Sources and evidence grades are in the appendices.

---

## 1. Executive Summary

Blind and low-vision people can do knowledge work, but the modern workplace is built out of visual, interactive, on-screen content that their tools cannot reach. Screen readers were built for linear text. Charts, dashboards, spreadsheets with visual structure, slide decks, PDFs, web apps, and the buttons and layouts of everyday business software are either silent, scrambled, or unusable through them. The result is measurable. Blind users read on-screen data about 61% less accurately and spend about 211% more time than sighted peers, and the single most common workaround is not a tool at all, it is asking a sighted colleague for help.

The deepest part of the problem is not a missing label. It is two things that no shipped product solves well. The first is structural and relational understanding, knowing what a sort did to the totals, what a chart's trend is, how a dashboard's filters connect. The second is trust, because a blind user cannot visually check whether the AI describing their screen got it right, and the strongest 2026 research shows they often cannot catch the error even when they read the model's own reasoning.

There is a clear incumbent, Be My Eyes, which launched a workplace product in February 2026 at 55 to 90 US dollars per seat. It describes on-screen content from a screenshot. That is useful, but it is a one-shot black box the user cannot interrogate or verify, and the vendor itself says it is not a screen reader and must not be the sole basis for a decision. Everything else in the market either only works if the content's author prepared it correctly in advance, or degrades badly on arbitrary content. Nobody delivers automatic, structural, and verifiable access to whatever a worker is simply handed.

Our idea, in its current form, is a voice-driven browser accessibility agent. A blind person talks to it the way a person talks to an AI assistant today, and it perceives the page, reads and explains the parts that screen readers fail on, navigates and interacts on request, and acts on the user's behalf only after confirming what it is about to do. Where it can read the true underlying data or page structure it does, so its answers are accurate and checkable, and it falls back to visual interpretation only when it must. Charts and dashboards are the sharpest demonstration of this, not the boundary of it.

Vietnam gives the idea a real home. Around two million Vietnamese are blind or low-vision, vision is the least-employed disability group in the country, and the evidence of blind Vietnamese people fighting inaccessible workplace software is now documented and named, including a blind Vietnamese student who already uses AI by hand to convert charts she cannot read into text. The competition host, RMIT Vietnam, runs its own blind-user accessibility co-design work, which makes it a credible showcase.

Two strategic tensions are still open and belong to the downstream lanes. The first is the moat, because a voice agent that operates a browser is exactly the direction the largest AI labs are moving, so we have to be clear about what we do that they will not do well. The second is trust and safety, because an agent that acts, rather than only describes, raises the stakes of a wrong action for someone who cannot see the result.

---

## 2. The Competition and Our Territory

ADC 2026 is the RMIT Accessibility Design Competition, a three-day in-person hackathon at RMIT Saigon South from 21 to 23 September 2026. A team of three builds an AI-powered solution that improves workplace inclusion for people with disability, across four disability categories. The preliminary pitch deck and a sub-five-minute video are due by 7:00 AM on day three. The competition has run annually since 2020 and sits inside RMIT Vietnam's broader disability-inclusion work, so it is an established track, not a one-off.

We chose the visual-impairment category and a workplace-inclusion frame. Within that we committed to helping blind and low-vision knowledge workers reach the visual and interactive work content that is inaccessible to them today. That decision came out of a scored idea pool. Reading and operating visual work artifacts was the broadest and most everyday problem, and it carries the strongest severity evidence, which is why it became the territory.

One caveat holds across everything below. The full competition brief lands on day one and may narrow the theme into a specific challenge statement. Our concept is built to flex against that, and the early framing should be treated as a strong hypothesis to confirm against the day-one brief, not a fixed spec.

---

## 3. The Fundamental Problem

Blind and low-vision people are capable knowledge workers who are locked out by the format of the work, not the substance of it. The mechanism is well understood and has been documented consistently across independent research groups for two decades.

**Screen readers are built for linear text, and the workplace is not linear text.** A screen reader turns the screen into a one-dimensional stream of words. A spreadsheet grid, a chart, a slide layout, a dashboard, and most custom web-app interfaces are two-dimensional and visual by nature. Content that is drawn as pixels, which is most charts and many dashboard widgets, exposes nothing to the accessibility layer a screen reader depends on, so it is simply absent. This is an architectural mismatch, not a bug waiting for a patch.

**The cost is measured, not anecdotal.** In controlled studies, screen-reader users extracted information from on-screen data visualizations about 61% less accurately and spent about 211% more time than sighted users, and about a third of visualizations were entirely undiscoverable to them (Fan et al., 2021, cross-cited across multiple peer-reviewed papers). In a study of sixteen blind Excel users, fifteen could not meaningfully read a line chart at all, even with optical character recognition (ASSETS 2023). Spreadsheets are not a niche, they are the workday, with 91.6% of employed blind and low-vision people using spreadsheet software at work, and it is the single highest unmet training need they report (NRTC 2024).

**The most common workaround is another person.** Across the workforce, 70.6% of screen-reader users facing inaccessible software rely on a sighted coworker to help (NRTC). That is the true baseline our idea competes against, and it is a dependency that costs time, privacy, and dignity, and it is not always available.

**The barrier runs across the whole workday, not just data.** Documents compound it. Three-quarters of screen-reader users say PDFs are likely to pose significant problems (WebAIM), and scanned or untagged files, the tax forms, contracts, and reports that arrive every day, read as silence or scrambled text. Live meetings compound it again. A shared screen reaches other participants as video, which is inaccessible by design in Zoom, Teams, and Meet, so a blind employee sitting in a screen-share presentation is locked out of the exact content under discussion, and slide decks expose only a flat reading order that loses the two-dimensional layout. The problem is not one artifact. It is the spreadsheet, the chart, the dashboard, the PDF, the deck, the shared screen, and the unlabeled web app, across the entire working day.

**The deep failure is structure and trust, not missing labels.** Two findings reframe the whole problem. First, the hard part is relational and structural comprehension. A blind user needs to know what a sort did to the rest of the sheet, whether a column hides merged cells, what a chart's trend and outliers are, how a dashboard's filters interact. Flat description does not deliver this. Second, and most important for our design, trust is unsolved. A 2026 study of blind users adopting AI assistants found they could not detect incorrect data points or chart-rendering errors even when reviewing the model's own reasoning, and that verification for them is a different and more layered process than it is for sighted users, not just a slower one. A confidently wrong answer that the user cannot check is worse than no answer, because it carries false confidence into a real decision.

**The barrier persists by default.** Most inaccessible workplace software is off-the-shelf, not custom, so every employer buying the same mainstream tools inherits the same gap, and 57.5% of screen-reader users say their employer requires software that is inaccessible to their screen reader (NRTC). The fix has never depended on the reader's own assistive-technology budget. It depends on content and software the reader does not control.

---

## 4. The Global Landscape and Competitors

The market is real, active, and incomplete. Understanding exactly where each player stops is what defines our opening.

**Be My Eyes is the incumbent to beat.** Its Workplace product launched on 11 February 2026 at 55 to 90 US dollars per seat, and it does keystroke-triggered description of on-screen content, including charts, dashboards, PDFs, and slides. It works by capturing a screenshot and describing it. That is genuinely useful and it validated both the product category and the price point. But it is a one-shot description a user cannot query relationally or verify, it treats the screen as an undifferentiated image rather than structured data, and the vendor states plainly that it is not a screen reader and that its output must not be the sole basis for any decision that affects someone's employment or rights.

**The big platforms cover pieces, not the whole.** Microsoft offers author-triggered alt text and Copilot in Excel, but Copilot generates new summaries and charts on request rather than explaining a chart someone else handed you, and several of its richer features are gated to specific hardware. Google's Android screen reader can now describe and answer questions about a whole screen with Gemini, which is the closest free analog to on-screen description, but it is mobile-only. Apple's chart accessibility is strong but only for charts an app author specifically built for it. None of these targets the arbitrary, host-agnostic case of a worker handed content they did not create.

**Specialist assistive-tech tools all require preparation or degrade on arbitrary input.** Every dedicated chart and data accessibility tool falls into one of three buckets. Some work only if the chart's author used a specific library or added metadata in advance. Some work only for a fixed list of charting frameworks. And the only bucket that can take a chart the worker did not create, image-and-OCR interpretation, is documented as materially less accurate, with chart-image extraction accuracy around 77% before summarization even runs. No shipped product or research prototype delivers automatic, zero-setup, structural, and verifiable access to an arbitrary chart, spreadsheet, dashboard, or PDF.

**The frontier labs are the real long-term force.** General browser and computer-use agents from OpenAI, Anthropic, and Google are advancing quickly, and a voice-driven agent that operates a browser is a natural application of that capability. This is the strategic backdrop for our idea. It means the raw wow of "an AI that browses for you by voice" is achievable and impressive, but it is also a direction the largest players are heading, so our defensible edge has to be the things they are unlikely to do well for this specific user, which are trustworthy structured reads and safe, confirmation-first action designed around a blind person's verification needs.

**The gap widens in collaboration tools.** Peer-reviewed surveys rank project-management tools and digital whiteboards among the least accessible software of all, described as cluttered and offering little non-visual interaction, and no vendor targets a live whiteboard's spatial layout or a shared screen's real-time content. The tools where modern teamwork actually happens carry the least accessible-path coverage, which means the exclusion is sharpest exactly where collaboration is densest.

**The white space, stated plainly.** No one delivers access to arbitrary interactive visual content that is at once automatic, so it needs no author setup, structural, so it conveys relationships and not just surface description, and verifiable, so a blind user can trust it enough to act on it. That is the gap.

---

## 5. The Market and the Buyer

**The category is unsized, which is both a risk and an opening.** The nearest measured markets bracket ours without naming it. Digital-accessibility compliance software, the market of website-testing tools, is roughly 0.7 to 1.6 billion US dollars. The broad assistive-technology market, dominated by hardware like hearing and mobility aids, is roughly 31 to 58 billion. Employee-facing AI accessibility tooling for blind workers sits between them and is not separately tracked by any analyst. There is no clean category yet, which means no obvious budget line, and also no entrenched category owner.

**The buyer is a committee, and the money is an accommodation.** In practice, spend is shared across a reasonable-accommodation coordinator, IT, which handles procurement and security vetting, legal, which owns litigation exposure, and the employee's own manager. For a per-employee accommodation the motion is bottom-up and case-by-case, which is slow but recurring.

**The force that actually funds the purchase is legal exposure.** Most workplace accommodations cost the employer little or nothing, with 61% costing zero and a typical one-time cost around 300 US dollars (US Job Accommodation Network), so cost is rarely the blocker. The mover is liability. Two 2026 US enforcement actions established that inaccessible internal dashboards and training tools create employer liability, including a 150,000 US dollar settlement against Pearson Education for benefits and training platforms that blind staff could not use with screen readers. The framing lesson is to sell productivity and compliance, not diversity programs, because diversity budgets are politically exposed in the current US climate while compliance and litigation risk are not.

**Compliance crosses borders, which is the likely route to a Vietnam buyer.** The European Accessibility Act became enforceable in mid-2025 and reaches any company serving European consumers, so multinationals carry accessibility obligations into their offices worldwide, including their Vietnam delivery and research centers, even where Vietnamese law imposes no such duty on private employers. That cross-border propagation, rather than local regulation, is the most plausible path to a Vietnamese enterprise buyer, and it makes the multinational delivery centers in Ho Chi Minh City and Hanoi the more realistic early ground than domestic firms.

**Product form is a real constraint, and it points where our idea already points.** A browser extension is the one host-agnostic path that can reach any web-rendered dashboard or portal, because it can capture and read the page directly. An Office add-in can read a spreadsheet's true chart and cell data natively, which is the most accurate and trustworthy path, but only inside Office. Raw meeting screen-share capture in Teams and Zoom is gated behind enterprise-only infrastructure and is effectively closed for a fast build. This is why a browser-first agent that reads structured data when it can, and falls back to vision when it must, is the technically honest shape for reaching the real breadth of the problem.

---

## 6. The Vietnam Case

The Vietnamese evidence has moved from thin inference to a documented, named, and current case. The honest boundary is stated at the end.

**The scale of exclusion is official and severe.** Around two million Vietnamese are blind or have low vision. In the 2023 national disability survey, labor-force participation for people with disability was 23.9% against 77.4% for others, and vision was the least-employed disability group, with an employment rate at or below 10%, the lowest of all categories (GSO VDS 2023). Only about 35% of people with disability are online at all, against about 84% of the general population.

**The digital-skills gap is real and specific.** Of the Vietnam Blind Association's more than 72,000 members, only about 20,000, roughly 28%, regularly use a computer or smartphone. A national survey in April 2026 found 91% of people with disability own a device but rate their skills as only basic, with work and content-creation skills weakest and 52% not knowing how to use AI tools, which its authors named a new digital divide (MSD and LNOB, N=201). A peer-reviewed study in Can Tho found that vocational training converts to employment measurably worse for the visually-impaired cohort than for people with physical disabilities, direct evidence that current training underperforms specifically for blind trainees (N=217). And 93.4% of Vietnamese people with disability aged sixteen and over hold no technical or professional qualification.

**Named people are living the problem right now.** The most on-thesis is Ma Thị Phương, a blind Vietnamese social-work student who already uses AI by hand to convert chart data she cannot read into tables and plain text, and who built a grassroots accessibility patch for Zalo, the messaging app most Vietnamese offices run on. She is a real local person building, manually, the workaround our product would automate. Đào Thu Hương, the first blind Vietnamese staffer at UNDP Vietnam, describes screen-reader glitches in office software being dismissed by colleagues and needs a private room because her computer talks all day. Dương Tuấn Nam, a blind software engineer, says openly that some work software is incompatible with blind users and that foreign-made tools take far longer to learn. Bùi Nhật Anh Thanh was rejected by more than thirty companies. Nguyễn Đức Nghị, a blind public-relations graduate, works as a masseur because no office would hire him.

**The software environment guarantees the gap.** Vietnamese offices run Microsoft 365, use Zalo for internal chat, and use MISA as the dominant local business suite, and none of these carries any screen-reader or accessibility claim. A July 2026 survey of 187 blind people by the Vietnam Blind Association, the State Bank, and UNDP documented the same screen-reader incompatibility in banking apps and ATMs, the identical technical failure class as office software. A separate survey of 2,310 people with disability found a quarter of those using government online portals struggled because the portals were screen-reader incompatible.

**The region confirms the barrier transfers.** A peer-reviewed Malaysian study quotes a blind telemarketer on the exact same screen-reader and job-portal incompatibility, Malaysia's digital agency formally names visual-first tools that exclude the blind, and the ASEAN Secretariat's 2025 report frames the same digitalization double-edge across all ten member states, including Vietnam. A widely syndicated 2025 feature, headlined by a blind marketer's account that presentation software broke her workflow because her screen reader saw slides as images, shows the exact mechanism still failing at named global companies.

**RMIT is a credible showcase.** The host institution runs its own blind-user accessibility co-design work on structured and interactive digital content, so the problem class is active and documented inside the very institution judging the competition.

**The honest boundary.** There is still no documented case of a blind Vietnamese worker fighting a spreadsheet or chart inside a paid office role, and none of someone losing a job specifically because software broke under their screen reader. We do not claim that persona exists. Instead we frame charts and dashboards as the sharp edge of a broad, well-evidenced barrier, triangulated from the named regional parallel, the lived Vietnamese accounts, and Ma Thị Phương's own workaround. One further nuance matters for later lanes. In a Vietnamese blind data-labeling program, once the technology worked, the remaining barrier became employer trust, because companies would not hand blind workers large data batches. That tells us fixing the technology is necessary but not sufficient, and it is a second reason trust has to be built into the product rather than assumed.

---

## 7. The Core Insight

Three things line up when the research is read as a whole.

The problem is broader than any single artifact. It is the whole arbitrary, interactive, visual surface of digital work, from spreadsheets and charts to dashboards, portals, forms, and everyday web apps. Narrowing to charts alone would under-describe what blind workers actually face, which is a general lockout from on-screen content they do not control.

The gap that no competitor fills is the combination of automatic, structural, and verifiable access. Screenshot describers are automatic but not structural or verifiable. Author-prepared tools are structural but not automatic. Nothing puts all three together on content handed over cold.

And the deepest unsolved thing is trust. The blind user cannot see whether the answer is right, so the product that wins is the one that earns trust, by reading true structure and data where it can rather than guessing from pixels, and by never acting blindly on the user's behalf.

The synthesis is that the right product is not a chart reader and not a generic screen describer. It is an access layer over arbitrary digital work that is trustworthy by design, and that can eventually act, not just explain.

**Why now.** Three forces have arrived at once. Vision-capable AI models are finally good enough to interpret arbitrary on-screen content rather than only author-prepared markup. General computer-use agents have just emerged, so an assistant that perceives and operates a page by voice is newly buildable rather than science fiction. And the category has been proven commercially and legally in the same window, with Be My Eyes shipping a paid workplace product in early 2026, US enforcement actions in 2026 turning inaccessible internal software into a named liability, and the European Accessibility Act adding cross-border pressure. The demand, the technology, and the funding force line up in 2026 in a way they did not two years ago.

---

## 8. The Idea in Its Current Form

This is direction, not implementation. We have deliberately not settled the build, and the lanes that follow this document will.

**The concept.** A voice-driven browser accessibility agent. A blind person talks to it in natural language, the way people already talk to AI assistants, and it does four things. It perceives the page, including the visual, unlabeled, and interactive content that screen readers fail on. It explains that content in a structural and relational way, not just a flat description. It navigates and can interact with the page on request. And it can act on the user's behalf to complete multi-step tasks, but only in a confirmation-first way, reading back what it is about to do before it does it.

**What makes it trustworthy, and therefore defensible.** Wherever the agent can read the true underlying page structure or data, it does, so its answers are accurate and the user can check them, and it falls back to visual interpretation only when there is no structured source. This is the line that separates it from a screenshot describer like the incumbent and from a naive vision agent, and it is also what a general-purpose lab agent is unlikely to tune specifically for a blind user's verification needs.

**It complements the screen reader, it does not replace it.** A blind professional's screen reader already handles linear text well and fast, and this agent is aimed squarely at what the screen reader cannot do, the visual, interactive, unlabeled, and ambiguous content, and at offloading multi-step tasks the user would otherwise grind through one element at a time. Positioning it as a companion that sits alongside JAWS, NVDA, or VoiceOver, rather than a replacement for them, matches how every credible tool in this space is framed and how blind users actually work.

**Where charts fit.** Charts and dashboards are the hero demonstration inside this broader agent, the sharpest and most visible moment where it beats what exists today, not the ceiling of the product.

**Why it fits the mission.** It targets the documented breadth of the problem rather than one slice, it uses AI as the load-bearing capability rather than decoration, it is delivered by voice, which is how the strongest evidence shows blind users want to work, and it is grounded in a real Vietnamese person already doing the manual version of it.

**The two tensions the lanes must resolve.**

The first is the moat. A voice agent that operates a browser is the direction the largest AI labs are moving, so the go-to-market and product lanes have to sharpen exactly what we do that they will not, which today looks like trustworthy structured reads and a safe, confirmation-first action model built around blind users.

The second is trust and safety in action. An agent that acts rather than only describes raises the stakes of a wrong action for someone who cannot see the result, so the product lane has to make read-back-and-confirm and safe failure a core mechanic, not an afterthought. This same mechanic doubles as the answer to the employer-trust barrier the Vietnamese evidence surfaced.

**Working name.** Not yet chosen. Referred to here descriptively.

---

## 9. Open Questions and What We're Deferring

- **Implementation and architecture.** How perception, structured reads, voice, and action actually fit together is a product and prototype question, not settled here.
- **The moat decision.** Whether we optimize purely to win ADC 2026, where wow and a live demo dominate, or also to stand up a defensible startup thesis, where the frontier-lab critique is the whole game. This shapes how far we lean into breadth versus the trust-and-structure edge.
- **The day-one competition brief.** It may narrow the theme into a specific challenge statement that reshapes scope.
- **Team capability.** What the three of us can realistically build in three days is an input the prototype lane needs and has not been captured.
- **Buyer and go-to-market specifics.** The buyer committee and the litigation-driven funding force are mapped, but the exact wedge buyer, pricing, and motion are for the go-to-market lane.

---

## Appendix A: Key Numbers for the Deck

| Metric | Figure | Source and grade |
|---|---|---|
| On-screen data read accuracy, blind vs sighted | About 61% less accurate | Fan et al. 2021, peer-reviewed, cross-cited. Strong |
| Time on on-screen data, blind vs sighted | About 211% more time | Fan et al. 2021. Strong |
| Visualizations undiscoverable to screen readers | About 33% | Fan et al. 2021. Strong |
| Blind Excel users who could not read a line chart | 15 of 16 | ASSETS 2023. Strong |
| Employed blind and low-vision using spreadsheets at work | 91.6% | NRTC 2024. Strong |
| Screen-reader users relying on a sighted coworker | 70.6% | NRTC. Strong |
| Employers requiring screen-reader-inaccessible software | 57.5% | NRTC. Strong |
| Screen-reader users citing PDFs as a significant problem | 75.1% | WebAIM survey. Strong |
| Blind users who cannot verify AI errors even reading its reasoning | Qualitative finding | CHI 2026. Strong |
| Be My Eyes Workplace launch and price | 11 Feb 2026, 55 to 90 USD per seat | Vendor primary. Strong |
| Chart-image extraction accuracy before summarization | About 77% | Chart-to-Text benchmark. Strong |
| Digital-accessibility compliance software market | About 0.7 to 1.6 billion USD | Three analyst firms. Moderate |
| Assistive-technology market, hardware-dominated | About 31 to 58 billion USD | Three analyst firms. Moderate |
| Accommodations costing the employer nothing | 61% | US Job Accommodation Network. Strong |
| Pearson Education inaccessible-platform settlement | 150,000 USD, Aug 2026 | EEOC primary. Strong |
| Vietnamese who are blind or low-vision | About 2 million | Central Eye Hospital, 2024. Strong |
| Vietnam disability labor-force participation vs others | 23.9% vs 77.4% | GSO VDS 2023. Strong |
| Vietnam vision employment rate | At or below 10%, lowest group | GSO VDS 2023. Strong |
| People with disability online, Vietnam | About 33.6% vs 83.7% general | GSO VDS 2023. Strong |
| Vietnamese with disability holding no professional qualification | 93.4% | UNDP and MOLISA, double-corroborated. Strong |
| Blind Association members regularly using a computer or phone | About 20,000 of 72,000-plus, ~28% | VBA Vice Chair, on record. Strong |
| Vietnam disability digital-competence survey | 91% own a device, skills basic, 52% cannot use AI | MSD and LNOB, Apr 2026, N=201. Strong |
| Blind Vietnamese reporting banking-app screen-reader failures | Survey of 187 | VBA, State Bank, UNDP, Jul 2026. Strong |
| People with disability struggling on government online portals | 25.6% | UNDP and MDRI PAPI, N=2,310. Strong |

## Appendix B: The Named Vietnamese Cases

- **Ma Thị Phương** (blind student, national IT-contest winner). Already uses AI by hand to convert chart data she cannot read into tables and plain text, and built a grassroots Zalo accessibility patch. The closest thing to direct proof of both the problem and the demand. The natural human opening for the pitch.
- **Đào Thu Hương** (first blind Vietnamese UNDP staffer). Screen-reader glitches in office software dismissed by colleagues, needs a private office because her computer talks all day, and once had to prove to a bank she could operate online banking to be allowed her own account.
- **Dương Tuấn Nam** (blind software engineer). States that some work software is outright incompatible with blind users and that foreign tools take far longer to learn.
- **Bùi Nhật Anh Thanh** (blind graduate). Rejected by more than thirty companies.
- **Nguyễn Đức Nghị** (blind public-relations graduate). Works as a masseur because no office role was open to him.
- **Nguyễn Hoàng Giang** and **Trần Việt Hoàng** (blind engineers, one at Grab, one who describes coding by ear). Proof that blind Vietnamese people do reach real technical knowledge work.

## Appendix C: Source Register

Evidence grades follow the research convention. Strong means a reputable primary, official, or peer-reviewed source. Moderate means a credible secondary source. Weak means a single blog, vendor marketing, or anecdote.

- **Global problem evidence.** Peer-reviewed HCI and accessibility studies 2021 to 2026 (Fan et al. 2021, ASSETS 2023, CHI 2024 to 2026), the WebAIM screen-reader surveys, and the NRTC longitudinal workplace study. Overall Strong.
- **Competitor landscape.** Vendor primary sources for Be My Eyes, Microsoft, Google, and Apple, plus peer-reviewed and open-source documentation for assistive-tech tools. Strong on capability and pricing facts, Moderate where claims are vendor-reported.
- **Market and buyer.** US Job Accommodation Network and EEOC primary sources are Strong. Market-size figures are Moderate, drawn from multiple analyst firms with a caveat that our specific category is unsized.
- **Vietnam.** GSO VDS 2023, UNDP and MOLISA, the MSD and LNOB 2026 survey, the VBA, State Bank, and UNDP banking survey, and named news profiles. Strong on the systemic figures and the named cases, with the explicit boundary that no blind Vietnamese chart-in-office-role case is directly documented.
- **Regional transfer.** ASEAN Secretariat, UNESCAP, Malaysia's MDEC, and a peer-reviewed Malaysian study. Strong as regional-transfer evidence, labeled as inference for Vietnam.

*Full source URLs live in the research clusters under `02-research/territory-1-deep-dive/` and `02-research/vietnam-landscape-wider/`.*
