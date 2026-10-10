import { json, handle, requireSeller } from './_shared/session.js';
import { trello } from './_shared/trello.js';

export const handler = handle(async event => {
  const seller = requireSeller(event);
  const t = trello(seller);
  const board = encodeURIComponent(t.boardId);

  const lists = await t.call(`boards/${board}/lists?filter=all&fields=name`);
  const target = lists.find(l => t.norm(l.name) === t.norm(seller.renewalListName));
  const empty = { notFound: 0, toRenew: 0, notRenew: 0, done: 0 };
  if (!target) return json(200, { listFound: false, listName: seller.renewalListName, summary: empty, groups: [] });

  const [reminders, cards] = await Promise.all([
    t.call(`lists/${target.id}/cards?fields=name,desc,url,shortUrl`),
    t.call(`boards/${board}/cards?filter=all&fields=name,desc,idList,url,shortUrl,closed`),
  ]);
  const all = cards.filter(c => c.idList !== target.id);
  const listName = Object.fromEntries(lists.map(l => [l.id, l.name]));
  const g = { notFound: [], toRenew: [], notRenew: [] };

  for (const reminder of reminders) {
    const txt = `${reminder.name || ''} ${reminder.desc || ''}`;
    const vat = txt.match(/partita\s+iva\s*[:#]?\s*(\d{11})/i)?.[1];
    const clientName = txt.match(/cliente\s+(.+?)\s*\(partita\s+iva/i)?.[1]?.trim();

    let original = vat ? all.find(c => `${c.name || ''} ${c.desc || ''}`.includes(vat)) : null;
    if (!original && clientName) {
      const words = clientName.toLowerCase().split(/\s+/).filter(Boolean);
      original = all.find(c => words.every(w => (c.name || '').toLowerCase().includes(w)));
    }
    if (original) original = { ...original, listName: listName[original.idList] || '' };

    const classification = !original
      ? 'non-trovato'
      : ['KO', 'VUOTO'].includes(String(original.listName).trim().toUpperCase()) ? 'non-rinnovare' : 'da-rinnovare';
    const item = { reminder, original, classification };
    (classification === 'non-trovato' ? g.notFound : classification === 'non-rinnovare' ? g.notRenew : g.toRenew).push(item);
  }

  return json(200, {
    listFound: true,
    listName: target.name,
    summary: { notFound: g.notFound.length, toRenew: g.toRenew.length, notRenew: g.notRenew.length, done: 0 },
    groups: [
      { title: 'Non trovati', key: 'notFound', items: g.notFound },
      { title: 'Da rinnovare', key: 'toRenew', items: g.toRenew },
      { title: 'Da non rinnovare', key: 'notRenew', items: g.notRenew },
    ],
  });
});
