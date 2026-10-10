import { CONFIG } from './config.js';

/* ---------- Utilità ---------- */
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
const fmtDateTime = d => (d ? new Date(d).toLocaleString('it-IT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const fmtDate = d => (d ? new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const sameLabel = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

const STEPS = ['Cliente', 'Traccia', 'Esito', 'Appuntamento', 'Etichette', 'Sposta scheda', 'Riepilogo'];
const OUTCOMES = ['Nessuna conversazione importante', 'Chiamata tracciata', 'Videochiamata', 'Contatto WhatsApp', 'Appuntamento fissato', 'Non risponde'];

let session = null;
let listsCache = null;
let renewals = { groups: [], done: 0 };

function freshWizard() {
  return { step: 1, lead: null, traccia: '', outcome: '', date: '', time: '', type: 'telefonata', labels: new Set(), targetList: '', completed: false };
}

/* ---------- Avvisi ---------- */
let toastTimer;
function toast(message, kind = 'info') {
  const t = $('#toast');
  t.textContent = message;
  t.dataset.kind = kind;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), kind === 'error' ? 6500 : 3800);
}
function fail(e) {
  if (!e?.silent) toast(e?.message || 'Errore imprevisto.', 'error');
}

/* ---------- API ---------- */
async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    showLogin('La sessione è scaduta. Accedi di nuovo.');
    const err = new Error(data.error || 'Sessione scaduta.');
    err.silent = true;
    throw err;
  }
  if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
  return data;
}
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });

/* ---------- Accesso ---------- */
function showLogin(message = '') {
  session = null;
  listsCache = null;
  flows.single.w = freshWizard();
  resetBatch();
  renewals = { groups: [], done: 0 };
  closeModal();
  $('#topbar').classList.add('hidden');
  $('#app').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
  $('#login-error').textContent = message;
  $('#login-pass').value = '';
  ['#history-results', '#history-detail', '#renewal-groups', '#renewal-summary'].forEach(s => ($(s).innerHTML = ''));
  $('#history-search').value = '';
}

function startApp(s) {
  session = s;
  $('#login-view').classList.add('hidden');
  $('#topbar').classList.remove('hidden');
  $('#app').classList.remove('hidden');
  $('#seller-name').textContent = s.name;
  $('#greeting').textContent = `Ciao, ${s.name}`;
  const today = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#today').textContent = today.charAt(0).toUpperCase() + today.slice(1);
  goHome();
}

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const username = $('#login-user').value.trim();
  const password = $('#login-pass').value;
  const error = $('#login-error');
  const button = $('#login-submit');
  if (!username || !password) {
    error.textContent = 'Inserisci nome utente e password.';
    return;
  }
  button.disabled = true;
  button.textContent = 'Accesso in corso…';
  error.textContent = '';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Accesso non riuscito.');
    startApp(data);
  } catch (x) {
    error.textContent = x.message === 'Failed to fetch' ? 'Server non raggiungibile. Controlla la connessione.' : x.message;
    $('#login-pass').select();
  } finally {
    button.disabled = false;
    button.textContent = 'Accedi';
  }
});

$('#logout').addEventListener('click', async () => {
  try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
  showLogin();
});

/* ---------- Navigazione ---------- */
function setActiveNav(name) {
  $$('.main-nav [data-section]').forEach(b => (b.dataset.section === name ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
}
function goHome() {
  $('#home-view').classList.remove('hidden');
  $$('.section').forEach(s => s.classList.add('hidden'));
  setActiveNav(null);
  window.scrollTo({ top: 0 });
}
function openSection(name) {
  $('#home-view').classList.add('hidden');
  $$('.section').forEach(s => s.classList.toggle('hidden', s.id !== `section-${name}`));
  setActiveNav(name);
  window.scrollTo({ top: 0 });
  if (name === 'update') renderFlow(flows.single);
  if (name === 'batch') renderBatch();
  if (name === 'renewal') loadRenewals();
}
$$('[data-section]').forEach(b => b.addEventListener('click', () => openSection(b.dataset.section)));
$('#go-home').addEventListener('click', goHome);

/* ---------- JSPL ---------- */
function extractJsplCode(item = {}) {
  const parts = [item.reminder?.desc, item.reminder?.description, item.reminder?.name, item.original?.name, item.original?.desc, item.lead?.name, item.lead?.description];
  for (const part of parts) {
    const t = String(part || '');
    const hit = t.match(/https?:\/\/www\.jspl\.it\/Tracce\/(\d{6})/i) || t.match(/(?:\(|\b)(\d{6})(?:\)|\b)/);
    if (hit) return hit[1];
  }
  return '';
}
async function openJspl(item = {}, candidate = '') {
  let code = String(candidate || extractJsplCode(item) || '').trim();
  if (!/^\d{6}$/.test(code)) {
    code = await askDialog({
      title: 'Codice JSPL',
      text: 'Inserisci le ultime 6 cifre del link JSPL.',
      input: '6 cifre',
      validate: v => (/^\d{6}$/.test(v) ? '' : 'Il codice deve contenere esattamente 6 cifre.'),
      confirmLabel: 'Apri JSPL',
    });
    if (!code) return false;
  }
  window.open('https://www.jspl.it/Tracce/' + code, '_blank', 'noopener,noreferrer');
  return true;
}
function jsplPanel(item, key) {
  const code = extractJsplCode(item);
  return `<div class="jspl">
    <div><strong>Traccia JSPL</strong><p>${code ? `Codice ${esc(code)} trovato nella scheda.` : 'Nessun codice nella scheda: ti verrà chiesto all’apertura.'}</p></div>
    <button type="button" class="btn btn-sm" data-jspl="${key}" data-code="${esc(code)}">Apri JSPL</button>
  </div>`;
}
function bindJspl(key, item, root = document) {
  const b = root.querySelector(`[data-jspl="${key}"]`);
  if (b) b.onclick = () => openJspl(item, b.dataset.code);
}

/* ---------- Ricerca schede ---------- */
const labelNames = c => (c?.labels || []).map(l => l.name || l).filter(Boolean);
const tags = names => names.map(n => `<span class="tag">${esc(n)}</span>`).join('');

async function searchCards(q) {
  q = String(q || '').trim();
  if (!q) throw new Error('Scrivi almeno un nome da cercare.');
  return (await api(`/api/trello-search-card?query=${encodeURIComponent(q)}`)).cards || [];
}
function renderCards(cards, target, onPick) {
  if (!cards.length) {
    target.innerHTML = '<p class="empty">Nessuna scheda trovata. Prova con il cognome o con la città.</p>';
    return;
  }
  target.innerHTML = `<ul class="result-list">${cards.map(c => `
    <li><button type="button" class="result" data-id="${esc(c.id)}">
      <span class="result-name">${esc(c.name)}</span>
      <span class="result-meta">${tags(labelNames(c))}${c.due ? `<span class="due">Scadenza ${esc(fmtDateTime(c.due))}</span>` : ''}</span>
    </button></li>`).join('')}</ul>`;
  $$('[data-id]', target).forEach(b => (b.onclick = () => onPick(cards.find(c => c.id === b.dataset.id))));
}
function bindSearch(input, button, results, onPick) {
  const run = async () => {
    results.innerHTML = '<p class="loading">Ricerca in corso…</p>';
    try {
      renderCards(await searchCards(input.value), results, onPick);
    } catch (e) {
      results.innerHTML = e.silent ? '' : `<p class="empty">${esc(e.message)}</p>`;
    }
  };
  button.onclick = run;
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); run(); }
  };
}

