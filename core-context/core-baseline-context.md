---
type: Reference
created: 2026-09-18
updated: 2026-09-18
tags: [core-context, baseline, research, canonical-surface]
alias: [baseline-context]
version: 2.0
description: The team's shared fact base — the problem, the landscape, the market, the product and how it is used, the business model, and the Vietnamese evidence. The single source every ADC 2026 lane and slide draws from. In-text citations resolve in core-baseline-references.md.
project: adc-hackathon-2026
---

# ADC 2026 Core Baseline Context

**Purpose.** This is the team's shared fact base for ADC 2026. It holds the problem, the landscape, the market, the product and how a person uses it, the business model, and the Vietnamese evidence. Every lane and every slide draws from this one document so we all reason from the same facts. Each load-bearing claim carries an in-text citation in the form (Source Year); the full source, link, and evidence grade for each live in the companion file `core-baseline-references.md`.

---

## 1. Executive Summary

Blind and low-vision people can do knowledge work, but the modern workplace is built out of visual, interactive, on-screen content their tools cannot reach. Screen readers were built for linear text. Charts, dashboards, spreadsheets with visual structure, slide decks, PDFs, web apps, and the buttons and layouts of everyday business software are either silent, scrambled, or unusable through them. The cost is measured. Blind users read on-screen data about 61% less accurately and spend about 211% more time than sighted peers, and the single most common workaround is not a tool at all, it is asking a sighted colleague for help (Fan et al. 2021; NRTC 2024).

The deepest part of the problem is two things no shipped product solves well. The first is structural and relational understanding, knowing what a sort did to the totals, what a chart's trend is, how a dashboard's filters connect. The second is trust, because a blind user cannot visually check whether the AI describing their screen got it right, and the strongest research shows they often cannot catch the error even when they read the model's own reasoning (CHI 2026).

The incumbent is Be My Eyes, which launched a workplace product in February 2026 at 55 to 90 US dollars per seat per month. It describes on-screen content from a screenshot. That is useful, but it is a one-shot black box the user cannot interrogate or verify, and the vendor itself says it is not a screen reader and must not be the sole basis for a decision (Be My Eyes 2026). Everything else in the market either only works if the content's author prepared it correctly in advance, or degrades badly on arbitrary content. Nobody delivers automatic, structural, and verifiable access to whatever a worker is simply handed.

The agent is a voice-driven browser accessibility agent. A blind person opens it with a keypress and talks to it the way people already talk to an AI assistant. It reads the true page structure and data where it can, so its answers are accurate and checkable, and it falls back to interpreting the image only when it must. It explains visual and unlabeled content in a structural way, navigates and operates the page on request, and acts on the user's behalf only after reading back what it is about to do. It sits alongside the screen reader rather than replacing it, and it is summoned on demand, never always listening. Charts and dashboards are the sharpest demonstration of it, not the boundary.

The market is real and funded. Around 161 million working-age people worldwide are blind or have moderate-to-severe vision impairment (Lancet 2021), the AI-in-accessibility market is growing from about 4.2 billion US dollars in 2024 toward a projected 52 billion by 2034 (Market.us 2024), and Be My Eyes alone passed one million blind and low-vision users and raised fresh funding to expand its paid workplace product (Be My Eyes 2026). The force that funds the purchase is legal exposure, not diversity budgets. Three US enforcement actions in 2026 turned inaccessible internal software into named employer liability, and one employer put its own reactive fix at up to one million dollars (EEOC 2026). We sell per seat to the employer, with a free tier for the individual, against the cost of doing nothing.

Vietnam gives the idea a real home. Around two million Vietnamese are blind or low-vision, vision is the least-employed disability group in the country, and a blind Vietnamese student already uses AI by hand to convert charts she cannot read into text (GSO 2023; Central Eye Hospital 2024). The host, RMIT Vietnam, runs its own blind-user accessibility co-design work, which makes it a credible showcase.

A voice agent that operates a browser is the direction the largest AI labs are already moving. That is validation that the category is real, not a threat to design around. Our durable edge is the part the general-purpose agents will not tune for this user, trustworthy structured reads and safe, confirmation-first action built around a blind person's verification needs.

---

## 2. The Competition and Our Territory

