// Matches the fields on an official portal page to the answers prepared in the app.
// Pure functions: the runner collects the page's fields in the browser, this decides what goes where,
// and the runner types it in. Nothing here invents a value: a field gets an answer only when the
// answer exists and the match is clear, otherwise it is left for the user.

export type PageFieldKind = 'text' | 'email' | 'tel' | 'number' | 'date' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'password' | 'file';

export interface PageField {
  /** Runner-assigned handle for the element (or radio group). */
  key: string;
  kind: PageFieldKind;
  /** Visible label text, including a fieldset legend for grouped inputs. */
  label: string;
  name: string;
  elId: string;
  placeholder: string;
  /** Option texts for selects and radio groups. */
  options: string[];
  required: boolean;
  /** Current value; for selects the selected option's value attribute ('' for a placeholder). */
  value: string;
  checked?: boolean;
}

export interface FillItem {
  id: string;
  label: string;
  /** Official field number, when the form has one. */
  number?: string;
  value: string;
  type?: string;
}

export interface Fill {
  key: string;
  itemId: string;
  value: string;
  kind: PageFieldKind;
}

export interface PagePlan {
  fills: Fill[];
  /** Required fields left empty that the app has no answer for. */
  needsYou: PageField[];
  /** An empty CAPTCHA box is on the page. */
  captcha: boolean;
  /** A CAPTCHA box is on the page, typed in or not: the user presses the button on such pages. */
  captchaOnPage: boolean;
  login: boolean;
  loginOnPage: boolean;
  declarationPending: boolean;
}

export interface PlanOptions {
  /** Portal-specific: field name or id (lower case) → answer id. */
  hints?: Record<string, string>;
  /** Extra label wordings per answer id, added to the defaults. */
  aliases?: Record<string, string[]>;
  /** Date format for text date boxes without a placeholder, e.g. 'dd.mm.yyyy'. */
  dateFormat?: string;
}

/** Other wordings portals use for the same question. */
export const DEFAULT_ALIASES: Record<string, string[]> = {
  surname: ['surname', 'family name', 'last name'],
  given_names: ['first name', 'first names', 'given name', 'given names', 'forename'],
  birth_date: ['date of birth', 'birth date'],
  place_of_birth: ['place of birth', 'city of birth', 'town of birth'],
  country_of_birth: ['country of birth', 'state of birth'],
  nationality: ['current nationality', 'nationality', 'citizenship'],
  sex: ['gender'],
  civil_status: ['marital status', 'relationship status'],
  national_id: ['national identity number', 'personal identification number', 'national id'],
  document_type: ['type of travel document', 'travel document type', 'document type'],
  passport_number: ['number of travel document', 'travel document number', 'passport number', 'document number'],
  issue_date: ['date of issue', 'issue date', 'issued on'],
  expiry_date: ['valid until', 'date of expiry', 'expiry date', 'expiration date'],
  issued_by: ['issued by', 'issuing country', 'issuing state'],
  issuing_authority: ['issuing authority', 'authority'],
  email: ['email', 'email address'],
  phone: ['telephone', 'telephone number', 'phone number', 'mobile number'],
  address: ['home address', 'address', 'street'],
  occupation: ['current occupation', 'occupation', 'profession', 'employment status'],
  main_destination: ['member state of main destination', 'main destination'],
  first_entry: ['member state of first entry', 'first entry', 'border of first entry'],
  entries: ['number of entries requested', 'number of entries', 'entries requested'],
  arrival_date: ['intended date of arrival', 'date of arrival', 'arrival date'],
  departure_date: ['intended date of departure', 'date of departure', 'departure date'],
  host_name: ['name of hotel', 'hotel name', 'inviting person', 'accommodation'],
  cost_covered_by: ['cost of travelling and living', 'who is paying for the trip', 'who is paying'],
};

