// WhatsApp messages through Twilio's Messages REST API.
// Business-initiated WhatsApp messages need an approved template (Content SID) outside the 24-hour
// window after the user last messaged you. Without TWILIO_CONTENT_SID the app sends free-form text,
// which only works inside that window (for example right after joining the Twilio sandbox).

export interface WhatsAppConfig {
  accountSid: string;
  username: string;
  password: string;
  from: string;
  contentSid?: string;
}

export function whatsappConfig(env: NodeJS.ProcessEnv = process.env): WhatsAppConfig | null {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const from = env.TWILIO_WHATSAPP_FROM;
  if (!accountSid || !from) return null;
  if (env.TWILIO_API_KEY && env.TWILIO_API_SECRET) {
    return { accountSid, username: env.TWILIO_API_KEY, password: env.TWILIO_API_SECRET, from, contentSid: env.TWILIO_CONTENT_SID || undefined };
  }
  if (env.TWILIO_AUTH_TOKEN) {
    return { accountSid, username: accountSid, password: env.TWILIO_AUTH_TOKEN, from, contentSid: env.TWILIO_CONTENT_SID || undefined };
  }
  return null;
}

/** E.164 with the whatsapp: prefix, e.g. whatsapp:+14155550100. */
export function toWhatsAppAddress(phone: string): string | null {
  const digits = phone.replace(/[\s()-]/g, '');
  if (!/^\+[1-9]\d{6,14}$/.test(digits)) return null;
  return `whatsapp:${digits}`;
}

export function buildMessageParams(cfg: WhatsAppConfig, to: string, title: string, body: string): URLSearchParams {
  const params = new URLSearchParams({ From: cfg.from.startsWith('whatsapp:') ? cfg.from : `whatsapp:${cfg.from}`, To: to });
  if (cfg.contentSid) {
    params.set('ContentSid', cfg.contentSid);
    params.set('ContentVariables', JSON.stringify({ 1: title, 2: body }));
  } else {
    params.set('Body', `${title}\n${body}`);
  }
  return params;
}

export async function sendWhatsApp(cfg: WhatsAppConfig, phone: string, title: string, body: string): Promise<{ sid: string }> {
  const to = toWhatsAppAddress(phone);
  if (!to) throw new Error('Phone number must be in international format, for example +14155550100.');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: buildMessageParams(cfg, to, title, body),
  });
  const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
  if (!res.ok || !json.sid) throw new Error(`Twilio error${json.code ? ` ${json.code}` : ''}: ${json.message ?? res.statusText}`);
  return { sid: json.sid };
}