ADC 2026 is the RMIT Accessibility Design Competition, a three-day in-person hackathon at RMIT Saigon South from 21 to 23 September 2026. A team of three builds an AI-powered solution that improves workplace inclusion for people with disability, across four disability categories. The preliminary pitch deck and a sub-five-minute video are due by 7:00 AM on day three. The competition has run annually since 2020 inside RMIT Vietnam's disability-inclusion work, so it is an established track.

We chose the visual-impairment category and a workplace-inclusion frame, and within it we help blind and low-vision knowledge workers reach the visual and interactive work content that is inaccessible to them today. Reading and operating visual work artifacts is the broadest and most everyday problem, and it carries the strongest severity evidence, which is why it is the territory.

The full competition brief lands on day one and may narrow the theme into a specific challenge statement. The agent is built to flex against that, so the framing here is a strong hypothesis to confirm against the day-one brief.

---

## 3. The Fundamental Problem

Blind and low-vision people are capable knowledge workers who are locked out by the format of the work, not the substance of it. The mechanism is well understood and has been documented consistently across independent research groups for two decades.

**Screen readers are built for linear text, and the workplace is not linear text.** A screen reader turns the screen into a one-dimensional stream of words. A spreadsheet grid, a chart, a slide layout, a dashboard, and most custom web-app interfaces are two-dimensional and visual by nature. Content drawn as pixels, which is most charts and many dashboard widgets, exposes nothing to the accessibility layer a screen reader depends on, so it is simply absent. Some web charts are even coded so the screen reader skips them entirely (Sharif et al. 2022). This is an architectural mismatch, not a bug waiting for a patch.

**The cost is measured, not anecdotal.** Screen-reader users extract information from on-screen data visualizations about 61% less accurately and spend about 211% more time than sighted users, and about a third of visualizations are entirely undiscoverable to them (Fan et al. 2021). In a study of sixteen blind Excel users, fifteen could not meaningfully read a line chart even with optical character recognition (ASSETS 2023). Spreadsheets are the workday, not a niche, with 91.6% of employed blind and low-vision people using spreadsheet software at work, and it is the single highest unmet training need they report (NRTC 2024).

**The most common workaround is another person.** Across the workforce, 70.6% of screen-reader users facing inaccessible software rely on a sighted coworker to help (NRTC 2024). That is the true baseline the agent competes against, a dependency that costs time, privacy, and dignity, and is not always available.

**The barrier runs across the whole workday, not just data.** Three-quarters of screen-reader users say PDFs are likely to pose significant problems (WebAIM 2024), and scanned or untagged files read as silence or scrambled text. A shared screen reaches other participants as video, which is inaccessible by design in Zoom, Teams, and Meet, so a blind employee in a screen-share presentation is locked out of the exact content under discussion, and slide decks expose only a flat reading order that loses the layout (McDonnall et al. 2023). The problem is the spreadsheet, the chart, the dashboard, the PDF, the deck, the shared screen, and the unlabeled web app, across the entire working day.

**The deep failure is structure and trust, not missing labels.** The hard part is relational and structural comprehension, knowing what a sort did to the rest of the sheet, what a chart's trend and outliers are, how a dashboard's filters interact. Flat description does not deliver this. And trust is unsolved, because a blind user reviewing an AI's answer could not detect incorrect data points or chart-rendering errors even when shown the model's own reasoning, and verification for them is a different and more layered process than it is for sighted users (CHI 2026). A confidently wrong answer the user cannot check is worse than no answer, because it carries false confidence into a real decision.

**The barrier persists by default.** Most inaccessible workplace software is off-the-shelf, not custom, so every employer buying the same mainstream tools inherits the same gap, and 57.5% of screen-reader users say their employer requires software that is inaccessible to their screen reader, 41.3% of it off-the-shelf (NRTC 2024). The fix has never depended on the reader's own assistive-technology budget. It depends on content and software the reader does not control.

---

## 4. The Global Landscape and Competitors

The market is real, active, and incomplete. Understanding exactly where each player stops is what defines the opening.

**Be My Eyes is the incumbent to beat.** Its Workplace product launched on 11 February 2026 at 55 to 90 US dollars per seat per month, and it does keystroke-triggered description of on-screen content, including charts, dashboards, PDFs, and slides, by capturing a screenshot and describing it (Be My Eyes 2026). That is genuinely useful and it validated both the category and the price point. But it is a one-shot description a user cannot query relationally or verify, it treats the screen as an undifferentiated image rather than structured data, and the vendor states plainly that it is not a screen reader and that its output must not be the sole basis for any decision that affects someone's employment or rights.

