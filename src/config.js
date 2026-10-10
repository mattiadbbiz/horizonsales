// Impostazioni comuni a tutti i venditori.
// Calendario e credenziali Trello NON stanno qui: arrivano da Netlify dopo il login.
export const CONFIG = {
  labels: ['NR 1', 'NR 2', 'NR 3', '9-13', '13-15', '15-18', 'EMAIL', 'GIACOMO', 'DOMENICO', 'ANGELO', 'INVIARE MESSAGGIO', 'PRIMA VALUTAZIONE', 'PRONTO CHIUSURA'],
  lists: {
    noValutazione: 'DA RECUPERARE (NO VALUTAZIONE)',
    freddo: 'DA RECUPERARE (FREDDO)',
    ko: 'KO',
    vuoto: 'VUOTO',
    // Vuoto = nel passaggio "Sposta scheda" compaiono tutte le liste aperte della board.
    // Se inserisci dei nomi, compaiono solo quelli.
    available: [],
  },
  // Testi preimpostati per i rinnovi: minimo 100 caratteri ciascuno (vale anche per i testi modificati).
  minTraceLength: 100,
  renewalTemplate: 'Sono in contatto con il cliente e la trattativa sta andando avanti: confermo il suo interesse e procedo con il rinnovo dell’esclusiva.',
  recoveryTemplate: 'Il cliente è in fase di recupero: la trattativa al momento è ferma, lo ricontatterò nei prossimi giorni per capire come riprenderla.',
  notRenewTemplate: 'Il cliente ha deciso di non partire, di conseguenza la trattativa si chiude qui per il momento e procedo a non rinnovare l’esclusiva.',
};
