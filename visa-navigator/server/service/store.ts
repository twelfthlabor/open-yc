// Storage for the hosted service: one SQLite file on the server's volume.
// Trips (all answers and passport fields), files and portal references are encrypted with crypto.ts;
// only what the queue needs to sort and route on (status, dates, owner) is stored in the clear.

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Trip } from '../../src/store/model';
import { hashToken, newToken, openBytes, openJson, sealBytes, sealJson } from './crypto';

export type AppStatus = 'draft' | 'in_review' | 'returned' | 'approved' | 'filing' | 'filing_failed' | 'filed' | 'appointment' | 'decided';
export type Role = 'customer' | 'operator';

/** The customer's agreement to the portal's declaration: exactly what they were shown, and when. */
export interface Consent {
  formId: string;
  text: string;
  agreedAt: string;
}

export interface Preferences {
  dates: string[];
  place?: string;
}

/** Results of filing: portal references per traveller, the booked appointment, the decision. */
export interface Filing {
  travellers?: Record<string, { serial?: string; pin?: string; reference?: string; pdfFileId?: string }>;
  appointment?: { at: string; place: string };
  decision?: 'approved' | 'refused';
  /** Files the customer can download: the filed application form, confirmations. */
  documents?: Array<{ fileId: string; name: string }>;
}

export interface AppRecord {
  id: string;
  userId: string;
  status: AppStatus;
  trip: Trip;
  consent?: Consent;
  preferences?: Preferences;
  note?: string;
  filing: Filing;
  createdAt: string;
  updatedAt: string;
}

export interface FileMeta {
  kind: string;
  mediaType: string;
  name: string;
  travellerId?: string;
  itemId?: string;
}

const LINK_MS = 15 * 60_000;
const SESSION_MS = 30 * 24 * 3600_000;
const DAY = 24 * 3600_000;

const SCHEMA = `
pragma journal_mode = wal;
pragma foreign_keys = on;
create table if not exists users (id text primary key, email text unique not null, created_at integer not null);
create table if not exists links (token_hash text primary key, email text not null, expires_at integer not null, used_at integer);
create table if not exists sessions (token_hash text primary key, user_id text references users(id) on delete cascade, role text not null, expires_at integer not null);
create table if not exists applications (
  id text primary key, user_id text not null references users(id) on delete cascade, status text not null,
  trip blob not null, consent text, preferences text, note text, filing blob,
  created_at integer not null, updated_at integer not null, decided_at integer);
create index if not exists applications_status on applications(status, updated_at);
create index if not exists applications_user on applications(user_id, updated_at);
create table if not exists files (
  id text primary key, application_id text not null references applications(id) on delete cascade,
  meta text not null, size integer not null, data blob not null, created_at integer not null);
create table if not exists events (
  id integer primary key autoincrement, application_id text not null references applications(id) on delete cascade,
  at integer not null, actor text not null, text text not null);
`;

interface AppRow {
  id: string;
  user_id: string;
  status: AppStatus;
  trip: Uint8Array;
  consent: string | null;
  preferences: string | null;
  note: string | null;
  filing: Uint8Array | null;
  created_at: number;
  updated_at: number;
}

const iso = (ms: number) => new Date(ms).toISOString();
const buf = (u: Uint8Array) => Buffer.from(u.buffer, u.byteOffset, u.byteLength);

export class ServiceStore {
  private db: DatabaseSync;

  constructor(
    file: string,
    private readonly key: Buffer,
    private readonly now: () => number = Date.now,
  ) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ---- sign-in ----

  createLink(email: string): string {
    const token = newToken();
    this.db.prepare('insert into links (token_hash, email, expires_at) values (?, ?, ?)').run(hashToken(token), email.trim().toLowerCase(), this.now() + LINK_MS);
    return token;
  }