**The big platforms cover pieces, not the whole.** Microsoft offers author-triggered alt text and Copilot in Excel, but Copilot generates new summaries and charts on request rather than explaining a chart someone else handed you, and several richer features are gated to specific hardware. Google's Android screen reader can describe and answer questions about a whole screen with Gemini, the closest free analog to on-screen description, but it is mobile-only. Apple's chart accessibility is strong but only for charts an app author specifically built for it, and its most advanced data-comprehension features are limited to single-line charts in its own Stocks and Health apps (Sharif et al. 2022). None targets the arbitrary, host-agnostic case of a worker handed content they did not create.

**Specialist tools require preparation or degrade on arbitrary input.** Every dedicated chart and data accessibility tool works only if the author used a specific library or metadata in advance, or only for a fixed list of charting frameworks, or, for the one bucket that can take a chart the worker did not create, through image-and-OCR interpretation that is materially less accurate, with chart-image extraction accuracy around 77% before summarization even runs (Chart-to-Text 2022). No shipped product delivers automatic, zero-setup, structural, and verifiable access to an arbitrary chart, spreadsheet, dashboard, or PDF.

**The frontier labs are the backdrop, and their direction validates ours.** General browser and computer-use agents from OpenAI, Anthropic, and Google are advancing quickly, and a voice-driven agent that operates a browser is a natural application of that capability. That the largest players are heading here confirms the category is real. It also means the raw appeal of an AI that browses for you by voice is achievable and impressive. Our durable edge is the part they will not tune for this specific user, trustworthy structured reads and safe, confirmation-first action designed around a blind person's verification needs. Today's general computer-use agents are also still unreliable at the base task, with the best model reaching only 52.5% success across real blind-user commands, which is why the trust layer, not raw autonomy, is the product (OLLA 2026).

**The gap widens in collaboration tools.** Peer-reviewed surveys rank project-management tools and digital whiteboards among the least accessible software of all, and no vendor targets a live whiteboard's spatial layout or a shared screen's real-time content. The exclusion is sharpest exactly where collaboration is densest.

**The white space, stated plainly.** No one delivers access to arbitrary interactive visual content that is at once automatic, so it needs no author setup, structural, so it conveys relationships and not just surface description, and verifiable, so a blind user can trust it enough to act on it. That is the gap the agent fills.

---

## 5. The Product

### 5.1 The Concept

The agent is a voice-driven browser accessibility agent. A blind person opens it with a keypress and speaks to it in natural language, and it does four things. It perceives the page, including the visual, unlabeled, and interactive content that screen readers fail on. It explains that content structurally and relationally, not as a flat description. It navigates and interacts with the page on request. And it completes multi-step tasks on the user's behalf, but only in a confirmation-first way, reading back what it is about to do before it does it. It complements the screen reader and is aimed squarely at what the screen reader cannot do.

### 5.2 How It Works

The agent perceives the page through two channels. Wherever the page exposes real structure, the agent reads the live document object model and the accessibility tree, and the true data behind a table or chart. This is the same machinery a browser-automation tool uses to find, read, and operate elements, and it is the ground-truth channel, because the answer comes from the page's own data rather than a guess from its picture. When content is drawn as pixels with no underlying structure, which is most charts, canvas widgets, images, and a shared screen, a structured read returns nothing, so the agent falls back to a screenshot and a vision model to interpret the image (GraphWhisper 2026). It reads targeted to the user's question or action rather than dumping the whole page, because the screen reader already handles linear reading well.

### 5.3 How You Activate It

The user summons the agent with a keypress and holds it to speak, the way a person holds a walkie-talkie button. There is no wake word and the microphone is not always listening. Every incumbent tool for this population invokes on demand this way rather than listening ambiently, because always-on listening in a shared office captures colleagues' speech, fires on false triggers, and collides with the screen reader's own audio (Be My Eyes 2026; Seeing AI 2024; Aira 2026). Deliberate, on-demand invocation is also what keeps the agent from fighting the screen reader, which is an unsolved problem at the platform level and the reason a bolt-on layer that seizes control instead of deferring is the wrong design (W3C ARIA 2757; overlay evidence 2026).

### 5.4 The Day-to-Day User Flow

The core loop is summon, ask, confirm, act, hear the result, hand back. A blind analyst working with her screen reader runs it like this.

