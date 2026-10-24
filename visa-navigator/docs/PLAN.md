# Visa Navigator: Plan

Status: draft v0. Research basis in `RESEARCH.md`. Not legal advice; the legal model below is a hypothesis to be checked by a licensed practitioner.

## 1. Goal

Help people with tourist and work-visa paperwork in one chosen corridor (passport country → destination), without giving legal advice and without charging for it before counsel signs off.

Working name is a placeholder. Do not reuse Veeza's name, branding, copy, or code. Build from our own designs and sources.

## 2. Legal model (gate 1)

The product is split into two layers. Only the clerical layer ships in v1.

| Clerical (in scope for v1) | Advice (out of scope; route to a licensed person) |
|---|---|
| Fill in forms from the user's own answers | Choosing a visa category or deciding eligibility |
| Restate official checklists from primary sources, with source and date | Interpreting whether a past refusal or travel history is a problem |
| Explain what a form field asks, in neutral terms, linking to the official instructions | Advice on how to answer a question to improve approval odds |
| Draft itineraries from the user's stated plans | Writing legal arguments or letters of explanation for refusals |
| Translation and transcription | Representing the user to a consulate or border |
| Appointment booking handoff | Any "approval guarantee" |

Hard rules:
1. **No charging for advice.** Any fee applies only to clerical work, and only after counsel review of the fee model.
2. **Licensed humans do the advice layer.** The product may refer users to a licensed practitioner in the destination (or home) jurisdiction. No referral fees without counsel review (Washington state bans them; check the target state).
3. **Source every requirement.** Each checklist item links to the official source (travel.state.gov, IRCC, gov.uk, a consulate or VFS page) with a retrieval date.
4. **No eligibility outputs.** The product never says "you qualify" or "you'll be refused".

Gate: a licensed immigration lawyer or RCIC for the chosen corridor reviews this table and the fee model. No charging and no public launch before that review, written down in `docs/LEGAL_REVIEW.md`.

## 3. Scope

### v1: tourist visa, one corridor
- One passport country and one destination. Pick from the validation step below.
- Flow: intake → document checklist (sourced) → form drafting from answers → itinerary draft → review by the user → export a filled-in PDF for them to submit.
- Output is a packet the user submits themselves. The product does not submit to government portals or consulates.

### Phase 2: work visas
Deferred, not dropped. Work visas usually depend on an employer petition or LMIA (US H-1B, most Canadian work permits, UK Skilled Worker sponsorship). The paperwork is attorney-and-employer work, so this goes through licensed partners, not self-serve. Revisit after v1 has validated users.

### Out of scope
- Asylum, removal defense, appeals, litigation.
- Multiple corridors at once.
- Submitting on the user's behalf.

## 4. Corridor choice (gate 2)

Choose by volume × refusal pain × reachable users. Candidates from `RESEARCH.md`:
- Schengen short-stay for high-refusal passports (refusals roughly 45–55% for several Global South nationalities, secondary data).
- US B-visa for Western Hemisphere passports (wide spread, e.g. Mexico 21%, Colombia 33%, Dominican Republic 36%).

Decision rule: the corridor is picked only after the operator confirms they can reach 5 to 10 real applicants in it. Without that, the corridor cannot be validated, and the first build is wasted.

## 5. Validation (gate 3, before any build)

1. Interview 5 to 10 people who have applied for a tourist visa in the chosen corridor in the last 12 months. Ask: what they paid, which steps took longest, where they got stuck, what they'd pay for help with.
2. Record answers in `docs/INTERVIEWS.md` (no names; refer by role).
3. Build only if at least several people describe the clerical work as painful and say they would pay for it. If not, stop and report.

Lesson from ARGUS: validate the core question first. ARGUS ran a full build before its core question was answered.

## 6. Technical plan (after gates 1–3)

- Stack: Python or TypeScript web app; form-drafting via structured forms per corridor, not free-form generation.
- AI is used for: reading the user's own uploaded documents, translating field labels, drafting itinerary text from user-supplied facts. It is not used for eligibility or legal answers.
- Every checklist item is data, not generated text: `source_url`, `retrieved_on`, `text`. A corridor's checklist is reviewed by a human before publishing.
- Store only what's needed; passport data is sensitive. Encrypt at rest, delete on request, no third-party analytics on intake pages.
- Test strategy: golden-file tests on each corridor's checklist (compare to the stored source snapshot), and a test that the product never emits eligibility language.

## 7. Open decisions for the operator
1. Where are you based (affects which regulator's rules apply first)?
2. Which passport and destination corridor can you reach applicants in?
3. Are you open to a licensed-partner referral model rather than self-serve for advice?
4. Budget for a one-time immigration lawyer or RCIC review?

## 8. Next steps (in order)
1. Operator answers the open decisions above.
2. Scan Atlys, iVisa, VisaHQ for pricing and human-review model (add to `RESEARCH.md`).
3. Pull the full US B-visa table and the Commission's Schengen dataset; verify the figures in `RESEARCH.md`.
4. Gate 1: find a licensed practitioner for the corridor and send them section 2.
5. Gate 3: run the validation interviews.
6. Only then: scaffold the app.
