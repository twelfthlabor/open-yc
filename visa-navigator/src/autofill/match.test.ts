import { describe, expect, it } from 'vitest';
import { classifyButton, datePart, formatDate, isDeclaration, normalize, pickOption, planPage, type FillItem, type PageField } from './match';

const field = (over: Partial<PageField>): PageField => ({
  key: over.key ?? over.name ?? 'k',
  kind: 'text',
  label: '',
  name: '',
  elId: '',
  placeholder: '',
  options: [],
  required: false,
  value: '',
  ...over,
});

const item = (id: string, label: string, value: string, over: Partial<FillItem> = {}): FillItem => ({ id, label, value, ...over });

describe('normalize', () => {
  it('drops field numbers, accents, punctuation and case', () => {
    expect(normalize('13. Number of travel document*')).toBe('number of travel document');
    expect(normalize('E-mail Address')).toBe('email address');
    expect(normalize('Prezime (obiteljsko ime) – Čšž')).toBe('prezime obiteljsko ime csz');
  });
});

describe('planPage', () => {
  const items = [
    item('surname', 'Surname (family name)', 'SILVA', { number: '1' }),
    item('surname_at_birth', 'Surname at birth (former family names)', '', { number: '2' }),
    item('given_names', 'First name(s) (given names)', 'MARTA', { number: '3' }),
    item('birth_date', 'Date of birth', '1998-03-07', { number: '4', type: 'date' }),
    item('issue_date', 'Date of issue', '2020-01-15', { number: '14', type: 'date' }),
    item('email', 'Email address', 'dan@example.com', { type: 'email' }),
    item('sex', 'Sex', 'Male', { type: 'select' }),
  ];

  it('matches fields by label and leaves the surname-at-birth field alone when there is no answer', () => {
    const page = [
      field({ key: 'a', label: '1. Surname (Family name)', name: 'Surname' }),
      field({ key: 'b', label: '2. Surname at birth (Former family name(s))', name: 'SurnameAtBirth' }),
      field({ key: 'c', label: '3. First name(s) (Given name(s))', name: 'FirstName' }),
      field({ key: 'd', label: 'E-mail', name: 'Email', kind: 'email' }),
    ];
    const plan = planPage(page, items);
    const byKey = Object.fromEntries(plan.fills.map((f) => [f.key, f]));
    expect(byKey.a.value).toBe('SILVA');
    expect(byKey.b).toBeUndefined();
    expect(byKey.c.value).toBe('MARTA');
    expect(byKey.d.value).toBe('dan@example.com');
  });

  it('matches plain wordings, and does not put the surname into surname at birth', () => {
    const page = [field({ key: 'a', label: 'Surname' }), field({ key: 'b', label: 'Given names' })];
    expect(planPage(page, items).fills.map((f) => [f.key, f.value])).toEqual([
      ['a', 'SILVA'],
      ['b', 'MARTA'],
    ]);
    const atBirthOnly = [field({ key: 'c', label: 'Surname at birth' })];
    expect(planPage(atBirthOnly, items.filter((i) => i.id !== 'surname_at_birth')).fills).toEqual([]);
  });

  it('never confuses date of birth with date of issue', () => {
    const page = [field({ key: 'x', label: 'Date of issue', kind: 'text', placeholder: 'dd.mm.yyyy' }), field({ key: 'y', label: 'Date of birth', kind: 'text', placeholder: 'dd.mm.yyyy' })];
    const plan = planPage(page, items);
    expect(plan.fills.find((f) => f.key === 'x')?.value).toBe('15.01.2020');
    expect(plan.fills.find((f) => f.key === 'y')?.value).toBe('07.03.1998');
  });

  it('uses portal hints by field name before labels', () => {
    const page = [field({ key: 'z', label: 'Prezime', name: 'Applicant.LastName' })];
    const plan = planPage(page, items, { hints: { 'applicant.lastname': 'surname' } });
    expect(plan.fills).toEqual([expect.objectContaining({ key: 'z', itemId: 'surname', value: 'SILVA' })]);
  });

  it('does not fill a field it cannot match, and lists it when the field is required and empty', () => {
    const page = [field({ key: 'q', label: 'Favourite colour', required: true })];
    const plan = planPage(page, items);
    expect(plan.fills).toEqual([]);
    expect(plan.needsYou.map((f) => f.key)).toEqual(['q']);
  });

  it('does not overwrite a field that already has a value', () => {
    const page = [field({ key: 'a', label: 'Surname', value: 'SMITH' })];
    expect(planPage(page, items).fills).toEqual([]);
  });

  it('picks the select option that matches the answer, and skips the field when none does', () => {
    const page = [
      field({ key: 's', label: 'Sex', kind: 'select', options: ['- Select -', 'MALE', 'FEMALE'] }),
      field({ key: 't', label: 'Gender', kind: 'select', options: ['A', 'B'], required: true }),
    ];
    const plan = planPage(page, items, { aliases: { sex: ['gender'] } });
    expect(plan.fills).toEqual([expect.objectContaining({ key: 's', value: 'MALE' })]);
    expect(plan.needsYou.map((f) => f.key)).toEqual(['t']);
  });

  it('splits a date across day, month and year boxes', () => {
    const page = [
      field({ key: 'd', label: 'Date of birth Day', name: 'dob-day' }),
      field({ key: 'm', label: 'Date of birth Month', name: 'dob-month' }),
      field({ key: 'y', label: 'Date of birth Year', name: 'dob-year' }),
    ];
    const plan = planPage(page, items);
    expect(plan.fills.map((f) => [f.key, f.value])).toEqual([
      ['d', '07'],
      ['m', '03'],
      ['y', '1998'],
    ]);
  });

  it('picks radio options by label', () => {
    const page = [field({ key: 'r', kind: 'radio', label: 'What is your sex?', options: ['Female', 'Male', 'Unspecified'] })];
    expect(planPage(page, items).fills).toEqual([expect.objectContaining({ key: 'r', value: 'Male' })]);
  });

  it('never fills declarations, CAPTCHAs, passwords or file uploads, and reports them as blockers', () => {
    const page = [
      field({ key: 'c', label: 'Please copy the security code', name: 'CaptchaCode', required: true }),
      field({ key: 'p', label: 'Password', kind: 'password', required: true }),
      field({ key: 'f', label: 'Upload photo', kind: 'file' }),
      field({ key: 'dec', kind: 'checkbox', label: 'I declare that to the best of my knowledge all particulars supplied by me are correct', required: true }),
    ];
    const plan = planPage(page, [...items, item('x', 'Security code', 'ABC123'), item('y', 'Password', 'hunter2')]);
    expect(plan.fills).toEqual([]);
    expect(plan.captcha).toBe(true);
    expect(plan.login).toBe(true);
    expect(plan.declarationPending).toBe(true);
  });

  it('treats a ticked declaration as done', () => {
    const page = [field({ key: 'dec', kind: 'checkbox', label: 'I confirm the information is true and complete', checked: true })];
    expect(planPage(page, items).declarationPending).toBe(false);
  });

  it('a captcha that has been typed in no longer blocks', () => {
    const page = [field({ key: 'c', label: 'Security code', name: 'CaptchaCode', value: 'X7Y2' })];
    expect(planPage(page, items).captcha).toBe(false);
  });
});