1. **She works normally with her screen reader.** She reads email, text, and menus at her own fast pace. The agent is asleep and stays silent. For anything the screen reader already does well, she never needs it.
2. **She hits a wall.** She opens a sales dashboard and the screen reader goes quiet, because the chart is only a picture to it. This is the moment the agent exists for.
3. **She activates it with one key.** She presses and holds the hotkey and speaks. She does not say a wake word, and the microphone was not listening until she opened it.
4. **She asks a question.** She says what is the top region this quarter and what is the trend. The agent reads the real numbers behind the chart where it can, answers in a few words at her listening speed, and takes follow-ups such as what was APAC last quarter. Question-and-answer over a chart is the best-evidenced interaction in the whole design (Kim et al. 2023; VoxLens 2022).
5. **She asks it to do something.** She says filter the dashboard to APAC only. Because the agent is about to act, it reads back what it will do, taken from the real page, then does it once she says yes and confirms the result.
6. **It protects her on anything risky.** When she says submit the expense report, the agent reads the whole thing back first, because submitting cannot be easily undone, and waits for a clear yes. It never types her password, card, or bank details for her.
7. **It tells her what happened.** After any action it states the outcome, including a confirmation number, or it says plainly that something failed and what it already did, and it can undo the step.
8. **She hands back.** She releases the key, the agent sleeps, and the screen reader resumes exactly where it was. There is no mode to exit and no cleanup.

### 5.5 What It Does and Does Not Do

**It does.** It reads and explains charts, dashboards, canvas widgets, unlabeled and custom interfaces, and shared-screen content. It answers structural and relational questions about that content. It navigates and operates the page. It completes multi-step tasks after confirmation. It always keeps a raw-data-table fallback available, because some users prefer direct data even when it is slower (VizAbility 2024).

**It does not.** It does not re-read the linear text the screen reader already reads fast and accurately. It does not listen ambiently or activate itself. It does not act on an irreversible or high-stakes step without reading it back and hearing yes. It does not enter passwords, card numbers, or banking details, which stay manual by rule. And it does not run an open-ended chain of actions unsupervised, because current agents are not reliable enough for that yet (OLLA 2026).

### 5.6 Where the Screen Reader Stays in Charge

The agent has no business re-narrating linear text. Experienced screen-reader users listen at 300 to 500-plus words per minute, far faster than a spoken agent response, and they navigate by heading, landmark, table, and form field through a decades-mature model they already have in muscle memory (Bragg et al. 2021; WebAIM 2024). For properly marked-up documents, forms, and real tables, the screen reader is faster, more trusted, and the right tool, and the agent defers to it entirely. The agent owns only what the screen reader cannot reach, the charts and canvas rendered as pixels, the unlabeled and custom widgets on off-the-shelf software the employer cannot remediate, the live dashboards whose updates break screen-reader semantics, and the meeting screen-share (McDonnall et al. 2023; NRTC 2024).

### 5.7 How It Works With Other Tools

The agent is a companion, framed the way every credible tool in this space frames itself, working alongside JAWS, NVDA, and VoiceOver rather than replacing them (Be My Eyes 2026; Seeing AI 2024). Blind professionals already run an average of seven assistive tools and hand off between them by task, so a new on-demand layer slots naturally into that stack (McDonnall et al. 2023). The cautionary contrast is the accessibility-overlay industry, which tried to auto-activate and override the screen reader, made sites harder to use for more than 70% of screen-reader users, drew a one-million-dollar FTC penalty against one vendor, and was rejected in a public letter signed by hundreds of accessibility professionals (overlay evidence 2026). The agent never intercepts or auto-activates in the presence of a running screen reader, and it acts only on explicit invocation.

### 5.8 What Makes It Trustworthy

Trust is the product, and it rests on four mechanics grounded in the evidence.

**Ground-truth reads.** The agent reads the page's real structure and data wherever it exists, so the answer is checkable, and it falls back to interpreting the image only when there is no structured source. This is the line that separates it from a screenshot describer and from a naive vision agent.

**Confirmation-first action, gated by reversibility.** The agent pauses at decision points and reads back what it is about to do before an irreversible or high-stakes step, and it lets reversible steps run. An agent that pauses at decision points beat a leading fully-automated agent on both task success and matching the user's actual preference (Morae 2025), and the accessible standard for irreversible transactions is exactly a distinct confirm-then-submit step (WCAG G155). Reversibility, not importance, is the trigger for when to gate.