/* ---------- Storico clienti ---------- */
function timeline(history) {
  if (!history.length) return '<p class="empty">Nessun commento registrato su questa scheda.</p>';
  return `<ol class="timeline">${history.map(h => `<li><time>${esc(fmtDateTime(h.date))}</time><p>${esc(h.text)}</p></li>`).join('')}</ol>`;
}

bindSearch($('#history-search'), $('#history-search-button'), $('#history-results'), openHistory);

async function openHistory(c) {
  const box = $('#history-detail');
  box.innerHTML = '<div class="panel detail"><p class="loading">Caricamento scheda…</p></div>';
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const d = await api(`/api/trello-get-card?cardId=${encodeURIComponent(c.id)}`);
    const card = d.card;
    box.innerHTML = `<article class="panel detail">
      <header class="detail-head">
        <h2>${esc(card.name)}</h2>
        <a class="btn btn-sm" href="${esc(card.shortUrl || card.url)}" target="_blank" rel="noopener">Apri in Trello</a>
      </header>
      <dl class="facts">
        <div><dt>Lista</dt><dd>${esc(card.listName || '—')}</dd></div>
        <div><dt>Scadenza</dt><dd>${card.due ? esc(fmtDateTime(card.due)) : 'Nessuna'}</dd></div>
        <div><dt>Commenti</dt><dd>${(d.history || []).length}</dd></div>
      </dl>
      ${labelNames(card).length ? `<div class="tag-row">${tags(labelNames(card))}</div>` : ''}
      <h3 class="block-title">Cronologia</h3>
      ${timeline(d.history || [])}
    </article>`;
  } catch (e) {
    box.innerHTML = '';
    fail(e);
  }
}

/* ---------- Flusso di aggiornamento (singolo e in sequenza) ---------- */
// Due flussi indipendenti: "Aggiorna cliente" e "Ricerca per lista" non si sovrascrivono a vicenda.
const flows = {
  single: { key: 'single', stepper: $('#stepper'), box: $('#update-content'), w: freshWizard(), queue: null },
  batch: { key: 'batch', stepper: $('#batch-stepper'), box: $('#batch-content'), w: freshWizard(), queue: null },
};
const minStep = f => (f.queue ? 2 : 1);
const presetLabels = c => new Set(CONFIG.labels.filter(l => labelNames(c).some(n => sameLabel(n, l))));

function renderStepper(f) {
  const ol = f.stepper;
  const w = f.w;
  ol.classList.toggle('hidden', !!f.queue?.finished);
  ol.innerHTML = STEPS.map((s, i) => {
    const n = i + 1;
    const cls = w.completed || n < w.step || (f.queue && n === 1) ? 'done' : n === w.step ? 'current' : '';
    return `<li class="${cls}" ${cls === 'current' ? 'aria-current="step"' : ''}><span class="num">${n}</span><span class="lbl">${s}</span></li>`;
  }).join('');
  const cur = $('.current', ol);
  if (cur) ol.scrollLeft = cur.offsetLeft - ol.clientWidth / 2 + cur.clientWidth / 2;
}

function scrollToFlow(f) {
  const anchor = f.queue ? $('#batch-run') : f.stepper;
  const top = anchor.getBoundingClientRect().top + window.scrollY - 100;
  if (window.scrollY > top) window.scrollTo({ top, behavior: 'smooth' });
}

function go(f, step) {
  f.w.step = step;
  renderFlow(f);
  scrollToFlow(f);
}

function wizardBar(f) {
  const w = f.w;
  const right = f.queue
    ? '<button type="button" class="btn btn-ghost btn-sm" id="wizard-skip">Salta cliente</button>'
    : '<button type="button" class="btn btn-ghost btn-sm" id="wizard-reset">Ricomincia</button>';
  return `<div class="wizard-bar">
    <button type="button" class="btn btn-ghost btn-sm" id="wizard-back" ${w.step === minStep(f) ? 'disabled' : ''}>Indietro</button>
    <span><span class="hide-sm">Passaggio </span>${w.step} di ${STEPS.length}</span>
    ${right}
  </div>`;
}

const leadLine = w => (w.lead ? `<p class="step-sub">${esc(w.lead.name)}</p>` : '');
const typeLabel = w => (w.type === 'videochiamata' ? 'videochiamata 30 min' : 'telefonata 15 min');

