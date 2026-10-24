// The packet a human reviewer receives: one self-contained HTML file, built on this device and shared by the
// user however they choose. It holds no passport images or uploaded documents. Passport numbers and contact
// details are masked unless the user switches that off.

import { countryName } from '../data/countries';
import { formatDate } from '../drafts/templates';
import { allFields, fieldValue, formFor } from '../forms/forms';
import { PURPOSE_LABELS, type Route } from '../rules/types';
import { doneKey, travellerName, type ReviewFinding, type Trip } from '../store/model';
import { maskNumber, RUBRIC, scrubPersonal, SENSITIVE_FIELDS, type RubricItem } from './rubric';

export const NOT_ADVICE =
  'This packet is a checklist and a copy of the applicant’s own answers, prepared with an app. It is not legal advice, and neither the app nor this review can promise a visa decision; the embassy or consulate decides.';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface PacketOptions {
  /** Include passport numbers and contact details in clear. Off by default. */
  includePersonal: boolean;
  findings?: ReviewFinding[];
  today?: Date;
}

export function buildReviewPacket(trip: Trip, route: Route, rubric: RubricItem[], opts: PacketOptions): string {
  const form = formFor(route);
  const today = opts.today ?? new Date();
  const mask = (id: string, v: string) => (opts.includePersonal || !SENSITIVE_FIELDS.has(id) ? v : id === 'passport_number' ? maskNumber(v) : '[hidden]');
  // Free text (itinerary, cover letter) can repeat the same details, so every known sensitive value is masked there too.
  const scrub = (text: string) => (opts.includePersonal ? text : scrubPersonal(text, trip, (v, isPassport) => (isPassport ? maskNumber(v) : '[hidden]')));
  const pill = (s: string) => `<span class="s ${esc(s)}">${esc(s)}</span>`;

  const travellers = trip.travellers
    .map((t) => {
      const p = t.passport;
      return `<tr><td>${esc(travellerName(t))}</td><td>${p ? esc(countryName(p.nationality)) : '—'}</td><td>${p ? esc(opts.includePersonal ? p.documentNumber : maskNumber(p.documentNumber)) : 'not read'}</td><td>${p ? esc(p.expiryDate) : '—'}</td><td>${p ? (p.mrzValid ? 'check digits OK' : 'not verified') : '—'}</td></tr>`;
    })
    .join('');

  const checklist = route.checklist
    .flatMap((c) =>
      (c.perTraveller ? trip.travellers : [undefined]).map((t) => {
        const done = trip.checklistDone[doneKey(c.id, t?.id)];
        const doc = t ? t.documents[c.id] : trip.sharedDocuments[c.id];
        return `<tr><td>${esc(c.label)}${t ? ` (${esc(travellerName(t))})` : ''}${c.required ? '' : ' <em>optional</em>'}</td><td>${done ? 'collected' : 'not yet'}</td><td>${doc?.verification ? pill(doc.verification.overall) : '—'}</td><td><a href="${esc(c.source.url)}">${esc(c.source.label)}</a> (checked ${esc(c.source.retrievedOn)})</td></tr>`;
      }),
    )
    .join('');

  const rubricRows = rubric.map((i) => `<tr><td>${esc(RUBRIC[i.area].title)}</td><td>${pill(i.status)}</td><td>${esc(i.text)}</td></tr>`).join('');
  const findings = (opts.findings ?? []).map((f) => `<li>${pill(f.severity)} <b>${esc(f.area)}</b>: ${esc(f.comment)}</li>`).join('');

  const answers = form
    ? trip.travellers
        .map((t) => {
          const rows = allFields(form)
            .map((f) => ({ f, v: fieldValue(trip, t, f) }))
            .map(({ f, v }) => `<tr><td>${f.number ? `${esc(f.number)}. ` : ''}${esc(f.label)}</td><td>${v ? esc(mask(f.id, v)).replace(/\n/g, '<br>') : '<em>empty</em>'}</td></tr>`)
            .join('');
          return `<h3>${esc(form.title)}: ${esc(travellerName(t))}</h3><table>${rows}</table>`;
        })
        .join('')
    : '<p>No application form on this route.</p>';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Review packet: ${esc(route.title)}</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#111;background:#fff}
table{border-collapse:collapse;width:100%;margin:.5rem 0 1.5rem}td,th{border:1px solid #ccc;padding:.35rem .5rem;vertical-align:top;text-align:left}
.note{background:#fff6d6;border:1px solid #e5c75a;padding:.75rem 1rem;border-radius:.5rem}
.s{font-size:12px;padding:0 .4rem;border-radius:1rem;background:#eee}.s.fail{background:#fcd4d4}.s.warn{background:#fdecc0}.s.pass{background:#d6f3dc}
pre{white-space:pre-wrap;background:#f6f6f6;padding:1rem;border-radius:.5rem}
.box{border:1px dashed #888;min-height:8rem;padding:.5rem;border-radius:.5rem}
</style></head><body>
<h1>Review packet</h1>
<p class="note">${esc(NOT_ADVICE)}</p>
<p><b>${esc(route.title)}</b><br>${esc(countryName(trip.input.nationality))} passport → ${esc(countryName(trip.input.destination))} · ${esc(PURPOSE_LABELS[trip.input.purpose])}<br>
${esc(formatDate(trip.input.departDate))} – ${esc(formatDate(trip.input.returnDate))} · ${trip.travellers.length} traveller(s)<br>
Prepared ${esc(formatDate(today.toISOString().slice(0, 10)))}. ${opts.includePersonal ? 'Includes passport numbers and contact details.' : 'Passport numbers and contact details are masked.'} No passport images or uploaded documents are included; the applicant shares those separately if asked.</p>
${route.fee ? `<p>Fee: ${esc(route.fee)}</p>` : ''}

<h2>1. Automatic pre-review (rubric)</h2>
<p>Computed by code from the applicant’s entries. It checks completeness and consistency only; it does not judge the chance of a visa.</p>
<table><tr><th>Area</th><th>Result</th><th>Detail</th></tr>${rubricRows}</table>
${findings ? `<h3>AI comments (suggestions, not decisions)</h3><ul>${findings}</ul>` : ''}

<h2>2. Travellers</h2>
<table><tr><th>Name</th><th>Nationality</th><th>Passport no.</th><th>Expires</th><th>MRZ</th></tr>${travellers}</table>

<h2>3. Document checklist</h2>
<table><tr><th>Document</th><th>Status</th><th>App check</th><th>Official source</th></tr>${checklist}</table>

<h2>4. Application answers</h2>
${answers}

<h2>5. Itinerary</h2>
<pre>${esc(scrub(trip.itineraryText) || '(not built yet)')}</pre>

<h2>6. Cover letter</h2>
<pre>${esc(scrub(trip.coverLetter) || '(none)')}</pre>

<h2>7. Reviewer notes</h2>
<p>Reviewer: please check each section against the official sources linked above, note anything to correct, and send your notes back to the applicant. Do not add facts the applicant has not given.</p>
<div class="box"></div>
<p>Reviewer name and date: ______________________</p>
</body></html>`;
}
