import { json, handle, requireSeller } from './_shared/session.js';
import { trello } from './_shared/trello.js';

// Liste aperte della board, con il numero di schede aperte in ciascuna.
export const handler = handle(async event => {
  const t = trello(requireSeller(event));
  const lists = await t.call(`boards/${encodeURIComponent(t.boardId)}/lists?filter=open&fields=name&cards=open&card_fields=id`);
  return json(200, { lists: lists.map(l => ({ id: l.id, name: l.name, count: (l.cards || []).length })) });
});
