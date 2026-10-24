# Parity with Veeza AI: capability checklist and audit

Retrieved 2026-10-23. Visa Navigator is an independent open-source project. It is **not affiliated with, endorsed by or derived from Veeza AI**, and it uses none of Veeza's name, branding, copy or code (see `PLAN.md`). The descriptions below are paraphrased from public pages to define what "the same jobs" means; nothing here is copied from Veeza's product.

## Sources

| # | Source | Kind |
|---|---|---|
| S1 | Company site, home, package and FAQ pages: https://veeza.ai (fetched 2026-10-23) | Company site |
| S2 | Y Combinator company page: https://www.ycombinator.com/companies/veeza-ai (fetched 2026-10-23) | YC profile |
| S3 | RuntimeWire, "Veeza AI launches a visa agent for travelers" (launch announced 19 Oct 2026): https://runtimewire.com/article/veeza-ai-launches-visa-agent-for-travelers | Press |
| S4 | EnterpriseAM, "One Egyptian founder and AI enthusiast is out to fix the broken visa process…" (10 Aug 2026): https://enterpriseam.com/egypt/2026/08/10/one-egyptian-founder-and-ai-enthusiast-is-out-to-fix-the-broken-visa-process-plaguing-residents-of-the-global-south/ | Press |
| S5 | `docs/RESEARCH.md`, competitor table (2026-10-09) | Earlier notes |

The sources disagree in places. S1 lists more "full service" Schengen states (Croatia, Finland, Denmark, Norway, Sweden, Estonia, Malta, Greece) and puts France, Germany and the Netherlands in early access. The brief for this work (S5) names Sweden, the UK and the US, with paperwork-only help for France and the Netherlands. This audit uses the brief's list as the minimum and notes the wider list.

## Capability checklist

Status values: **done**, **partial**, or **not done** with the reason (including "by design", where a principle in `README.md`, `PLAN.md` or `SYSTEM_DESIGN.md` rules it out).