const STOP = new Set(
  'a an and are as at be by do does for from have if in is it of on or please the to was what where which who with you your applicable required optional'.split(' '),
);

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\be-mail/g, 'email')
    .replace(/^\s*\d{1,2}[a-z]?\s*[.):]\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(s: string): Set<string> {
  return new Set(
    normalize(s)
      .split(' ')
      .filter((w) => w.length > 1 && !STOP.has(w))
      .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

const PART_WORD = /\b(day|month|year)\s*$/i;

export function datePart(f: Pick<PageField, 'label' | 'name' | 'elId'>): 'day' | 'month' | 'year' | undefined {
  const fromLabel = normalize(f.label).match(/(?:^|\s)(day|month|year)$/);
  if (fromLabel) return fromLabel[1] as 'day' | 'month' | 'year';
  for (const n of [f.name, f.elId]) {
    if (!n) continue;
    const m = n.match(/(?:^|[-_.\s[])(day|month|year)\]?$/i) ?? n.match(/[a-z0-9](Day|Month|Year)$/);
    if (m) return m[1].toLowerCase() as 'day' | 'month' | 'year';
  }
  return undefined;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatDate(iso: string, f: Pick<PageField, 'kind' | 'placeholder'>, fallback?: string): string {
  const m = iso.match(ISO);
  if (!m) return iso;
  if (f.kind === 'date') return iso;
  const ph = f.placeholder.trim().toLowerCase();
  const pattern = /^(dd|mm|yyyy)[./ -](dd|mm)[./ -](yyyy|dd)$/.test(ph) ? ph : fallback?.toLowerCase();
  if (!pattern) return iso;
  return pattern.replace('yyyy', m[1]).replace('mm', m[2]).replace('dd', m[3]);
}

const SYNONYMS: Record<string, string[]> = {
  male: ['m'],
  female: ['f'],
  m: ['male'],
  f: ['female'],
  yes: ['y', 'true'],
  no: ['n', 'false'],
};

const PLACEHOLDER_OPTION = /^(select|choose|please select|please choose|select type|)$/;

/** The option that matches the answer, or undefined when none does or the choice is ambiguous. */
export function pickOption(options: string[], value: string): string | undefined {
  const v = normalize(value);
  if (!v) return undefined;
  const variants = [v, ...(SYNONYMS[v] ?? [])];
  const real = options.filter((o) => !PLACEHOLDER_OPTION.test(normalize(o)));
  const norm = real.map((o) => normalize(o));
  const unique = (hits: number[]) => (hits.length === 1 ? real[hits[0]] : undefined);
  const where = (test: (o: string) => boolean) => norm.flatMap((o, i) => (test(o) ? [i] : []));

  const exact = where((o) => variants.includes(o));
  if (exact.length) return unique(exact);
  const prefixed = where((o) => variants.some((x) => o.startsWith(`${x} `)));
  if (prefixed.length) return unique(prefixed);
  const words = where((o) => variants.some((x) => x.length > 2 && ` ${o} `.includes(` ${x} `)));
  return unique(words);
}

export function isDeclaration(label: string): boolean {
  return /\b(i declare|i confirm|i agree|i accept|i am aware|i understand|i certify|declaration|terms and conditions|terms of use|consent)\b/.test(normalize(label));
}

function isCaptcha(f: PageField): boolean {
  return /captcha/i.test(`${f.name} ${f.elId}`) || /\b(captcha|copy the (security )?code|characters (in|from) the image|code (in|from) the image)\b/.test(normalize(f.label));
}

function isLoginSecret(f: PageField): boolean {
  return f.kind === 'password' || /\b(one time|verification code|security code sent|passcode|sign in code)\b/.test(normalize(f.label));
}

export type ButtonRole = 'next' | 'submit' | 'payment' | 'other';

export function classifyButton(text: string): ButtonRole {
  const t = normalize(text);
  if (/\b(pay|payment|checkout)\b/.test(t)) return 'payment';
  if (/\b(back|previous|cancel|delete|remove|print|logout|log out|sign out|exit|clear|reset|refresh|download)\b/.test(t)) return 'other';
  if (/\b(submit|send application|finali[sz]e|complete application|confirm and send|lock request)\b/.test(t)) return 'submit';
  if (/\b(next|continue|proceed|create new request|start|save|forward|dalje)\b/.test(t)) return 'next';
  return 'other';
}

function labelFor(f: PageField): string {
  const base = f.label || f.placeholder || f.name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._-]+/g, ' ');
  return base.replace(PART_WORD, '');
}

function score(item: FillItem, f: PageField, opts: PlanOptions): number {
  const hint = opts.hints?.[f.name.toLowerCase()] ?? opts.hints?.[f.elId.toLowerCase()];
  if (hint) return hint === item.id ? 2 : 0;
  const text = labelFor(f);
  const fieldTokens = tokens(text);
  const texts = [item.label, ...(DEFAULT_ALIASES[item.id] ?? []), ...(opts.aliases?.[item.id] ?? [])];
  let best = 0;
  for (const t of texts) {
    if (normalize(t) === normalize(text)) return 1.5;
    best = Math.max(best, jaccard(tokens(t), fieldTokens));
  }
  const num = f.label.match(/^\s*(\d{1,2})\s*[.):]/)?.[1];
  if (best > 0 && num && item.number === num) best += 0.2;
  return best;
}

