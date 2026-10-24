import { describe, expect, it } from 'vitest';
import { hostAllowed } from './portals';

describe('hostAllowed', () => {
  const hosts = ['crovisa.mvep.hr', '.gov.uk'];

  it('allows the portal hosts over https', () => {
    expect(hostAllowed('https://crovisa.mvep.hr/start', hosts)).toBe(true);
    expect(hostAllowed('https://www.gov.uk/apply', hosts)).toBe(true);
  });

  it('refuses plain http on a portal host', () => {
    expect(hostAllowed('http://crovisa.mvep.hr/start', hosts)).toBe(false);
    expect(hostAllowed('http://www.gov.uk/apply', hosts)).toBe(false);
  });

  it('refuses other schemes and other hosts', () => {
    expect(hostAllowed('ftp://crovisa.mvep.hr/', hosts)).toBe(false);
    expect(hostAllowed('javascript:alert(1)', hosts)).toBe(false);
    expect(hostAllowed('https://crovisa.mvep.hr.evil.example/', hosts)).toBe(false);
    expect(hostAllowed('not a url', hosts)).toBe(false);
  });

  it('allows http only on this machine (local copies of the portal pages), and only when listed', () => {
    expect(hostAllowed('http://127.0.0.1:5000/start.html', ['127.0.0.1'])).toBe(true);
    expect(hostAllowed('http://localhost:5000/start.html', ['localhost'])).toBe(true);
    expect(hostAllowed('http://127.0.0.1:5000/start.html', hosts)).toBe(false);
    expect(hostAllowed('http://127.0.0.1.evil.example/', ['.evil.example'])).toBe(false);
  });
});