**Verified read-back.** What the agent reads back before acting is reconstructed from the real pending action on the page, not from the model's own narration of its plan, because a read-back sourced from model text can be wrong or manipulated while the action underneath differs (Verifiable Action Card 2026).

**Safe failure and recovery.** Every action reports its outcome, a stop reports what already happened and what is still undoable, and sensitive fields never autofill. Blind users abandon tools that feel unrecoverable, so demonstrating recoverability early is what earns adoption (crypto-wallet study 2023; overlay evidence 2026).

---

## 6. The Market, the Buyer, and the Business Model

### 6.1 Market Size

The category has no analyst-tracked size, so we build it bottom-up and bracket it with adjacent markets. Around 161 million working-age people worldwide are blind or have moderate-to-severe vision impairment (Lancet 2021). Employment among them varies widely by region, from about 44% in the United States to far lower in lower-income countries, so the reachable near-term market is the employed, computer-using share in high-income and multinational-employer settings (AFB 2024; Lancet 2021). Among employed blind and low-vision people, a majority are in desk and office roles, about 56% by the US occupation mix, and 91.6% use spreadsheets at work (NRTC 2024; NRTC 2026). At a per-seat price in the range of a Be My Eyes seat, even a low-single-digit share of that reachable population is a market in the hundreds of millions of dollars a year.

The brackets around it confirm the space is real. The AI-in-accessibility market is put at about 4.2 billion US dollars in 2024, projected toward 52 billion by 2034 at roughly 29% a year (Market.us 2024), and the narrower digital-accessibility compliance software market sits near 0.8 to 1.0 billion today (Precedence 2025; Mordor 2025). The clearest proof of demand is the incumbent itself. Be My Eyes passed one million blind and low-vision users, operates in more than 150 countries, sells a paid workplace product, and raised fresh funding to expand it (Be My Eyes 2026).

### 6.2 The Buyer and the Buying Motion

The buyer is a committee and the purchase is an accommodation. Under US practice the motion is the interactive process, which is employee-initiated and bottom-up, the employee requests an accommodation in plain language, the employer gathers information and engages in dialogue, and the employer implements and pays for it by default (EEOC 2026; JAN 2025). A designated accommodation or disability coordinator drives it, the employee's manager is involved in rollout, and IT is pulled in for compatibility and security review. State vocational-rehabilitation agencies can co-fund portable assistive technology that follows the worker, though not equipment fixed to one employer's workstation (ACCES-VR policy).

At the enterprise level, accessibility conformance is increasingly a pre-award qualification rather than a post-purchase fix. Buyers ask for a documented conformance report mapped to the accessibility standards before procurement proceeds, which raises the vendor's own credibility burden early and is a reason to carry that documentation from the start (VPAT/ACR evidence 2026).

### 6.3 The Funding Force

The force that funds the purchase is legal exposure. Most accommodations cost the employer little, with 61% costing nothing and a one-time median around 300 US dollars (JAN 2025), so cost is rarely the blocker and liability is the mover. In 2026, three US enforcement actions turned inaccessible internal software into named employer liability, a 200,000-dollar settlement with American Airlines, a 150,000-dollar settlement with Pearson Education, and a 270,000-dollar settlement with PepsiCo, each requiring specific technical remediation, not just payment (EEOC 2026). The sharpest number for the pitch is PepsiCo's own estimate that retrofitting its systems for screen-reader compatibility after the fact would cost up to one million dollars and take a year, against a proactive tool costing tens of dollars a seat. The European Accessibility Act, enforceable from mid-2025, reaches any company serving European consumers and carries these obligations into multinationals' offices worldwide, including their Vietnam delivery and research centers, which is the most plausible route to a Vietnamese enterprise buyer (EAA 2025). The framing that sells is productivity and compliance, not diversity, because compliance and litigation risk are the durable, politically safe levers.

### 6.4 Pricing and Packaging

The agent is priced per seat per month, sold to the employer, tiered on admin and security features rather than on AI quality, with a free or steeply discounted tier for the individual. This is the pattern the market has already proven, Be My Eyes selling an employer seat while keeping its consumer app free, and JAWS pricing a work edition roughly ten to twenty times its discounted home edition (Be My Eyes 2026; JAWS 2025). The committed price is in the range of 50 to 60 US dollars per seat per month, positioned at or just under the incumbent, and sold against the cost of doing nothing rather than against the low median accommodation cost. A free individual tier builds the user base and the trust that a bottom-up accommodation request depends on, and the paid employer tier carries the single sign-on, management, and reporting that procurement requires.