const THRESHOLD = 0.6;

export function planPage(fields: PageField[], items: FillItem[], opts: PlanOptions = {}): PagePlan {
  const plan: PagePlan = { fills: [], needsYou: [], captcha: false, captchaOnPage: false, login: false, loginOnPage: false, declarationPending: false };
  const candidates: PageField[] = [];

  for (const f of fields) {
    if (isCaptcha(f)) {
      plan.captchaOnPage = true;
      if (!f.value) plan.captcha = true;
    } else if (isLoginSecret(f)) {
      plan.loginOnPage = true;
      if (!f.value) plan.login = true;
    } else if (f.kind === 'checkbox') {
      if (isDeclaration(f.label)) {
        if (!f.checked) plan.declarationPending = true;
      } else if (f.required && !f.checked) plan.needsYou.push(f);
    } else if (f.kind === 'file') {
      if (f.required && !f.value) plan.needsYou.push(f);
    } else candidates.push(f);
  }

  const pairs: Array<{ f: PageField; item: FillItem; s: number; part?: string }> = [];
  for (const f of candidates) {
    const part = datePart(f);
    for (const item of items) {
      if (part && item.type !== 'date') continue;
      const s = score(item, f, opts);
      if (s >= THRESHOLD) pairs.push({ f, item, s, part });
    }
  }
  pairs.sort((a, b) => b.s - a.s);

  const usedFields = new Set<string>();
  const usedItems = new Set<string>();
  const matched = new Map<string, { item: FillItem; part?: string }>();
  for (const p of pairs) {
    const itemKey = `${p.item.id}|${p.part ?? ''}`;
    if (usedFields.has(p.f.key) || usedItems.has(itemKey)) continue;
    usedFields.add(p.f.key);
    usedItems.add(itemKey);
    matched.set(p.f.key, { item: p.item, part: p.part });
  }

  for (const f of candidates) {
    const m = matched.get(f.key);
    const value = m && !f.value ? valueFor(f, m.item, m.part, opts) : undefined;
    if (m && value) plan.fills.push({ key: f.key, itemId: m.item.id, value, kind: f.kind });
    else if (f.required && !f.value) plan.needsYou.push(f);
  }
  return plan;
}

function valueFor(f: PageField, item: FillItem, part: string | undefined, opts: PlanOptions): string | undefined {
  if (!item.value) return undefined;
  if (part) {
    const m = item.value.match(ISO);
    if (!m) return undefined;
    return part === 'year' ? m[1] : part === 'month' ? m[2] : m[3];
  }
  if (f.kind === 'select' || f.kind === 'radio') return pickOption(f.options, item.value);
  if (item.type === 'date') return formatDate(item.value, f, opts.dateFormat);
  return item.value;
}
