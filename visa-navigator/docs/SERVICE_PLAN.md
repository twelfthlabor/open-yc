# Visa Navigator as a service: plan

Decided 2026-10-14 with the operator: a free public web service. Customers do three steps; the operator reviews every application and the filing runs on the operator's PC. Routes stay Croatia (Schengen C) and UK for now. The personal, local-vault app keeps working alongside.

## Customer flow (three steps)

1. **Where and when.** Destination, dates, purpose, passport country, travellers. The rules engine shows the visa, fee and timing.
2. **Passport and details.** Upload the passport photo (AI reads it, MRZ check digits verify it). The app then asks only for answers the form still needs (form fields minus those derived from the passport and trip), and collects the documents the route lists. The customer reads the portal's declaration and agrees to it; the text, time and account are recorded.
3. **Pick a time.** Preferred appointment dates and place. Then a status page: in review, returned (with the operator's note), filing, filed (reference and, for Croatia, the signed-form PDF to print), appointment, decision.

## Operator

- **Console** (hosted): queue by status; review screen with the passport photo beside the extracted fields, every answer, document check results, cover letter and itinerary. Approve, or return with a note.
- **Filing by hand** (decided 2026-10-14): after approving, the operator opens the official form from the console, pastes each answer with its copy button, then records the portal's serial number, PIN or reference and uploads the filed form. The customer sees the references and downloads the form, cover letter and itinerary, with a list of what to bring.
- **Agent** (deferred): a program on the operator's PC that would claim approved applications and run the autofill. The API for it (`/svc/agent/*`) exists and is tested; the program is not built.
- **Appointments:** the console opens the booking page with the customer's details and preferred dates; the operator books. No automated slot-checking or bot logins to VFS or TLScontact.

## Data and limits

- SQLite on a mounted volume (node:sqlite), with nightly backups. Passport images, documents and answers are encrypted at rest with AES-256-GCM; the key is an env var (`SERVICE_KEY`), never in the database.
- Customer sign-in by email link; operator sign-in by password (`OPERATOR_PASSWORD`); agent by bearer token (`AGENT_TOKEN`).
- Consent screen names Anthropic as the AI processor and says the operator files on the customer's behalf.
- Deletion: files and answers are deleted 30 days after a decision, or 90 days after the last activity, or on request.
- Limits: per-account and per-IP caps on sign-in emails, uploads and AI reads; a daily AI spend cap.

## Open items

- Which portal codes go to the customer's email (gov.uk account, visa centre); the status page asks the customer for a code when one is needed.
- Hosting: Fly.io (one machine, a volume, the domain) plus an email provider for sign-in links. Needs the operator's accounts; done last.
  On Fly.io set `TRUST_PROXY_HEADER=fly-client-ip` (in `fly.toml` `[env]` or as a secret). The sign-in and console login rate limits ignore forwarding headers unless this names one, so without it every customer shares the proxy's limit.
- Legal: `PLAN.md` gate 1 (licensed review) before public launch, even when free.

## Build order

1. Data model, encrypted storage, sign-in, API (local, tested).
2. Customer three-step flow.
3. Operator console.
4. Filing by hand from the console (done). Agent deferred.
5. Notifications and assisted booking.
6. Deploy.
