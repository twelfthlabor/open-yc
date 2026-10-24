# Visa Navigator

A free, private visa assistant that does what a full-service tourist-visa package does, for your own trips. Enter your passport, destination and travellers; the app works out the permission you need and walks you through it:

- **Fills the official form for you**: one click opens CROVISA (Croatia) or gov.uk (UK) in a Chrome window and fills it page by page from your answers, moving on with the form's own Next buttons. It waits for you at the security code, sign-in, any question it has no answer for, the declaration and payment, and presses Submit on the final page only after you tick its declaration box (you can switch that off; with no box to tick, you press Submit). The CROVISA serial number and PIN, or a gov.uk reference, are saved to the tracker. Autofill only runs on the portal that takes the application: a Swedish or French Schengen application is never typed into CROVISA. Tested against local copies of the portal pages and the live CROVISA start page; the pages after the CROVISA security code and the gov.uk flow have not been run live yet, so watch the first real run.
- **Application filled in with you**: every answer prepared from passports and trip details, then a fill-along mode that steps through the official form field by field with copy buttons. Schengen countries use the official numbered Schengen form (fields 1–32); the UK and the US DS-160 (B-1/B-2) have answer sheets of the common questions.
- **Cover letter written from your trip**: a template letter from your answers works offline. With an API key, AI writes the letter from a list of facts you can see before sending. Your passport number, address and email never leave the device: they are sent as placeholders and filled in locally. A letter that contains a number not in your facts, or promises a decision, is discarded.
- **Day-by-day itinerary**: one entry per day from arrival to departure, with flights on their dates and your accommodation carried forward. A consistency check flags days outside the trip, nights with no bed, missing outbound or return flights, and nights your accommodation booking does not cover. With a key, AI can suggest sightseeing for free days; each suggestion is used only if you accept it, and stays marked as suggested.
- **AI document verification**: upload bank statements, insurance, bookings, tickets and photos (image or PDF). AI reads the details; plain code checks them against the sourced requirement (for example SEK 700 × days × travellers for Sweden, €30,000 cover for the whole stay). Without an API key you type the details and the same checks run.
- **Passport reading**: AI reads the photo page, and the machine-readable lines are verified with ICAO check digits.
- **Apply together**: several travellers on one application; shared answers are entered once.
- **Appointment booking assistant**: for the country where you apply, the app opens the official booking system (VFS Global for Sweden and the Netherlands, France-Visas and the centre it assigns, gov.uk and its visa application centre, or the DS-160 → fee → interview booking system for the US). It tracks each booking step, checks the shape of references such as the DS-160 confirmation number, and keeps a copy sheet of everything the booking form asks.
- **Availability tracking and reminders**: WhatsApp and desktop reminders for the application window, checking for slots, the appointment, the decision and departure.
- **Expert review**: a fixed rubric checks passports, documents, form answers, itinerary and dates, the cover letter and the appointment. An optional AI pass adds comments. You can then download a review packet (one HTML file; passport numbers and contact details are masked unless you switch that off; no images) for a person you choose, and record their notes. There is no score and no prediction of the decision.
- **Review and export**: self-review checklist, copy sheet and a printable PDF packet.

