import { json, handle, readBody, requireSeller } from './_shared/session.js';
import { trello } from './_shared/trello.js';

const MIN_TEXT = 100;

// Ordine: 1) sposta la scheda ORIGINALE  2) commento sulla scheda originale
//         3) archivia la scheda "scadenza esclusiva" (solo se i passi prima sono riusciti)
export const handler = handle(async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Metodo non consentito' });
  const b = readBody(event);
  if (!b.reminderCardId) return json(400, { error: 'Manca la scheda scadenza esclusiva.' });
  if (!b.originalCardId) return json(400, { error: 'Manca la scheda originale del cliente.' });
  if (b.originalCardId === b.reminderCardId) return json(400, { error: 'La scheda originale non può essere la scheda scadenza esclusiva.' });

  const text = String(b.text || '').trim();
  const min = Math.max(MIN_TEXT, Number(b.minTextLength) || 0);
  if (b.mode === 'recover' && !b.targetList) return json(400, { error: 'In fase di recupero scegli la lista in cui spostare la scheda originale.' });
  if (b.mode === 'recover' && !text) return json(400, { error: `In fase di recupero serve un commento di almeno ${min} caratteri.` });
  if (text && text.length < min) return json(400, { error: `Il commento ha ${text.length} caratteri: ne servono almeno ${min}.` });

  const t = trello(requireSeller(event));
  const original = `cards/${encodeURIComponent(b.originalCardId)}`;

  if (b.targetList) {
    const list = await t.findList(b.targetList);
    if (!list) return json(400, { error: `Lista non trovata: ${b.targetList}` });
    await t.call(original, { method: 'PUT', body: { idList: list.id } });
  }
  if (text) await t.call(`${original}/actions/comments`, { method: 'POST', body: { text } });
  await t.call(`cards/${encodeURIComponent(b.reminderCardId)}`, { method: 'PUT', body: { closed: true } });

  return json(200, { ok: true, movedTo: b.targetList || null });
});
