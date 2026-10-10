import { json, handle, requireSeller } from './_shared/session.js';
import { trello } from './_shared/trello.js';

// Tutte le schede aperte di una lista, nell'ordine in cui stanno su Trello.
export const handler = handle(async event => {
  const t = trello(requireSeller(event));
  const listId = event.queryStringParameters?.listId;
  if (!listId) return json(400, { error: 'listId obbligatorio' });
  const lid = encodeURIComponent(listId);

  // Il board ID su Netlify può essere quello corto dell'URL: lo confronto con quello completo
  const [list, board] = await Promise.all([
    t.call(`lists/${lid}?fields=name,idBoard`),
    t.call(`boards/${encodeURIComponent(t.boardId)}?fields=id`),
  ]);
  if (list.idBoard !== board.id) return json(403, { error: 'Questa lista non appartiene alla tua board.' });

  const cards = await t.call(`lists/${lid}/cards?fields=id,name,desc,due,shortUrl,labels,idList`);
  return json(200, {
    list: { id: list.id, name: list.name },
    cards: cards.map(c => ({
      id: c.id,
      name: c.name,
      description: c.desc,
      due: c.due,
      labels: (c.labels || []).map(l => ({ name: l.name, color: l.color })),
      url: c.shortUrl,
      listId: c.idList,
    })),
  });
});
