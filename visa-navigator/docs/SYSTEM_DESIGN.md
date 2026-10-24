# Visa Navigator: System Design (personal app)

This document covers the personal app: a tool for your own applications, run on your own machine. The hosted service, where an operator reviews and files applications for customers, is a separate part of the repository (`server/service`, `src/apply`, `src/console`) and is designed in `SERVICE_PLAN.md`. For the personal app, the advice-for-fee constraints in `PLAN.md` do not apply. Two limits still do:

1. **No invented information.** The tool records what the user enters or uploads. It never fills a field with a guess, and it never generates supporting documents (letters, bank statements, invitation letters) that claim facts.
2. **Automation stops at the steps that are the applicant's.** The portal autofill (`server/autofill/`, decided 2026-10-14) fills the official form in a visible Chrome window and moves through its pages. It never types a CAPTCHA, signs in, ticks a declaration, fills a field it has no answer for, or pays; it waits for the user at each of these. It presses Submit only on a final page (one with no Next button), only when the user has switched that on for the run, and only after the user ticked that page's declaration box themselves; with no box to tick, the user presses Submit. It only acts on the portal's own hosts, and it does not book appointments or watch slot pages, which visa centres treat as bot traffic.

These two limits also make the tool more useful. The hard part of a visa application is getting the facts right and keeping track of deadlines, and the tool helps with both.

## 1. What the tool does

| Job | Description | Automation |
|---|---|---|
| Checklist | For a chosen destination and visa type, list required documents, each with its official source URL and the date it was checked | Data-driven from a checklist file; reviewed by you before use |
| Document intake | Upload a passport scan or photo; extract name, number, dates, and MRZ | Vision extraction via the Claude API; you confirm every field |
| Answer sheet | Mirror the official form's questions and store your answers once | You type or confirm answers; the tool reuses them across forms |
| Itinerary draft | Turn your flights and hotels into a day-by-day itinerary | AI drafts text from facts you supply; you edit |
| Field help | Explain what a form question asks, neutrally, with a link to the official instructions | Static text from the checklist, plus AI paraphrase of that text only |
| Tracker | Track application stage, appointment dates, passport expiry, and reminders | Manual entry plus date math |
| Export | Produce a PDF packet and a copy-paste sheet for the official portal | Local generation, no upload |

Each item in the checklist is data, not generated text:

```yaml
- id: passport_bio_page
  label: Passport bio page scan
  required: true
  source_url: https://example.gov/...   # official page
  retrieved_on: 2026-10-09
  notes: Valid at least N months beyond the planned stay (per source)
```

Every screen shows "checked on <date>, source: <link>" for each requirement. When a source is older than a set threshold (say 30 days), the UI marks it stale.

## 2. Architecture

```
Browser (Vite + React + TypeScript)
  ├─ UI: checklist, answer sheet, tracker, 3D/animated views
  ├─ Local store: encrypted IndexedDB (or SQLite via the local server)
  └─ calls ──► Local server (Node, Hono or Express, bound to 127.0.0.1)
                 ├─ /extract   → Claude API (vision) for passport and document fields
                 ├─ /draft     → Claude API for itinerary text and field paraphrases
                 └─ /export    → PDF and copy-paste sheets (pdf-lib or similar)
```

Decisions:

- **Local-first.** Passport numbers and personal details stay on your machine. Nothing goes to a hosted database. Only the minimum needed for an extraction or draft call leaves the machine, and you see what is sent.
- **API key stays on the server.** The Anthropic key lives in `.env` read by the local server. The browser never sees it.
- **One place for facts.** A single `profile` record holds your answers. Every form and checklist reads from it, so you enter a fact once and it stays consistent.
- **Human confirmation on every extracted field.** Extraction returns value and confidence; anything low-confidence or changed is highlighted for review. No field writes to the profile without your confirmation.
- **Versioned checklists.** Each corridor's checklist lives in a file under git. Changes are reviewed as diffs, with the source and date visible.

## 3. Data model (sketch)

```
profile          { id, legal_name, dob, nationality, passport: {number, issuer, issued, expires}, addresses, ... }
trip             { id, destination, purpose, depart, return, flights[], lodging[], itinerary_md }
application      { id, trip_id, visa_type, checklist_version, status, appointment_at, confirmation_no }
document         { id, kind, file_ref (encrypted blob), extracted_fields, confirmed_at }
checklist_item   { id, application_id, requirement_id, done, document_id?, source_url, retrieved_on }
```

Only `file_ref` points at a file. Files are stored encrypted, and the key is derived from a passphrase you enter at launch (WebCrypto `AES-GCM` with PBKDF2 or Argon2 via a WASM build). Losing the passphrase means losing the data, which is the right trade-off for passport data.

## 4. AI use

| Task | Input | Output | Guardrail |
|---|---|---|---|
| Extract passport fields | Image of the bio page | JSON fields + confidence | Confirmed by you; MRZ checksum checked locally |
| Extract other document fields | Flight or hotel confirmation | JSON fields | Confirmed by you |
| Draft itinerary | Your structured trip data | Markdown | You edit; no invented venues or times |
| Paraphrase field help | Official instruction text | Plain-language summary | Must cite the source text; no advice on how to answer |

Model choice: use the latest Claude model that supports vision and structured output. Check the current model IDs with the claude-api skill when you wire it up rather than hard-coding one here.

The MRZ (the two machine-readable lines at the bottom of the passport bio page) has a check-digit algorithm (ICAO 9303). Verifying it locally catches most extraction mistakes without any AI call.

## 5. Build order

1. **Data layer and encryption.** Profile, trip, and application records; passphrase-derived key; round-trip tests.
2. **Checklist engine.** Load one corridor's checklist file; render it; show source and date per item.
3. **Answer sheet.** Form questions from data; one profile feeds all answers.
4. **Export.** PDF packet and copy-paste sheet. Test with a sample profile.
5. **Document intake.** MRZ check first (deterministic), then the vision extraction call with confirmation UI.
6. **Tracker and reminders.** Expiry and appointment dates; in-app reminders.
7. **Itinerary draft.** Last, because it is the least critical.
8. **Animation and 3D.** Add after the flows work, so they support the function instead of driving it. See `FRONTEND.md`.

## 6. Testing

- Unit: MRZ check digits (use ICAO 9303 examples), date math for expiry and stale sources, encryption round-trip.
- Golden files: each checklist has a snapshot of its source page text; a test flags when the source text changes so you re-check the requirement.
- Guardrail tests: the export and draft prompts must not contain eligibility language, and no output field may be filled without a confirmed source.
- Manual: run through one real application end to end, comparing the packet with the official form.

## 7. Known risks

- **Stale requirements.** Visa rules change often (fees, photo specs, interview waivers). The source-date system and stale flags are the main defense, not the code.
- **Portal differences.** Each country's portal and each consulate's process differs. The checklist file is per corridor, and the official portal is always the final authority.
- **Extraction errors.** Names with diacritics, transliteration, and MRZ quirks cause mistakes. Human confirmation is required.
- **Data loss.** A forgotten passphrase loses everything. Add an encrypted export backup.
- **Form PDF libraries.** `pdf-lib` on npm (1.17.1) has not been updated since 2022. Test any PDF field filling on the current official forms before relying on it; fall back to a maintained fork if needed.

## 8. Decisions for you

1. Which corridor first (passport country and destination)? The checklist file is built for that one.
2. Local server (Node) or fully in-browser (no server, no key in the browser)? In-browser is simpler but cannot call the API without exposing the key, so the default here is a local server.
3. How much of this do you want in the first version? Recommended: steps 1–4 first.
