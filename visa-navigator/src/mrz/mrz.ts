// ICAO Doc 9303 TD3 (passport) machine-readable zone: two lines of 44 characters.

export function charValue(ch: string): number {
  if (ch === '<') return 0;
  if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
  if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - 55; // A=10 ... Z=35
  return -1;
}

export function checkDigit(field: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    const v = charValue(field[i]);
    if (v < 0) return -1;
    sum += v * weights[i % 3];
  }
  return sum % 10;
}

function digitAt(s: string, i: number): number {
  const c = s[i];
  if (c === '<') return 0; // ICAO allows filler for an empty optional field's check digit
  return c >= '0' && c <= '9' ? Number(c) : -1;
}

export interface MrzChecks {
  documentNumber: boolean;
  birthDate: boolean;
  expiryDate: boolean;
  personalNumber: boolean;
  composite: boolean;
}

export interface MrzResult {
  valid: boolean;
  checks: MrzChecks;
  documentType: string;
  issuingState: string;
  surname: string;
  givenNames: string;
  documentNumber: string;
  nationality: string;
  birthDate: string; // YYYY-MM-DD
  sex: 'M' | 'F' | 'X';
  expiryDate: string; // YYYY-MM-DD
  personalNumber: string;
  errors: string[];
}

export function normalizeMrzLine(line: string): string {
  return line.toUpperCase().replace(/\s+/g, '').replace(/«/g, '<');
}

/** Converts YYMMDD to YYYY-MM-DD. Birth dates pick the century that keeps the date in the past. */
export function mrzDate(yymmdd: string, kind: 'birth' | 'expiry', today: Date = new Date()): string {
  const yy = Number(yymmdd.slice(0, 2));
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  const currentYY = today.getUTCFullYear() % 100;
  let century: number;
  if (kind === 'birth') {
    century = yy > currentYY ? 1900 : 2000;
  } else {
    century = 2000; // passports issued under TD3 rules expire in the 2000s
  }
  return `${century + yy}-${mm}-${dd}`;
}

export function parseMrz(line1Raw: string, line2Raw: string, today: Date = new Date()): MrzResult {
  const line1 = normalizeMrzLine(line1Raw);
  const line2 = normalizeMrzLine(line2Raw);
  const errors: string[] = [];
  if (line1.length !== 44) errors.push(`Line 1 has ${line1.length} characters; a passport MRZ line has 44.`);
  if (line2.length !== 44) errors.push(`Line 2 has ${line2.length} characters; a passport MRZ line has 44.`);
  if (/[^A-Z0-9<]/.test(line1 + line2)) errors.push('The MRZ can only contain A–Z, 0–9 and <.');

  const documentType = line1.slice(0, 2).replace(/</g, '');
  const issuingState = line1.slice(2, 5).replace(/</g, '');
  const nameField = line1.slice(5);
  const [surnamePart, givenPart = ''] = nameField.split('<<');
  const surname = surnamePart.replace(/</g, ' ').trim();
  const givenNames = givenPart.replace(/</g, ' ').replace(/\s+/g, ' ').trim();

  const docNum = line2.slice(0, 9);
  const docCheck = digitAt(line2, 9);
  const nationality = line2.slice(10, 13).replace(/</g, '');
  const birth = line2.slice(13, 19);
  const birthCheck = digitAt(line2, 19);
  const sexChar = line2[20];
  const expiry = line2.slice(21, 27);
  const expiryCheck = digitAt(line2, 27);
  const personal = line2.slice(28, 42);
  const personalCheck = digitAt(line2, 42);
  const compositeCheck = digitAt(line2, 43);
  const compositeField = line2.slice(0, 10) + line2.slice(13, 20) + line2.slice(21, 43);

  const checks: MrzChecks = {
    documentNumber: checkDigit(docNum) === docCheck,
    birthDate: checkDigit(birth) === birthCheck,
    expiryDate: checkDigit(expiry) === expiryCheck,
    personalNumber: /^<+$/.test(personal) ? personalCheck === 0 : checkDigit(personal) === personalCheck,
    composite: checkDigit(compositeField) === compositeCheck,
  };
  if (!checks.documentNumber) errors.push('Passport number check digit does not match.');
  if (!checks.birthDate) errors.push('Birth date check digit does not match.');
  if (!checks.expiryDate) errors.push('Expiry date check digit does not match.');
  if (!checks.personalNumber) errors.push('Personal number check digit does not match.');
  if (!checks.composite) errors.push('Overall check digit does not match.');

  return {
    valid: errors.length === 0,
    checks,
    documentType,
    issuingState,
    surname,
    givenNames,
    documentNumber: docNum.replace(/</g, ''),
    nationality,
    birthDate: /^\d{6}$/.test(birth) ? mrzDate(birth, 'birth', today) : '',
    sex: sexChar === 'M' || sexChar === 'F' ? sexChar : 'X',
    expiryDate: /^\d{6}$/.test(expiry) ? mrzDate(expiry, 'expiry', today) : '',
    personalNumber: personal.replace(/</g, ''),
    errors,
  };
}
