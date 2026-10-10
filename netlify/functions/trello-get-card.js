import { json, handle, requireSeller } from './_shared/session.js';
import { trello } from './_shared/trello.js';

export const handler = handle(async event => {
  const t = trello(requireSeller(event));
  const id = event.queryStringParameters?.cardId;
  if (!id) return json(400, { error: 'cardId obbligatorio' });
  const cid = encodeURIComponent(id);

  const [card, actions, lists] = await Promise.all([
    t.call(`cards/${cid}?fields=all`),
    t.call(`cards/${cid}/actions?filter=commentCard&limit=1000`),
    t.call(`boards/${encodeURIComponent(t.boardId)}/lists?filter=all&fields=name`),
  ]);
  card.listName = lists.find(l => l.id === card.idList)?.name || '';
  return json(200, {
    card,
    history: (actions || []).reverse().map(a => ({ date: a.date, text: a.data?.text || '' })),
  });
});
