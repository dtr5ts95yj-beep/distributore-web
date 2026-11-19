import * as pdfjs from './lib/pdf.min.mjs';
import { Gestionale, TIPI, leggiZip, oggiIso, isoIta, normalizza, chiave, piuGiorni } from './logica.js';
import { drive } from './drive.js';
import { pdfRifornimento, nomeFile } from './stampa.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./lib/pdf.worker.min.mjs', import.meta.url).href;
const VERSIONE = '1.1';

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

// ------------------------------------------------------------------ stato della pagina
let g = null;                       // Gestionale
const ui = { scheda: 'oggi', cerca: '', filtro: 'tutti', cercaStorico: '', tipoStorico: 'tutti', quantiStorico: 150, drive: { stato: 'fermo', msg: '', nuovi: [] } };
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
  ui.drive = { stato: 'lavoro', msg: 'Controllo Google Drive…', nuovi: [] };
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
      for (const [i, f] of da.entries()) {
        ui.drive.msg = `Leggo ${f.name} (${i + 1} di ${da.length})…`; disegna();
        const letto = await leggiZip(window.JSZip, pdfjs, await drive.scarica(f.id), f.name);
        const r = g.importaZip(letto, f.id);
        nuovi.push({ nome: f.name, ...r });
      }
    }
    await archivio.scrivi('stato', g.s);
    if (nuovi.length || !remoti || (g.s.aggiornato || '') > (remoti.aggiornato || '')) await drive.salvaDati(g.s);
    const pezzi = nuovi.reduce((s, x) => s + (x.pezzi || 0), 0);
    ui.drive = { stato: 'fatto', nuovi, ora: new Date(),
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
  s.innerHTML = ({ oggi, articoli, rifornimento, storico, altro })[ui.scheda]();
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
  ${sosp ? `<button type="button" class="drive attenzione" data-a="apri-drive"><span class="icona" style="background:#8a5a2a">!</span><span style="flex-grow:1;display:flex;flex-direction:column"><b>${sosp} ${sosp === 1 ? 'riga' : 'righe'} da abbinare</b><small class="tenue">Non entrano nel rifornimento finché non scegli il codice AS400</small></span>${ico.freccia}</button>` : ''}
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
  ${mancanti.length ? `<h2>Giorni senza ZIP</h2><div class="lista">${mancanti.slice(-7).reverse().map((gg) => `
    <div class="voce"><span class="punto" style="background:var(--rosso)"></span><span class="corpo"><b>${GIORNI[new Date(gg + 'T12:00').getDay()]} ${isoIta(gg)}</b><small>Nessuno ZIP con i prelievi di questo giorno</small></span>
    <button type="button" class="btn vuoto piccolo" data-a="ignora-giorno" data-giorno="${gg}">Ignora</button></div>`).join('')}</div>` : ''}
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
      <span class="piede"><span>Magazzino <b>${num(p.magazzino)}</b>${p.scorta_minima != null ? ` · scorta min. <b>${num(p.scorta_minima)}</b>` : ''}</span><span>${ultimo}</span></span>
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
  const righe = [...g.s.bozza].sort((a, b) => a.codice.localeCompare(b.codice));
  const attive = righe.filter((b) => b.quantita > 0);
  const pezzi = attive.reduce((s, b) => s + b.quantita, 0);
  const zipDopo = periodoBozza();
  return `
  <div><h1>Rifornimento</h1><div class="sopra">${zipDopo ? esc(zipDopo) + ' · ' : ''}${attive.length} articoli · <b style="color:var(--rosa)">${num(pezzi)} pezzi</b></div></div>
  ${righe.length ? `<div class="lista">${righe.map((b) => `
    <div class="rif"><span class="corpo"><b>${esc(b.codice)}</b><small class="tenue taglia">${esc(b.descrizione)}${b.quantita !== b.proposta ? ` · proposti ${b.proposta}` : ''}</small></span>
      <button type="button" class="passo" aria-label="Uno in meno per ${esc(b.codice)}" data-a="meno" data-codice="${esc(b.codice)}">−</button>
      <span class="n">${b.quantita}</span>
      <button type="button" class="passo piu" aria-label="Uno in più per ${esc(b.codice)}" data-a="piu" data-codice="${esc(b.codice)}">+</button></div>`).join('')}</div>
  <div class="azioni">
    <button type="button" class="btn" data-a="pdf" ${attive.length ? '' : 'disabled'}>${ico.mail} Crea PDF con barcode e mandalo</button>
    <button type="button" class="btn vuoto" data-a="fatto" ${attive.length ? '' : 'disabled'}>Rifornimento fatto</button>
  </div>` : '<div class="vuoto-msg">Niente da rifornire: i prelievi dei prossimi ZIP compariranno qui.</div>'}
  ${g.s.rifornimenti.length ? `<h2>Ultimi rifornimenti</h2><div class="lista">${g.s.rifornimenti.slice(-5).reverse().map((r) => `<div class="voce"><span class="corpo"><b>${isoIta(r.data_ora.slice(0, 10))} alle ${r.data_ora.slice(11, 16)}</b><small>${r.articoli} articoli · ${num(r.pezzi)} pezzi</small></span></div>`).join('')}</div>` : ''}`;
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
  const tutti = g.s.movimenti.filter((m) => (!tipi || tipi.includes(m.tipo)) && (!q || chiave(m.codice + ' ' + m.descrizione).includes(q)));
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
  <div class="tenue">${num(tutti.length)} movimenti</div>
  ${html || '<div class="vuoto-msg">Nessun movimento.</div>'}
  ${tutti.length > mostra.length ? '<button type="button" class="btn vuoto" data-a="altri-storico">Mostra altri</button>' : ''}`;
}

function altro() {
  const imp = g.s.impostazioni;
  return `
  <h1>Altro</h1>
  <h2>Google Drive</h2>
  <div class="carta">
    <div class="campo"><label for="client-id">Codice client di Google (ID client OAuth)</label>
      <input id="client-id" type="text" value="${esc(drive.clientId)}" placeholder="….apps.googleusercontent.com" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
    <div class="tenue">Indirizzo da autorizzare in Google Cloud: <code>${esc(location.origin)}</code></div>
    <div class="affianca"><button type="button" class="btn piccolo" data-a="salva-client">Salva</button>
      ${drive.collegato ? '<button type="button" class="btn vuoto piccolo" data-a="scollega">Scollega</button>' : '<button type="button" class="btn secondario piccolo" data-a="accedi">Accedi con Google</button>'}</div>
    <div class="tenue">Cartella degli ZIP: <b style="color:var(--testo)">${esc(imp.drive_cartella_nome || 'non scelta')}</b></div>
    <button type="button" class="btn vuoto piccolo" data-a="scegli-cartella" ${drive.token() ? '' : 'disabled'}>Scegli la cartella</button>
    <div class="campo"><label for="partenza">Prendi gli ZIP a partire dal giorno</label><input id="partenza" type="date" value="${esc(imp.zip_partenza)}" data-a-cambio="partenza"></div>
  </div>

  <h2>Abbinamenti (${g.s.abbinamenti.length})</h2>
  <div class="lista">${g.s.abbinamenti.slice().sort((a, b) => a.codice.localeCompare(b.codice)).map((a) => `
    <div class="voce"><span class="corpo"><b>${esc(a.codice)}</b><small class="taglia">PDF ${esc(a.codice_pdf || '')} · ${esc(a.descrizione_pdf)}</small></span>
    <button type="button" class="btn vuoto piccolo" data-a="togli-abbinamento" data-chiave="${esc(a.chiave)}" aria-label="Togli l'abbinamento ${esc(a.descrizione_pdf)}">Togli</button></div>`).join('') || '<div class="vuoto-msg">Nessuno</div>'}</div>

  <h2>Importa uno ZIP a mano</h2>
  <div class="carta"><div class="tenue">Se Drive non funziona, scegli lo ZIP da File (anche da Google Drive).</div>
    <label class="btn vuoto">Scegli ZIP<input type="file" accept=".zip,application/zip" multiple data-file="zip" class="nascosto"></label></div>

  <h2>Backup</h2>
  <div class="carta"><div class="tenue">${drive.collegato ? 'I dati si salvano da soli anche nel tuo Google Drive (Distributore_dati.json).' : 'Collega Google Drive per avere il backup automatico.'}</div>
    <div class="affianca"><button type="button" class="btn vuoto piccolo" data-a="backup">Scarica backup</button>
      <label class="btn vuoto piccolo">Ripristina<input type="file" accept=".json,application/json" data-file="dati" class="nascosto"></label></div></div>
  <div class="tenue" style="text-align:center;padding:10px">Distributore web ${VERSIONE} · AC</div>`;
}

// ------------------------------------------------------------------ fogli (dal basso)
function apriFoglio(html) {
  $('#foglio').innerHTML = `<button type="button" class="chiudi" data-a="chiudi" aria-label="Chiudi">×</button>${html}`;
  $('#foglio').hidden = false; $('#velo').hidden = false;
}
function chiudiFoglio() { $('#foglio').hidden = true; $('#velo').hidden = true; $('#foglio').innerHTML = ''; }

function foglioArticolo(codice) {
  const p = g.prodotto(codice);
  if (!p) return;
  const movs = g.s.movimenti.filter((m) => m.codice === codice).sort((a, b) => b.data_ora.localeCompare(a.data_ora) || b.id - a.id).slice(0, 12);
  const campo = (id, et, v, tipo = 'number') => `<div class="campo"><label for="f-${id}">${et}</label><input id="f-${id}" name="${id}" type="${tipo}" inputmode="${tipo === 'number' ? 'numeric' : 'text'}" value="${esc(v ?? '')}"></div>`;
  apriFoglio(`
    <h1>${esc(p.codice)}</h1>
    <form id="form-articolo" data-codice="${esc(codice)}" style="display:flex;flex-direction:column;gap:12px">
      ${campo('descrizione', 'Descrizione', p.descrizione, 'text')}
      <div class="griglia2">${campo('quantita', 'Nel distributore', p.quantita)}${campo('magazzino', 'In magazzino', p.magazzino)}
      ${campo('carico_completo', 'Carico completo', p.carico_completo)}${campo('scorta_minima', 'Scorta minima', p.scorta_minima)}${campo('pezzi_spira', 'Pezzi per spira', p.pezzi_spira)}</div>
      <button type="submit" class="btn">Salva</button>
    </form>
    <h2>Ultimi movimenti</h2>
    <div class="lista">${movs.map((m) => `<div class="mov"><span class="corpo"><b>${esc(TIPI[m.tipo] || m.tipo)}</b><small class="tenue">${isoIta(m.data_ora.slice(0, 10))} ${m.data_ora.slice(11, 16)}${m.note ? ' · ' + esc(m.note) : ''}</small></span><span class="qta ${m.quantita < 0 ? 'meno' : m.quantita > 0 ? 'piu-t' : ''}">${m.quantita > 0 ? '+' : ''}${m.quantita}</span></div>`).join('') || '<div class="vuoto-msg">Nessuno</div>'}</div>`);
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
    <div class="lista">${ultimi.map((z) => `<div class="voce"><span class="corpo"><b class="taglia">${esc(z.nome)}</b><small>${z.dal ? 'prelievi del ' + isoIta(z.dal) : ''}${z.pezzi != null ? ' · ' + num(z.pezzi) + ' pezzi' : ''} · importato il ${isoIta((z.importato_il || '').slice(0, 10))}</small></span></div>`).join('') || '<div class="vuoto-msg">Nessuno</div>'}</div>`);
}

