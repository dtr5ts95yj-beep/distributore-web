import * as pdfjs from './lib/pdf.min.mjs';
import { Gestionale, TIPI, leggiZip, oggiIso, isoIta, normalizza, chiave, piuGiorni, dataZip as dataZipNome } from './logica.js';
const lunediDi = (iso) => piuGiorni(iso, -((new Date(iso + 'T12:00:00').getDay() + 6) % 7));
import { drive } from './drive.js';
import { pdfRifornimento, pdfInventario, nomeFile } from './stampa.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./lib/pdf.worker.min.mjs', import.meta.url).href;
const VERSIONE = '1.5';

// ------------------------------------------------------------------ archivio nel telefono (IndexedDB)
const archivio = {
  _db: null,
  async apri() {
    if (this._db) return this._db;
    this._db = await new Promise((ok, ko) => {
      const r = indexedDB.open('distributore', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('dati');
      r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
    });
    return this._db;
  },
  async leggi(k) { const db = await this.apri(); return new Promise((ok, ko) => { const r = db.transaction('dati').objectStore('dati').get(k); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); }); },
  async scrivi(k, v) { const db = await this.apri(); return new Promise((ok, ko) => { const t = db.transaction('dati', 'readwrite'); t.objectStore('dati').put(v, k); t.oncomplete = () => ok(); t.onerror = () => ko(t.error); }); },
};

// backup automatici nel telefono: gli ultimi 10, prima delle operazioni delicate e uno al giorno
async function backupLocale(motivo) {
  try {
    const elenco = (await archivio.leggi('backup_elenco')) || [];
    const chiave = 'backup:' + new Date().toISOString();
    await archivio.scrivi(chiave, JSON.parse(JSON.stringify(g.s)));
    elenco.push({ chiave, motivo, ora: new Date().toISOString(), articoli: Object.keys(g.s.prodotti).length });
    while (elenco.length > 10) { const via = elenco.shift(); await archivio.scrivi(via.chiave, null); }
    await archivio.scrivi('backup_elenco', elenco);
  } catch (e) { console.warn('backup locale', e); }
}

// ------------------------------------------------------------------ stato della pagina
let g = null;                       // Gestionale
const ui = { scheda: 'oggi', pagina: '', controllo: { data: '', righe: {} }, inventario: {}, meseStorico: '', mese: oggiIso().slice(0, 7), settimana: '', cerca: '', filtro: 'tutti', cercaStorico: '', tipoStorico: 'tutti', quantiStorico: 150, drive: { stato: 'fermo', msg: '', nuovi: [] } };
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => Number(n || 0).toLocaleString('it-IT');
const GIORNI = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const ico = {
  aggiorna: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>',
  freccia: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" style="width:20px;height:20px;color:var(--tenue)"><path d="m9 5 7 7-7 7"/></svg>',
  ok: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" style="color:var(--verde);width:28px;height:28px"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
  cerca: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" style="width:18px;height:18px;color:var(--tenue)"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
  mail: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
};

function avviso(testo, errore = false) {
  const a = $('#avviso');
  a.textContent = testo; a.className = errore ? 'errore' : ''; a.hidden = false;
  clearTimeout(avviso._t); avviso._t = setTimeout(() => { a.hidden = true; }, errore ? 6000 : 3500);
}

// ------------------------------------------------------------------ salvataggio
let timerDrive = null;
async function salva() {
  await archivio.scrivi('stato', g.s);
  if (drive.collegato && drive.token()) {
    clearTimeout(timerDrive);
    timerDrive = setTimeout(() => drive.salvaDati(g.s).catch((e) => console.warn('Salvataggio su Drive', e)), 2500);
  }
}
async function cambia(fn, messaggio) {
  try { const r = fn(); await salva(); if (messaggio) avviso(typeof messaggio === 'function' ? messaggio(r) : messaggio); disegna(); return r; }
  catch (e) { avviso(e.message || String(e), true); }
}

// ------------------------------------------------------------------ Google Drive: sincronizza
async function sincronizza(manuale = false) {
  if (!drive.clientId || !g) return;
  if (!drive.token()) {
    if (drive.collegato && !sessionStorage.getItem('drive_silenzioso')) {
      sessionStorage.setItem('drive_silenzioso', '1');
      drive.accedi(true);            // torna qui da solo, senza chiedere niente
      return;
    }
    ui.drive = { stato: 'accedi', msg: drive.collegato ? 'Tocca per aggiornare da Google Drive' : 'Collega Google Drive', nuovi: [] };
    disegna();
    if (manuale) drive.accedi(false);
    return;
  }
  const cartella = g.s.impostazioni.drive_cartella_id;
  ui.drive = { stato: 'lavoro', msg: 'Controllo Google Drive…', sotto: `Cartella ${g.s.impostazioni.drive_cartella_nome || ''}`, nuovi: [], lista: [] };
  disegna();
  try {
    // 1) dati: se su Drive c'è una versione più nuova (es. dall'altro dispositivo) la prendo
    const remoti = await drive.leggiDati();
    if (remoti && remoti.formato === 'distributore-web' && (remoti.aggiornato || '') > (g.s.aggiornato || '')) {
      g = new Gestionale(remoti);
      await archivio.scrivi('stato', g.s);
    }
    // 2) ZIP nuovi nella cartella
    const nuovi = [];
    if (cartella) {
      const elenco = await drive.zipNellaCartella(cartella);
      const da = g.zipDaImportare(elenco);
      ui.drive.lista = da.map((f) => ({ nome: f.name, stato: 'attesa', info: 'in coda' }));
      if (da.length) { ui.drive.msg = `Trovati ${da.length} ZIP nuovi`; disegna(); }
      for (const [i, f] of da.entries()) {
        const voce = ui.drive.lista[i];
        voce.stato = 'lavoro'; voce.info = 'scarico da Drive…'; ui.drive.msg = `ZIP ${i + 1} di ${da.length}`; disegna();
        const dati = await drive.scarica(f.id);
        voce.info = `leggo il PDF (${Math.round(dati.length / 1024)} KB)…`; disegna();
        const letto = await leggiZip(window.JSZip, pdfjs, dati, f.name);
        const r = g.importaZip(letto, f.id);
        nuovi.push({ nome: f.name, ...r });
        if (r.ok) {
          voce.stato = r.completo ? 'ok' : 'controlla';
          voce.info = `${r.righe} righe · ${num(r.pezzi_pdf)} pezzi nel PDF${r.sospese ? ` · ${r.sospese} da abbinare` : ''}${r.completo ? ' · tutto contato' : ''}`;
        } else { voce.stato = r.gia ? 'ok' : 'errore'; voce.info = r.gia ? 'già importato' : r.errori.join(' '); }
        await archivio.scrivi('stato', g.s); disegna();
      }
    }
    await archivio.scrivi('stato', g.s);
    if (nuovi.length || !remoti || (g.s.aggiornato || '') > (remoti.aggiornato || '')) await drive.salvaDati(g.s);
    const pezzi = nuovi.reduce((s, x) => s + (x.pezzi || 0), 0);
    ui.drive = { stato: 'fatto', nuovi, lista: ui.drive.lista || [], ora: new Date(),
      msg: !cartella ? 'Scegli la cartella degli ZIP (Altro)' : nuovi.length ? `${nuovi.length} ZIP nuov${nuovi.length === 1 ? 'o' : 'i'} da Google Drive` : 'Nessuno ZIP nuovo',
      sotto: nuovi.length ? `${num(pezzi)} pezzi · importati alle ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}` : `Controllato alle ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}` };
    const err = nuovi.filter((x) => !x.ok && !x.gia);
    if (err.length) avviso(`${err[0].nome}: ${err[0].errori.join(' ')}`, true);
  } catch (e) {
    if (e.accesso) { ui.drive = { stato: 'accedi', msg: 'Tocca per aggiornare da Google Drive', nuovi: [] }; }
    else { ui.drive = { stato: 'errore', msg: 'Google Drive non raggiungibile', sotto: e.message, nuovi: [] }; }
  }
  disegna();
}

// ------------------------------------------------------------------ schermate
function disegna() {
  document.querySelectorAll('#schede button').forEach((b) => b.setAttribute('aria-current', b.dataset.scheda === ui.scheda ? 'page' : 'false'));
  $('#schede').hidden = !g;
  const s = $('#schermo');
  if (!g) { s.innerHTML = benvenuto(); return; }
  const pagine = { prelievi, storico, abbinamenti, impostazioni, backup, controllo, riepilogo, magazzino, inventario, zipimportati, storicoimporta, ignorate, info };
  s.innerHTML = ui.scheda === 'altro' && ui.pagina && pagine[ui.pagina]
    ? `<button type="button" class="indietro" data-a="indietro">‹ Altro</button>${pagine[ui.pagina]()}`
    : ({ oggi, articoli, rifornimento, calendario, altro })[ui.scheda]();
  if (ui.focus) { const el = document.getElementById(ui.focus); if (el) { el.focus(); el.setSelectionRange?.(el.value.length, el.value.length); } ui.focus = null; }
}

function benvenuto() {
  return `<div class="benvenuto carta" style="background:none;gap:16px">
    <img src="icone/icona-192.png" alt="">
    <h1>Distributore</h1>
    <p class="tenue" style="margin:0;font-size:16px">La prima volta carica i tuoi dati: il file <b>dati_iniziali_distributore.json</b>, oppure un backup.</p>
    <label class="btn" style="width:100%">Carica i dati<input type="file" accept=".json,application/json" data-file="dati" class="nascosto"></label>
    <button class="btn vuoto" type="button" data-a="vuoto" style="width:100%">Parti da zero</button>
  </div>`;
}

function cartaDrive() {
  const d = ui.drive;
  if (!drive.clientId) return `<button type="button" class="drive attenzione" data-a="vai-altro"><span class="icona">${ico.aggiorna}</span><span class="corpo" style="flex-grow:1;display:flex;flex-direction:column"><b>Collega Google Drive</b><small class="tenue">Per prendere gli ZIP da soli · Altro → Google Drive</small></span>${ico.freccia}</button>`;
  const gira = d.stato === 'lavoro' ? ' gira' : '';
  const titolo = d.msg || 'Google Drive';
  const sotto = d.sotto || (d.stato === 'accedi' ? 'Un tocco e importa gli ZIP nuovi' : '');
  const azione = d.stato === 'accedi' ? 'accedi' : 'apri-drive';
  return `<button type="button" class="drive${d.stato === 'errore' || d.stato === 'accedi' ? ' attenzione' : ''}" data-a="${azione}">
    <span class="icona"><span class="${gira}" style="display:grid">${ico.aggiorna}</span></span>
    <span style="flex-grow:1;display:flex;flex-direction:column;gap:2px"><b>${esc(titolo)}</b><small class="tenue">${esc(sotto)}</small></span>${ico.freccia}</button>`;
}

const SIMBOLI = { ok: '✓', controlla: '!', manca: '✕', ignorato: '–', prima: '·', attesa: '…', lavoro: '↓', errore: '✕' };
function listaCaricamento() {
  const l = ui.drive.lista || [];
  if (!l.length) return '';
  return `<div class="lista caricamento">${l.map((v) => `<div class="voce"><span class="stato-z ${v.stato}">${v.stato === 'lavoro' ? `<span class="gira" style="display:grid">${ico.aggiorna}</span>` : SIMBOLI[v.stato] || ''}</span>
    <span class="corpo"><b class="taglia">${esc(v.nome)}</b><small>${esc(v.info)}</small></span></div>`).join('')}</div>`;
}