function renderFlow(f) {
  renderStepper(f);
  if (f.key === 'batch') renderQueueBar(f);
  const b = f.box;
  const w = f.w;
  const q = s => b.querySelector(s);

  if (f.queue?.finished) {
    b.innerHTML = batchSummary(f);
    q('#batch-home').onclick = () => { resetBatch(); goHome(); };
    q('#batch-again').onclick = () => { resetBatch(); renderBatch(); };
    return;
  }

  if (w.completed) {
    b.innerHTML = `<div class="done-state">
      <div class="horizon horizon-mini" aria-hidden="true"></div>
      <h2>Scheda aggiornata</h2>
      <p class="lede">Le modifiche a ${esc(w.lead?.name || 'questa scheda')} sono su Trello.</p>
      <div class="actions actions-center">
        <button type="button" class="btn btn-primary" id="again">Aggiorna un altro cliente</button>
        <button type="button" class="btn" id="done-home">Torna alla home</button>
      </div>
    </div>`;
    q('#again').onclick = () => { f.w = freshWizard(); renderFlow(f); };
    q('#done-home').onclick = () => { f.w = freshWizard(); goHome(); };
    return;
  }

  const step = w.step;
  const jkey = `${f.key}-${step}`;
  let html = wizardBar(f);

  if (step === 1) {
    html += `<h2 class="step-title">Scegli il cliente</h2>
      <p class="step-sub">Cerca la scheda Trello da aggiornare.</p>
      <div class="search-row">
        <input id="u-search" type="search" placeholder="Nome, azienda o città" enterkeyhint="search">
        <button id="u-search-btn" type="button" class="btn btn-primary">Cerca</button>
      </div>
      <div id="u-results"></div>`;
  }

  if (step === 2) {
    html += `<h2 class="step-title">Traccia</h2>${leadLine(w)}
      <textarea id="traccia" placeholder="Scrivi o detta com’è andato il contatto…">${esc(w.traccia)}</textarea>
      <p class="hint">“Metti in ordine” sistema spazi e punteggiatura, senza aggiungere nulla.</p>
      <div class="actions">
        <button type="button" class="btn" id="voice">Detta</button>
        <button type="button" class="btn" id="organize">Metti in ordine</button>
        <button type="button" class="btn btn-ghost" id="none">Nessuna traccia</button>
        <button type="button" class="btn btn-primary push" id="next">Avanti</button>
      </div>
      ${jsplPanel({ lead: w.lead }, jkey)}`;
  }

  if (step === 3) {
    html += `<h2 class="step-title">Esito</h2>${leadLine(w)}
      <div class="choices">${OUTCOMES.map(o => `<button type="button" class="choice" data-o="${esc(o)}" aria-pressed="${w.outcome === o}">${esc(o)}</button>`).join('')}</div>
      <div class="actions"><button type="button" class="btn btn-primary push" id="next" ${w.outcome ? '' : 'disabled'}>Avanti</button></div>`;
  }

  if (step === 4) {
    html += `<h2 class="step-title">Appuntamento</h2>${leadLine(w)}
      <div class="split">
        <div class="form-stack">
          <label class="field"><span>Data</span><input type="date" id="date" value="${esc(w.date)}"></label>
          <label class="field"><span>Ora</span><input type="time" id="time" value="${esc(w.time)}"></label>
          <div class="choices">
            <button type="button" class="choice" data-type="telefonata" aria-pressed="${w.type === 'telefonata'}">Telefonata 15 min</button>
            <button type="button" class="choice" data-type="videochiamata" aria-pressed="${w.type === 'videochiamata'}">Videochiamata 30 min</button>
          </div>
          <p class="hint">Senza data e ora la scadenza resta invariata.</p>
        </div>
        <div>
          <div class="cal-controls">
            <div class="seg" role="group" aria-label="Vista">
              <button type="button" data-v="day">Giorno</button><button type="button" data-v="week">Settimana</button><button type="button" data-v="month">Mese</button>
            </div>
            <div class="seg" role="group" aria-label="Periodo">
              <button type="button" class="cal-prev" aria-label="Precedente">‹</button><button type="button" class="cal-today">Oggi</button><button type="button" class="cal-next" aria-label="Successivo">›</button>
            </div>
          </div>
          <div class="planner"></div>
          <p class="hint">Guarda gli spazi liberi e inserisci data e ora a sinistra.</p>
        </div>
      </div>
      <div class="actions"><button type="button" class="btn btn-primary push" id="next">Avanti</button></div>`;
  }

  if (step === 5) {
    html += `<h2 class="step-title">Etichette</h2>${leadLine(w)}
      <p class="hint spaced">Sono già selezionate quelle presenti sulla scheda. Togli la selezione per rimuoverle.</p>
      <div class="choices">${CONFIG.labels.map(l => `<button type="button" class="choice" data-l="${esc(l)}" aria-pressed="${w.labels.has(l)}">${esc(l)}</button>`).join('')}</div>
      <div class="actions"><button type="button" class="btn btn-primary push" id="next">Avanti</button></div>`;
  }

  if (step === 6) {
    html += `<h2 class="step-title">Sposta scheda</h2>${leadLine(w)}
      <label class="field"><span>Lista di destinazione</span>
        <select id="target-list" disabled><option>Caricamento liste…</option></select>
      </label>
      <div class="actions"><button type="button" class="btn btn-primary push" id="next">Vai al riepilogo</button></div>`;
  }

  if (step === 7) {
    const due = w.date && w.time ? `${fmtDate(`${w.date}T${w.time}`)} alle ${w.time}, ${typeLabel(w)}` : 'Nessuna nuova scadenza';
    const last = !f.queue || f.queue.index === f.queue.items.length - 1;
    html += `<h2 class="step-title">Riepilogo</h2>
      <p class="step-sub">Controlla prima di inviare a Trello.</p>
      <dl class="recap">
        <div><dt>Cliente</dt><dd>${esc(w.lead.name)}</dd></div>
        <div><dt>Traccia</dt><dd>${esc(w.traccia || 'Nessuna traccia')}</dd></div>
        <div><dt>Esito</dt><dd>${esc(w.outcome)}</dd></div>
        <div><dt>Scadenza</dt><dd>${esc(due)}</dd></div>
        <div><dt>Etichette</dt><dd>${w.labels.size ? tags([...w.labels]) : 'Nessuna'}</dd></div>
        <div><dt>Lista</dt><dd>${esc(w.targetList || 'Resta nella lista attuale')}</dd></div>
      </dl>
      ${jsplPanel({ lead: w.lead }, jkey)}
      <div class="actions"><button type="button" class="btn btn-primary push" id="confirm">${last ? 'Invia a Trello' : 'Invia e passa al prossimo'}</button></div>`;
  }

  b.innerHTML = html;
  bindStep(f, step, jkey);
}