### 6.5 Adoption Friction

The friction to clear is trust in a tool that watches the screen. Disabled workers already report that opaque workplace monitoring misreads their accommodations as underperformance, and most were never told about the monitoring before it began (AFB 2026). An agent that reads a person's work screen has to be visibly on the worker's side, invoked by the worker, transparent about what it does with screen contents, and privacy-safe by design. IT security review and the privacy of screen contents are the practical gates, which is why the ground-truth, on-demand, confirmation-first design is also the commercial design.

---

## 7. The Vietnam Case

The Vietnamese evidence is documented, named, and current, with the honest boundary stated at the end.

**The scale of exclusion is official and severe.** Around two million Vietnamese are blind or have low vision, a repeated clinical estimate from the national eye hospitals (Central Eye Hospital 2024). In the 2023 national disability survey, labor-force participation for people with disability was 23.5% against 76.3% for others, and vision was among the least-employed groups at or below 10%, the lowest of all categories (GSO 2023). Only about a third of people with disability are online at all, against most of the general population (GSO 2023).

**The digital-skills gap is real and specific.** Of the Vietnam Blind Association's more than 72,000 members, only about 20,000 regularly use a computer or smartphone (VBA 2024). A national survey in April 2026 found 91% of people with disability own a device but rate their skills as only basic, with 52% not knowing how to use AI tools, which its authors named a new digital divide (MSD and LNOB 2026). And 93.4% of Vietnamese people with disability hold no technical or professional qualification (UNDP and MOLISA 2023).

**Named people are living the problem now.** The most on-thesis is Ma Thị Phương, a blind Vietnamese student who already uses AI by hand to convert chart data she cannot read into tables and plain text, and who built a grassroots accessibility patch for Zalo, the messaging app most Vietnamese offices run on. She is a real local person building, by hand, the workaround the agent would automate. Đào Thu Hương, the first blind Vietnamese staffer at UNDP Vietnam, describes screen-reader glitches in office software dismissed by colleagues and needs a private room because her computer talks all day. Dương Tuấn Nam, a blind software engineer, says some work software is incompatible with blind users and that foreign-made tools take far longer to learn. Bùi Nhật Anh Thanh was rejected by more than thirty companies. Nguyễn Đức Nghị, a blind public-relations graduate, works as a masseur because no office would hire him (Vietnam case profiles 2024).

**The software environment guarantees the gap.** Vietnamese offices run Microsoft 365, use Zalo for internal chat, and use MISA as the dominant local business suite, and none carries any screen-reader or accessibility claim. A July 2026 survey of 187 blind people by the Vietnam Blind Association, the State Bank, and UNDP documented the same screen-reader incompatibility in banking apps and ATMs, the identical technical failure class as office software (VBA and SBV 2026).

**The region confirms the barrier transfers.** A peer-reviewed Malaysian study quotes a blind telemarketer on the same screen-reader and job-portal incompatibility, and the ASEAN Secretariat's 2025 report frames the same digitalization double-edge across all ten member states, including Vietnam (ASEAN 2025). RMIT, the host, runs its own blind-user accessibility co-design work on structured and interactive digital content, so the problem class is active inside the institution judging the competition.

**The honest boundary.** There is no documented case of a blind Vietnamese worker fighting a spreadsheet or chart inside a paid office role, and none of someone losing a job specifically because software broke under their screen reader. We do not claim that persona exists. We frame charts and dashboards as the sharp edge of a broad, well-evidenced barrier, triangulated from the named regional parallel, the lived Vietnamese accounts, and Ma Thị Phương's own workaround. One further nuance matters. In a Vietnamese blind data-labeling program, once the technology worked, the remaining barrier became employer trust, because companies would not hand blind workers large data batches. Fixing the technology is necessary but not sufficient, which is a second reason trust is built into the product rather than assumed.

---

## 8. Why Now

Three forces have arrived at once. Vision-capable AI models are finally good enough to interpret arbitrary on-screen content rather than only author-prepared markup. General computer-use agents have just emerged, so an assistant that perceives and operates a page by voice is newly buildable. And the category has been proven commercially and legally in the same window, with Be My Eyes shipping a paid workplace product in early 2026, US enforcement actions in 2026 turning inaccessible internal software into a named liability, and the European Accessibility Act adding cross-border pressure. The demand, the technology, and the funding force line up in 2026 in a way they did not two years ago.

