import { json, clearSessionCookie } from './_shared/session.js';

export const handler = async () => json(200, { ok: true }, { 'set-cookie': clearSessionCookie() });