function bindStep(f, step, jkey) {
  const w = f.w;
  const q = s => f.box.querySelector(s);
  const qa = s => [...f.box.querySelectorAll(s)];
  q('#wizard-back').onclick = () => w.step > minStep(f) && go(f, w.step - 1);
  if (q('#wizard-reset')) q('#wizard-reset').onclick = () => { f.w = freshWizard(); renderFlow(f); };
  if (q('#wizard-skip')) q('#wizard-skip').onclick = () => skipCurrent(f);
  const next = q('#next');

  if (step === 1) {
    bindSearch(q('#u-search'), q('#u-search-btn'), q('#u-results'), c => {
      f.w = freshWizard();
      f.w.lead = c;
      f.w.labels = presetLabels(c);
      go(f, 2);
    });
  }

  if (step === 2) {
    const ta = q('#traccia');
    ta.oninput = () => (w.traccia = ta.value);
    q('#voice').onclick = () => voice(f);
    q('#organize').onclick = () => { ta.value = organize(ta.value); w.traccia = ta.value; };
    q('#none').onclick = () => { w.traccia = ''; go(f, 3); };
    next.onclick = () => { w.traccia = ta.value.trim(); go(f, 3); };
    bindJspl(jkey, { lead: w.lead }, f.box);
  }

  if (step === 3) {
    qa('[data-o]').forEach(x => (x.onclick = () => { w.outcome = x.dataset.o; renderFlow(f); }));
    next.onclick = () => go(f, 4);
  }

  if (step === 4) {
    q('#date').onchange = e => (w.date = e.target.value);
    q('#time').oninput = e => (w.time = e.target.value);
    qa('[data-type]').forEach(x => (x.onclick = () => {
      w.type = x.dataset.type;
      qa('[data-type]').forEach(y => y.setAttribute('aria-pressed', y === x));
    }));
    next.onclick = () => {
      if (w.date && !w.time) return toast('Hai scelto la data: aggiungi anche l’ora, oppure cancella la data.', 'warn');
      if (!w.date && w.time) return toast('Hai scelto l’ora: aggiungi anche la data, oppure cancella l’ora.', 'warn');
      go(f, 5);
    };
    calendar(f.box);
  }

  if (step === 5) {
    qa('[data-l]').forEach(x => (x.onclick = () => {
      const l = x.dataset.l;
      w.labels.has(l) ? w.labels.delete(l) : w.labels.add(l);
      x.setAttribute('aria-pressed', w.labels.has(l));
    }));
    next.onclick = () => go(f, 6);
  }

  if (step === 6) {
    fillLists(f);
    next.onclick = () => go(f, 7);
  }

  if (step === 7) {
    bindJspl(jkey, { lead: w.lead }, f.box);
    q('#confirm').onclick = e => confirmFlow(f, e.currentTarget);
  }
}

async function getLists(force = false) {
  if (!listsCache || force) listsCache = (await api('/api/trello-lists')).lists || [];
  return listsCache;
}