---

## Appendix A: Key Numbers for the Deck

| Metric | Figure | Citation |
|---|---|---|
| On-screen data read accuracy, blind vs sighted | About 61% less accurate | Fan et al. 2021 |
| Time on on-screen data, blind vs sighted | About 211% more time | Fan et al. 2021 |
| Visualizations undiscoverable to screen readers | About 33% | Fan et al. 2021 |
| Blind Excel users who could not read a line chart | 15 of 16 | ASSETS 2023 |
| Employed blind and low-vision using spreadsheets at work | 91.6% | NRTC 2024 |
| Screen-reader users relying on a sighted coworker | 70.6% | NRTC 2024 |
| Employers requiring screen-reader-inaccessible software | 57.5% | NRTC 2024 |
| Screen-reader users citing PDFs as a significant problem | 75.1% | WebAIM 2024 |
| Blind users cannot verify AI errors even reading its reasoning | Qualitative finding | CHI 2026 |
| Best computer-use agent success rate, real blind-user tasks | 52.5% | OLLA 2026 |
| Expert screen-reader listening rate | 300 to 500-plus words per minute | Bragg et al. 2021 |
| Voice question-answer over charts, accuracy gain | +122%, 36% faster | VoxLens 2022 |
| Blind professionals, average assistive tools used at work | 7 | McDonnall et al. 2023 |
| Be My Eyes Workplace launch and price | 11 Feb 2026, 55 to 90 USD per seat per month | Be My Eyes 2026 |
| Be My Eyes users | 1 million-plus, 150-plus countries | Be My Eyes 2026 |
| Chart-image extraction accuracy before summarization | About 77% | Chart-to-Text 2022 |
| Working-age blind or moderate-to-severe vision impairment, global | About 161 million | Lancet 2021 |
| US employment rate, vision disability | 44 to 47% | AFB 2024 |
| Employed US blind and low-vision in desk or office roles | About 56% | NRTC 2026 |
| AI-in-accessibility market | 4.2B USD (2024) toward 52B (2034), ~29% CAGR | Market.us 2024 |
| Digital-accessibility compliance software market | About 0.8 to 1.0B USD | Precedence 2025; Mordor 2025 |
| Accommodations costing the employer nothing | 61%, one-time median ~300 USD | JAN 2025 |
| 2026 EEOC settlements over screen-reader-inaccessible software | 150,000 to 270,000 USD | EEOC 2026 |
| PepsiCo reactive-remediation self-estimate | Up to 1,000,000 USD, one year | EEOC 2026 |
| JAWS work edition vs home edition price gap | About 10 to 20x | JAWS 2025 |
| Vietnamese who are blind or low-vision | About 2 million | Central Eye Hospital 2024 |
| Vietnam disability labor-force participation vs others | 23.5% vs 76.3% | GSO 2023 |
| Vietnam vision employment rate | At or below 10%, lowest group | GSO 2023 |
| Vietnamese with disability holding no professional qualification | 93.4% | UNDP and MOLISA 2023 |
| Vietnam disability digital-competence survey | 91% own a device, 52% cannot use AI | MSD and LNOB 2026 |

## Appendix B: The Named Vietnamese Cases

- **Ma Thị Phương** (blind student, national IT-contest winner). Already uses AI by hand to convert chart data she cannot read into tables and plain text, and built a grassroots Zalo accessibility patch. The closest thing to direct proof of both the problem and the demand, and the natural human opening for the pitch.
- **Đào Thu Hương** (first blind Vietnamese UNDP staffer). Screen-reader glitches in office software dismissed by colleagues, needs a private office because her computer talks all day, and once had to prove to a bank she could operate online banking to be allowed her own account.
- **Dương Tuấn Nam** (blind software engineer). States that some work software is outright incompatible with blind users and that foreign tools take far longer to learn.
- **Bùi Nhật Anh Thanh** (blind graduate). Rejected by more than thirty companies.
- **Nguyễn Đức Nghị** (blind public-relations graduate). Works as a masseur because no office role was open to him.
- **Nguyễn Hoàng Giang** and **Trần Việt Hoàng** (blind engineers, one at Grab, one who describes coding by ear). Proof that blind Vietnamese people do reach real technical knowledge work.
