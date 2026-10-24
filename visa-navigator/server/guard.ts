// The API runs on the user's machine and can spend API credit and send WhatsApp messages.
// Only the app itself (served by Vite on localhost) may call the endpoints that change things.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function hostIsLocal(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return LOCAL_HOSTS.has(name);
}

export function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  return Boolean(origin && allowed.includes(origin));
}

export interface GuardInput {
  method: string;
  host?: string;
  origin?: string;
  contentType?: string;
}

/** Returns an error message when the request must be rejected, or null when it may proceed. */
export function checkRequest(req: GuardInput, allowedOrigins: string[]): string | null {
  // Blocks DNS-rebinding: a hostile domain that resolves to 127.0.0.1 still sends its own Host.
  if (!hostIsLocal(req.host)) return 'Requests must come from this computer.';
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return null;
  // Blocks cross-site requests from other web pages open in the browser.
  if (!originAllowed(req.origin, allowedOrigins)) return 'Requests must come from the Visa Navigator app.';
  if (!req.contentType?.toLowerCase().startsWith('application/json')) return 'Send JSON.';
  return null;
}