function sceltaCodice(id, descrizionePdf, codici) {
  const opz = (c) => `<option value="${esc(c)}">${esc(c)} – ${esc(g.prodotto(c).descrizione)}</option>`;
  const consigliati = g.suggerisci(descrizionePdf);
  return `<select id="${id}" name="codice" required>
    <option value="">Scegli il codice…</option>
    ${consigliati.length ? `<optgroup label="Più probabili">${consigliati.map(opz).join('')}</optgroup>` : ''}
    <optgroup label="Tutti gli articoli">${codici.map(opz).join('')}</optgroup>
  </select>`;
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

function scaricaBackup() {
  const b = new Blob([JSON.stringify(g.s)], { type: 'application/json' });
  const f = new File([b], `Distributore_backup_${oggiIso()}.json`, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [f] })) { navigator.share({ files: [f] }).catch(() => {}); return; }
  const url = URL.createObjectURL(f); const a = document.createElement('a'); a.href = url; a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const azioni = {
  'vuoto': async () => { g = new Gestionale(null); g.s.impostazioni.zip_partenza = oggiIso(); await salva(); disegna(); },
  'vai-altro': () => { ui.scheda = 'altro'; disegna(); },
  'accedi': () => { try { drive.accedi(false); } catch (e) { avviso(e.message, true); } },
  'apri-drive': () => foglioDrive(),
  'controlla': () => { chiudiFoglio(); sincronizza(true); },
  'chiudi': () => chiudiFoglio(),
  'articolo': (el) => foglioArticolo(el.dataset.codice),
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
  'ignora-giorno': (el) => cambia(() => { g.s.giorni_ignorati.push(el.dataset.giorno); g.s.aggiornato = new Date().toISOString(); }),
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
  if (s) { ui.scheda = s.dataset.scheda; chiudiFoglio(); disegna(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-a]');
  if (el && azioni[el.dataset.a]) { e.preventDefault(); azioni[el.dataset.a](el); }
});
$('#velo').addEventListener('click', chiudiFoglio);
document.addEventListener('input', (e) => {
  const k = e.target.dataset.input;
  if (k === 'cerca') { ui.cerca = e.target.value; ui.focus = 'cerca-art'; disegna(); }
  if (k === 'cerca-storico') { ui.cercaStorico = e.target.value; ui.quantiStorico = 150; ui.focus = 'cerca-st'; disegna(); }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.file === 'dati' && t.files[0]) caricaDati(t.files[0]);
  if (t.dataset.file === 'zip' && t.files.length) importaFileZip([...t.files]);
  if (t.dataset.aCambio === 'partenza') cambia(() => { g.s.impostazioni.zip_partenza = t.value; g.s.aggiornato = new Date().toISOString(); }, 'Data di partenza salvata.');
});
document.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'form-articolo') {
    const dati = Object.fromEntries(new FormData(f));
    cambia(() => g.modificaArticolo(f.dataset.codice, dati), 'Articolo salvato.').then(chiudiFoglio);
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
  if (drive.clientId) sincronizza();
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
avvia();