function strisciaZip() {
  // solo i giorni dalla data di partenza in avanti: quelli prima li gestiva il programma
  const part = g.s.impostazioni.zip_partenza ? piuGiorni(g.s.impostazioni.zip_partenza, -1) : '';
  const giorni = g.giorniZip(7).filter((x) => !part || x.giorno >= part);
  const mancano = giorni.filter((x) => x.stato === 'manca').length;
  const controlla = giorni.filter((x) => x.stato === 'controlla').length;
  const frase = mancano ? `Manca${mancano === 1 ? '' : 'no'} ${mancano} ${mancano === 1 ? 'giorno' : 'giorni'}` : controlla ? 'Uno ZIP da controllare' : 'Tutti gli ZIP ci sono';
  const SIGLE = ['Do', 'Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa'];
  return `<div class="carta">
    <div class="riga-titolo" style="align-items:center"><b style="font-size:16px">ZIP ${giorni.length < 7 && part ? 'dal ' + isoIta(part).slice(0, 5) : 'degli ultimi 7 giorni'}</b><span class="tenue" style="color:${mancano ? 'var(--rosso)' : controlla ? 'var(--arancio)' : 'var(--verde)'};font-weight:700">${frase}</span></div>
    <div class="striscia">${giorni.map((x) => {
      const pezzi = x.zip.reduce((t, z) => t + (g.dettaglioZip(z.nome)?.pezzi || 0), 0);
      return `<button type="button" class="tile ${x.stato}" data-a="giorno-zip" data-giorno="${x.giorno}" aria-label="${GIORNI[new Date(x.giorno + 'T12:00').getDay()]} ${isoIta(x.giorno)}: ${x.stato}">
        <span class="sg">${SIGLE[new Date(x.giorno + 'T12:00').getDay()]}</span><span class="nr">${Number(x.giorno.slice(8))}</span>
        <span class="si">${SIMBOLI[x.stato]}</span><span class="pz">${x.zip.length ? num(pezzi) : ''}</span></button>`;
    }).join('')}</div>
    <small class="tenue">Tocca un giorno per vedere il suo ZIP riga per riga.</small>
  </div>`;
}

function esitiNonVisti() {
  const e = g.s.esiti_controlli.filter((x) => !x.visto);
  if (!e.length) return '';
  return e.map((x, i) => `<div class="carta ${x.ammanchi.length ? 'avviso-carta' : ''}">
    <b>Controllo sul posto del ${isoIta(x.data)}: confrontato con lo ZIP</b>
    <small class="tenue">${x.coperti} ${x.coperti === 1 ? 'articolo spiegato' : 'articoli spiegati'} dai prelievi${x.ammanchi.length ? `, ${x.ammanchi.length} con ammanco:` : '. Nessun ammanco.'}</small>
    ${x.ammanchi.map((a) => `<div class="riga-titolo" style="align-items:center"><span><b>${esc(a.codice)}</b> <small class="tenue">${esc(a.descrizione)}</small></span><b style="color:var(--arancio)">−${a.pezzi}</b></div><small class="tenue">mancavano ${a.mancanti}, i prelievi ne spiegano ${a.prelevati}: ${a.pezzi} ${a.pezzi === 1 ? 'pezzo è un ammanco' : 'pezzi sono un ammanco'}, già nel rifornimento</small>`).join('')}
    <button type="button" class="btn vuoto piccolo" data-a="esito-visto" data-data="${x.data}">Ok, visto</button></div>`).join('');
}

function controllo() {
  const c = ui.controllo;
  if (!c.data) c.data = oggiIso();
  const attesa = g.controlliInAttesa();
  const codici = Object.keys(g.s.prodotti).sort();
  const righe = Object.entries(c.righe);
  return `<h1>Controllo sul posto</h1>
  <div class="tenue">Al distributore segna i pezzi che mancano. Li tolgo subito e li metto nel rifornimento; quando arriva lo ZIP di quel giorno confronto e trovo l'eventuale ammanco, senza togliere niente due volte.</div>
  <div class="carta">
    <div class="campo"><label for="ctrl-data">Giorno del controllo</label><input id="ctrl-data" type="date" value="${c.data}" data-a-cambio="ctrl-data"></div>
    <div class="campo"><label for="ctrl-art">Articolo</label><select id="ctrl-art"><option value="">Scegli l'articolo…</option>${codici.map((k) => `<option value="${esc(k)}">${esc(k)} – ${esc(g.prodotto(k).descrizione)}</option>`).join('')}</select></div>
    <div class="affianca"><div class="campo"><label for="ctrl-q">Pezzi mancanti</label><input id="ctrl-q" type="number" inputmode="numeric" min="1" value="1"></div>
      <button type="button" class="btn secondario" data-a="ctrl-aggiungi" style="align-self:flex-end">Aggiungi</button></div>
    ${righe.length ? `<div class="lista">${righe.map(([k, q]) => `<div class="voce"><span class="corpo"><b>${esc(k)}</b><small class="taglia">${esc(g.prodotto(k)?.descrizione || '')}</small></span><b style="font-size:18px">${q}</b>
      <button type="button" class="btn vuoto piccolo" data-a="ctrl-togli" data-codice="${esc(k)}" aria-label="Togli ${esc(k)}">Togli</button></div>`).join('')}</div>
      <button type="button" class="btn" data-a="ctrl-salva">Salva il controllo (${righe.reduce((t, [, q]) => t + q, 0)} pezzi)</button>` : '<small class="tenue">Aggiungi gli articoli con i pezzi mancanti.</small>'}
  </div>
  ${attesa.length ? `<h2>In attesa dello ZIP</h2>${attesa.map((a) => `<div class="carta"><div class="riga-titolo" style="align-items:center"><b>${GIORNI[new Date(a.data + 'T12:00').getDay()]} ${isoIta(a.data)}</b><span class="tenue">${a.pezzi} pezzi</span></div>
    ${a.righe.map((r) => `<small><b>${esc(r.codice)}</b> mancanti ${r.mancanti} · tolti ${r.scalati}${r.assorbiti ? ` · rimessi dagli ZIP ${r.assorbiti}` : ''}</small>`).join('')}
    <div class="affianca"><button type="button" class="btn vuoto piccolo" data-a="ctrl-modifica" data-data="${a.data}">Modifica</button><button type="button" class="btn pericolo piccolo" data-a="ctrl-elimina" data-data="${a.data}">Elimina</button></div></div>`).join('')}` : ''}
  ${g.s.esiti_controlli.length ? `<h2>Controlli chiusi</h2><div class="lista">${g.s.esiti_controlli.slice().reverse().map((x) => `<div class="voce"><span class="corpo"><b>${isoIta(x.data)}</b><small>${x.coperti} spiegati${x.ammanchi.length ? ` · ammanchi: ${x.ammanchi.map((a) => `${esc(a.codice)} −${a.pezzi}`).join(', ')}` : ' · nessun ammanco'}</small></span></div>`).join('')}</div>` : ''}`;
}

function riepilogo() {
  const r = g.riepilogoSettimana();
  const max = Math.max(1, ...r.giorni.map((x) => x.pezzi));
  const SIGLE = ['Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa', 'Do'];
  const freccia = r.variazione == null ? '' : r.variazione > 0 ? `<span style="color:var(--verde)">▲ ${r.variazione}%</span>` : r.variazione < 0 ? `<span style="color:var(--rosso)">▼ ${-r.variazione}%</span>` : 'uguale';
  return `<h1>Com'è andata la settimana</h1>
  <div class="sopra">Dal ${isoIta(r.dal)} al ${isoIta(r.al)}</div>
  <div class="numeri">
    <div><span>Prelevati</span><strong style="color:var(--rosa)">${num(r.pezzi)}</strong><span>${freccia}${r.pezzi_prima ? ` · erano ${num(r.pezzi_prima)}` : ''}</span></div>
    <div><span>Articoli</span><strong>${r.articoli}</strong><span>diversi</span></div>
    <div><span>Rifornimenti</span><strong>${r.rifornimenti}</strong><span>${r.rifornimenti ? `${num(r.pezzi_riforniti)} pezzi` : ''}</span></div>
  </div>
  <div class="carta"><div class="grafico sett7">${r.giorni.map((x, i) => `<div><span class="v">${x.pezzi || ''}</span><span class="b" style="height:${Math.round(x.pezzi * 100 / max)}%;${r.giorni_mancanti.includes(x.giorno) ? 'background:repeating-linear-gradient(45deg,#ff8a8a 0 4px,transparent 4px 8px)' : ''}"></span><span class="e">${SIGLE[i]}</span></div>`).join('')}</div></div>
  ${r.piu_prelevati.length ? `<h2>I più prelevati</h2><div class="lista">${r.piu_prelevati.map((x, i) => `<button type="button" class="voce" data-a="articolo" data-codice="${esc(x.codice)}"><b style="color:var(--rosa);width:22px">${i + 1}</b><span class="corpo"><b>${esc(x.codice)}</b><small class="taglia">${esc(x.descrizione)}</small></span><b style="font-size:18px">${num(x.totale)}</b></button>`).join('')}</div>` : ''}
  ${r.giorni_mancanti.length ? `<div class="carta avviso-carta">${r.giorni_mancanti.length} ${r.giorni_mancanti.length === 1 ? 'giorno' : 'giorni'} senza ZIP: ${r.giorni_mancanti.map(isoIta).join(', ')}</div>` : ''}
  ${r.sotto_scorta ? `<div class="carta">Adesso ${r.sotto_scorta} ${r.sotto_scorta === 1 ? 'articolo è' : 'articoli sono'} sotto scorta. <button type="button" class="btn vuoto piccolo" data-a="vedi-sotto">Vedi</button></div>` : ''}`;
}

function oggi() {
  const d = new Date();
  const el = g.elenco();
  const sotto = el.filter((p) => p.sotto || p.negativo);
  const mancanti = g.giorniMancanti();
  const bozza = g.s.bozza.filter((b) => b.quantita > 0);
  const pezziBozza = bozza.reduce((s, b) => s + b.quantita, 0);
  const sosp = g.s.sospese.length;
  return `
  <div class="riga-titolo"><div><div class="sopra">${GIORNI[d.getDay()]} ${d.getDate()} ${MESI[d.getMonth()]}</div><h1>Ciao Andrea</h1></div><span class="sigla">AC</span></div>
  ${cartaDrive()}
  ${listaCaricamento()}
  ${strisciaZip()}
  ${sosp ? `<button type="button" class="drive attenzione" data-a="apri-drive"><span class="icona" style="background:#8a5a2a">!</span><span style="flex-grow:1;display:flex;flex-direction:column"><b>${sosp} ${sosp === 1 ? 'riga' : 'righe'} da abbinare</b><small class="tenue">Non entrano nel rifornimento finché non scegli il codice AS400</small></span>${ico.freccia}</button>` : ''}
  ${esitiNonVisti()}
  <div class="numeri">
    <div><span>Prelevati</span><strong style="color:var(--rosa)">${num(g.prelevatiSettimana())}</strong><span>questa sett.</span></div>
    <div><span>Sotto scorta</span><strong style="color:${sotto.length ? 'var(--arancio)' : 'var(--verde)'}">${sotto.length}</strong><span>articoli</span></div>
    <div><span>Senza ZIP</span><strong style="color:${mancanti.length ? 'var(--rosso)' : 'var(--verde)'}">${mancanti.length}</strong><span>giorni</span></div>
  </div>
  <div class="carta">
    <div class="riga-titolo" style="align-items:center"><b style="font-size:16px">Rifornimento pronto</b></div>
    <div style="display:flex;gap:24px"><div><div style="font-size:28px;font-weight:800">${bozza.length}</div><div class="tenue">articoli</div></div><div><div style="font-size:28px;font-weight:800">${num(pezziBozza)}</div><div class="tenue">pezzi da riportare</div></div></div>
    <button type="button" class="btn secondario" data-scheda="rifornimento">Vedi e crea il PDF</button>
  </div>
  ${sotto.length ? `<h2>Da guardare</h2><div class="lista">${sotto.slice(0, 6).map((p) => `
    <button type="button" class="voce" data-a="articolo" data-codice="${esc(p.codice)}"><span class="punto" style="${p.negativo ? 'background:var(--rosso)' : ''}"></span>
      <span class="corpo"><b>${esc(p.codice)}</b><small class="taglia">${esc(p.descrizione)}</small></span>
      <small style="color:${p.negativo ? 'var(--rosso)' : 'var(--arancio)'};font-weight:700">${num(p.quantita)}${p.carico_completo != null ? ' / ' + num(p.carico_completo) : ''}</small></button>`).join('')}</div>` : ''}
  `;
}

