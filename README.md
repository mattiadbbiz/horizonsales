# Team Horizon · Sales workspace

Web app collegata a Trello con quattro sezioni:

- **Storico clienti**: cerca una scheda e rileggi tutti i commenti.
- **Aggiorna cliente**: un cliente alla volta, dopo una chiamata o un cambiamento.
- **Ricerca per lista**: scegli una lista, seleziona più clienti e aggiornali in sequenza (stessi 7 passaggi, calendario incluso). Finito un cliente si passa da soli al successivo; si può saltare un cliente o interrompere. A fine selezione c'è il riepilogo e il ritorno alla home.
- **Rinnova esclusive**: abbina i reminder alle schede originali e decide cosa rinnovare.
Ogni venditore accede con le proprie credenziali e lavora solo sulla propria board e sul proprio calendario.

## Come funziona l'accesso

1. Il venditore inserisce nome utente e password.
2. La funzione `login` li confronta con le variabili salvate su Netlify (mai nel codice).
3. Se sono corretti, il browser riceve un cookie di sessione firmato e protetto (`HttpOnly`, `Secure`), valido 24 ore.
4. Ogni chiamata a Trello passa dalle funzioni Netlify, che usano API key, token e board del venditore loggato.
   Le chiavi Trello non arrivano mai al browser.

Per cambiare una password: modifica la variabile su Netlify e fai un nuovo deploy.
Le sessioni aperte vengono chiuse automaticamente.

## Installarla sul telefono

L'app si installa come un'app vera (PWA): icona sulla schermata Home, apertura a schermo intero, nessuna barra del browser.

- **Android (Chrome):** apri il sito, menu con i tre puntini, poi "Installa app" o "Aggiungi a schermata Home".
- **iPhone (Safari, non Chrome):** apri il sito, pulsante Condividi, poi "Aggiungi alla schermata Home".

Gli aggiornamenti arrivano da soli a ogni deploy. Su iPhone la prima volta bisogna rifare l'accesso dentro l'app.
Al primo accesso il telefono propone di salvare nome utente e password.

## Variabili su Netlify

| Dato | Mattia | Manoah |
|---|---|---|
| Trello API key | `TRELLO_API_KEY` | `MANOAH_API_KEY` |
| Trello token | `TRELLO_TOKEN` | `MANOAH_TOKEN` |
| Board ID | `TRELLO_BOARD_ID` | `MANOAH_BOARD_ID` |
| Calendario Google | `MATTIA_CALENDAR_SRC` | `MANOAH_CALENDAR_SRC` |

Nome utente e password di accesso sono anch'essi variabili su Netlify, una coppia per venditore, e non compaiono nel codice né in questo file.

Facoltative:
- `RENEWAL_LIST_NAME`: nome della lista dei reminder (predefinito `RINNOVA ESCLUSIVE`). Per un nome diverso per venditore: `MATTIA_RENEWAL_LIST_NAME`, `MANOAH_RENEWAL_LIST_NAME`.
- `SESSION_SECRET`: chiave di firma delle sessioni. Se manca, viene ricavata dai segreti già presenti.

I nomi non distinguono maiuscole e minuscole. Per il calendario puoi incollare sia l'URL `src` sia l'intero codice `<iframe>`.
Tutti i nomi accettati sono elencati in cima a `netlify/functions/_shared/session.js`: per aggiungere un venditore basta copiare un blocco.

## Struttura

```
index.html
assets/team-horizon.jpg
src/main.js            interfaccia
src/styles.css         grafica
src/config.js          etichette, liste e testi comuni
netlify/functions/
  _shared/session.js   venditori, login, sessioni
  _shared/trello.js    client Trello
  login.js  logout.js  session.js
  trello-search-card.js  trello-get-card.js  trello-update-card.js
  trello-lists.js  trello-list-cards.js
  trello-renewals.js  trello-renew-action.js
netlify.toml
```

## Dopo il deploy

Accedi con entrambi gli account e prova una scheda di test prima di usare schede reali.
In caso di errori, controlla i log delle funzioni su Netlify.
