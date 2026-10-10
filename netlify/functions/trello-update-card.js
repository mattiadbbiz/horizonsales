import { json, handle, readBody, requireSeller } from './_shared/session.js';
import { trello } from './_shared/trello.js';

export const handler = handle(async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Metodo non consentito' });
  const b = readBody(event);
  if (!b.cardId) return json(400, { error: 'cardId obbligatorio' });
  const t = trello(requireSeller(event));
  const base = `cards/${encodeURIComponent(b.cardId)}`;

  // 1. Lista e scadenza
  const changes = {};
  if (b.targetList) {
    const list = await t.findList(b.targetList);
    if (!list) return json(400, { error: `Lista non trovata: ${b.targetList}` });
    changes.idList = list.id;
  }
  if (b.due) changes.due = b.due;
  if (Object.keys(changes).length) await t.call(base, { method: 'PUT', body: changes });

  // 2. Etichette: tocca solo quelle gestite dall'app, lascia stare le altre
  const missingLabels = [];
  if (Array.isArray(b.labels) && Array.isArray(b.managedLabels)) {
    const [card, boardLabels] = await Promise.all([
      t.call(`${base}?fields=idLabels`),
      t.call(`boards/${encodeURIComponent(t.boardId)}/labels?limit=1000&fields=name`),
    ]);
    const selected = new Set(b.labels.map(t.norm));
    for (const name of b.managedLabels) {
      const label = boardLabels.find(l => t.norm(l.name) === t.norm(name));
      const wanted = selected.has(t.norm(name));
      if (!label) {
        if (wanted) missingLabels.push(name);
        continue;
      }
      const onCard = card.idLabels.includes(label.id);
      if (wanted && !onCard) await t.call(`${base}/idLabels`, { method: 'POST', body: { value: label.id } });
      if (!wanted && onCard) await t.call(`${base}/idLabels/${label.id}`, { method: 'DELETE' });
    }
  }

  // 3. Commento
  if (b.comment) await t.call(`${base}/actions/comments`, { method: 'POST', body: { text: b.comment } });

  return json(200, { ok: true, movedTo: b.targetList || null, missingLabels });
});