function articoli() {
  const q = chiave(ui.cerca);
  const tutti = g.elenco();
  const filtri = { tutti: () => true, sotto: (p) => p.sotto || p.negativo, magazzino: (p) => p.magazzino > 0 };
  const el = tutti.filter(filtri[ui.filtro]).filter((p) => !q || chiave(p.codice + ' ' + p.descrizione).includes(q));
  const chip = (k, t, n) => `<button type="button" class="chip" data-a="filtro" data-filtro="${k}" aria-pressed="${ui.filtro === k}">${t} ${n}</button>`;
  return `
  <div class="riga-titolo"><h1>Articoli</h1><button type="button" class="btn vuoto piccolo" data-a="nuovo-articolo">+ Nuovo</button></div>
  <label class="cerca">${ico.cerca}<span class="nascosto">Cerca articolo</span><input id="cerca-art" type="search" placeholder="Codice o descrizione" value="${esc(ui.cerca)}" data-input="cerca" autocomplete="off"></label>
  <div class="chips">${chip('tutti', 'Tutti', tutti.length)}${chip('sotto', 'Sotto scorta', tutti.filter(filtri.sotto).length)}${chip('magazzino', 'In magazzino', tutti.filter(filtri.magazzino).length)}</div>
  ${el.length ? el.map((p) => {
    const c = p.carico_completo;
    const pieno = c ? Math.max(0, Math.min(100, Math.round(p.quantita * 100 / c))) : 0;
    const ultimo = ultimoPrelievo(p.codice);
    return `<button type="button" class="articolo${p.sotto ? ' sotto' : ''}${p.negativo ? ' negativo' : ''}" data-a="articolo" data-codice="${esc(p.codice)}">
      <span class="testa"><span style="display:flex;flex-direction:column;min-width:0"><b style="font-size:16px">${esc(p.codice)}</b><small class="tenue">${esc(p.descrizione)}</small></span>
      <span class="q">${num(p.quantita)}${c != null ? `<small> / ${num(c)}</small>` : ''}</span></span>
      ${c ? `<span class="barra"><div style="width:${pieno}%"></div></span>` : ''}
      <span class="piede"><span>Magazzino <b>${num(p.magazzino)}</b> · Totale <b>${num(p.disponibile)}</b>${p.scorta_minima != null ? ` / min. ${num(p.scorta_minima)}` : ''}</span><span>${ultimo}</span></span>
    </button>`;
  }).join('') : '<div class="vuoto-msg">Nessun articolo.</div>'}`;
}

function ultimoPrelievo(codice) {
  let ultimo = '';
  for (const [giorno, c] of Object.entries(g.s.consumi)) if (c[codice] && giorno > ultimo) ultimo = giorno;
  if (!ultimo) return '';
  const diff = Math.round((new Date(oggiIso() + 'T12:00') - new Date(ultimo + 'T12:00')) / 86400000);
  return diff === 0 ? 'prelevato oggi' : diff === 1 ? 'prelevato ieri' : `prelevato ${diff} giorni fa`;
}

function rifornimento() {
  const righe = g.bozzaDettaglio();
  const attive = righe.filter((b) => b.quantita > 0);
  const pezzi = attive.reduce((t, b) => t + b.quantita, 0);
  const oltre = attive.filter((b) => b.oltre).length, spira = attive.filter((b) => b.fuori_spira).length;
  const per = periodoBozza();
  return `
  <div><h1>Rifornimento</h1><div class="sopra">${per ? esc(per) + ' · ' : ''}${attive.length} articoli · <b style="color:var(--rosa)">${num(pezzi)} pezzi</b></div></div>
  ${oltre || spira ? `<div class="carta ${spira ? 'avviso-carta' : ''}">${oltre ? `<div class="tenue">Per <b style="color:var(--testo)">${oltre}</b> ${oltre === 1 ? 'articolo' : 'articoli'} il distributore è già pieno: i pezzi riportati vanno a ripristinare il magazzino.</div>` : ''}${spira ? `<div><b>${spira}</b> ${spira === 1 ? 'quantità non è' : 'quantità non sono'} multipl${spira === 1 ? 'a' : 'e'} dei pezzi per spira.</div>` : ''}</div>` : ''}
  ${righe.length ? `<div class="lista">${righe.map((b) => `
    <div class="rif ${b.quantita ? '' : 'spento'}"><button type="button" class="corpo" data-a="articolo" data-codice="${esc(b.codice)}" style="background:none;border:0;text-align:left;padding:4px 0">
        <b>${esc(b.codice)}</b><small class="tenue taglia">${esc(b.descrizione)}</small>
        <small class="tenue">ora ${b.ora ?? '—'}${b.carico != null ? ` → <b style="color:${b.oltre ? 'var(--arancio)' : 'var(--testo)'}">${b.dopo}</b> / ${b.carico}` : ''}${b.oltre ? ` · +${b.eccesso} in mag.` : ''}${b.modificata ? ` · proposti ${b.proposta}` : ''}${b.blister ? ` · blister da ${b.blister}` : ''}${b.fuori_spira ? ` · <b style="color:var(--arancio)">spira da ${b.spira}</b>` : ''}</small></button>
      <button type="button" class="passo" aria-label="Uno in meno per ${esc(b.codice)}" data-a="meno" data-codice="${esc(b.codice)}">−</button>
      <span class="n">${b.quantita}</span>
      <button type="button" class="passo piu" aria-label="Uno in più per ${esc(b.codice)}" data-a="piu" data-codice="${esc(b.codice)}">+</button></div>`).join('')}</div>` : '<div class="vuoto-msg">Niente da rifornire: i prelievi dei prossimi ZIP compariranno qui.</div>'}
  <button type="button" class="btn vuoto piccolo" data-a="aggiungi-rif">+ Aggiungi un articolo a mano</button>
  ${attive.length ? `<div class="azioni">
    <button type="button" class="btn" data-a="pdf">${ico.mail} Crea PDF con barcode e mandalo</button>
    <button type="button" class="btn vuoto" data-a="fatto">Rifornimento fatto</button></div>` : ''}
  ${righe.length ? '<button type="button" class="btn vuoto piccolo" data-a="svuota-bozza">Svuota il rifornimento</button>' : ''}
  ${g.s.rifornimenti.length ? `<h2>Rifornimenti fatti</h2><div class="lista">${g.s.rifornimenti.slice(-8).reverse().map((r, i) => `<div class="voce"><span class="corpo"><b>${isoIta(r.data_ora.slice(0, 10))} alle ${r.data_ora.slice(11, 16)}</b><small>${r.articoli} articoli · ${num(r.pezzi)} pezzi</small></span>
    ${r.righe ? `<button type="button" class="btn vuoto piccolo" data-a="ripdf" data-ora="${esc(r.data_ora)}">PDF</button>` : ''}${i === 0 && r.righe ? '<button type="button" class="btn vuoto piccolo" data-a="annulla-rif">Annulla</button>' : ''}</div>`).join('')}</div>` : ''}`;
}

