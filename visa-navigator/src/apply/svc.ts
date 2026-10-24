// Browser client for the hosted service API (/svc). Cookies carry the session.

import type { PassportExtraction } from '@/api';
import type { TripInput } from '@/rules/types';
import type { Trip } from '@/store/model';

export type AppStatus = 'draft' | 'in_review' | 'returned' | 'approved' | 'filing' | 'filing_failed' | 'filed' | 'appointment' | 'decided';

export interface Application {
  id: string;
  status: AppStatus;
  trip: Trip;
  consent?: { formId: string; text: string; agreedAt: string };
  preferences?: { dates: string[]; place?: string };
  note?: string;
  filing: {
    travellers?: Record<string, { serial?: string; pin?: string; reference?: string }>;
    appointment?: { at: string; place: string };
    decision?: 'approved' | 'refused';
    documents?: Array<{ fileId: string; name: string }>;
  };
  createdAt: string;
  updatedAt: string;
}

export class SvcError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly missing?: string[],
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
      headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new SvcError('Could not reach the server. Check your connection.', 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new SvcError(body.error ?? `Request failed (${res.status}).`, res.status, body.missing);
  return body as T;
}

export const svc = {
  config: () => call<{ ai: boolean }>('/svc/config'),
  me: () => call<{ email?: string; role: 'customer' | 'operator' }>('/svc/me'),
  requestLink: (email: string) => call<{ ok: true }>('/svc/auth/link', { body: { email } }),
  logout: () => call<{ ok: true }>('/svc/auth/logout', { body: {} }),
  list: () => call<Application[]>('/svc/applications'),
  get: (id: string) => call<Application>(`/svc/applications/${id}`),
  create: (input: TripInput, travellers: number) => call<Application>('/svc/applications', { body: { input, travellers } }),
  saveTrip: (id: string, trip: Trip) => call<Application>(`/svc/applications/${id}/trip`, { method: 'PUT', body: { trip } }),
  upload: (id: string, file: { kind: string; mediaType: string; name: string; data: string; travellerId?: string; itemId?: string }) =>
    call<{ id: string }>(`/svc/applications/${id}/files`, { body: file }),
  fileUrl: (id: string, fileId: string) => `/svc/applications/${id}/files/${fileId}`,
  extractPassport: (id: string, image: string, mediaType: string) => call<PassportExtraction>(`/svc/applications/${id}/extract-passport`, { body: { image, mediaType } }),
  submit: (id: string, body: { agreed: true; declarationText: string; preferences: { dates: string[]; place?: string } }) => call<Application>(`/svc/applications/${id}/submit`, { body }),

  // Operator console
  operatorLogin: (password: string) => call<{ ok: true }>('/svc/operator/login', { body: { password } }),
  queue: (status?: AppStatus) => call<OperatorSummary[]>(`/svc/operator/applications${status ? `?status=${status}` : ''}`),
  review: (id: string) => call<OperatorDetail>(`/svc/operator/applications/${id}`),
  decide: (id: string, body: { action: 'approve' } | { action: 'return'; note: string }) => call<Application>(`/svc/operator/applications/${id}/decision`, { body }),
  operatorUpload: (id: string, file: { kind: string; mediaType: string; name: string; data: string }) => call<{ id: string }>(`/svc/operator/applications/${id}/files`, { body: file }),
  markFiled: (id: string, travellers: Record<string, { serial?: string; pin?: string; reference?: string }>, documents: string[]) =>
    call<Application>(`/svc/operator/applications/${id}/filed`, { body: { travellers, documents } }),
  retry: (id: string) => call<Application>(`/svc/operator/applications/${id}/retry`, { body: {} }),
  appointment: (id: string, at: string, place: string) => call<Application>(`/svc/operator/applications/${id}/appointment`, { body: { at, place } }),
  decided: (id: string, decision: 'approved' | 'refused') => call<Application>(`/svc/operator/applications/${id}/decided`, { body: { decision } }),
};

export interface OperatorSummary {
  id: string;
  status: AppStatus;
  email?: string;
  names: string[];
  route: string;
  destination: string;
  nationality: string;
  departDate?: string;
  preferences?: { dates: string[]; place?: string };
  updatedAt: string;
}

export interface OperatorDetail extends Application {
  email?: string;
  events: Array<{ at: string; actor: string; text: string }>;
  files: Array<{ id: string; kind: string; mediaType: string; name: string; travellerId?: string; itemId?: string; size: number }>;
}

export const STATUS_TEXT: Record<AppStatus, { label: string; detail: string }> = {
  draft: { label: 'Not sent yet', detail: 'Finish the three steps and send it for review.' },
  in_review: { label: 'In review', detail: 'A person is checking your passport, answers and documents before anything is filed.' },
  returned: { label: 'Needs a change', detail: 'The reviewer sent it back with a note. Fix it and send it again.' },
  approved: { label: 'Being filed', detail: 'Checked and approved. We are filling in your official application now.' },
  filing: { label: 'Being filed', detail: 'Your answers are being entered on the official site now.' },
  filing_failed: { label: 'Filing paused', detail: 'Something went wrong on the official site. We will retry; nothing is needed from you.' },
  filed: { label: 'Filed', detail: 'Your application is on the official site. Next: the appointment.' },
  appointment: { label: 'Appointment booked', detail: 'Bring your passport and documents to the appointment.' },
  decided: { label: 'Decision made', detail: 'The decision has come back.' },
};