describe('pickOption', () => {
  it('matches countries and yes/no answers loosely but unambiguously', () => {
    expect(pickOption(['', 'CANADA', 'CHINA'], 'Canada')).toBe('CANADA');
    expect(pickOption(['Canada (CAN)', 'Cameroon (CMR)'], 'Canada')).toBe('Canada (CAN)');
    expect(pickOption(['Yes', 'No'], 'No')).toBe('No');
    expect(pickOption(['M', 'F', 'X'], 'Male')).toBe('M');
    expect(pickOption(['Single entry', 'Two entries', 'Multiple entries'], 'Multiple entries')).toBe('Multiple entries');
  });
  it('returns undefined when nothing matches or two options match equally', () => {
    expect(pickOption(['Red', 'Blue'], 'Canada')).toBeUndefined();
    expect(pickOption(['Guinea', 'Guinea-Bissau', 'Equatorial Guinea'], 'Guin')).toBeUndefined();
  });
});

describe('formatDate', () => {
  it('follows the field', () => {
    expect(formatDate('2026-05-04', field({ kind: 'date' }))).toBe('2026-05-04');
    expect(formatDate('2026-05-04', field({ placeholder: 'DD/MM/YYYY' }))).toBe('04/05/2026');
    expect(formatDate('2026-05-04', field({ placeholder: 'mm/dd/yyyy' }))).toBe('05/04/2026');
    expect(formatDate('2026-05-04', field({}), 'dd.mm.yyyy')).toBe('04.05.2026');
  });
  it('passes through values that are not ISO dates', () => {
    expect(formatDate('sometime', field({}))).toBe('sometime');
  });
});

describe('datePart', () => {
  it('reads day, month and year boxes from the label or name', () => {
    expect(datePart(field({ label: 'Date of birth Day' }))).toBe('day');
    expect(datePart(field({ name: 'dateOfBirth.month' }))).toBe('month');
    expect(datePart(field({ name: 'dob-year' }))).toBe('year');
    expect(datePart(field({ label: 'Date of birth' }))).toBeUndefined();
  });
});

describe('classifyButton', () => {
  it('sorts buttons into next, submit, payment and other', () => {
    expect(classifyButton('Save and continue')).toBe('next');
    expect(classifyButton('Next ›')).toBe('next');
    expect(classifyButton('Create New Request')).toBe('next');
    expect(classifyButton('Submit application')).toBe('submit');
    expect(classifyButton('Pay now')).toBe('payment');
    expect(classifyButton('Back')).toBe('other');
    expect(classifyButton('Print')).toBe('other');
    expect(classifyButton('Delete request')).toBe('other');
  });
});

describe('isDeclaration', () => {
  it('spots declarations and terms', () => {
    expect(isDeclaration('I declare that the information I have given is correct')).toBe(true);
    expect(isDeclaration('I agree to the terms and conditions')).toBe(true);
    expect(isDeclaration('I am aware that the visa fee is not refunded if the visa is refused')).toBe(true);
    expect(isDeclaration('Surname')).toBe(false);
  });
});