function calendario() {
  const [a, m] = ui.mese.split('-').map(Number);
  const primo = `${ui.mese}-01`;
  const giorniMese = new Date(a, m, 0).getDate();
  const inizio = lunediDi(primo);
  const fine = piuGiorni(`${ui.mese}-${String(giorniMese).padStart(2, '0')}`, 6 - ((new Date(a, m - 1, giorniMese).getDay() + 6) % 7));
  const dati = g.calendario(inizio, fine);
  const mancanti = new Set(g.giorniMancanti());
  const oggi = oggiIso();
  let celle = '';
  for (let d = inizio; d <= fine; d = piuGiorni(d, 1)) {
    const x = dati[d];
    const cl = ['cella', d.slice(0, 7) !== ui.mese ? 'fuori' : '', d === oggi ? 'oggi' : '', x ? (x.stato === 'riportato' ? 'rossa' : 'verde') : mancanti.has(d) ? 'manca' : ''].join(' ');
    celle += `<button type="button" class="${cl}" data-a="giorno-zip" data-giorno="${d}"><span class="nr">${Number(d.slice(8))}</span>${x ? `<span class="art">${x.articoli} art.</span>` : mancanti.has(d) ? '<span class="art">manca</span>' : ''}</button>`;
  }
  const meseNome = new Date(a, m - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  return `
  <h1>Calendario</h1>
  <div class="riga-titolo" style="align-items:center"><button type="button" class="btn vuoto piccolo" data-a="mese" data-d="-1" aria-label="Mese prima">‹</button>
    <b style="font-size:18px;text-transform:capitalize">${meseNome}</b><button type="button" class="btn vuoto piccolo" data-a="mese" data-d="1" aria-label="Mese dopo">›</button></div>
  <div class="calendario"><span>Lun</span><span>Mar</span><span>Mer</span><span>Gio</span><span>Ven</span><span>Sab</span><span>Dom</span>${celle}</div>
  <div class="legenda"><span><i class="verde"></i>ZIP da riportare</span><span><i class="rossa"></i>già riportato</span><span><i class="manca"></i>ZIP mancante</span></div>
  <small class="tenue">Il giorno è quello dei prelievi. Tocca un giorno per la distinta: articoli e pezzi.</small>`;
}

function prelievi() {
  const lun = ui.settimana || lunediDi(oggiIso());
  const w = g.prelieviSettimana(lun);
  const SIGLE = ['Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa', 'Do'];
  const max = Math.max(1, ...w.perGiorno);
  return `
  <h1>Prelievi della settimana</h1>
  <div class="riga-titolo" style="align-items:center"><button type="button" class="btn vuoto piccolo" data-a="settimana" data-d="-7" aria-label="Settimana prima">‹</button>
    <b>dal ${isoIta(w.giorni[0]).slice(0, 5)} al ${isoIta(w.giorni[6])}</b><button type="button" class="btn vuoto piccolo" data-a="settimana" data-d="7" aria-label="Settimana dopo">›</button></div>
  <div class="carta"><div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:16px">Totale</b><strong style="font-size:28px;color:var(--rosa)">${num(w.totale)} pezzi</strong></div>
    <div class="grafico sett7">${w.perGiorno.map((q, i) => `<div><span class="v">${q || ''}</span><span class="b" style="height:${Math.round(q * 100 / max)}%"></span><span class="e">${SIGLE[i]}</span></div>`).join('')}</div></div>
  <div class="lista">${w.righe.map((r) => `<button type="button" class="voce" data-a="articolo" data-codice="${esc(r.codice)}"><span class="corpo"><b>${esc(r.codice)}</b><small class="taglia">${esc(r.descrizione)}</small>
    <small class="tenue">${r.giorni.map((q, i) => q ? `${SIGLE[i]} ${q}` : '').filter(Boolean).join(' · ')}</small></span><b style="font-size:18px">${num(r.totale)}</b></button>`).join('') || '<div class="vuoto-msg">Nessun prelievo in questa settimana.</div>'}</div>`;
}

function periodoBozza() {
  const ultimo = g.s.rifornimenti.length ? g.s.rifornimenti[g.s.rifornimenti.length - 1].data_ora : '';
  const z = g.s.zip.filter((x) => x.dal && (!ultimo || x.importato_il > ultimo));
  if (!z.length) return '';
  const dal = z.map((x) => x.dal).sort()[0], al = z.map((x) => x.al || x.dal).sort().pop();
  return dal === al ? `Prelievi del ${isoIta(dal)}` : `Prelievi dal ${isoIta(dal)} al ${isoIta(al)}`;
}

const GRUPPI = { tutti: null, zip: ['SCARICO_ZIP'], rif: ['RIFORNIMENTO'], mag: ['DAL_MAGAZZINO', 'ECCESSO_MAGAZZINO', 'CORREZIONE_MAGAZZINO', 'REINTEGRO_MAGAZZINO'], corr: ['MODIFICA_MANUALE', 'MODIFICA_ARTICOLO', 'CONTROLLO_POSTO', 'AMMANCO', 'NUOVO_PRODOTTO', 'CARICO_MANUALE'], imp: ['STORICO_IMPORTATO'] };
function storico() {
  const q = chiave(ui.cercaStorico);
  const tipi = GRUPPI[ui.tipoStorico];
  const tutti = g.s.movimenti.filter((m) => (!tipi || tipi.includes(m.tipo)) && (!ui.meseStorico || (m.data_ora || '').startsWith(ui.meseStorico)) && (!q || chiave(m.codice + ' ' + m.descrizione).includes(q)));
  ui._storicoVisti = tutti;
  tutti.sort((a, b) => (b.data_ora || '').localeCompare(a.data_ora || '') || b.id - a.id);
  const mostra = tutti.slice(0, ui.quantiStorico);
  const chip = (k, t) => `<button type="button" class="chip" data-a="tipo-storico" data-tipo="${k}" aria-pressed="${ui.tipoStorico === k}">${t}</button>`;
  let html = '', giorno = '';
  for (const m of mostra) {
    const gg = (m.data_ora || '').slice(0, 10);
    if (gg !== giorno) { if (giorno) html += '</div>'; giorno = gg; html += `<div class="lista"><div class="giorno"><span>${GIORNI[new Date(gg + 'T12:00').getDay()]} ${isoIta(gg)}</span></div>`; }
    const qta = Number(m.quantita || 0);
    html += `<div class="mov"><span class="corpo"><b>${esc(m.codice)}</b><small class="tenue taglia">${esc(TIPI[m.tipo] || m.tipo)} · ${esc(m.descrizione || '')}</small>${m.note ? `<small class="tenue taglia">${esc(m.note)}</small>` : ''}</span>
      <span style="display:flex;flex-direction:column;align-items:flex-end"><span class="qta ${qta < 0 ? 'meno' : qta > 0 ? 'piu-t' : ''}">${qta > 0 ? '+' : ''}${num(qta)}</span><small class="tenue">${m.prima ?? ''}${m.dopo != null ? ' → ' + m.dopo : ''}</small></span></div>`;
  }
  if (giorno) html += '</div>';
  return `
  <h1>Storico</h1>
  <label class="cerca">${ico.cerca}<span class="nascosto">Cerca nello storico</span><input id="cerca-st" type="search" placeholder="Codice o descrizione" value="${esc(ui.cercaStorico)}" data-input="cerca-storico" autocomplete="off"></label>
  <div class="chips">${chip('tutti', 'Tutto')}${chip('zip', 'Scarichi ZIP')}${chip('rif', 'Rifornimenti')}${chip('mag', 'Magazzino')}${chip('corr', 'Correzioni')}${chip('imp', 'Storico importato')}</div>
  <div class="campo"><label for="st-mese">Mese</label><select id="st-mese" data-a-cambio="st-mese"><option value="">Tutti i mesi</option>${[...new Set(g.s.movimenti.map((m) => (m.data_ora || '').slice(0, 7)))].filter(Boolean).sort().reverse().map((m) => `<option value="${m}" ${ui.meseStorico === m ? 'selected' : ''}>${new Date(m + '-15').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}</option>`).join('')}</select></div>
  <div class="riga-titolo" style="align-items:center"><span class="tenue">${num(tutti.length)} movimenti</span><span class="affianca" style="flex:0 0 auto"><button type="button" class="btn vuoto piccolo" data-a="esporta-storico">Esporta</button>${ui.meseStorico ? '<button type="button" class="btn pericolo piccolo" data-a="cancella-mese">Cancella il mese</button>' : ''}</span></div>
  ${html || '<div class="vuoto-msg">Nessun movimento.</div>'}
  ${tutti.length > mostra.length ? '<button type="button" class="btn vuoto" data-a="altri-storico">Mostra altri</button>' : ''}`;
}

function altro() {
  const voce = (pag, titolo, sotto) => `<button type="button" class="voce" data-a="pagina" data-pagina="${pag}"><span class="corpo"><b>${titolo}</b><small>${sotto}</small></span>${ico.freccia}</button>`;
  const attesa = g.controlliInAttesa().length;
  const conMag = Object.values(g.s.prodotti).filter((p) => p.magazzino > 0).length;
  return `
  <h1>Altro</h1>
  <h2>Ogni giorno</h2>
  <div class="lista">
    ${voce('controllo', 'Controllo sul posto', attesa ? `${attesa} in attesa dello ZIP` : 'Segna i pezzi mancanti al distributore')}
    ${voce('prelievi', 'Prelievi della settimana', `${num(g.prelevatiSettimana())} pezzi questa settimana, articolo per articolo`)}
    ${voce('riepilogo', 'Riepilogo della settimana', 'Com\'è andata la settimana scorsa')}
    ${voce('storico', 'Storico', `${num(g.s.movimenti.length)} movimenti · ricerca, mesi, esporta`)}
  </div>
  <h2>Magazzino e inventario</h2>
  <div class="lista">
    ${voce('magazzino', 'Magazzino', `${conMag} articoli con pezzi di riserva · carica pezzi nuovi`)}
    ${voce('inventario', 'Inventario', 'Conta e correggi · foglio PDF · scorte minime')}
  </div>
  <h2>ZIP</h2>
  <div class="lista">
    ${voce('zipimportati', 'ZIP importati', `${g.s.zip.filter((z) => !z.eliminato && !z.storico).length} ZIP · vedi o annulla`)}
    ${voce('storicoimporta', 'Importa storico', 'ZIP vecchi solo per statistiche e scorte')}
  </div>
  <h2>Impostazioni</h2>
  <div class="lista">
    ${voce('impostazioni', 'Google Drive', drive.collegato ? `Collegato · cartella ${esc(g.s.impostazioni.drive_cartella_nome || '—')}` : 'Non collegato')}
    ${voce('abbinamenti', 'Abbinamenti', `${g.s.abbinamenti.length} descrizioni del PDF collegate ai codici AS400`)}
    ${voce('ignorate', 'Descrizioni ignorate', `${g.s.ignorate.length} descrizioni che non conto`)}
    ${voce('backup', 'Backup e ripristino', drive.collegato ? 'Automatico su Drive · copie nel telefono · file' : 'Copie nel telefono · file')}
    ${voce('info', 'Informazioni', `Versione ${VERSIONE}`)}
  </div>
  <div class="tenue" style="text-align:center;padding:10px">Distributore web ${VERSIONE} · AC</div>`;
}

function magazzino() {
  const el = g.elenco().filter((p) => p.magazzino > 0).sort((a, b) => b.magazzino - a.magazzino);
  const tot = el.reduce((t, p) => t + p.magazzino, 0);
  const codici = Object.keys(g.s.prodotti).sort();
  const ultimi = g.s.movimenti.filter((m) => ['DAL_MAGAZZINO', 'ECCESSO_MAGAZZINO', 'CORREZIONE_MAGAZZINO', 'REINTEGRO_MAGAZZINO'].includes(m.tipo)).sort((a, b) => b.data_ora.localeCompare(a.data_ora) || b.id - a.id).slice(0, 15);
  return `<h1>Magazzino</h1>
  <div class="tenue">I pezzi di riserva. Quando il distributore scende sotto il carico completo li sposto da soli; quando riporti il rifornimento quelli in più rientrano qui.</div>
  <div class="numeri"><div><span>In magazzino</span><strong style="color:var(--rosa)">${num(tot)}</strong><span>pezzi</span></div><div><span>Articoli</span><strong>${el.length}</strong><span>con riserva</span></div><div><span>Distributore</span><strong>${num(g.elenco().reduce((t, p) => t + p.quantita, 0))}</strong><span>pezzi</span></div></div>
  <div class="carta"><b>Carica pezzi nuovi in magazzino</b><small class="tenue">Quando arrivano pezzi da mettere di riserva.</small>
    <div class="campo"><label for="mag-art">Articolo</label><select id="mag-art"><option value="">Scegli l'articolo…</option>${codici.map((k) => `<option value="${esc(k)}">${esc(k)} – ${esc(g.prodotto(k).descrizione)}</option>`).join('')}</select></div>
    <div class="affianca"><div class="campo"><label for="mag-q">Pezzi</label><input id="mag-q" type="number" inputmode="numeric" min="1" value="1"></div><button type="button" class="btn secondario" data-a="mag-carica" style="align-self:flex-end">Carica</button></div></div>
  <h2>Cosa c'è in magazzino</h2>
  <div class="lista">${el.map((p) => `<button type="button" class="voce" data-a="articolo" data-codice="${esc(p.codice)}"><span class="corpo"><b>${esc(p.codice)}</b><small class="taglia">${esc(p.descrizione)}</small><small>distributore ${num(p.quantita)}${p.carico_completo != null ? ' / ' + num(p.carico_completo) : ''} · totale ${num(p.disponibile)}</small></span><b style="font-size:20px">${num(p.magazzino)}</b></button>`).join('') || '<div class="vuoto-msg">Magazzino vuoto</div>'}</div>
  <h2>Ultimi passaggi</h2>
  <div class="lista">${ultimi.map((m) => `<button type="button" class="mov" data-a="articolo" data-codice="${esc(m.codice)}" style="background:none;border:0;width:100%;text-align:left"><span class="corpo"><b>${esc(m.codice)} · ${esc(TIPI[m.tipo] || m.tipo)}</b><small class="tenue">${isoIta(m.data_ora.slice(0, 10))} ${m.data_ora.slice(11, 16)} · ${esc(m.note || '')}</small></span></button>`).join('') || '<div class="vuoto-msg">Nessuno</div>'}</div>`;
}

function inventario() {
  const el = g.elenco();
  const conti = ui.inventario;
  const cambiati = Object.keys(conti).length;
  return `<h1>Inventario</h1>
  <div class="carta"><b>Foglio d'inventario</b><small class="tenue">PDF A4 in bianco e nero con tutti gli articoli, le giacenze attuali, il barcode e lo spazio per scrivere i conteggi.</small>
    <button type="button" class="btn secondario" data-a="pdf-inventario">${ico.mail} Crea il foglio e mandalo</button></div>
  <div class="carta"><b>Conta e correggi</b><small class="tenue">Scrivi solo quello che hai contato diverso. Applico tutto insieme e finisce nello storico.</small></div>
  <div class="lista">${el.map((p) => `<div class="inv"><span class="corpo"><b>${esc(p.codice)}</b><small class="tenue taglia">${esc(p.descrizione)}</small></span>
    <label class="inv-c"><span>Distr. ${num(p.quantita)}</span><input type="number" inputmode="numeric" placeholder="${p.quantita}" value="${esc(conti[p.codice]?.distributore ?? '')}" data-inv="${esc(p.codice)}" data-campo="distributore" aria-label="Contati nel distributore ${esc(p.codice)}"></label>
    <label class="inv-c"><span>Mag. ${num(p.magazzino)}</span><input type="number" inputmode="numeric" placeholder="${p.magazzino}" value="${esc(conti[p.codice]?.magazzino ?? '')}" data-inv="${esc(p.codice)}" data-campo="magazzino" aria-label="Contati in magazzino ${esc(p.codice)}"></label></div>`).join('')}</div>
  <button type="button" class="btn" data-a="inv-applica" ${cambiati ? '' : 'disabled'}>Applica i conteggi${cambiati ? ` (${cambiati} articoli)` : ''}</button>
  <h2>Scorte minime</h2>
  <div class="carta"><small class="tenue">Come nel programma: una settimana di consumo medio degli ultimi 30 giorni. Si aggiornano da sole ogni 7 giorni${g.s.scorte_calcolate_il ? ` (ultima volta il ${isoIta(g.s.scorte_calcolate_il)})` : ''}.</small>
    <button type="button" class="btn vuoto piccolo" data-a="ricalcola-scorte">Ricalcola adesso</button></div>
  <h2>Azzera</h2>
  <div class="carta"><small class="tenue">Porta a zero distributore e magazzino di tutti gli articoli (prima faccio un backup). Articoli, abbinamenti e storico restano.</small>
    <button type="button" class="btn pericolo piccolo" data-a="azzera">Azzera tutte le giacenze</button></div>`;
}

function zipimportati() {
  const el = g.s.zip.filter((z) => !z.storico).slice().reverse();
  return `<h1>ZIP importati</h1><div class="tenue">Tocca uno ZIP per vederlo riga per riga. Uno ZIP non ancora riportato si può annullare: i pezzi tornano nel distributore, poi lo puoi reimportare.</div>
  <div class="lista">${el.map((z) => `<div class="voce"><button type="button" class="corpo" data-a="zip" data-nome="${esc(z.nome)}" style="background:none;border:0;text-align:left;padding:0">
      <b class="taglia" style="${z.eliminato ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(z.nome)}</b>
      <small>${z.dal ? 'prelievi del ' + isoIta(z.dal) : ''} · ${num(g.dettaglioZip(z.nome).pezzi)} pezzi · ${z.eliminato ? '<b style="color:var(--rosso)">annullato</b>' : z.rifornito ? 'riportato' : '<b style="color:var(--verde)">da riportare</b>'}${z.completo === false ? ' · <b style="color:var(--arancio)">da controllare</b>' : ''}</small></button>
    ${!z.eliminato && !z.rifornito ? `<button type="button" class="btn vuoto piccolo" data-a="annulla-zip" data-nome="${esc(z.nome)}">Annulla</button>` : ''}</div>`).join('') || '<div class="vuoto-msg">Nessuno</div>'}</div>
  <div class="carta"><b>Importa uno ZIP a mano</b><small class="tenue">Da File o da Google Drive, se l'automatico non l'ha preso.</small>
    <label class="btn vuoto">Scegli ZIP<input type="file" accept=".zip,application/zip" multiple data-file="zip" class="nascosto"></label></div>`;
}

function storicoimporta() {
  const st = g.s.zip.filter((z) => z.storico);
  return `<h1>Importa storico</h1>
  <div class="tenue">Gli ZIP vecchi servono solo per le statistiche, i grafici e le scorte minime: non toccano giacenze, rifornimento né calendario.</div>
  <div class="carta"><b>Da Google Drive</b>
    <div class="griglia2"><div class="campo"><label for="st-dal">Dal (prelievi)</label><input id="st-dal" type="date"></div><div class="campo"><label for="st-al">Al</label><input id="st-al" type="date"></div></div>
    <button type="button" class="btn secondario" data-a="storico-drive" ${drive.token() ? '' : 'disabled'}>Importa dal Drive</button>
    ${drive.token() ? '' : '<small class="tenue">Prima collega Google Drive.</small>'}
    <div id="storico-stato" class="tenue"></div></div>
  <div class="carta"><b>Da file</b><label class="btn vuoto">Scegli ZIP<input type="file" accept=".zip,application/zip" multiple data-file="storico" class="nascosto"></label></div>
  <h2>Già nello storico (${st.length})</h2>
  <div class="lista">${st.slice().reverse().slice(0, 40).map((z) => `<div class="voce"><span class="corpo"><b class="taglia">${esc(z.nome)}</b><small>prelievi del ${isoIta(z.dal)} · ${num(z.pezzi)} pezzi</small></span></div>`).join('') || '<div class="vuoto-msg">Nessuno</div>'}</div>`;
}

function ignorate() {
  return `<h1>Descrizioni ignorate</h1><div class="tenue">Le righe del PDF con queste descrizioni non le conto. Riabilitale se ti servono di nuovo.</div>
  <div class="lista">${g.s.ignorate.map((k) => `<div class="voce"><span class="corpo"><b>${esc(k)}</b></span><button type="button" class="btn vuoto piccolo" data-a="riabilita" data-chiave="${esc(k)}">Riabilita</button></div>`).join('') || '<div class="vuoto-msg">Nessuna</div>'}</div>`;
}

function info() {
  const z = g.s.zip.filter((x) => !x.eliminato);
  return `<h1>Informazioni</h1>
  <div class="lista">
    ${[['Versione', `Distributore web ${VERSIONE}`], ['Articoli', Object.keys(g.s.prodotti).length], ['Movimenti nello storico', num(g.s.movimenti.length)], ['ZIP importati', `${z.filter((x) => !x.storico).length} (+ ${z.filter((x) => x.storico).length} nello storico)`],
      ['Abbinamenti', g.s.abbinamenti.length], ['Ultimo salvataggio', g.s.aggiornato ? new Date(g.s.aggiornato).toLocaleString('it-IT') : '—'],
      ['Google Drive', drive.collegato ? (drive.token() ? 'collegato, accesso valido' : 'collegato, accesso da rinnovare') : 'non collegato'], ['Indirizzo', location.origin + location.pathname],
      ['Dati partiti da', g.s.esportato_da || '—']].map(([a, b]) => `<div class="voce"><span class="corpo"><small>${a}</small><b>${esc(String(b))}</b></span></div>`).join('')}
  </div>
  <small class="tenue">I dati stanno in questo dispositivo e, se Drive è collegato, nel file Distributore_dati.json del tuo Google Drive. Il programma della web app è pubblico, i dati no.</small>`;
}

function impostazioni() {
  const imp = g.s.impostazioni;
  return `<h1>Google Drive</h1>
  <div class="carta">
    <div class="campo"><label for="client-id">Codice client di Google (ID client OAuth)</label>
      <input id="client-id" type="text" value="${esc(drive.clientId)}" placeholder="….apps.googleusercontent.com" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
    <div class="tenue">Indirizzo autorizzato in Google Cloud: <code>${esc(location.origin)}</code></div>
    <div class="affianca"><button type="button" class="btn piccolo" data-a="salva-client">Salva</button>
      ${drive.collegato ? '<button type="button" class="btn vuoto piccolo" data-a="scollega">Scollega</button>' : '<button type="button" class="btn secondario piccolo" data-a="accedi">Accedi con Google</button>'}</div>
  </div>
  <div class="carta">
    <div class="tenue">Cartella degli ZIP: <b style="color:var(--testo)">${esc(imp.drive_cartella_nome || 'non scelta')}</b></div>
    <button type="button" class="btn vuoto piccolo" data-a="scegli-cartella" ${drive.token() ? '' : 'disabled'}>Scegli la cartella</button>
    <div class="campo"><label for="partenza">Prendi i prelievi a partire dal giorno</label><input id="partenza" type="date" value="${esc(imp.zip_partenza ? piuGiorni(imp.zip_partenza, -1) : '')}" data-a-cambio="partenza"></div>
    <small class="tenue">È il giorno dei prelievi, come nel calendario. Lo ZIP di un giorno arriva su Drive il giorno dopo: ci penso io. I giorni prima di questa data restano quelli importati dal programma del PC.</small>
    <button type="button" class="btn secondario piccolo" data-a="controlla">Controlla Drive adesso</button>
  </div>`;
}

function abbinamenti() {
  return `<h1>Abbinamenti</h1><div class="tenue">Ogni descrizione del PDF è collegata a un codice AS400. Quando arriva una descrizione nuova te la chiedo una volta sola.</div>
  <div class="lista">${g.s.abbinamenti.slice().sort((a, b) => a.codice.localeCompare(b.codice)).map((a) => `
    <div class="voce"><span class="corpo"><b>${esc(a.codice)}</b><small class="taglia">${esc((g.prodotto(a.codice) || {}).descrizione || '')}</small><small class="taglia">PDF ${esc(a.codice_pdf || '')} · ${esc(a.descrizione_pdf)}</small></span>
    <button type="button" class="btn vuoto piccolo" data-a="togli-abbinamento" data-chiave="${esc(a.chiave)}" aria-label="Togli l'abbinamento ${esc(a.descrizione_pdf)}">Togli</button></div>`).join('') || '<div class="vuoto-msg">Nessuno</div>'}</div>`;
}

function backup() {
  const el = ui.backupElenco || [];
  return `<h1>Backup e ripristino</h1>
  <div class="carta"><b>Google Drive</b><small class="tenue">${drive.collegato ? 'A ogni modifica salvo i dati nel file Distributore_dati.json del tuo Drive. Se cambi telefono, colleghi Drive e li ritrovi.' : 'Collega Google Drive per avere il backup automatico.'}</small></div>
  <div class="carta"><b>Copie nel telefono</b><small class="tenue">Le ultime 10: una al giorno e una prima di ogni operazione delicata (annullare, azzerare, inventario, ripristino).</small>
    <div class="lista">${el.slice().reverse().map((b) => `<div class="voce"><span class="corpo"><b>${new Date(b.ora).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</b><small>${esc(b.motivo)}</small></span><button type="button" class="btn vuoto piccolo" data-a="ripristina-locale" data-chiave="${esc(b.chiave)}">Ripristina</button></div>`).join('') || '<div class="vuoto-msg">Ancora nessuna</div>'}</div>
    <button type="button" class="btn vuoto piccolo" data-a="backup-ora">Fai una copia adesso</button></div>
  <div class="carta"><b>File</b><small class="tenue">Scarica un file con tutti i dati, o ripristinane uno.</small>
    <div class="affianca"><button type="button" class="btn vuoto piccolo" data-a="backup">Scarica backup</button>
      <label class="btn vuoto piccolo">Ripristina<input type="file" accept=".json,application/json" data-file="dati" class="nascosto"></label></div></div>`;
}

// ------------------------------------------------------------------ fogli (dal basso)
function apriFoglio(html) {
  $('#foglio').innerHTML = `<button type="button" class="chiudi" data-a="chiudi" aria-label="Chiudi">×</button>${html}`;
  $('#foglio').hidden = false; $('#velo').hidden = false;
}
function chiudiFoglio() { $('#foglio').hidden = true; $('#velo').hidden = true; $('#foglio').innerHTML = ''; }

function foglioArticolo(codice, modifica = false) {
  const p = g.prodotto(codice);
  if (!p) return;
  const st = g.statistiche(codice);
  const disp = (p.quantita || 0) + (p.magazzino || 0);
  const c = p.carico_completo;
  const sotto = p.scorta_minima != null && disp <= p.scorta_minima;
  if (modifica) {
    const campo = (id, et, v, tipo = 'number') => `<div class="campo"><label for="f-${id}">${et}</label><input id="f-${id}" name="${id}" type="${tipo}" inputmode="${tipo === 'number' ? 'numeric' : 'text'}" value="${esc(v ?? '')}"></div>`;
    apriFoglio(`<h1>Modifica ${esc(p.codice)}</h1>
      <form id="form-articolo" data-codice="${esc(codice)}" style="display:flex;flex-direction:column;gap:12px">
        ${campo('descrizione', 'Descrizione', p.descrizione, 'text')}
        <div class="griglia2">${campo('quantita', 'Nel distributore', p.quantita)}${campo('magazzino', 'In magazzino', p.magazzino)}
        ${campo('carico_completo', 'Carico completo', p.carico_completo)}${campo('scorta_minima', 'Scorta minima', p.scorta_minima)}${campo('pezzi_spira', 'Pezzi per spira', p.pezzi_spira)}${campo('pezzi_blister', 'Pezzi per blister (vuoto = no)', p.in_blister ? p.pezzi_blister : '')}</div>
        <small class="tenue">Ogni modifica finisce nello storico. Se il distributore resta sotto il carico completo, i pezzi del magazzino ci vanno da soli.</small>
        <div class="affianca"><button type="button" class="btn vuoto" data-a="articolo" data-codice="${esc(codice)}">Annulla</button><button type="submit" class="btn">Salva</button></div>
      </form>
      <button type="button" class="btn pericolo piccolo" data-a="elimina-articolo" data-codice="${esc(codice)}">Elimina l'articolo</button>`);
    return;
  }
  const maxG = Math.max(1, ...st.giorni.map((x) => x.pezzi));
  const maxS = Math.max(1, ...st.settimane.map((x) => x.pezzi));
  const storia = g.storiaArticolo(codice, 40);
  const durata = st.durata == null ? 'nessun prelievo nelle ultime 4 settimane'
    : st.durata <= 3 ? `<b style="color:var(--rosso)">circa ${st.durata} giorni</b>` : st.durata <= 7 ? `<b style="color:var(--arancio)">circa ${st.durata} giorni</b>` : `circa <b>${st.durata} giorni</b>`;
  const freccia = (a, b) => (a == null || b == null) ? (b ?? '—') : a === b ? `${b}` : `${a} → <b>${b}</b>`;
  apriFoglio(`
    <div style="display:flex;flex-direction:column;gap:2px;padding-right:40px"><h1>${esc(p.codice)}</h1><span class="tenue" style="font-size:15px">${esc(p.descrizione)}</span></div>
    <div class="tre">
      <div><span>Distributore</span><strong class="${p.quantita < 0 ? 'rosso' : ''}">${num(p.quantita)}</strong><small>${c != null ? `su ${num(c)}` : 'carico ?'}</small></div>
      <div><span>Magazzino</span><strong>${num(p.magazzino)}</strong><small>di riserva</small></div>
      <div class="${sotto ? 'allarme' : ''}"><span>Totale</span><strong>${num(disp)}</strong><small>${p.scorta_minima != null ? `scorta min. ${num(p.scorta_minima)}` : 'scorta ?'}</small></div>
    </div>
    ${c ? `<div class="barra grande"><div style="width:${Math.max(0, Math.min(100, Math.round(p.quantita * 100 / c)))}%"></div></div>` : ''}
    <div class="carta">
      <div>Con i prelievi delle ultime 4 settimane (<b>${num(st.pezzi_28)}</b> pezzi, ${st.media.toLocaleString('it-IT', { maximumFractionDigits: 1 })} al giorno) ti dura ${durata}.</div>
      ${sotto ? '<div style="color:var(--arancio);font-weight:700">Sotto la scorta minima: da riordinare.</div>' : ''}
      ${st.in_rifornimento ? `<div>Nel prossimo rifornimento: <b style="color:var(--rosa)">${st.in_rifornimento} pezzi</b>.</div>` : ''}
      ${g.consiglio(codice) ? `<div style="color:var(--rosa);font-weight:600">${esc(g.consiglio(codice))}</div>` : ''}
      <small class="tenue">Ultimo prelievo ${st.ultimo_prelievo ? isoIta(st.ultimo_prelievo) : '—'} · ultimo rifornimento ${st.ultimo_rifornimento ? isoIta(st.ultimo_rifornimento.slice(0, 10)) : '—'}</small>
    </div>
    <h2>Prelievi degli ultimi 14 giorni</h2>
    <div class="grafico">${st.giorni.map((x) => `<div title="${isoIta(x.giorno)}: ${x.pezzi}"><span class="v">${x.pezzi || ''}</span><span class="b" style="height:${Math.round(x.pezzi * 100 / maxG)}%"></span><span class="e">${Number(x.giorno.slice(8))}</span></div>`).join('')}</div>
    <h2>Per settimana</h2>
    <div class="grafico sett">${st.settimane.map((x) => `<div><span class="v">${x.pezzi || ''}</span><span class="b" style="height:${Math.round(x.pezzi * 100 / maxS)}%"></span><span class="e">${isoIta(x.dal).slice(0, 5)}</span></div>`).join('')}</div>
    <div class="affianca"><button type="button" class="btn secondario" data-a="modifica-articolo" data-codice="${esc(codice)}">Modifica</button><button type="button" class="btn vuoto" data-a="carica-mag" data-codice="${esc(codice)}">Carica in magazzino</button></div>
    <h2>Avanti e indietro: distributore e magazzino</h2>
    <div class="lista">${storia.map((m) => {
      const q = Number(m.quantita || 0);
      return `<div class="mov"><span class="corpo"><b>${esc(TIPI[m.tipo] || m.tipo)}</b>
        <small class="tenue">${isoIta((m.data_ora || '').slice(0, 10))} ${(m.data_ora || '').slice(11, 16)}${m.note ? ' · ' + esc(m.note) : ''}</small>
        <small>Distributore ${freccia(m.distr_prima, m.distr_dopo)} · Magazzino ${freccia(m.mag_prima, m.mag_dopo)}</small></span>
        <span class="qta ${q < 0 ? 'meno' : q > 0 ? 'piu-t' : ''}">${q > 0 ? '+' : ''}${num(q)}</span></div>`;
    }).join('') || '<div class="vuoto-msg">Nessun movimento</div>'}</div>
    ${st.abbinamenti.length ? `<h2>Come si chiama nel PDF</h2><div class="lista">${st.abbinamenti.map((a) => `<div class="voce"><span class="corpo"><b>${esc(a.descrizione_pdf)}</b><small>Codice PDF ${esc(a.codice_pdf || '—')}</small></span></div>`).join('')}</div>` : ''}`);
}

function foglioDrive() {
  const d = ui.drive;
  const ultimi = g.s.zip.slice(-6).reverse();
  const codici = Object.keys(g.s.prodotti).sort();
  apriFoglio(`
    <h1>Google Drive</h1>
    <div class="carta"><div style="display:flex;gap:12px;align-items:center">${d.stato === 'fatto' ? ico.ok : ''}<div style="display:flex;flex-direction:column"><b>${esc(d.msg || 'Google Drive')}</b><small class="tenue">${esc(d.sotto || '')}</small></div></div>
      <div class="riga-titolo" style="align-items:center"><span class="tenue">Cartella: <b style="color:var(--testo)">${esc(g.s.impostazioni.drive_cartella_nome || 'non scelta')}</b></span>
      <button type="button" class="btn vuoto piccolo" data-a="controlla">Controlla ora</button></div></div>
    ${g.s.sospese.length ? `<h2 style="color:var(--arancio)">${g.s.sospese.length} da abbinare</h2>
      ${g.s.sospese.map((x, i) => `<form class="carta avviso-carta" data-sospesa="${i}">
        <div style="display:flex;flex-direction:column"><b>${esc(x.descrizione_pdf)}</b><small class="tenue">Codice PDF ${esc(x.codice_pdf)} · ${x.quantita} pezzi · ${esc(x.nome_zip)}</small></div>
        <div class="campo"><label for="ab-${i}">Codice AS400</label>${sceltaCodice(`ab-${i}`, x.descrizione_pdf, codici)}</div>
        <div class="affianca"><button type="submit" class="btn piccolo">Abbina</button><button type="button" class="btn vuoto piccolo" data-a="ignora-riga" data-i="${i}">Ignora sempre</button></div>
        <small class="tenue">L'abbinamento vale anche per i prossimi ZIP.</small></form>`).join('')}` : ''}
    <h2>Ultimi ZIP</h2>
    <div class="lista">${ultimi.map((z) => `<button type="button" class="voce" data-a="zip" data-nome="${esc(z.nome)}"><span class="corpo"><b class="taglia">${esc(z.nome)}</b><small>${z.dal ? 'prelievi del ' + isoIta(z.dal) : ''} · ${num(g.dettaglioZip(z.nome).pezzi)} pezzi · importato il ${isoIta((z.importato_il || '').slice(0, 10))}${z.completo === false ? ' · <b style="color:var(--arancio)">da controllare</b>' : z.completo ? ' · completo' : ''}</small></span>${ico.freccia}</button>`).join('') || '<div class="vuoto-msg">Nessuno</div>'}</div>`);
}

function sceltaCodice(id, descrizionePdf, codici) {
  const opz = (c) => `<option value="${esc(c)}">${esc(c)} – ${esc(g.prodotto(c).descrizione)}</option>`;
  const consigliati = g.suggerisci(descrizionePdf);
  const opzC = (x, i) => `<option value="${esc(x.codice)}" ${i === 0 && x.punti >= 80 ? 'selected' : ''}>${esc(x.codice)} – ${esc(g.prodotto(x.codice).descrizione)} (${x.punti}%)</option>`;
  return `<select id="${id}" name="codice" required>
    <option value="">Scegli il codice…</option>
    ${consigliati.length ? `<optgroup label="Più probabili">${consigliati.map(opzC).join('')}</optgroup>` : ''}
    <optgroup label="Tutti gli articoli">${codici.map(opz).join('')}</optgroup>
  </select>`;
}

function foglioGiorno(giorno) {
  const zipG = g.s.zip.filter((z) => !z.nascosto && z.dal && giorno >= z.dal && giorno <= (z.al || z.dal));
  const x = g.giorniZip(7).find((y) => y.giorno === giorno) || { giorno, zip: zipG, stato: zipG.length ? 'ok' : (g.giorniMancanti().includes(giorno) ? 'manca' : (g.s.giorni_ignorati.includes(giorno) ? 'ignorato' : '')) };
  const titolo = `${GIORNI[new Date(giorno + 'T12:00').getDay()]} ${isoIta(giorno)}`;
  if (!x.zip.length) {
    apriFoglio(`<h1>${titolo}</h1>
      <div class="carta avviso-carta"><b>${x.stato === 'ignorato' ? 'Giorno ignorato' : 'Nessuno ZIP con i prelievi di questo giorno'}</b>
      <small class="tenue">${x.stato === 'ignorato' ? 'Lo hai segnato come giorno senza prelievi.' : 'Di solito arriva il giorno dopo nella cartella di Drive. Se quel giorno il distributore era chiuso, puoi ignorarlo.'}</small>
      ${x.stato === 'manca' ? `<div class="affianca"><button type="button" class="btn piccolo" data-a="controlla">Controlla Drive</button><button type="button" class="btn vuoto piccolo" data-a="ignora-giorno" data-giorno="${giorno}">Ignora il giorno</button></div>` : ''}</div>`);
    return;
  }
  foglioZip(x.zip[x.zip.length - 1].nome, titolo);
}

function foglioZip(nome, titolo = '') {
  const z = g.dettaglioZip(nome);
  if (!z) return;
  const righe = z.dettaglio || [];
  const contate = righe.filter((r) => r.esito === 'scaricata' || r.esito === 'controllo sul posto').length;
  const verifica = z.ricostruito
    ? `<div class="carta"><b>${righe.length} righe · ${num(z.pezzi)} pezzi scaricati</b><small class="tenue">ZIP importato dal programma del PC il ${isoIta((z.importato_il || '').slice(0, 10))}: righe ricostruite dallo storico.</small></div>`
    : `<div class="carta ${z.completo ? '' : 'avviso-carta'}"><div style="display:flex;gap:12px;align-items:center">${z.completo ? ico.ok : '<span class="stato-z controlla">!</span>'}
        <div style="display:flex;flex-direction:column"><b>${z.completo ? 'Completo: tutte le righe contate' : 'Da controllare'}</b>
        <small class="tenue">${righe.length} righe nel PDF · ${num(z.pezzi_pdf)} pezzi nel PDF = ${num(z.pezzi)} scaricati${z.sospesi ? ` + ${num(z.sospesi)} da abbinare` : ''}${z.ignorati ? ` + ${num(z.ignorati)} ignorati` : ''}</small></div></div>
        ${(z.errori || []).length ? `<small style="color:var(--rosso)">${z.errori.map(esc).join('<br>')}</small>` : ''}</div>`;
  apriFoglio(`<h1>${esc(titolo || 'ZIP')}</h1>
    <div class="tenue"><b style="color:var(--testo)">${esc(z.nome)}</b> · ${z.rifornito ? `<b style="color:#ff8a8a">già riportato</b> (${isoIta(z.rifornito.slice(0, 10))})` : '<b style="color:var(--verde)">da riportare</b>'}<br>Prelievi ${z.dal === z.al || !z.al ? 'del ' + isoIta(z.dal) : `dal ${isoIta(z.dal)} al ${isoIta(z.al)}`} · importato il ${isoIta((z.importato_il || '').slice(0, 10))} alle ${(z.importato_il || '').slice(11, 16)}</div>
    ${verifica}
    <h2>Righe del PDF (${contate} di ${righe.length} contate)</h2>
    <div class="lista">${righe.map((r) => `<${r.cod ? `button type="button" data-a="articolo" data-codice="${esc(r.cod)}"` : 'div'} class="voce">
      <span class="corpo"><b class="taglia">${esc(r.d)}</b><small>PDF ${esc(r.cp)} → ${r.cod ? `<b style="color:var(--rosa)">${esc(r.cod)}</b>` : `<b style="color:var(--arancio)">${esc(r.esito)}</b>`}${r.esito === 'controllo sul posto' ? ' · già tolti al controllo' : ''}</small></span>
      <b style="font-size:17px">${num(r.q)}</b></${r.cod ? 'button' : 'div'}>`).join('') || '<div class="vuoto-msg">Nessuna riga</div>'}</div>`);
}

async function foglioCartelle() {
  try {
    const c = await drive.cartelleCondivise();
    apriFoglio(`<h1>Cartella degli ZIP</h1><div class="tenue">Le cartelle condivise con te su Google Drive.</div>
      <div class="lista">${c.map((x) => `<button type="button" class="voce" data-a="cartella" data-id="${esc(x.id)}" data-nome="${esc(x.name)}"><span class="corpo"><b>${esc(x.name)}</b></span>${x.id === g.s.impostazioni.drive_cartella_id ? ico.ok : ''}</button>`).join('') || '<div class="vuoto-msg">Nessuna cartella condivisa</div>'}</div>`);
  } catch (e) { avviso(e.message, true); }
}

// ------------------------------------------------------------------ azioni
async function caricaDati(file) {
  try {
    const dati = JSON.parse(await file.text());
    if (dati.formato !== 'distributore-web') throw new Error('Questo file non è un file dati del Distributore.');
    if (g && !confirm('Sostituisco i dati di questo telefono con quelli del file?')) return;
    g = new Gestionale(dati);
    const n = g.riempiDaMagazzino('Sistemazione automatica');
    g.s.aggiornato = new Date().toISOString();
    await salva();
    avviso(`Dati caricati: ${Object.keys(g.s.prodotti).length} articoli${n ? `, ${n} distributori riempiti dal magazzino` : ''}.`);
    disegna();
  } catch (e) { avviso(e.message || 'File non leggibile.', true); }
}

async function importaFileZip(files) {
  let testo = [];
  for (const f of files) {
    const letto = await leggiZip(window.JSZip, pdfjs, new Uint8Array(await f.arrayBuffer()), f.name);
    const r = g.importaZip(letto);
    testo.push(r.gia ? `${f.name}: già importato` : r.ok ? `${f.name}: ${num(r.pezzi)} pezzi${r.sospese ? `, ${r.sospese} da abbinare` : ''}` : `${f.name}: ${r.errori.join(' ')}`);
  }
  await salva(); disegna();
  avviso(testo.join(' · '), testo.some((t) => /errore|non /i.test(t)));
}

async function creaPdf() {
  const righe = [...g.s.bozza].filter((b) => b.quantita > 0).sort((a, b) => a.codice.localeCompare(b.codice))
    .map((b) => ({ ...b, descrizione: g.prodotto(b.codice)?.descrizione || b.descrizione }));
  const pezzi = righe.reduce((s, r) => s + r.quantita, 0);
  const per = periodoBozza();
  const ora = new Date();
  const info = `${per ? per + '   ·   ' : ''}${righe.length} articoli   ·   ${pezzi} pezzi   ·   preparato il ${ora.toLocaleDateString('it-IT')} ${ora.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
  const byte = await pdfRifornimento(righe, info);
  const file = new File([byte], nomeFile(oggiIso()), { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Rifornimento distributore' }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function condividi(file, titolo) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: titolo }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function importaFileStorico(files) {
  let pezzi = 0, n = 0, gia = 0;
  for (const f of files) {
    const r = g.importaStorico(await leggiZip(window.JSZip, pdfjs, new Uint8Array(await f.arrayBuffer()), f.name));
    if (r.ok) { n++; pezzi += r.pezzi; } else if (r.gia) gia++;
  }
  if (n) g.ricalcolaScorte(true);
  await salva(); disegna();
  avviso(`Storico: ${n} ZIP, ${num(pezzi)} pezzi${gia ? ` · ${gia} già presenti` : ''}.`);
}

async function importaStoricoDrive() {
  const dal = $('#st-dal').value, al = $('#st-al').value;
  if (!dal || !al) { avviso('Scegli le date dei prelievi.', true); return; }
  const stato = $('#storico-stato');
  try {
    stato.textContent = 'Cerco gli ZIP su Drive…';
    const elenco = await drive.zipNellaCartella(g.s.impostazioni.drive_cartella_id);
    // la data del file è il giorno dopo i prelievi
    const da = elenco.map((f) => ({ ...f, data: piuGiorni(dataZipNome(f.name, f.modifiedTime), -1) }))
      .filter((f) => f.data >= dal && f.data <= al && !g.s.zip.find((z) => z.nome === f.name)).sort((a, b) => a.data.localeCompare(b.data));
    if (!da.length) { stato.textContent = 'Nessuno ZIP nuovo in quel periodo.'; return; }
    let pezzi = 0;
    for (const [i, f] of da.entries()) {
      stato.textContent = `ZIP ${i + 1} di ${da.length}: ${f.name}…`;
      const r = g.importaStorico(await leggiZip(window.JSZip, pdfjs, await drive.scarica(f.id), f.name));
      if (r.ok) pezzi += r.pezzi;
    }
    g.ricalcolaScorte(true);
    await salva(); avviso(`Storico: ${da.length} ZIP, ${num(pezzi)} pezzi.`); disegna();
  } catch (e) { stato.textContent = e.message; }
}

function scaricaBackup() {
  const b = new Blob([JSON.stringify(g.s)], { type: 'application/json' });
  const f = new File([b], `Distributore_backup_${oggiIso()}.json`, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [f] })) { navigator.share({ files: [f] }).catch(() => {}); return; }
  const url = URL.createObjectURL(f); const a = document.createElement('a'); a.href = url; a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const azioni = {
  'vuoto': async () => { g = new Gestionale(null); g.s.impostazioni.zip_partenza = oggiIso(); await salva(); disegna(); },
  'vai-altro': () => { ui.scheda = 'altro'; ui.pagina = 'impostazioni'; disegna(); },
  'accedi': () => { try { drive.accedi(false); } catch (e) { avviso(e.message, true); } },
  'apri-drive': () => foglioDrive(),
  'controlla': () => { chiudiFoglio(); sincronizza(true); },
  'chiudi': () => chiudiFoglio(),
  'articolo': (el) => foglioArticolo(el.dataset.codice),
  'modifica-articolo': (el) => foglioArticolo(el.dataset.codice, true),
  'giorno-zip': (el) => foglioGiorno(el.dataset.giorno),
  'mag-carica': () => { const k = $('#mag-art').value; if (!k) { avviso('Scegli l\'articolo.', true); return; } cambia(() => g.caricaInMagazzino(k, $('#mag-q').value), 'Caricato in magazzino.'); },
  'carica-mag': (el) => { const q = prompt(`Quanti pezzi nuovi di ${el.dataset.codice} metti in magazzino?`, '1'); if (!q) return; cambia(() => g.caricaInMagazzino(el.dataset.codice, q), 'Caricato in magazzino.').then(() => foglioArticolo(el.dataset.codice)); },
  'elimina-articolo': async (el) => { if (!confirm(`Elimino ${el.dataset.codice}? Spariscono anche i suoi abbinamenti. Lo storico resta.`)) return; await backupLocale(`prima di eliminare ${el.dataset.codice}`); cambia(() => g.eliminaArticolo(el.dataset.codice), 'Articolo eliminato.').then(chiudiFoglio); },
  'pdf-inventario': async (el) => { el.disabled = true; try { const ora = new Date(); const b = await pdfInventario(g.elenco(), `${Object.keys(g.s.prodotti).length} articoli · giacenze al ${ora.toLocaleDateString('it-IT')} ${ora.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`); await condividi(new File([b], `Inventario_${isoIta(oggiIso()).replace(/\//g, '-')}.pdf`, { type: 'application/pdf' }), 'Inventario distributore'); } catch (e) { avviso('PDF non creato: ' + e.message, true); } el.disabled = false; },
  'inv-applica': async () => { const n = Object.keys(ui.inventario).length; if (!confirm(`Applico i conteggi di ${n} articoli?`)) return; await backupLocale('prima dell\'inventario'); cambia(() => g.applicaInventario(ui.inventario), (k) => `Inventario applicato: ${k} correzioni.`).then(() => { ui.inventario = {}; disegna(); }); },
  'ricalcola-scorte': () => cambia(() => g.ricalcolaScorte(true), (n) => `Scorte minime ricalcolate: ${n} articoli aggiornati.`),
  'azzera': async () => { if (!confirm('Azzero distributore e magazzino di TUTTI gli articoli?')) return; if (!confirm('Sicuro? Prima faccio un backup nel telefono.')) return; await backupLocale('prima di azzerare le giacenze'); cambia(() => g.azzeraGiacenze(), 'Giacenze azzerate.'); },
  'annulla-zip': async (el) => { if (!confirm(`Annullo ${el.dataset.nome}? I suoi pezzi tornano nel distributore e spariscono dal rifornimento.`)) return; await backupLocale(`prima di annullare ${el.dataset.nome}`); cambia(() => g.annullaZip(el.dataset.nome), (r) => `ZIP annullato: ${r.pezzi} pezzi rimessi.`); },
  'annulla-rif': async () => { if (!confirm('Annullo l\'ultimo rifornimento? I pezzi riportati escono di nuovo e la lista torna com\'era.')) return; await backupLocale('prima di annullare il rifornimento'); cambia(() => g.annullaUltimoRifornimento(), 'Rifornimento annullato.'); },
  'svuota-bozza': () => { if (confirm('Svuoto il rifornimento? Le giacenze non cambiano.')) cambia(() => g.svuotaBozza(), 'Rifornimento svuotato.'); },
  'ripdf': async (el) => { const r = g.s.rifornimenti.find((x) => x.data_ora === el.dataset.ora); if (!r) return; const righe = r.righe.filter((b) => b.quantita > 0).sort((a, b) => a.codice.localeCompare(b.codice)).map((b) => ({ ...b, descrizione: g.prodotto(b.codice)?.descrizione || b.descrizione })); const byte = await pdfRifornimento(righe, `Rifornimento del ${isoIta(r.data_ora.slice(0, 10))} ${r.data_ora.slice(11, 16)}   ·   ${r.articoli} articoli   ·   ${r.pezzi} pezzi   ·   copia`); condividi(new File([byte], nomeFile(r.data_ora.slice(0, 10)), { type: 'application/pdf' }), 'Rifornimento distributore'); },
  'riabilita': (el) => cambia(() => g.riabilitaDescrizione(el.dataset.chiave), 'Descrizione riabilitata.'),
  'backup-ora': async () => { await backupLocale('copia a mano'); ui.backupElenco = await archivio.leggi('backup_elenco'); avviso('Copia fatta.'); disegna(); },
  'ripristina-locale': async (el) => { if (!confirm('Ripristino questa copia? I dati di adesso vengono sostituiti (prima ne salvo una copia).')) return; const dati = await archivio.leggi(el.dataset.chiave); if (!dati) { avviso('Copia non trovata.', true); return; } await backupLocale('prima del ripristino'); g = new Gestionale(dati); g.s.aggiornato = new Date().toISOString(); await salva(); ui.backupElenco = await archivio.leggi('backup_elenco'); avviso('Copia ripristinata.'); disegna(); },
  'esporta-storico': () => {
    const righe = [['Data', 'Ora', 'Tipo', 'Codice', 'Descrizione', 'Quantità', 'Distributore prima', 'Distributore dopo', 'Origine', 'Note']]
      .concat((ui._storicoVisti || []).map((m) => [isoIta((m.data_ora || '').slice(0, 10)), (m.data_ora || '').slice(11, 16), TIPI[m.tipo] || m.tipo, m.codice, m.descrizione, m.quantita, m.prima ?? '', m.dopo ?? '', m.origine || '', m.note || '']));
    const csv = '﻿' + righe.map((r) => r.map((c) => { const t = String(c ?? ''); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }).join(';')).join('\r\n');
    condividi(new File([csv], `Storico_${ui.meseStorico || 'tutto'}_${oggiIso()}.csv`, { type: 'text/csv' }), 'Storico distributore');
  },
  'cancella-mese': async () => { const m = ui.meseStorico; if (!confirm(`Cancello tutti i movimenti di ${m} dallo storico? Le giacenze non cambiano.`)) return; await backupLocale(`prima di cancellare lo storico di ${m}`); cambia(() => g.cancellaStoricoMese(m), (n) => `${n} movimenti cancellati.`).then(() => { ui.meseStorico = ''; disegna(); }); },
  'storico-drive': () => importaStoricoDrive(),
  'riepilogo-ok': (el) => { try { localStorage.setItem('riepilogo_visto', el.dataset.settimana); } catch { /* niente */ } chiudiFoglio(); },
  'esito-visto': (el) => cambia(() => { g.s.esiti_controlli.forEach((x) => { if (x.data === el.dataset.data) x.visto = true; }); g.s.aggiornato = new Date().toISOString(); }),
  'ctrl-aggiungi': () => {
    const k = $('#ctrl-art').value, q = Math.round(Number($('#ctrl-q').value));
    if (!k) { avviso('Scegli l\'articolo.', true); return; }
    if (!(q > 0)) { avviso('Scrivi i pezzi mancanti.', true); return; }
    ui.controllo.righe[k] = q; disegna();
  },
  'ctrl-togli': (el) => { delete ui.controllo.righe[el.dataset.codice]; disegna(); },
  'ctrl-salva': () => {
    const c = ui.controllo;
    cambia(() => g.salvaControllo(c.data, c.righe), (r) => `Controllo salvato: ${r.tolti} pezzi tolti dal distributore e messi nel rifornimento.${r.esiti.length ? ' Confrontato subito con lo ZIP già arrivato.' : ''}`)
      .then((r) => { if (r) ui.controllo = { data: c.data, righe: {} }; disegna(); });
  },
  'ctrl-modifica': (el) => { const d = el.dataset.data; ui.controllo = { data: d, righe: Object.fromEntries(g.s.controlli.filter((x) => x.data === d && x.stato === 'attesa').map((x) => [x.codice, x.mancanti])) }; disegna(); window.scrollTo(0, 0); },
  'ctrl-elimina': (el) => { if (confirm(`Elimino il controllo del ${isoIta(el.dataset.data)}? I pezzi tolti tornano nel distributore.`)) cambia(() => g.eliminaControllo(el.dataset.data), 'Controllo eliminato.'); },
  'vedi-sotto': () => { ui.scheda = 'articoli'; ui.filtro = 'sotto'; ui.pagina = ''; disegna(); },
  'pagina': async (el) => { ui.pagina = el.dataset.pagina; if (ui.pagina === 'backup') ui.backupElenco = await archivio.leggi('backup_elenco').catch(() => []); disegna(); window.scrollTo(0, 0); },
  'indietro': () => { ui.pagina = ''; disegna(); window.scrollTo(0, 0); },
  'mese': (el) => { const [a, m] = ui.mese.split('-').map(Number); const d = new Date(a, m - 1 + Number(el.dataset.d), 1); ui.mese = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; disegna(); },
  'settimana': (el) => { ui.settimana = piuGiorni(ui.settimana || lunediDi(oggiIso()), Number(el.dataset.d)); disegna(); },
  'aggiungi-rif': () => {
    const codice = (prompt('Codice AS400 da aggiungere al rifornimento:') || '').trim().toUpperCase(); if (!codice) return;
    const q = prompt(`Quanti pezzi di ${codice}?`, '1'); if (!q) return;
    cambia(() => g.aggiungiABozza(codice, q), 'Aggiunto al rifornimento.');
  },
  'zip': (el) => foglioZip(el.dataset.nome),
  'filtro': (el) => { ui.filtro = el.dataset.filtro; disegna(); },
  'tipo-storico': (el) => { ui.tipoStorico = el.dataset.tipo; ui.quantiStorico = 150; disegna(); },
  'altri-storico': () => { ui.quantiStorico += 300; disegna(); },
  'meno': (el) => { const b = g.s.bozza.find((x) => x.codice === el.dataset.codice); cambia(() => g.impostaQuantitaBozza(b.codice, b.quantita - 1)); },
  'piu': (el) => { const b = g.s.bozza.find((x) => x.codice === el.dataset.codice); cambia(() => g.impostaQuantitaBozza(b.codice, b.quantita + 1)); },
  'pdf': async (el) => { el.disabled = true; try { await creaPdf(); } catch (e) { avviso('PDF non creato: ' + e.message, true); } el.disabled = false; },
  'fatto': () => {
    const pezzi = g.s.bozza.reduce((s, b) => s + (b.quantita > 0 ? b.quantita : 0), 0);
    if (!confirm(`Hai riportato i ${pezzi} pezzi nel distributore?\n\nTornano nel distributore e quelli oltre il carico completo vanno in magazzino.`)) return;
    cambia(() => g.rifornimentoFatto(), (r) => `Rifornimento registrato: ${r.articoli} articoli, ${r.pezzi} pezzi.`);
  },
  'ignora-giorno': (el) => cambia(() => { g.s.giorni_ignorati.push(el.dataset.giorno); g.s.aggiornato = new Date().toISOString(); }, 'Giorno ignorato.').then(chiudiFoglio),
  'ignora-riga': (el) => { if (confirm('Questa descrizione non verrà più considerata nei prossimi ZIP. Continuo?')) cambia(() => g.ignora(Number(el.dataset.i)), 'Ignorata.').then(foglioDrive); },
  'nuovo-articolo': () => {
    const codice = prompt('Codice AS400 del nuovo articolo:'); if (!codice) return;
    const descr = prompt('Descrizione:') || '';
    cambia(() => g.nuovoArticolo(codice, descr), 'Articolo aggiunto.').then(() => foglioArticolo(codice.trim().toUpperCase()));
  },
  'salva-client': () => { drive.clientId = $('#client-id').value; avviso(drive.clientId ? 'Codice client salvato.' : 'Codice client tolto.'); disegna(); },
  'scollega': () => { if (confirm('Scollego Google Drive da questo dispositivo? I dati restano.')) { drive.scollega(); ui.drive = { stato: 'fermo', msg: '', nuovi: [] }; disegna(); } },
  'scegli-cartella': () => foglioCartelle(),
  'cartella': (el) => cambia(() => { g.s.impostazioni.drive_cartella_id = el.dataset.id; g.s.impostazioni.drive_cartella_nome = el.dataset.nome; g.s.aggiornato = new Date().toISOString(); }, 'Cartella scelta.').then(chiudiFoglio),
  'togli-abbinamento': (el) => { if (confirm('Tolgo questo abbinamento?')) cambia(() => { g.s.abbinamenti = g.s.abbinamenti.filter((a) => a.chiave !== el.dataset.chiave); g.s.aggiornato = new Date().toISOString(); }, 'Abbinamento tolto.'); },
  'backup': () => scaricaBackup(),
};

document.addEventListener('click', (e) => {
  const s = e.target.closest('[data-scheda]');
  if (s) { if (ui.scheda === s.dataset.scheda || s.dataset.scheda !== 'altro') ui.pagina = ''; ui.scheda = s.dataset.scheda; chiudiFoglio(); disegna(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-a]');
  if (el && azioni[el.dataset.a]) { e.preventDefault(); azioni[el.dataset.a](el); }
});
$('#velo').addEventListener('click', chiudiFoglio);
document.addEventListener('input', (e) => {
  if (e.target.dataset.inv) {
    const c = e.target.dataset.inv, campo = e.target.dataset.campo, v = e.target.value;
    const r = (ui.inventario[c] ||= {});
    if (v === '') delete r[campo]; else r[campo] = v;
    if (!Object.keys(r).length) delete ui.inventario[c];
    const b = document.querySelector('[data-a="inv-applica"]');
    if (b) { const n = Object.keys(ui.inventario).length; b.disabled = !n; b.textContent = `Applica i conteggi${n ? ` (${n} articoli)` : ''}`; }
    return;
  }
  const k = e.target.dataset.input;
  if (k === 'cerca') { ui.cerca = e.target.value; ui.focus = 'cerca-art'; disegna(); }
  if (k === 'cerca-storico') { ui.cercaStorico = e.target.value; ui.quantiStorico = 150; ui.focus = 'cerca-st'; disegna(); }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.file === 'dati' && t.files[0]) caricaDati(t.files[0]);
  if (t.dataset.file === 'zip' && t.files.length) importaFileZip([...t.files]);
  if (t.dataset.aCambio === 'ctrl-data') { ui.controllo.data = t.value; }
  if (t.dataset.aCambio === 'st-mese') { ui.meseStorico = t.value; ui.quantiStorico = 150; disegna(); }
  if (t.dataset.file === 'storico' && t.files.length) importaFileStorico([...t.files]);
  if (t.dataset.aCambio === 'partenza') cambia(() => { g.s.impostazioni.zip_partenza = t.value ? piuGiorni(t.value, 1) : ''; g.s.aggiornato = new Date().toISOString(); }, `Prelievi presi dal ${isoIta(t.value)}.`);
});
document.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'form-articolo') {
    const dati = Object.fromEntries(new FormData(f));
    const pb = String(dati.pezzi_blister || '').trim(); delete dati.pezzi_blister;
    const pr = g.prodotto(f.dataset.codice); if (pr) { pr.in_blister = !!(pb && Number(pb) > 0); pr.pezzi_blister = pr.in_blister ? Math.round(Number(pb)) : null; }
    cambia(() => g.modificaArticolo(f.dataset.codice, dati), 'Articolo salvato.').then(() => foglioArticolo(f.dataset.codice));
  }
  if (f.dataset.sospesa !== undefined) {
    const codice = String(new FormData(f).get('codice') || '').trim().toUpperCase();
    if (!codice) { avviso('Scegli il codice AS400.', true); return; }
    cambia(() => g.abbina(Number(f.dataset.sospesa), codice), (n) => `Abbinato: ${n} pezzi aggiunti al rifornimento.`).then(foglioDrive);
  }
});

// ------------------------------------------------------------------ avvio
async function avvia() {
  const ritorno = drive.ritorno();
  try { navigator.storage?.persist?.(); } catch { /* niente */ }
  const salvato = await archivio.leggi('stato').catch(() => null);
  g = salvato ? new Gestionale(normalizza(salvato)) : null;
  disegna();
  if (!g) return;
  if (ritorno.startsWith('errore:') && !/interaction_required|login_required|consent_required/.test(ritorno)) avviso('Google: accesso non riuscito (' + ritorno.slice(7) + ').', true);
  if (ritorno.startsWith('errore:')) { ui.drive = { stato: 'accedi', msg: 'Tocca per aggiornare da Google Drive', nuovi: [] }; disegna(); return; }
  try {
    const el = (await archivio.leggi('backup_elenco')) || [];
    if (!el.length || el[el.length - 1].ora.slice(0, 10) !== new Date().toISOString().slice(0, 10)) await backupLocale('copia del giorno');
    if (g.ricalcolaScorte(false)) await salva();
  } catch { /* niente */ }
  mostraRiepilogoSettimana();
  if (drive.clientId) sincronizza();
}

function mostraRiepilogoSettimana() {
  try {
    const r = g.riepilogoSettimana();
    if (!r.pezzi || localStorage.getItem('riepilogo_visto') === r.settimana) return;
    setTimeout(() => apriFoglio(riepilogo() + `<button type="button" class="btn" data-a="riepilogo-ok" data-settimana="${r.settimana}">Ok</button>`), 800);
  } catch { /* niente */ }
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
avvia();