Your applications, passports and uploaded files are encrypted on your device (passphrase of at least 12 characters → PBKDF2-SHA256, 600,000 iterations → AES-GCM in IndexedDB; vaults made with the earlier 310,000 iterations are re-encrypted on the next unlock). A few things are kept outside the vault; see [Privacy limits](#privacy-limits). The autofill only types on the official portal, and never solves security codes, signs in, ticks declarations or pays for you. The app never invents facts or documents. You book appointments yourself; the app opens the official page and reminds you to check for slots.

Autofill needs Google Chrome (set `CHROME_PATH` if it is not in the default place). Portal sign-ins are kept in `data/browser-profile`.

**Not affiliated with Veeza AI.** This is an independent open-source project. It is not affiliated with, endorsed by or connected to Veeza AI, Inc., and it uses none of their name, branding, copy or code. `docs/PARITY.md` compares capabilities, with sources.

**Not legal advice.** The app restates official requirements with links and checks your own data for consistency. It does not decide eligibility or predict decisions; the embassy or consulate decides.

## Run

```bash
npm install
cp .env.example .env   # optional keys, see below
npm run dev            # web on http://localhost:5173, API on 127.0.0.1:8787
```

Optional settings in `.env`:

| Setting | Enables |
|---|---|
| `ANTHROPIC_API_KEY` | AI passport reading, document reading, cover letter writing, itinerary suggestions, AI pre-review comments, draft polishing |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` | WhatsApp reminders (the Twilio sandbox works for personal use) |
| `TWILIO_CONTENT_SID` | An approved message template, needed for reminders sent more than 24 hours after you last messaged the sender |

Without `ANTHROPIC_API_KEY` everything still works in manual mode. You type the MRZ and document details, use the template cover letter, and get the deterministic itinerary and the review rubric; the AI buttons are hidden.

Reminders are sent by the local server, so they only go out while `npm run dev` is running; missed ones are sent on start-up if less than two days late.

The hosted service (`npm run dev:service`) has its own settings in `.env.example`. If it runs behind a proxy, set `TRUST_PROXY_HEADER` to the header that proxy sets to the client's address (on Fly.io, `fly-client-ip`); the sign-in and console login rate limits use it. Left empty, they use the connection's address and ignore forwarding headers, which clients can forge.

## Checks

```bash
npm test          # unit and adversarial tests: rules (UK, US, Croatia, Sweden, France, Netherlands, all Schengen states), MRZ (fuzzed),
                  # encryption (tamper checks), migration, forms, verification, itinerary consistency, cover-letter facts and masking,
                  # booking guides, review rubric and packet masking, draft wording (evasion cases), reminders, flags, globe data,
                  # and the local API (request guard, autofill portal limits, mocked model boundaries for every AI route)
npm run typecheck
npm run build
npm run e2e         # needs `npm run dev` running; Croatia and UK flows in headless Chrome, screenshots in e2e/shots/
npm run e2e:sweden  # needs `npm run dev`; Egypt → Sweden: trip, checklist, funds check, form, itinerary, cover letter,
                    # booking, expert review, packet export, plus a US DS-160/interview booking leg (E2E_SHOTS=<dir> for screenshots)
E2E_URL=http://localhost:4173 npm run e2e   # the production build: run `npm run build && npm run preview` first
```

Reminder trips the e2e runs create are removed from `data/reminders.json` at the end.

## Coverage

| Destination | Routes | Sources |
|---|---|---|
| Sweden | Schengen type C; paper form 119031; SEK 700 a day; hand-in at VFS Global (booking hand-off) | Swedish Migration Agency, Regulation (EU) 2018/1806, European Commission, Visa Code |
| France | Schengen type C, paperwork packet; France-Visas online form; €120 a day (€65 with a hotel, €32.50 with a host's attestation) shown as a warning, because the page could not be read automatically | France-Visas (linked), EU sources |
| Netherlands | Schengen type C, paperwork packet; Dutch online form; €55 a day; VFS Global booking | IND, NetherlandsWorldwide, EU sources |
| Croatia | Schengen type C with CROVISA autofill; visa-free for Annex II nationals; free movement for EU/EEA/CH | Regulation (EU) 2018/1806 (consolidated 30 Dec 2025, saved in `docs/sources`), European Commission, Croatian Ministry of Foreign Affairs |
| Other Schengen states | Schengen type C or visa-free, with EU-wide rules only (no country-specific funds amount) | European Commission and each state's official visa site |
| United Kingdom | ETA, Standard Visitor visa, Youth Mobility Scheme, Skilled Worker | gov.uk |
| United States | ESTA (Visa Waiver Program), B-1/B-2 visitor visa with DS-160 answers and interview booking steps, entry restrictions under Proclamation 10998 | eCFR (8 CFR, 22 CFR), Federal Register, DHS/CBP, White House |
| Anything else | "Not covered yet": no invented requirements | — |

Every checklist item links to its source with the date it was checked; items older than 30 days are flagged.

## Limitations

- **No automated booking.** The app does not sign in to VFS Global, TLScontact, Capago, AIS or gov.uk, solve CAPTCHAs, watch slot pages, pick slots or pay. Visa centres treat that as bot traffic, and those steps are the applicant's. You book; the app opens the page and keeps the details ready.
- **Autofill covers CROVISA and gov.uk only.** France-Visas, the Dutch online form, Sweden's PDF form and the DS-160 are filled along with copy buttons.
- **No reviewer supplied.** The expert review is a rubric, optional AI comments and a packet for a person you choose. It is not legal advice and gives no approval odds.
- **Sources need re-checking.** Rules, fees and daily amounts change. France's daily figures and the US booking systems could not be read automatically and are linked for you to check. The booking link for Sweden and the Netherlands follows VFS Global's address pattern for your country of residence; check that it is the one your local embassy links.
- **Schengen states other than Croatia, Sweden, France and the Netherlands** get EU-wide rules only. There is no country-specific funds amount or booking channel.
- **AI output is checked, not trusted.** The server drops letters with unsupported numbers or approval wording, plan ideas with times or prices, and review comments that grade the application, but you still read everything before you use it. The AI tests use a mocked model; real-model behaviour has not been tested in this repository.
- **English only**, no chat or voice assistant, no document translation, no Canada.
- **The hosted service** (`server/service`, `src/apply`, `src/console`) still files Croatia and the UK only.

### Privacy limits

Not everything is encrypted. What is stored in plain text:

- **Reminders (personal app).** `data/reminders.json` holds your WhatsApp number and the text of each reminder (titles, dates and the trip details they mention) unencrypted, because the local server sends them while the vault is locked. It never holds passport data. Delete the file, or switch reminders off, if that matters on your machine.
- **Portal sign-ins (personal app).** The autofill's Chrome profile in `data/browser-profile` keeps the portals' cookies, like any browser profile.
- **Hosted service database.** The trip (passports, answers), the filing references and uploaded file contents are sealed with `SERVICE_KEY`. Kept in plain text: customers' email addresses (accounts and sign-in links), the agreed declaration text and time (`consent`), appointment preferences (dates and place), the reviewer's return note, the event log (which repeats that note), and uploaded files' names and types. Anyone with the database file can read these, but not the sealed parts without the key.

## Stack

Vite, React 19, TypeScript, Tailwind CSS v4, shadcn/ui on Radix, Magic UI, motion, GSAP, React Three Fiber (trip globe), Hono local API, Anthropic SDK (`claude-opus-5-5`), Twilio REST API.

```
src/rules/        destination rules (UK, US, Croatia, every Schengen state; Sweden/France/Netherlands profiles) with sources
src/forms/        fill-along form definitions (Schengen form fields 1–32, UK answer sheets, DS-160 answers)
src/drafts/       cover letter (template and AI facts), day-by-day itinerary and its consistency check, wording guard
src/booking/      booking assistant per destination: official system, steps, reference checks, copy sheet
src/review/       expert review: rubric, AI review input, reviewer packet
src/verify/       document checks (AI extracts, code decides)
src/notify/       reminder schedule
src/store/        data model, v1→v2 migration, IndexedDB
src/crypto/       passphrase vault
src/mrz/          ICAO 9303 parser
src/data/         country names and codes
src/views/        screens and workspace panels
src/components/   shadcn/Magic UI components and app pieces
src/autofill/     portal autofill: field matching (match.ts) and the portals it may act on (portals.ts)
server/autofill/  the autofill runner (Playwright in a visible Chrome window) and its tests against local copies of the portal pages
server/           local API: app.ts (routes, a factory so tests run without a port), dispatch.ts (due WhatsApp reminders),
                  index.ts (entry point), ai.ts, whatsapp.ts, schedule.ts, guard.ts
scripts/          build helpers (regenerates the land-dot data for the globe: npm run build:land)
e2e/              end-to-end drivers
docs/             research, plan, design, parity audit, official source snapshots
```

## License

MIT, see `LICENSE`.
