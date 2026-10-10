import { HttpError } from './session.js';

// Client Trello legato alle credenziali del venditore loggato.
export function trello(seller) {
  const auth = `key=${encodeURIComponent(seller.key)}&token=${encodeURIComponent(seller.token)}`;

  async function call(path, { method = 'GET', body } = {}) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`https://api.trello.com/1/${path}${sep}${auth}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = (data && data.message) || (typeof data === 'string' && data) || `errore ${res.status}`;
      // 502 e non 401: un errore di Trello non deve far scadere la sessione dell'app
      throw new HttpError(502, `Trello: ${msg}`);
    }
    return data;
  }

  const norm = v => String(v || '').trim().toLowerCase();

  async function findList(name, filter = 'open') {
    const lists = await call(`boards/${encodeURIComponent(seller.boardId)}/lists?filter=${filter}&fields=name`);
    return lists.find(l => norm(l.name) === norm(name)) || null;
  }

  return { call, findList, norm, boardId: seller.boardId };
}
