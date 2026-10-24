import type { TripInput } from '../rules/types';

export interface PassportRecord {
  surname: string;
  givenNames: string;
  documentNumber: string;
  nationality: string;
  issuingState: string;
  birthDate: string;
  sex: string;
  expiryDate: string;
  issueDate?: string;
  placeOfBirth?: string;
  issuingAuthority?: string;
  mrzLine1?: string;
  mrzLine2?: string;
  mrzValid: boolean;
  /** Id of the passport photo in the encrypted document store. */
  imageDocId?: string;
  confirmedAt: string;
}

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'info';

export interface VerificationCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
}

export interface Verification {
  verifiedAt: string;
  /** 'ai' when fields came from the model; 'manual' when the user typed them. */
  method: 'ai' | 'manual';
  extracted: Record<string, string | number | boolean | null>;
  checks: VerificationCheck[];
  overall: CheckStatus;
}

/** Metadata only; the file itself is encrypted separately in the document store. */
export interface DocumentRecord {
  id: string;
  fileName: string;
  mediaType: string;
  size: number;
  uploadedAt: string;
  verification?: Verification;
}

export interface Traveller {
  id: string;
  label: string;
  passport?: PassportRecord;
  answers: Record<string, string>;
  /** Per-traveller documents, keyed by checklist item id. */
  documents: Record<string, DocumentRecord>;
}

export interface ItineraryStop {
  id: string;
  date: string;
  city: string;
  lodging: string;
  plans: string;
  /** The plans are an AI suggestion the user accepted (shown as such until they edit it). */
  suggested?: boolean;
}

export interface Flight {
  id: string;
  date: string;
  from: string;
  to: string;
  flightNo: string;
}

export type TrackerStatus = 'preparing' | 'submitted' | 'appointment' | 'decided';

export interface AvailabilityWatch {
  enabled: boolean;
  bookingUrl: string;
  everyHours: number;
  lastCheckedAt?: string;
  log: Array<{ at: string; note: string }>;
}

export interface Tracker {
  status: TrackerStatus;
  submittedOn?: string;
  reference?: string;
  appointmentAt?: string;
  appointmentPlace?: string;
  decision?: 'approved' | 'refused' | '';
  decisionOn?: string;
  permissionExpires?: string;
  watch?: AvailabilityWatch;
  booking?: BookingProgress;
}

/** Progress through the official booking system. References are the user's own, copied from the portal. */
export interface BookingProgress {
  /** Country where the application is made (ISO alpha-3). The booking system depends on it, not on nationality. */
  residence?: string;
  done: Record<string, boolean>;
  /** Keys: `${refId}` for shared references, `${refId}:${travellerId}` for per-traveller ones. */
  refs: Record<string, string>;
  preferredDates?: string;
}

export interface ReviewFinding {
  area: string;
  severity: 'fail' | 'warn' | 'info';
  comment: string;
}

/** Hand-off to a human reviewer, and what came back. */
export interface ExpertReview {
  aiFindings?: ReviewFinding[];
  aiAt?: string;
  exportedAt?: string;
  reviewer?: string;
  reviewerNotes?: string;
  receivedAt?: string;
}

export interface Trip {
  id: string;
  createdAt: string;
  updatedAt: string;
  input: TripInput;
  travellers: Traveller[];
  /** One-per-application documents (funds, accommodation, tickets), keyed by checklist item id. */
  sharedDocuments: Record<string, DocumentRecord>;
  /** Keys: `${itemId}:${travellerId}` for per-traveller items, `${itemId}` for shared ones. */
  checklistDone: Record<string, boolean>;
  stops: ItineraryStop[];
  flights: Flight[];
  itineraryText: string;
  coverLetter: string;
  reviewDone: Record<string, boolean>;
  tracker: Tracker;
  expertReview?: ExpertReview;
}

export interface Settings {
  whatsappNumber: string;
  notifyWhatsApp: boolean;
  notifyDesktop: boolean;
}

export interface AppData {
  version: 2;
  trips: Trip[];
  settings: Settings;
}

export const defaultSettings = (): Settings => ({ whatsappNumber: '', notifyWhatsApp: false, notifyDesktop: true });

export const emptyData = (): AppData => ({ version: 2, trips: [], settings: defaultSettings() });

export const newId = (): string => crypto.randomUUID();

export function newTraveller(label: string): Traveller {
  return { id: newId(), label, answers: {}, documents: {} };
}

export function newTrip(input: TripInput, travellerLabels: string[] = ['Traveller 1']): Trip {
  const now = new Date().toISOString();
  return {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    input,
    travellers: travellerLabels.map(newTraveller),
    sharedDocuments: {},
    checklistDone: {},
    stops: [],
    flights: [],
    itineraryText: '',
    coverLetter: '',
    reviewDone: {},
    tracker: { status: 'preparing' },
  };
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

export function travellerName(t: Traveller): string {
  if (t.passport) return titleCase(`${t.passport.givenNames} ${t.passport.surname}`);
  return t.label;
}

export function doneKey(itemId: string, travellerId?: string): string {
  return travellerId ? `${itemId}:${travellerId}` : itemId;
}
