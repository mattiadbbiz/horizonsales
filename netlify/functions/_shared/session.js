import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/*
 * Venditori e nomi delle variabili Netlify.
 * Per ogni dato sono elencati più nomi possibili: viene usato il primo che
 * esiste su Netlify. Il confronto ignora maiuscole/minuscole.
 * Per aggiungere un venditore basta copiare un blocco e cambiare i nomi.
 *
 * Le credenziali di accesso non sono scritte qui: vengono lette da Netlify
 * componendo il nome dall'identificativo del venditore (la chiave del blocco).
 */
const SELLERS = {
  mattia: {
    name: 'Mattia',
    key: ['TRELLO_API_KEY', 'MATTIA_API_KEY', 'MATTIA_TRELLO_API_KEY'],
    token: ['TRELLO_TOKEN', 'MATTIA_TOKEN', 'MATTIA_TRELLO_TOKEN'],
    board: ['TRELLO_BOARD_ID', 'MATTIA_BOARD_ID', 'MATTIA_TRELLO_BOARD_ID'],
    calendar: ['MATTIA_CALENDAR_SRC', 'MATTIA_CALENDAR', 'MATTIA_IFRAME', 'MATTIA_CALENDAR_IFRAME', 'CALENDAR_SRC', 'CALENDAR_IFRAME', 'PUBLIC_CALENDAR_IFRAME_SRC'],
    renewal: ['MATTIA_RENEWAL_LIST_NAME', 'RENEWAL_LIST_NAME'],
  },
  manoah: {
    name: 'Manoah',
    key: ['MANOAH_API_KEY', 'MANOAH_TRELLO_API_KEY', 'MANOA_API_KEY', 'MANOA_TRELLO_API_KEY'],
    token: ['MANOAH_TOKEN', 'MANOAH_TRELLO_TOKEN', 'MANOA_TOKEN', 'MANOA_TRELLO_TOKEN'],
    board: ['MANOAH_BOARD_ID', 'MANOAH_TRELLO_BOARD_ID', 'MANOA_BOARD_ID', 'MANOA_TRELLO_BOARD_ID'],
    calendar: ['MANOAH_CALENDAR_SRC', 'MANOAH_CALENDAR', 'MANOAH_IFRAME', 'MANOAH_CALENDAR_IFRAME', 'MANOA_CALENDAR_SRC', 'MANOA_CALENDAR', 'MANOA_IFRAME'],
    renewal: ['MANOAH_RENEWAL_LIST_NAME', 'RENEWAL_LIST_NAME'],
  },
};

const COOKIE = 'hz_session';
const MAX_AGE = 12 * 60 * 60; // 12 ore

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function envLookup(names) {
  const index = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && String(v).trim() !== '') index[k.toUpperCase()] = String(v).trim();
  }
  for (const n of names) {
    const v = index[n.toUpperCase()];
    if (v) return v;
  }
  return '';
}

// Accetta sia l'URL del calendario sia l'intero codice <iframe ...>
function extractSrc(value) {
  if (!value) return '';
  const m = value.match(/src\s*=\s*["']([^"']+)["']/i);
  return (m ? m[1] : value).replace(/&amp;/g, '&').trim();
}

const credentialVar = (id, kind) => `${id}_${kind}`.toUpperCase();

export function sellerConfig(id) {
  const s = SELLERS[id];
  if (!s) return null;
  return {
    id,
    name: s.name,
    username: envLookup([credentialVar(id, 'USERNAME')]),
    password: envLookup([credentialVar(id, 'PASSWORD')]),
    key: envLookup(s.key),
    token: envLookup(s.token),
    boardId: envLookup(s.board),
    calendarSrc: extractSrc(envLookup(s.calendar)),
    renewalListName: envLookup(s.renewal) || 'RINNOVA ESCLUSIVE',
  };
}

function digest(v) {
  return createHash('sha256').update(String(v)).digest();
}

function safeEqual(a, b) {
  return timingSafeEqual(digest(a), digest(b));
}

// Chiave di firma: SESSION_SECRET se presente, altrimenti derivata dai segreti
// già salvati. Cambiare una password invalida automaticamente le sessioni aperte.
function signingKey() {
  const explicit = envLookup(['SESSION_SECRET']);
  if (explicit) return explicit;
  const parts = Object.keys(SELLERS).flatMap(id => {
    const c = sellerConfig(id);
    return [c.username, c.password, c.token];
  });
  return createHash('sha256').update('horizon-session|' + parts.join('|')).digest('hex');
}

function sign(payload) {
  return createHmac('sha256', signingKey()).update(payload).digest('base64url');
}

export function findSellerByCredentials(username, password) {
  let match = null;
  for (const id of Object.keys(SELLERS)) {
    const c = sellerConfig(id);
    if (!c.username || !c.password) continue;
    const userOk = safeEqual(username.trim().toLowerCase(), c.username.toLowerCase());
    const passOk = safeEqual(password, c.password);
    if (userOk && passOk && !match) match = c;
  }
  return match;
}

export function createSessionCookie(sellerId) {
  const payload = Buffer.from(JSON.stringify({ s: sellerId, exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString('base64url');
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function readSession(event) {
  const raw = event.headers?.cookie || event.headers?.Cookie || '';
  const part = raw.split(/;\s*/).find(p => p.startsWith(COOKIE + '='));
  if (!part) return null;
  const [payload, sig] = part.slice(COOKIE.length + 1).split('.');
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data.exp || data.exp < Date.now() / 1000) return null;
  return sellerConfig(data.s);
}

export function requireSeller(event) {
  const seller = readSession(event);
  if (!seller) throw new HttpError(401, 'Sessione scaduta o non valida. Accedi di nuovo.');
  const missing = [!seller.key && 'API key', !seller.token && 'token', !seller.boardId && 'board ID'].filter(Boolean);
  if (missing.length) throw new HttpError(500, `Su Netlify mancano per ${seller.name}: ${missing.join(', ')}.`);
  return seller;
}

export function publicSession(seller) {
  return { seller: seller.id, name: seller.name, calendarSrc: seller.calendarSrc };
}

export function readBody(event) {
  if (!event.body) return {};
  const text = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
    body: JSON.stringify(body),
  };
}

export function handle(fn) {
  return async event => {
    try {
      return await fn(event);
    } catch (e) {
      return json(e.status || 500, { error: e.message || 'Errore imprevisto' });
    }
  };
}
