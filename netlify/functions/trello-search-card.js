import { json, handle, requireSeller } from './_shared/session.js';
import { trello } from './_shared/trello.js';

export const handler = handle(async event => {
  const t = trello(requireSeller(event));
  const query = (event.queryStringParameters?.query || '').trim();
  if (!query) return json(400, { error: 'Scrivi almeno un nome da cercare.' });

  const params = new URLSearchParams({
    query,
    idBoards: t.boardId,
    modelTypes: 'cards',
    card_fields: 'id,name,desc,due,shortUrl,idList,labels',
    cards_limit: '25',
    partial: 'true',
  });
  const d = await t.call(`search?${params}`);
  return json(200, {
    cards: (d.cards || []).map(c => ({
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
