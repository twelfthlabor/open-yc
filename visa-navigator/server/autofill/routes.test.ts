import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { ScheduleStore } from '../schedule';
import type { RunStatus, StartRequest } from './runner';

const JSON_FROM_APP = { host: '127.0.0.1:8787', 'content-type': 'application/json', origin: 'http://localhost:5173' };
const idle: RunStatus = { state: 'idle', message: '', url: '', filled: [], needsYou: [], captured: {}, log: [] };

let started: StartRequest[];
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  started = [];
  const fake = {
    start: (req: StartRequest) => {
      started.push(req);
      return { ...idle, state: 'starting' as const };
    },
    status: () => idle,
    stop: async () => {},
  };
  app = createApp(new ScheduleStore(mkdtempSync(path.join(tmpdir(), 'vn-af-'))), undefined, fake);
});

const start = (body: unknown, headers: Record<string, string> = JSON_FROM_APP) =>
  app.request('/api/autofill/start', { method: 'POST', headers, body: JSON.stringify(body) });

const items = [{ id: 'surname', label: 'Surname', value: 'SILVA' }];

describe('autofill routes', () => {
  it('starts CROVISA at its own new-request page, whatever start page the client sends', async () => {
    const res = await start({ formId: 'schengen_c', applyUrl: 'https://evil.example/', destination: 'HRV', allowSubmit: true, items });
    expect(res.status).toBe(200);
    expect(started[0].startUrl).toBe('https://crovisa.mvep.hr/NewVisaRequest?lang=en');
    expect(started[0].hosts).toEqual(['crovisa.mvep.hr']);
    expect(started[0].allowSubmit).toBe(true);
    expect(started[0].options.dateFormat).toBe('dd.mm.yyyy');
  });

  it('never types a Swedish, French or Dutch Schengen application into CROVISA', async () => {
    for (const destination of ['SWE', 'FRA', 'NLD', undefined]) {
      const res = await start({ formId: 'schengen_c', destination, allowSubmit: false, items });
      expect(res.status, String(destination)).toBe(400);
    }
    expect(started).toHaveLength(0);
  });

  it('has no autofill for the DS-160 (filled along by hand)', async () => {
    expect((await start({ formId: 'us_b', applyUrl: 'https://ceac.state.gov/genniv/', allowSubmit: false, items })).status).toBe(400);
  });

  it('uses the route apply link for gov.uk, and only when it is on gov.uk', async () => {
    expect((await start({ formId: 'uk_visitor', applyUrl: 'https://www.gov.uk/standard-visitor/apply-standard-visitor-visa', allowSubmit: false, items })).status).toBe(200);
    expect(started[0].startUrl).toContain('www.gov.uk');
    const bad = await start({ formId: 'uk_visitor', applyUrl: 'https://gov.uk.evil.example/apply', allowSubmit: false, items });
    expect(bad.status).toBe(400);
    expect((await start({ formId: 'uk_eta', applyUrl: 'javascript:alert(1)', allowSubmit: false, items })).status).toBe(400);
    expect(started).toHaveLength(1);
  });

  it('rejects other web pages and malformed bodies', async () => {
    expect((await start({ formId: 'schengen_c', allowSubmit: true, items }, { ...JSON_FROM_APP, origin: 'https://evil.example' })).status).toBe(403);
    expect((await start({ formId: 'nope', allowSubmit: true, items })).status).toBe(400);
    expect((await start({ formId: 'schengen_c', allowSubmit: 'yes', items })).status).toBe(400);
    expect(started).toHaveLength(0);
  });

  it('reports status and stops', async () => {
    expect(await (await app.request('/api/autofill/status', { headers: { host: '127.0.0.1:8787' } })).json()).toEqual(idle);
    expect((await app.request('/api/autofill/stop', { method: 'POST', headers: JSON_FROM_APP, body: '{}' })).status).toBe(200);
  });
});