async function fillLists(f) {
  try {
    const all = (await getLists()).map(l => l.name);
    const allowed = CONFIG.lists.available || [];
    const lists = allowed.length ? all.filter(l => allowed.some(a => sameLabel(a, l))) : all;
    const select = f.box.querySelector('#target-list');
    if (!select) return; // l'utente ha già cambiato passaggio
    select.innerHTML = `<option value="">Resta nella lista attuale</option>${lists.map(l => `<option value="${esc(l)}" ${f.w.targetList === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}`;
    select.disabled = false;
    select.onchange = e => (f.w.targetList = e.target.value);
  } catch (e) {
    const select = f.box.querySelector('#target-list');
    if (select) select.innerHTML = '<option value="">Liste non disponibili: la scheda resta dov’è</option>';
    fail(e);
  }
}

function voice(f) {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!R) return toast('La dettatura funziona su Chrome, Edge e Safari recente.', 'warn');
  const r = new R();
  r.lang = 'it-IT';
  const b = f.box.querySelector('#voice');
  b.textContent = 'In ascolto…';
  b.classList.add('recording');
  r.onresult = e => {
    const t = f.box.querySelector('#traccia');
    if (!t) return;
    t.value = [t.value, e.results[0][0].transcript].filter(Boolean).join(' ');
    f.w.traccia = t.value;
  };
  r.onerror = () => toast('Dettatura interrotta. Controlla il permesso del microfono.', 'warn');
  r.onend = () => {
    if (!b.isConnected) return;
    b.textContent = 'Detta';
    b.classList.remove('recording');
  };
  r.start();
}

function organize(t) {
  return t.replace(/\s+/g, ' ').replace(/\s*([,.!?])\s*/g, '$1 ').trim().replace(/^./, x => x.toUpperCase());
}

/* Calendario */
function ymd(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
function calendarEmbed(view, date) {
  const src = session?.calendarSrc;
  if (!src) {
    return `<div class="planner-empty">Calendario non configurato per ${esc(session?.name || 'questo venditore')}. Aggiungi su Netlify la variabile <code>${esc((session?.seller || '').toUpperCase())}_CALENDAR_SRC</code> con l’indirizzo del calendario Google.</div>`;
  }
  let u;
  try { u = new URL(src); } catch { return '<div class="planner-empty">L’indirizzo del calendario salvato su Netlify non è valido.</div>'; }
  u.searchParams.set('mode', view === 'day' ? 'DAY' : view === 'month' ? 'MONTH' : 'WEEK');
  const d = ymd(date);
  u.searchParams.set('dates', `${d}/${d}`);
  return `<iframe src="${esc(u.toString())}" title="Calendario di ${esc(session.name)}" loading="lazy"></iframe>`;
}
function calendar(root) {
  let view = 'week';
  let date = new Date();
  const q = s => root.querySelector(s);
  const draw = () => {
    q('.planner').innerHTML = calendarEmbed(view, date);
    root.querySelectorAll('[data-v]').forEach(x => x.setAttribute('aria-pressed', x.dataset.v === view));
  };
  const shift = dir => { date.setDate(date.getDate() + dir * (view === 'month' ? 30 : view === 'week' ? 7 : 1)); draw(); };
  root.querySelectorAll('[data-v]').forEach(x => (x.onclick = () => { view = x.dataset.v; draw(); }));
  q('.cal-prev').onclick = () => shift(-1);
  q('.cal-next').onclick = () => shift(1);
  q('.cal-today').onclick = () => { date = new Date(); draw(); };
  draw();
}

async function confirmFlow(f, button) {
  const w = f.w;
  const due = w.date && w.time ? new Date(`${w.date}T${w.time}`).toISOString() : null;
  const comment = [
    new Date().toLocaleDateString('it-IT'),
    `Esito: ${w.outcome}.`,
    w.traccia ? `Traccia: ${w.traccia}` : 'Nessuna traccia aggiuntiva.',
    due ? `Ricontatto previsto il ${new Date(due).toLocaleDateString('it-IT')} alle ${w.time} (${typeLabel(w)}).` : 'Nessuna nuova scadenza.',
  ].join(' ');

  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Invio in corso…';
  try {
    const r = await post('/api/trello-update-card', {
      cardId: w.lead.id,
      due,
      comment,
      labels: [...w.labels],
      managedLabels: CONFIG.labels,
      targetList: w.targetList || null,
    });
    if (r.missingLabels?.length) toast(`Etichette non presenti sulla board, non applicate: ${r.missingLabels.join(', ')}.`, 'warn');
    if (f.queue) {
      f.queue.updated.push(w.lead.name);
      advance(f, `${w.lead.name} aggiornato.`, !r.missingLabels?.length);
    } else {
      w.completed = true;
      renderFlow(f);
    }
  } catch (e) {
    button.disabled = false;
    button.textContent = label;
    fail(e);
  }
}

/* ---------- Ricerca per lista ---------- */
const picker = { list: null, cards: [], selected: new Set(), filter: '' };

function resetBatch() {
  const f = flows.batch;
  f.queue = null;
  f.w = freshWizard();
  picker.list = null;
  picker.cards = [];
  picker.selected = new Set();
  picker.filter = '';
}

function renderBatch() {
  const running = !!flows.batch.queue;
  $('#batch-picker').classList.toggle('hidden', running);
  $('#batch-run').classList.toggle('hidden', !running);
  if (running) renderFlow(flows.batch);
  else if (picker.list) renderCardPicker();
  else renderListPicker();
}

async function renderListPicker() {
  const box = $('#batch-picker');
  box.innerHTML = '<div class="panel"><p class="loading">Caricamento liste…</p></div>';
  try {
    const lists = await getLists(true);
    box.innerHTML = `<div class="panel">
      <h2 class="step-title">Scegli la lista</h2>
      <p class="step-sub">Vedrai tutti i suoi clienti, uno sotto l’altro.</p>
      ${lists.length ? `<ul class="list-pick">${lists.map(l => `
        <li><button type="button" class="list-row" data-list="${esc(l.id)}">
          <span class="list-name">${esc(l.name)}</span>
          <span class="count">${l.count} ${l.count === 1 ? 'cliente' : 'clienti'}</span>
        </button></li>`).join('')}</ul>` : '<p class="empty">Nessuna lista aperta sulla board.</p>'}
    </div>`;
    $$('[data-list]', box).forEach(b => (b.onclick = () => openPickerList(lists.find(l => l.id === b.dataset.list))));
  } catch (e) {
    box.innerHTML = e.silent ? '' : `<div class="panel"><p class="empty">${esc(e.message)}</p></div>`;
  }
}

async function openPickerList(list) {
  const box = $('#batch-picker');
  box.innerHTML = `<div class="panel"><p class="loading">Caricamento di ${esc(list.name)}</p></div>`;
  try {
    const d = await api(`/api/trello-list-cards?listId=${encodeURIComponent(list.id)}`);
    picker.list = d.list || list;
    picker.cards = d.cards || [];
    picker.selected = new Set();
    picker.filter = '';
    renderCardPicker();
  } catch (e) {
    if (!e.silent) { fail(e); renderListPicker(); }
  }
}

function visibleCards() {
  const f = picker.filter.trim().toLowerCase();
  return f ? picker.cards.filter(c => c.name.toLowerCase().includes(f)) : picker.cards;
}

function renderCardPicker() {
  const box = $('#batch-picker');
  const n = picker.cards.length;
  box.innerHTML = `<div class="panel">
      <div class="pick-head">
        <div>
          <h2>${esc(picker.list.name)}</h2>
          <p class="step-sub">${n} ${n === 1 ? 'cliente' : 'clienti'} in lista</p>
        </div>
        <button type="button" class="btn btn-sm" id="change-list">Cambia lista</button>
      </div>
      ${n ? `<div class="pick-tools">
          <input type="search" id="pick-filter" placeholder="Filtra per nome" value="${esc(picker.filter)}">
          <label class="check-row check-all"><input type="checkbox" id="pick-all"><span>Seleziona tutti</span></label>
        </div>
        <ul class="pick-list" id="pick-list"></ul>` : '<p class="empty">Questa lista è vuota. Scegline un’altra.</p>'}
    </div>
    ${n ? `<div class="sticky-cta">
      <span id="pick-count"></span>
      <button type="button" class="btn btn-primary" id="batch-start" disabled>Inizia</button>
    </div>` : ''}`;

  $('#change-list').onclick = () => { picker.list = null; renderListPicker(); };
  if (!n) return;

  const draw = () => {
    const cards = visibleCards();
    $('#pick-list').innerHTML = cards.length ? cards.map(c => `
      <li><label class="check-row pick">
        <input type="checkbox" value="${esc(c.id)}" ${picker.selected.has(c.id) ? 'checked' : ''}>
        <span class="pick-body">
          <span class="result-name">${esc(c.name)}</span>
          <span class="result-meta">${tags(labelNames(c))}${c.due ? `<span class="due">Scadenza ${esc(fmtDateTime(c.due))}</span>` : ''}</span>
        </span>
      </label></li>`).join('') : '<li class="empty">Nessun cliente corrisponde al filtro.</li>';
    $$('#pick-list input').forEach(cb => (cb.onchange = () => {
      cb.checked ? picker.selected.add(cb.value) : picker.selected.delete(cb.value);
      sync();
    }));
    sync();
  };
  const sync = () => {
    const cards = visibleCards();
    const all = $('#pick-all');
    const sel = cards.filter(c => picker.selected.has(c.id)).length;
    all.checked = cards.length > 0 && sel === cards.length;
    all.indeterminate = sel > 0 && sel < cards.length;
    const k = picker.selected.size;
    $('#pick-count').textContent = k ? `${k} ${k === 1 ? 'cliente selezionato' : 'clienti selezionati'}` : 'Seleziona i clienti da gestire';
    const start = $('#batch-start');
    start.disabled = !k;
    start.textContent = k ? `Gestisci ${k} ${k === 1 ? 'cliente' : 'clienti'}` : 'Inizia';
  };

  $('#pick-filter').oninput = e => { picker.filter = e.target.value; draw(); };
  $('#pick-all').onchange = e => {
    visibleCards().forEach(c => (e.target.checked ? picker.selected.add(c.id) : picker.selected.delete(c.id)));
    draw();
  };
  $('#batch-start').onclick = startQueue;
  draw();
}

function startQueue() {
  const items = picker.cards.filter(c => picker.selected.has(c.id)); // stesso ordine della lista
  if (!items.length) return;
  const f = flows.batch;
  f.queue = { listName: picker.list.name, items, index: 0, updated: [], skipped: [], finished: false };
  loadQueueItem(f);
  renderBatch();
  scrollToFlow(f);
}

function loadQueueItem(f) {
  const c = f.queue.items[f.queue.index];
  f.w = freshWizard();
  f.w.lead = c;
  f.w.labels = presetLabels(c);
  f.w.step = 2;
}

function advance(f, message, notify = true) {
  const q = f.queue;
  q.index++;
  if (q.index >= q.items.length) {
    q.finished = true;
    f.w.completed = true;
  } else {
    loadQueueItem(f);
    if (notify) toast(`${message} Ora: ${q.items[q.index].name}.`);
  }
  renderFlow(f);
  scrollToFlow(f);
}

function skipCurrent(f) {
  const name = f.w.lead.name;
  f.queue.skipped.push(name);
  advance(f, `${name} saltato.`);
}

async function stopQueue(f) {
  const q = f.queue;
  const left = q.items.length - q.index;
  const ok = await askDialog({
    title: 'Interrompere la sequenza?',
    text: `${left === 1 ? 'Resta 1 cliente' : `Restano ${left} clienti`} da gestire. Quelli già inviati restano aggiornati su Trello.`,
    confirmLabel: 'Interrompi',
    cancelLabel: 'Continua',
    danger: true,
  });
  if (!ok || !f.queue) return;
  q.finished = true;
  f.w.completed = true;
  renderFlow(f);
}

function renderQueueBar(f) {
  const el = $('#batch-progress');
  const q = f.queue;
  if (!q || q.finished) { el.innerHTML = ''; el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const total = q.items.length;
  const handled = q.updated.length + q.skipped.length;
  const next = q.items[q.index + 1];
  el.innerHTML = `<div class="queue-top">
      <div><span class="queue-list">${esc(q.listName)}</span><strong>Cliente ${q.index + 1} di ${total}</strong></div>
      <button type="button" class="btn btn-ghost btn-sm" id="queue-stop">Interrompi</button>
    </div>
    <div class="queue-track" role="progressbar" aria-label="Clienti gestiti" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${handled}"><span style="width:${(handled / total) * 100}%"></span></div>
    <p class="queue-next">${next ? `Dopo: ${esc(next.name)}` : 'È l’ultimo cliente della selezione.'}</p>`;
  $('#queue-stop').onclick = () => stopQueue(f);
}

function batchSummary(f) {
  const q = f.queue;
  const left = q.items.length - q.updated.length - q.skipped.length;
  const parts = [`${q.updated.length} ${q.updated.length === 1 ? 'aggiornato' : 'aggiornati'}`];
  if (q.skipped.length) parts.push(`${q.skipped.length} ${q.skipped.length === 1 ? 'saltato' : 'saltati'}`);
  if (left) parts.push(`${left} non ${left === 1 ? 'gestito' : 'gestiti'}`);
  return `<div class="done-state">
    <div class="horizon horizon-mini" aria-hidden="true"></div>
    <h2>${left ? 'Sequenza interrotta' : 'Selezione completata'}</h2>
    <p class="lede">${esc(q.listName)}: ${parts.join(', ')}.</p>
    ${q.skipped.length ? `<p class="hint">Saltati: ${esc(q.skipped.join(', '))}</p>` : ''}
    <div class="actions actions-center">
      <button type="button" class="btn btn-primary" id="batch-home">Torna alla home</button>
      <button type="button" class="btn" id="batch-again">Lavora un’altra lista</button>
    </div>
  </div>`;
}

/* ---------- Rinnova esclusive ---------- */
function renderRenewalSummary(s = {}) {
  const items = [
    ['notFound', 'Non trovati', s.notFound || 0],
    ['toRenew', 'Da rinnovare', s.toRenew || 0],
    ['notRenew', 'Da non rinnovare', s.notRenew || 0],
    ['done', 'Gestiti ora', renewals.done],
  ];
  $('#renewal-summary').innerHTML = items.map(([k, label, n]) => `<div class="stat stat-${k}"><b>${n}</b><span>${label}</span></div>`).join('');
}

async function loadRenewals() {
  const box = $('#renewal-groups');
  box.innerHTML = '<p class="loading">Lettura dei reminder…</p>';
  try {
    const d = await api('/api/trello-renewals');
    renewals.groups = d.groups || [];
    renderRenewalSummary(d.summary);
    if (!d.listFound) {
      box.innerHTML = `<p class="empty">Sulla board non c’è una lista chiamata “${esc(d.listName)}”. Creala su Trello o imposta il nome corretto su Netlify.</p>`;
      return;
    }
    $('#renewal-sub').textContent = `Reminder della lista “${d.listName}”, abbinati alla scheda originale.`;
    box.innerHTML = renewals.groups.map(g => `
      <section class="group">
        <header class="group-head"><h2>${esc(g.title)}</h2><span class="count">${g.items.length}</span></header>
        ${g.items.length ? g.items.map(i => `
          <div class="renewal-row">
            <div>
              <strong>${esc(i.reminder.name)}</strong>
              <p class="meta">${i.original ? `Scheda originale: ${esc(i.original.name)}, in ${esc(i.original.listName || '—')}` : 'Scheda originale non trovata'}</p>
            </div>
            <button type="button" class="btn btn-sm" data-r="${esc(i.reminder.id)}">Gestisci</button>
          </div>`).join('') : '<p class="empty compact">Nessun reminder in questo gruppo.</p>'}
      </section>`).join('');
  } catch (e) {
    box.innerHTML = e.silent ? '' : `<p class="empty">${esc(e.message)}</p>`;
  }
}

$('#load-renewals').onclick = loadRenewals;
$('#renewal-groups').onclick = e => {
  const b = e.target.closest('[data-r]');
  if (!b) return;
  const item = renewals.groups.flatMap(g => g.items).find(x => x.reminder.id === b.dataset.r);
  if (item) renewModal(item);
};

const CLASS_LABEL = { 'da-rinnovare': 'Da rinnovare', 'non-rinnovare': 'Da non rinnovare', 'non-trovato': 'Non trovato' };

function renewModal(i) {
  const found = !!i.original;
  const L = CONFIG.lists;
  openModal(`
    <span class="pill pill-${esc(i.classification)}">${esc(CLASS_LABEL[i.classification] || i.classification)}</span>
    <h2>${esc(i.reminder.name)}</h2>
    ${found
      ? `<p class="step-sub">Scheda originale: <strong>${esc(i.original.name)}</strong>, in ${esc(i.original.listName || '—')}</p>
         <button type="button" class="btn btn-sm" id="renewal-history">Mostra storico cliente</button>
         <div id="renewal-history-content" class="hidden"></div>`
      : `<p class="step-sub">Scheda originale non trovata. Cercala qui sotto; se non fai nulla la scheda scadenza esclusiva resta dov’è.</p>
         <div class="search-row">
           <input id="manual-search" type="search" placeholder="Cerca la scheda originale" enterkeyhint="search">
           <button id="manual-btn" type="button" class="btn btn-primary">Cerca</button>
         </div>
         <div id="manual-results"></div>`}
    ${jsplPanel(i, 'renewal')}
    ${found ? `
      <div class="field"><span>Esito</span>
        <div class="choices" id="renew-mode">
          <button type="button" class="choice" data-mode="renew">Rinnova</button>
          <button type="button" class="choice" data-mode="recover">Fase di recupero</button>
          <button type="button" class="choice" data-mode="no-renew">Non rinnovare</button>
        </div>
      </div>
      <label class="field"><span>Commento sulla scheda originale</span>
        <textarea id="renew-text"></textarea>
        <small class="char-count" id="renew-count"></small>
      </label>
      <label class="field"><span id="target-label">Sposta la scheda originale</span>
        <select id="target"></select>
      </label>
      <p class="hint" id="renew-explain"></p>
      <div class="actions">
        <button type="button" class="btn btn-primary" id="renew-confirm">Conferma</button>
        <button type="button" class="btn btn-ghost btn-sm push" id="open-link">Copia commento e apri JSPL</button>
      </div>`
    : `<div class="actions"><button type="button" class="btn" id="keep">Lascia tra i non trovati</button></div>`}
  `);
  bindJspl('renewal', i, $('#modal'));

  if (!found) {
    bindSearch($('#manual-search'), $('#manual-btn'), $('#manual-results'), c => {
      i.original = { ...c, listName: 'da verificare' };
      i.classification = 'da-rinnovare';
      renewModal(i);
    });
    $('#keep').onclick = closeModal;
    return;
  }

  $('#renewal-history').onclick = async () => {
    const box = $('#renewal-history-content');
    if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML = '<p class="loading">Caricamento storico…</p>';
    try {
      const d = await api(`/api/trello-get-card?cardId=${encodeURIComponent(i.original.id)}`);
      box.innerHTML = timeline(d.history || []);
    } catch (e) {
      box.innerHTML = e.silent ? '' : `<p class="empty">${esc(e.message)}</p>`;
    }
  };

  const opt = (v, label, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(label)}</option>`;
  const MODES = {
    renew: {
      text: CONFIG.renewalTemplate,
      targets: () => opt('', 'Nessuno spostamento', true) + opt(L.noValutazione, L.noValutazione) + opt(L.freddo, L.freddo) + opt(L.ko, L.ko),
      label: 'Sposta la scheda originale (facoltativo)',
      explain: 'Il commento va sulla scheda originale, poi la scheda scadenza esclusiva viene archiviata.',
      button: 'Rinnova e archivia la scadenza',
      cls: 'btn-primary',
    },
    recover: {
      text: CONFIG.recoveryTemplate,
      targets: () => opt(L.noValutazione, L.noValutazione, true) + opt(L.freddo, L.freddo),
      label: 'Lista di recupero per la scheda originale',
      explain: 'La scheda originale viene spostata nella lista di recupero con il commento, poi la scheda scadenza esclusiva viene archiviata.',
      button: 'Sposta in recupero e archivia la scadenza',
      cls: 'btn-primary',
    },
    'no-renew': {
      text: CONFIG.notRenewTemplate,
      targets: () => opt('', 'Nessuno spostamento', true) + opt(L.ko, L.ko) + opt(L.freddo, L.freddo) + opt(L.noValutazione, L.noValutazione),
      label: 'Sposta la scheda originale (facoltativo)',
      explain: 'Il commento va sulla scheda originale, poi la scheda scadenza esclusiva viene archiviata.',
      button: 'Non rinnovare e archivia la scadenza',
      cls: 'btn-danger',
    },
  };

  const text = $('#renew-text');
  const count = () => {
    const n = text.value.trim().length;
    const short = n > 0 && n < CONFIG.minTraceLength;
    $('#renew-count').textContent = short ? `${n} caratteri: ne servono almeno ${CONFIG.minTraceLength}` : `${n} caratteri`;
    $('#renew-count').classList.toggle('warn', short || (n === 0 && i.mode === 'recover'));
  };
  const setMode = mode => {
    const m = MODES[mode];
    // Cambia il testo solo se è ancora quello preimpostato di un altro esito (non cancella testo scritto a mano)
    const presets = Object.values(MODES).map(x => x.text);
    if (!text.value.trim() || presets.includes(text.value.trim())) text.value = m.text;
    i.mode = mode;
    $$('#renew-mode [data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === mode));
    $('#target').innerHTML = m.targets();
    $('#target-label').textContent = m.label;
    $('#renew-explain').textContent = m.explain;
    const btn = $('#renew-confirm');
    btn.textContent = m.button;
    btn.className = `btn ${m.cls}`;
    // Nel "non rinnovare" la traccia non va inserita su JSPL
    $('#open-link').classList.toggle('hidden', mode === 'no-renew');
    count();
  };
  text.oninput = count;
  $$('#renew-mode [data-mode]').forEach(b => (b.onclick = () => setMode(b.dataset.mode)));
  setMode(i.classification === 'non-rinnovare' ? 'no-renew' : 'renew');

  $('#renew-confirm').onclick = e => renewAction(i, i.mode, e.currentTarget);
  $('#open-link').onclick = async () => {
    const problem = traceProblem(text.value, true);
    if (problem) return toast(problem, 'warn');
    let copied = false;
    try { await navigator.clipboard.writeText(text.value.trim()); copied = true; } catch {}
    const opened = await openJspl(i);
    if (copied) toast(opened ? 'Commento copiato, JSPL aperto.' : 'Commento copiato.');
  };
}

// Il commento è facoltativo (tranne in fase di recupero), ma se c'è deve avere almeno 100 caratteri.
function traceProblem(value, required = false) {
  const n = String(value || '').trim().length;
  if (!n) return required ? `Scrivi un commento di almeno ${CONFIG.minTraceLength} caratteri.` : '';
  if (n < CONFIG.minTraceLength) return `Il commento ha ${n} caratteri: ne servono almeno ${CONFIG.minTraceLength}.`;
  return '';
}

async function renewAction(i, mode, button) {
  const text = $('#renew-text').value.trim();
  const targetList = $('#target').value;
  const problem = traceProblem(text, mode === 'recover');
  if (problem) return toast(problem, 'warn');
  if (mode === 'recover' && ![CONFIG.lists.noValutazione, CONFIG.lists.freddo].includes(targetList)) {
    return toast('Scegli la lista di recupero per la scheda originale.', 'warn');
  }
  $$('#modal .actions .btn, #renew-mode .choice').forEach(b => (b.disabled = true));
  const label = button.textContent;
  button.textContent = 'Invio in corso…';
  try {
    await post('/api/trello-renew-action', {
      reminderCardId: i.reminder.id,
      originalCardId: i.original.id,
      mode,
      text,
      targetList,
      minTextLength: CONFIG.minTraceLength,
    });
    renewals.done++;
    closeModal();
    const done = {
      renew: 'Rinnovato. Scheda scadenza esclusiva archiviata.',
      recover: `Scheda originale spostata in ${targetList}. Scadenza esclusiva archiviata.`,
      'no-renew': 'Non rinnovato. Scheda scadenza esclusiva archiviata.',
    };
    toast(done[mode]);
    loadRenewals();
  } catch (e) {
    $$('#modal .actions .btn, #renew-mode .choice').forEach(b => (b.disabled = false));
    button.textContent = label;
    fail(e);
  }
}

/* ---------- Finestra modale ---------- */
let lastFocus = null;
function openModal(html) {
  lastFocus = document.activeElement;
  $('#modal-content').innerHTML = html;
  $('#modal').classList.remove('hidden');
  document.body.classList.add('modal-open');
  $('#close-modal').focus();
}
function closeModal() {
  if ($('#modal').classList.contains('hidden')) return;
  $('#modal').classList.add('hidden');
  document.body.classList.remove('modal-open');
  lastFocus?.focus?.();
}
$('#close-modal').onclick = closeModal;
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#dialog').classList.contains('hidden')) return closeDialog(null);
  closeModal();
});