| # | Veeza capability (paraphrased) | Source | Status here | Where / notes |
|---|---|---|---|---|
| 1 | Upload a passport photo; details are extracted automatically | S1, S2, S4 | **done** (before this work) | `PassportReader` + `server/ai.ts`; MRZ check digits verified locally (`src/mrz`). Without a key: type the MRZ. |
| 2 | Required-document checklist per destination | S1, S2 | **done** | `src/rules/*`. Every item links an official source with a date. New: Sweden, France and the Netherlands profiles, the other Schengen states (generic route), US B-1/B-2 and ESTA. |
| 3 | AI document checks (flag what's missing or wrong) | S1, S2 | **done** (before this work), extended | `src/verify/checks.ts`. New: Sweden SEK 700/day, Netherlands €55/day, France tiers (€120, or €65 with a hotel) as a warning, and the US 6-month passport rule. |
| 4 | Fills the government application forms | S1, S2, S4 | **done / partial** | Schengen form fields 1–32, UK answer sheets, and **new** DS-160 (B-1/B-2) answers (`src/forms/forms.ts`). Autofill runs on CROVISA and gov.uk only. It is now limited to Croatia, so a Swedish or French application can never be typed into CROVISA. Sweden uses a paper PDF form, France-Visas and the Dutch form are copied from the answer sheet, and the DS-160 is copy-along (ceac.state.gov is not automated). |
| 5 | AI-written cover letter | S1 (packages), S4 | **done** | `src/drafts/coverLetter.ts` and `/api/cover-letter`. Grounded in trip facts. Passport number, address and email are sent as tokens and filled in locally. The server discards a letter with a number not found in the facts, or with approval wording. Without a key: the template letter. |
| 6 | Travel itinerary | S1, S4 | **done** | `src/drafts/itinerary.ts`. One row per day from arrival to departure, with flights on their dates and lodging carried forward. A consistency check covers days outside the trip, nights without a bed, missing outbound or return flights, and gaps against the booking document's check-in/out. Optional AI ideas for free days must each be accepted and stay marked "suggested". |
| 7 | Books the visa appointment (biometrics for UK, embassy interview for US) | S1, S2 | **partial, by design** | `src/booking/booking.ts` and `BookingAssistant`. Per destination it gives the official system for the applicant's country of residence (VFS Global for Sweden and the Netherlands, France-Visas then TLScontact/VFS/Capago, gov.uk then a visa application centre, US DS-160 → fee → embassy booking system), a step tracker, reference fields with format checks (DS-160 `AA…`, GWF), and a copy sheet. The app does not sign in, solve CAPTCHAs, pick slots or pay. S2 says Veeza uses computer-use agents on government portals; that is excluded here because visa centres treat it as bot traffic (see `SYSTEM_DESIGN.md`). |
| 8 | Appointment availability tracking with notifications | S1 | **partial, by design** | Reminders to check the booking page at a set interval (WhatsApp or desktop). The app does not poll or scrape slot pages. |
| 9 | Human expert review before submission | S1, S2, S4 | **partial** | New Expert review panel. A fixed **rubric** in code covers passports, documents, form, itinerary/dates, cover letter and appointment (no score, no approval odds). An optional **AI pre-review** adds comments; findings that grade the application or predict a decision are dropped. A **reviewer packet** (one HTML file, passport numbers and contact details masked by default, no images) goes to a human of the user's choosing, and the reviewer's notes are recorded. The app supplies no reviewer itself. |
| 10 | Adversarial AI first pass before the human | S4 | **done** | Same as 9: rubric plus AI pre-review. |
| 11 | Coverage: Schengen via Sweden, UK, US; paperwork-only France and Netherlands | S5 (brief), S1 | **done** | Sweden (full route, VFS booking hand-off), UK (existing), US (ESTA, B-1/B-2, proclamation restrictions), France and the Netherlands (marked `service: 'paperwork'`). Croatia keeps its CROVISA route. |
| 12 | Wider Schengen list (Finland, Denmark, Norway, Estonia, Malta, Greece, Germany, …) | S1 | **partial** | All 29 Schengen states resolve to a sourced type C route (EU-wide fee, timing, insurance, form). Only Croatia, Sweden, France and the Netherlands have a state-specific funds amount and booking channel. The others have no funds amount rather than a guessed one. |
| 13 | Canada and ~33 destinations | S2 | **not done** | Out of scope. There are no New Zealand or Canada rules. |
| 14 | Multiple travellers on one application, group handling | S1 | **done** (before this work) | Apply together; shared answers entered once. |
| 15 | Reusable document vault across trips | S1 | **partial** | Everything is kept in the encrypted local vault. There is no "copy passport to new trip" shortcut yet. |
| 16 | WhatsApp updates | S1, S4 | **partial** | WhatsApp reminders via Twilio (optional). No two-way chat assistant. |
| 17 | Web chat / voice assistant | S1 | **not done** | Not built. A voice agent is outside this project's scope. |
| 18 | Arabic/English interface | S1 | **not done** | English only; the interface has no translations. |
| 19 | Document translation (Arabic → English) | S4 | **not done** | Not built. |
| 20 | Quizzes: destination finder, "application strength" score, "when to start" | S1 | **not done, by design (score)**; partial (timing) | `PLAN.md` rule 4 forbids eligibility or approval-odds outputs, so there is no strength score. "When to apply" is covered by the apply-window dates and reminders. |
| 21 | Paid service, refunds, B2B tier | S1, S4 | **not applicable** | Free, local, personal tool. No payments. |
| 22 | "Not legal advice", no outcome guarantee | S1 | **done** | Draft wording guard (`FORBIDDEN_PHRASES`), a not-legal-advice banner in Expert review and in the packet, and "Limitations" in the README. |
| 23 | Works without paid AI (degraded manual mode) | README promise | **done** | No key: passport by MRZ, documents typed in, template letter, deterministic itinerary and rubric. The AI buttons are hidden and the endpoints answer 503 with the manual alternative. |

## Audit before this work (what existed)

Coverage was Croatia and the UK only, with Croatia's Schengen route, CROVISA and gov.uk autofill. The template cover letter and an itinerary listing only the days the user entered were each polished by AI. There were document checks, MRZ, reminders, a self-review checklist and a print packet. Missing: Sweden, France, the Netherlands, the US and the DS-160. Also missing: grounded AI letter writing, a day-by-day itinerary with consistency checks, per-country booking guidance, an expert-review rubric and reviewer packet, and Schengen decision reminders outside Croatia. One latent bug would have appeared with more Schengen states: autofill would have offered CROVISA for any `schengen_c` form.

## Official sources added in this work (retrieved 2026-10-23)

- Swedish Migration Agency, Visiting Sweden for up to 90 days: SEK 700 a day, VFS Global in most countries, form 119031, €90 fee, decision normally in 15 days.
- IND (Netherlands): at least €55 per person per day. NetherlandsWorldwide: online form at `consular.mfaservices.nl`, then a VFS Global appointment, booked by the applicant, one per person.
- France-Visas: online application, then the centre assigned for the place of residence (consulate, TLScontact, VFS Global or Capago). The daily figures (€120, €65 with a hotel, €32.50 with an attestation d'accueil) were confirmed only through search excerpts of france-visas.gouv.fr and service-public.fr, because the pages refuse automated reading (HTTP 403). The app links the page, labels the figure as unquoted, and warns rather than fails.
- US: 22 CFR 41.102/41.103 and 22.1 (eCFR) for the interview, DS-160 and fee, plus the visa appointment service many embassies use (ais.usvisa-info.com). The embassy's own visa page decides which booking system applies. travel.state.gov refuses automated requests, so it is not quoted.
- gov.uk: book at a visa application centre after the online application; centre finder.
