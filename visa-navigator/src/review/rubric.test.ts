import { describe, expect, it } from 'vitest';
import { resolveRoute } from '../rules/engine';
import { newTrip, type Trip } from '../store/model';
import { buildReviewPacket, NOT_ADVICE } from './packet';
import { aiReviewInput, maskNumber, runRubric } from './rubric';

const TODAY = new Date('2026-10-23T00:00:00Z');
const trip = (): Trip => {
  const t = newTrip({ nationality: 'EGY', destination: 'SWE', purpose: 'tourism', passportType: 'national', departDate: '2026-12-01', returnDate: '2026-12-03' }, ['Anna']);
  t.travellers[0].passport = {
    surname: 'HASSAN',
    givenNames: 'ANNA',
    documentNumber: 'A12345678',
    nationality: 'EGY',
    issuingState: 'EGY',
    birthDate: '1990-01-01',
    sex: 'F',
    expiryDate: '2031-01-01',
    issueDate: '2021-01-01',
    mrzValid: true,
    confirmedAt: '',
  };
  t.travellers[0].answers = { email: 'anna@example.com', phone: '+20 100 000 0000', address: '1 Nile St' };
  return t;
};
const route = (t: Trip) => resolveRoute(t.input, TODAY);

describe('pre-review rubric', () => {
  it('finds missing documents, empty answers and an unbooked appointment', () => {
    const t = trip();
    const items = runRubric(t, route(t), TODAY);
    expect(items.some((i) => i.area === 'documents' && i.status === 'fail' && /Missing: Passport photo/.test(i.text))).toBe(true);
    expect(items.some((i) => i.area === 'form' && i.status === 'fail')).toBe(true);
    expect(items.some((i) => i.area === 'booking' && i.status === 'warn')).toBe(true);
    expect(items.some((i) => i.area === 'passports' && i.status === 'pass')).toBe(true);
  });

  it('flags a cover letter with placeholders, wrong dates or a promise', () => {
    const t = trip();
    t.coverLetter = 'I am sure the visa will be approved. [add your occupation]';
    const letter = runRubric(t, route(t), TODAY).filter((i) => i.area === 'cover_letter');
    expect(letter.map((i) => i.status)).toEqual(expect.arrayContaining(['fail', 'warn']));
    expect(letter.some((i) => /promises/.test(i.text))).toBe(true);
    expect(letter.some((i) => /placeholders/.test(i.text))).toBe(true);
    expect(letter.some((i) => /1 December 2026/.test(i.text))).toBe(true);
  });

  it('reports itinerary gaps from the day-by-day check', () => {
    const t = trip();
    const it = runRubric(t, route(t), TODAY).filter((i) => i.area === 'itinerary');
    expect(it.some((i) => /accommodation/.test(i.text))).toBe(true);
  });

  it('gives no score and no prediction', () => {
    const t = trip();
    const text = JSON.stringify(runRubric(t, route(t), TODAY));
    expect(text).not.toMatch(/score|likely|chance|approv|odds/i);
  });

  it('the AI input has no passport number, email or phone', () => {
    const t = trip();
    t.coverLetter = 'Passport A12345678, email anna@example.com, phone +20 100 000 0000, arriving 2026-12-01.';
    const input = aiReviewInput(t, route(t), runRubric(t, route(t), TODAY));
    for (const s of ['A12345678', 'anna@example.com', '+20 100 000 0000']) expect(input).not.toContain(s);
    expect(input).toContain('2026-12-01'); // dates are kept, so the AI can spot date mismatches
  });

  it('the AI input has no home address from the template letter and no phone typed without +', async () => {
    const { buildCoverLetter } = await import('../drafts/templates');
    const t = trip();
    t.travellers[0].answers.address = '1 Nile St\nZamalek, Cairo';
    t.coverLetter = `${buildCoverLetter(t, 'schengen_c', TODAY)}\nCall me on 0100 000 0000 or 0100-000-0000.`;
    expect(t.coverLetter).toContain('1 Nile St'); // the template does include the address
    const input = aiReviewInput(t, route(t), runRubric(t, route(t), TODAY));
    for (const s of ['1 Nile St', 'Zamalek, Cairo', '0100 000 0000', '0100-000-0000', 'A12345678', 'anna@example.com']) expect(input, s).not.toContain(s);
    expect(input).toContain('1 December 2026');
  });
});

describe('reviewer packet', () => {
  it('masks passport numbers and contact details by default and says it is not legal advice', () => {
    const t = trip();
    const r = route(t);
    const html = buildReviewPacket(t, r, runRubric(t, r, TODAY), { includePersonal: false, today: TODAY });
    expect(html).toContain(NOT_ADVICE.slice(0, 30));
    expect(html).not.toContain('A12345678');
    expect(html).not.toContain('anna@example.com');
    expect(html).toContain(maskNumber('A12345678'));
    expect(html).toContain('Reviewer notes');
    expect(html).toContain('migrationsverket.se');
  });

  it('also masks them inside the cover letter and itinerary text', () => {
    const t = trip();
    t.coverLetter = 'Anna Hassan\n1 Nile St\nanna@example.com\nMy passport number is A12345678.';
    const r = route(t);
    const html = buildReviewPacket(t, r, runRubric(t, r, TODAY), { includePersonal: false, today: TODAY });
    for (const s of ['A12345678', 'anna@example.com', '1 Nile St']) expect(html).not.toContain(s);
    expect(html).toContain('My passport number is ' + maskNumber('A12345678'));
  });

  it('includes them only when asked, and escapes what the user typed', () => {
    const t = trip();
    t.coverLetter = '<script>alert(1)</script>';
    const r = route(t);
    const html = buildReviewPacket(t, r, runRubric(t, r, TODAY), { includePersonal: true, today: TODAY });
    expect(html).toContain('A12345678');
    expect(html).toContain('anna@example.com');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