/* ---------- Finestra di conferma / inserimento ---------- */
let dialogResolve = null;
function closeDialog(value) {
  $('#dialog').classList.add('hidden');
  $('#dialog').innerHTML = '';
  const r = dialogResolve;
  dialogResolve = null;
  r?.(value);
}
// Sostituisce prompt() e confirm() del browser: stessa grafica dell'app e nessun blocco nei browser integrati.
function askDialog({ title, text = '', input = '', validate = () => '', confirmLabel = 'Conferma', cancelLabel = 'Annulla', danger = false }) {
  if (dialogResolve) closeDialog(null);
  return new Promise(resolve => {
    dialogResolve = resolve;
    const d = $('#dialog');
    d.innerHTML = `<form class="dialog-card" novalidate>
      <h2 id="dialog-title">${esc(title)}</h2>
      ${text ? `<p class="lede">${esc(text)}</p>` : ''}
      ${input ? `<input id="dialog-input" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="${esc(input)}" aria-labelledby="dialog-title">` : ''}
      <p class="form-error" id="dialog-error" role="alert"></p>
      <div class="actions">
        <button type="button" class="btn btn-ghost" id="dialog-cancel">${esc(cancelLabel)}</button>
        <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'} push">${esc(confirmLabel)}</button>
      </div>
    </form>`;
    d.classList.remove('hidden');
    const field = $('#dialog-input');
    (field || $('#dialog [type=submit]')).focus();
    $('#dialog-cancel').onclick = () => closeDialog(input ? null : false);
    $('#dialog form').onsubmit = e => {
      e.preventDefault();
      if (!input) return closeDialog(true);
      const v = field.value.trim();
      const err = validate(v);
      if (err) { $('#dialog-error').textContent = err; field.select(); return; }
      closeDialog(v);
    };
  });
}
$('#dialog').addEventListener('click', e => { if (e.target.id === 'dialog') closeDialog(null); });

/* ---------- Avvio ---------- */
(async function boot() {
  try {
    const r = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
    if (r.ok) return startApp(await r.json());
    showLogin();
  } catch {
    showLogin('Server non raggiungibile. Controlla la connessione e ricarica la pagina.');
  }
})();