  /** The email the link was sent to, once; null when unknown, used or expired. */
  useLink(token: string): string | null {
    const row = this.db
      .prepare('update links set used_at = ? where token_hash = ? and used_at is null and expires_at > ? returning email')
      .get(this.now(), hashToken(token), this.now()) as { email: string } | undefined;
    return row?.email ?? null;
  }

  ensureUser(email: string): { id: string; email: string } {
    const e = email.trim().toLowerCase();
    this.db.prepare('insert into users (id, email, created_at) values (?, ?, ?) on conflict(email) do nothing').run(randomUUID(), e, this.now());
    return this.db.prepare('select id, email from users where email = ?').get(e) as { id: string; email: string };
  }

  createSession(userId: string | null, role: Role): string {
    const token = newToken();
    this.db.prepare('insert into sessions (token_hash, user_id, role, expires_at) values (?, ?, ?, ?)').run(hashToken(token), userId, role, this.now() + SESSION_MS);
    return token;
  }

  session(token: string): { userId: string | null; role: Role; email?: string } | null {
    const row = this.db
      .prepare('select s.user_id, s.role, u.email from sessions s left join users u on u.id = s.user_id where s.token_hash = ? and s.expires_at > ?')
      .get(hashToken(token), this.now()) as { user_id: string | null; role: Role; email: string | null } | undefined;
    if (!row) return null;
    return row.email ? { userId: row.user_id, role: row.role, email: row.email } : { userId: row.user_id, role: row.role };
  }

  deleteSession(token: string): void {
    this.db.prepare('delete from sessions where token_hash = ?').run(hashToken(token));
  }

  // ---- applications ----

  createApplication(userId: string, trip: Trip): string {
    const id = randomUUID();
    const t = this.now();
    this.db.prepare("insert into applications (id, user_id, status, trip, created_at, updated_at) values (?, ?, 'draft', ?, ?, ?)").run(id, userId, sealJson(this.key, trip, `trip:${id}`), t, t);
    this.addEvent(id, 'customer', 'Created');
    return id;
  }

  private toRecord(r: AppRow): AppRecord {
    return {
      id: r.id,
      userId: r.user_id,
      status: r.status,
      trip: openJson<Trip>(this.key, buf(r.trip), `trip:${r.id}`),
      consent: r.consent ? (JSON.parse(r.consent) as Consent) : undefined,
      preferences: r.preferences ? (JSON.parse(r.preferences) as Preferences) : undefined,
      note: r.note ?? undefined,
      filing: r.filing ? openJson<Filing>(this.key, buf(r.filing), `filing:${r.id}`) : {},
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    };
  }

  getApplication(id: string): AppRecord | undefined {
    const row = this.db.prepare('select * from applications where id = ?').get(id) as AppRow | undefined;
    return row && this.toRecord(row);
  }

  listByUser(userId: string): AppRecord[] {
    return (this.db.prepare('select * from applications where user_id = ? order by updated_at desc').all(userId) as unknown as AppRow[]).map((r) => this.toRecord(r));
  }

  listByStatus(status?: AppStatus): AppRecord[] {
    const rows = status
      ? this.db.prepare('select * from applications where status = ? order by updated_at asc').all(status)
      : this.db.prepare('select * from applications order by updated_at desc').all();
    return (rows as unknown as AppRow[]).map((r) => this.toRecord(r));
  }

