import { json, handle, readSession, publicSession } from './_shared/session.js';

export const handler = handle(async event => {
  const seller = readSession(event);
  if (!seller) return json(401, { error: 'Non autenticato' });
  return json(200, publicSession(seller));
});
