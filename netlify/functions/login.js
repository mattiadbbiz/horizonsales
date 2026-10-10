import { json, handle, readBody, findSellerByCredentials, createSessionCookie, publicSession } from './_shared/session.js';

export const handler = handle(async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Metodo non consentito' });
  const body = readBody(event);
  const username = String(body.username || '');
  const password = String(body.password || '');
  if (!username.trim() || !password) return json(400, { error: 'Inserisci nome utente e password.' });

  const seller = findSellerByCredentials(username, password);
  if (!seller) {
    await new Promise(r => setTimeout(r, 700)); // rallenta i tentativi a raffica
    return json(401, { error: 'Nome utente o password non corretti.' });
  }
  return json(200, publicSession(seller), { 'set-cookie': createSessionCookie(seller.id) });
});