  update(
    id: string,
    patch: { status?: AppStatus; trip?: Trip; consent?: Consent; preferences?: Preferences; note?: string | null; filing?: Filing },
    actor: string,
    event?: string,
  ): void {
    const sets: string[] = ['updated_at = ?'];
    const args: Array<string | number | Buffer | null> = [this.now()];
    if (patch.status) {
      sets.push('status = ?');
      args.push(patch.status);
      if (patch.status === 'decided') {
        sets.push('decided_at = ?');
        args.push(this.now());
      }
    }
    if (patch.trip) {
      sets.push('trip = ?');
      args.push(sealJson(this.key, patch.trip, `trip:${id}`));
    }
    if (patch.consent) {
      sets.push('consent = ?');
      args.push(JSON.stringify(patch.consent));
    }
    if (patch.preferences) {
      sets.push('preferences = ?');
      args.push(JSON.stringify(patch.preferences));
    }
    if (patch.note !== undefined) {
      sets.push('note = ?');
      args.push(patch.note);
    }
    if (patch.filing) {
      sets.push('filing = ?');
      args.push(sealJson(this.key, patch.filing, `filing:${id}`));
    }
    this.db.prepare(`update applications set ${sets.join(', ')} where id = ?`).run(...args, id);
    if (event) this.addEvent(id, actor, event);
  }

  /** Moves the longest-waiting approved application to 'filing' and returns it; one claim per application. */
  claimNextApproved(): AppRecord | undefined {
    const row = this.db
      .prepare(
        "update applications set status = 'filing', updated_at = ? where id = (select id from applications where status = 'approved' order by updated_at asc limit 1) and status = 'approved' returning *",
      )
      .get(this.now()) as AppRow | undefined;
    if (!row) return undefined;
    this.addEvent(row.id, 'agent', 'Filing started');
    return this.toRecord(row);
  }

  // ---- files ----

  addFile(applicationId: string, meta: FileMeta, bytes: Buffer): string {
    const id = randomUUID();
    this.db
      .prepare('insert into files (id, application_id, meta, size, data, created_at) values (?, ?, ?, ?, ?, ?)')
      .run(id, applicationId, JSON.stringify(meta), bytes.length, sealBytes(this.key, bytes, `file:${applicationId}:${id}`), this.now());
    return id;
  }

  getFile(applicationId: string, fileId: string): { meta: FileMeta; bytes: Buffer } | undefined {
    const row = this.db.prepare('select meta, data from files where id = ? and application_id = ?').get(fileId, applicationId) as { meta: string; data: Uint8Array } | undefined;
    if (!row) return undefined;
    return { meta: JSON.parse(row.meta) as FileMeta, bytes: openBytes(this.key, buf(row.data), `file:${applicationId}:${fileId}`) };
  }

  listFiles(applicationId: string): Array<FileMeta & { id: string; size: number }> {
    return (this.db.prepare('select id, meta, size from files where application_id = ? order by created_at').all(applicationId) as Array<{ id: string; meta: string; size: number }>).map((r) => ({
      ...(JSON.parse(r.meta) as FileMeta),
      id: r.id,
      size: r.size,
    }));
  }

  userEmail(userId: string): string | undefined {
    return (this.db.prepare('select email from users where id = ?').get(userId) as { email: string } | undefined)?.email;
  }

  countFiles(applicationId: string): number {
    return (this.db.prepare('select count(*) n from files where application_id = ?').get(applicationId) as { n: number }).n;
  }

  // ---- history and retention ----

  addEvent(applicationId: string, actor: string, text: string): void {
    this.db.prepare('insert into events (application_id, at, actor, text) values (?, ?, ?, ?)').run(applicationId, this.now(), actor, text);
  }

  events(applicationId: string): Array<{ at: string; actor: string; text: string }> {
    return (this.db.prepare('select at, actor, text from events where application_id = ? order by id').all(applicationId) as Array<{ at: number; actor: string; text: string }>).map((e) => ({
      ...e,
      at: iso(e.at),
    }));
  }

  /** Deletes applications (with their files and history) 30 days after a decision or 90 days after the last activity. */
  purge(): number {
    const t = this.now();
    const res = this.db.prepare('delete from applications where (decided_at is not null and decided_at < ?) or updated_at < ?').run(t - 30 * DAY, t - 90 * DAY);
    this.db.prepare('delete from links where expires_at < ?').run(t - DAY);
    this.db.prepare('delete from sessions where expires_at < ?').run(t);
    return Number(res.changes);
  }
}
