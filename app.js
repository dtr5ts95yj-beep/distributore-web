import * as pdfjs from './lib/pdf.min.mjs';
import { Gestionale, TIPI, leggiZip, oggiIso, isoIta, normalizza, chiave, piuGiorni, dataZip as dataZipNome } from './logica.js';
const lunediDi = (iso) => piuGiorni(iso, -((new Date(iso + 'T12:00:00').getDay() + 6) % 7));
import { drive } from './drive.js';
import { pdfRifornimento, pdfInventario, nomeFile } from './stampa.js';
import { apriLettore } from './lettore.js';
import { creaExcel, fogliColleghi } from './excel.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./lib/pdf.worker.min.mjs', import.meta.url).href;
const VERSIONE = '5.1';

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
const ui = { ordineRif: (() => { try { return localStorage.getItem('ordine_rif') || 'codice'; } catch { return 'codice'; } })(), ordine: (() => { try { return localStorage.getItem('ordine_articoli') || ''; } catch { return ''; } })(), scheda: 'oggi', pagina: '', controllo: { data: '', righe: {} }, inventario: {}, meseStorico: '', mese: oggiIso().slice(0, 7), settimana: '', cerca: '', filtro: 'tutti', cercaStorico: '', tipoStorico: 'tutti', quantiStorico: 150, drive: { stato: 'fermo', msg: '', nuovi: [] } };
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => Number(n || 0).toLocaleString('it-IT');
const GIORNI = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
// il distributorino dell'icona, colorato secondo lo stato del giorno
let _idDist = 0;
function distributorino(stato) {
  const id = 'd' + (++_idDist);
  // vuoto (ZIP senza prelievi) = spento; manca = acceso con luce e tettoia rosse
  const spento = stato === 'zero' || stato === 'prima' || stato === 'ignorato', manca = stato === 'manca', arancio = stato === 'controlla';
  const col = spento ? Array(6).fill('#3d3354') : manca ? Array(6).fill('#5a3346') : arancio ? ['#ffb454', '#ffcf7a', '#ffb454', '#ffcf7a', '#ffb454', '#ffcf7a'] : ['#ff7fbf', '#ffd166', '#6ee7b7', '#7cc4ff', '#c79bff', '#6ee7b7'];
  const c1 = spento ? '#9a92ad' : '#ffffff', c2 = spento ? '#6f6787' : '#ddd5f0';
  const tetto = spento ? '#5b5275' : manca ? '#ff4d6d' : arancio ? '#ffb454' : 'var(--a2, #b44dff)';
  const led = spento ? '#4a4260' : manca ? '#ff3b5c' : arancio ? '#ffb454' : '#6ee7b7';
  return `<svg class="dist${manca ? ' allarme' : ''}" viewBox="0 0 40 52" aria-hidden="true"><defs>
    <linearGradient id="${id}c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
    <linearGradient id="${id}v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${spento ? '#2a2238' : '#3a2a60'}"/><stop offset="1" stop-color="${spento ? '#17121f' : '#1c1233'}"/></linearGradient>
    <radialGradient id="${id}l"><stop offset="0" stop-color="${led}" stop-opacity=".9"/><stop offset="1" stop-color="${led}" stop-opacity="0"/></radialGradient></defs>
    <rect x="2" y="2" width="36" height="48" rx="7" fill="url(#${id}c)"/>
    <rect x="2" y="2" width="36" height="7" rx="7" fill="${tetto}" opacity=".95"/><rect x="2" y="6" width="36" height="3" fill="${tetto}" opacity=".95"/>
    <rect x="6" y="12" width="20" height="24" rx="3" fill="url(#${id}v)"/>
    ${col.map((c, i) => `<rect x="${8.5 + (i % 3) * 5.8}" y="${14.5 + Math.floor(i / 3) * 8}" width="3.8" height="5" rx="1.2" fill="${c}"/>`).join('')}
    ${spento ? '' : '<path d="M6 13h20v4H6z" fill="#fff" opacity=".07"/>'}
    <rect x="29" y="13" width="6" height="2.6" rx="1.3" fill="#2a1d45"/>${spento ? '' : `<circle cx="32" cy="20.5" r="5" fill="url(#${id}l)"/>`}<circle class="led" cx="32" cy="20.5" r="2" fill="${led}"/><rect x="30.6" y="25" width="2.8" height="9" rx="1.4" fill="#2a1d45" opacity=".35"/>
    <rect x="7" y="40" width="26" height="6" rx="2.5" fill="#2a1d45"/>${spento || manca ? '' : '<rect x="16.5" y="41.3" width="7" height="3.4" rx="1" fill="#ffd166"/>'}</svg>`;
}

const ico = {
  barcode: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8M10 8v8M13 8v8M16 8v8"/></svg>',
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
    aggiornaColleghi();
  }
}

// ------------------------------------------------------------------ file Excel per i colleghi su Drive (solo in uscita)
let timerColleghi = null;
const colleghiAttivo = () => { try { return localStorage.getItem('colleghi') !== 'no'; } catch { return true; } };
function aggiornaColleghi(subito = false) {
  if (!colleghiAttivo() || !drive.collegato || !drive.token()) return Promise.resolve();
  clearTimeout(timerColleghi);
  return new Promise((ok) => { timerColleghi = setTimeout(async () => {
    try {
      const byte = await creaExcel(window.JSZip, fogliColleghi(g, { isoIta }));
      // come Foglio Google: il collega lo apre da Drive nel browser, senza scaricare niente
      await drive.salvaPerColleghi('fogli', 'Distributore Termomeccanica aggiornato', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byte, 'application/vnd.google-apps.spreadsheet');
      drive.togliVecchiColleghi('excel').catch(() => {});   // il vecchio file .xlsx della 4.9
      // il PDF del rifornimento come lo vedi tu in Prepara: un solo file, riscritto (col nome del giorno)
      if (g.s.bozza.some((b) => b.quantita > 0)) {
        const f = await filePdfRifornimento('DA PREPARARE · aggiornato');
        const oggi = oggiIso();
        await drive.salvaPerColleghi('rif-oggi', `Rifornimento da preparare ${isoIta(oggi).replace(/\//g, '-')}.pdf`, 'application/pdf', new Uint8Array(await f.arrayBuffer()));
        drive.togliVecchiColleghi('rif-2').catch(() => {});   // le copie per giorno della 4.9: ne resta una sola
      }
      try { localStorage.setItem('colleghi_ultimo', new Date().toISOString()); } catch { /* niente */ }
    } catch (e) { console.warn('File per i colleghi', e); }
    ok();
  }, subito ? 0 : 15000); });
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
    aggiornaColleghi(true);
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
setInterval(() => { const o = document.getElementById('orologio'); if (o) o.textContent = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); }, 20000);

// ---------- colori: Giorno = rosa e viola, Notte = coppia scelta; Automatico cambia da solo alle 7 e alle 19
const COLORI_NOTTE = [['grafite', 'Grafite e azzurro', '#5ac8fa', '#6e7f99'], ['verdeblu', 'Verde e blu', '#34d399', '#0a84ff'], ['arancioblu', 'Arancio e blu notte', '#ff9f0a', '#3b82f6'], ['smeraldo', 'Smeraldo e oro', '#10b981', '#f5b301'], ['indaco', 'Indaco e lime', '#818cf8', '#a3e635']];
const pref = (k, d) => { try { return localStorage.getItem('pref_' + k) || d; } catch { return d; } };
function eNotte() {   // Chiaro = giorno, Scuro = notte, Automatico = come l'iPhone
  const t = pref('tema', 'auto');
  if (t === 'chiaro') return false;
  if (t === 'scuro') return true;
  try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; }
}
function applicaColori() {
  const notte = eNotte(), coppia = COLORI_NOTTE.some(([k]) => k === pref('colori', 'grafite')) ? pref('colori', 'grafite') : 'grafite';
  const r = document.documentElement;
  if (notte) r.setAttribute('data-colori', coppia); else r.removeAttribute('data-colori');
  const fondo = getComputedStyle(r).getPropertyValue('--fondo').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', fondo || '#140b26');
}
applicaColori();
setInterval(applicaColori, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) applicaColori(); });
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applicaColori(); if (g) disegna(); }); } catch { /* niente */ }

function aspetto() {
  const col = pref('colori', 'grafite');
  return `<h1>Aspetto e colori</h1>
  <div class="tenue">Chiaro è rosa e viola, Scuro usa i colori della notte che scegli qui sotto. Automatico fa come l'iPhone (Impostazioni → Schermo e luminosità): se lì hai Automatico, diventa scura al tramonto.</div>
  <div class="carta"><b>Aspetto</b><div class="segmenti">${[['chiaro', 'Chiaro'], ['scuro', 'Scuro'], ['auto', 'Automatico']].map(([v, t]) => `<button type="button" data-a="pref-tema" data-v="${v}" aria-pressed="${pref('tema', 'auto') === v}">${t}</button>`).join('')}</div>
    <small class="tenue">${pref('tema', 'auto') === 'auto' ? `Automatico segue l'iPhone: adesso è ${eNotte() ? '<b>scuro</b>' : '<b>chiaro</b>'}.` : pref('tema', 'auto') === 'scuro' ? 'Sempre scuro, con i colori della notte.' : 'Sempre chiaro, rosa e viola.'}</small></div>
  <h2>Chiaro</h2>
  <div class="colori-scelta"><button type="button" aria-pressed="${!eNotte()}" disabled><span class="campione"><i style="background:#ff6fb5"></i><i style="background:#b44dff"></i></span><b>Rosa e viola</b></button></div>
  <h2>Colori dello scuro</h2>
  <div class="colori-scelta">${COLORI_NOTTE.map(([k, t, c1, c2]) => `<button type="button" data-a="pref-colori" data-v="${k}" aria-pressed="${col === k}"><span class="campione"><i style="background:${c1}"></i><i style="background:${c2}"></i></span><b>${t}</b></button>`).join('')}</div>
  <small class="tenue">Toccando un colore della notte lo vedi subito.</small>
  <h2>Numerino sull'icona</h2>
  <div class="carta"><small class="tenue">Il numero rosso sull'icona dell'app conta i giorni senza ZIP, le righe da abbinare e gli ammanchi del controllo sul posto. L'iPhone lo mostra solo se dai il permesso alle notifiche (l'app non ti manda notifiche).</small>
    ${!('Notification' in window) ? '<b class="tenue">Su questo dispositivo non c\'è: apri l\'app dall\'icona sulla schermata Home.</b>' : Notification.permission === 'granted' ? '<b style="color:var(--verde)">Attivo</b>' : Notification.permission === 'denied' ? '<b style="color:var(--arancio)">Permesso negato: riattivalo in Impostazioni iPhone → Notifiche → Distributore</b>' : '<button type="button" class="btn secondario" data-a="attiva-numerino">Attiva il numerino</button>'}</div>`;
}

// numerino rosso sull'icona: giorni senza ZIP + righe da abbinare + ammanchi da guardare
function aggiornaNumerino() {
  try {
    if (!g || !('setAppBadge' in navigator)) return;
    const n = g.prelieviGiro().mancanti.length + g.s.sospese.length + g.s.esiti_controlli.filter((e) => !e.visto && e.ammanchi.length).length;
    if (n) navigator.setAppBadge(n).catch(() => {}); else navigator.clearAppBadge?.().catch(() => {});
  } catch { /* niente */ }
}

function chiudiSplash() {
  const sp = $('#splash'); if (!sp) return;
  const resta = Math.max(0, 1900 - performance.now());
  setTimeout(() => { sp.classList.add('via'); document.body.classList.add('intro'); setTimeout(() => { sp.remove(); document.body.classList.remove('intro'); }, 1600); }, resta);
}

// i numeri grandi contano da zero all'apertura
function contaNumeri() {
  document.querySelectorAll('[data-conta]').forEach((el) => {
    const fine = Number(el.dataset.conta), suf = el.textContent.includes('%') ? '%' : ''; if (!(fine > 0)) return;
    const t0 = performance.now(); const passo = (t) => { const k = Math.min(1, (t - t0) / 900); el.textContent = num(Math.round(fine * (1 - Math.pow(1 - k, 3)))) + suf; if (k < 1) requestAnimationFrame(passo); };
    requestAnimationFrame(passo);
  });
}

function disegna() {
  document.querySelectorAll('#schede button').forEach((b) => b.setAttribute('aria-current', b.dataset.scheda === ui.scheda ? 'page' : 'false'));
  $('#schede').hidden = !g;
  const s = $('#schermo');
  if (!g) { s.innerHTML = benvenuto(); return; }
  const pagine = { barcodeab, aspetto, prelievi, storico, abbinamenti, impostazioni, backup, controllo, riepilogo, inventario, zipimportati, storicoimporta, ignorate, info };
  s.innerHTML = ui.scheda === 'altro' && ui.pagina && pagine[ui.pagina]
    ? `<button type="button" class="indietro" data-a="indietro">‹ Altro</button>${pagine[ui.pagina]()}`
    : ({ oggi, articoli, rifornimento, calendario, altro })[ui.scheda]();
  aggiornaNumerino();
  document.querySelectorAll('.striscia.scorre').forEach((el) => { el.scrollLeft = el.scrollWidth; });
  if (document.body.classList.contains('intro') || !disegna.fatto) { disegna.fatto = true; contaNumeri(); }
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
  // da rifornimento a rifornimento: dal giorno dopo l'ultimo ZIP già riportato fino a ieri
  const inizio = g.inizioGiro();
  const ieri = piuGiorni(oggiIso(), -1);
  const n = Math.max(0, Math.round((new Date(ieri + 'T12:00') - new Date(inizio + 'T12:00')) / 864e5) + 1);
  const giorni = n ? g.giorniZip(Math.min(n, 60)) : [];
  const ultimo = g.s.rifornimenti.length ? g.s.rifornimenti[g.s.rifornimenti.length - 1].data_ora.slice(0, 10) : '';
  const mancano = giorni.filter((x) => x.stato === 'manca').length;
  const controlla = giorni.filter((x) => x.stato === 'controlla').length;
  const pezziTot = giorni.reduce((t, x) => t + x.zip.reduce((u, z) => u + (g.dettaglioZip(z.nome)?.pezzi || 0), 0), 0);
  const stato = !giorni.length ? ['verde', 'Nessun giorno nuovo'] : mancano ? ['rosso', `Manca${mancano === 1 ? '' : 'no'} ${mancano}`] : controlla ? ['arancio', 'Da controllare'] : ['verde', 'Tutti presenti'];
  const SIGLE = ['Do', 'Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa'];
  return `<section class="wid largo zipwid">
    <div class="wid-riga"><span class="wid-tit">ZIP dall'ultimo rifornimento</span><span class="pill ${stato[0]}">${stato[1]}</span></div>
    <div class="zip-sommario"><strong>${num(pezziTot)}</strong><span>pezzi in ${giorni.length} ${giorni.length === 1 ? 'giorno' : 'giorni'}<small>dal ${isoIta(inizio).slice(0, 5)} · ${ultimo ? `ultimo rifornimento il ${isoIta(ultimo).slice(0, 5)}` : 'rifornimento col programma'}</small></span></div>
    ${giorni.length ? `<div class="striscia ${giorni.length > 7 ? 'scorre' : ''}" style="--n:${Math.min(7, giorni.length)}">${giorni.map((x) => {
      const pezzi = x.zip.reduce((t, z) => t + (g.dettaglioZip(z.nome)?.pezzi || 0), 0);
      const zero = x.zip.length && !pezzi && x.stato === 'ok';
      return `<button type="button" class="tile ${x.stato}${zero ? ' zero' : ''}${x.giorno === ieri ? ' ieri' : ''}" data-a="giorno-zip" data-giorno="${x.giorno}" aria-label="${GIORNI[new Date(x.giorno + 'T12:00').getDay()]} ${isoIta(x.giorno)}: ${x.stato}">
        <span class="sg">${SIGLE[new Date(x.giorno + 'T12:00').getDay()]}</span><b class="nr">${Number(x.giorno.slice(8))}</b>
        ${distributorino(zero ? 'zero' : x.stato)}<span class="pz">${zero ? 'vuoto' : x.zip.length ? num(pezzi) : x.stato === 'manca' ? 'manca' : '—'}</span></button>`;
    }).join('')}</div>` : '<small class="tenue">Il rifornimento ha coperto tutti gli ZIP: domani compare il primo giorno nuovo.</small>'}
  </section>`;
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

function testoCtrl() {
  const r = Object.values(ui.controllo.righe), t = r.reduce((a, b) => a + b, 0);
  return r.length ? `Salva il controllo · ${r.length} ${r.length === 1 ? 'articolo' : 'articoli'}, ${t} pezzi` : 'Schiaccia + sugli articoli che mancano';
}

function controllo() {
  const c = ui.controllo;
  if (!c.data) c.data = oggiIso();
  const attesa = g.controlliInAttesa();
  const codici = Object.keys(g.s.prodotti).sort();
  const righe = Object.entries(c.righe);
  return `<h1>Controllo sul posto</h1>
  <div class="tenue">Al distributore segna i pezzi che mancano. Non li tolgo dal distributore: li aggiungo subito al prossimo rifornimento. Quando arriva lo ZIP di quel giorno, lo ZIP scala il distributore come sempre e dove c'è il prelievo non lo aggiungo una seconda volta; i pezzi senza movimento nello ZIP sono l'ammanco: restano nel rifornimento e li tolgo dal distributore.</div>
  <div class="carta">
    <div class="campo"><label for="ctrl-data">Giorno del controllo</label><input id="ctrl-data" type="date" value="${c.data}" data-a-cambio="ctrl-data"></div>
  </div>
  <button type="button" class="btn modo-barcode" data-a="ctrl-barcode">${ico.barcode} Barcode <small>leggi e scrivi i pezzi, uno dopo l'altro</small></button>
  <div class="cerca-riga"><div class="campo" style="flex:1"><input id="ctrl-cerca" type="search" placeholder="Cerca codice o descrizione…" autocomplete="off" aria-label="Cerca articolo"></div>
    <button type="button" class="scan" data-a="scan" data-dove="controllo" aria-label="Cerca con il barcode">${ico.barcode}</button></div>
  <div class="lista" id="ctrl-lista">${codici.map((k) => { const q = c.righe[k] || 0; return `<div class="ctrl-riga ${q ? 'segnato' : ''}" data-cerca="${esc(chiave(k + ' ' + g.prodotto(k).descrizione))}" data-codice="${esc(k)}">
      <span class="corpo"><b>${esc(k)}</b><small class="tenue taglia">${esc(g.prodotto(k).descrizione)}</small><small class="tenue">nel distributore ${num(g.prodotto(k).quantita)}</small></span>
      <button type="button" class="pm" data-a="ctrl-meno" data-codice="${esc(k)}" aria-label="Meno ${esc(k)}" ${q ? '' : 'disabled'}>−</button>
      <b class="ctrl-q" aria-live="polite">${q}</b>
      <button type="button" class="pm piu" data-a="ctrl-piu" data-codice="${esc(k)}" aria-label="Più ${esc(k)}">+</button></div>`; }).join('')}</div>
  <div class="ctrl-barra"><button type="button" class="btn" data-a="ctrl-salva" ${righe.length ? '' : 'disabled'}>${testoCtrl()}</button></div>
  </div>
  ${attesa.length ? `<h2>In attesa dello ZIP</h2>${attesa.map((a) => `<div class="carta"><div class="riga-titolo" style="align-items:center"><b>${GIORNI[new Date(a.data + 'T12:00').getDay()]} ${isoIta(a.data)}</b><span class="tenue">${a.pezzi} pezzi</span></div>
    ${a.righe.map((r) => `<small><b>${esc(r.codice)}</b> segnati ${r.mancanti}${r.assorbiti ? ` · ${r.assorbiti} già trovati nello ZIP` : ''}</small>`).join('')}
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

// quanto è pieno (distributore + magazzino) rispetto a subito dopo il rifornimento: i pezzi da riportare sono il vuoto
function livelloMagazzino() {
  const ora = g.elenco().reduce((t, p) => t + Math.max(0, p.quantita) + Math.max(0, p.magazzino || 0), 0);
  const manca = g.s.bozza.reduce((t, b) => t + (b.quantita > 0 ? b.quantita : 0), 0);
  const pieno = ora + manca;
  return { ora, manca, pieno, pct: pieno ? Math.floor(ora * 100 / pieno) : null };
}

// il distributore grande di Oggi: gli scaffali accesi sono la percentuale di pieno
function distributoreGrande(pct, mancano, daRiportare) {
  const RIGHE = 5, COL = 4, tot = RIGHE * COL, accesi = Math.round((pct ?? 0) / 100 * tot);
  const COLORI = ['#ff7fbf', '#ffd166', '#6ee7b7', '#7cc4ff', '#c79bff', '#ff9f6b'];
  let celle = '';
  for (let r = 0; r < RIGHE; r++) for (let c = 0; c < COL; c++) {
    const i = r * COL + c, on = i >= tot - accesi;   // si svuota dall'alto
    const x = 22 + c * 25, y = 46 + r * 30, col = COLORI[(i * 7 + r) % COLORI.length];
    celle += on
      ? `<g class="prod" style="--i:${tot - i}"><rect x="${x}" y="${y}" width="17" height="21" rx="4" fill="${col}"/><rect x="${x + 3}" y="${y + 3}" width="5" height="12" rx="2" fill="#fff" opacity=".35"/></g>`
      : `<rect x="${x}" y="${y}" width="17" height="21" rx="4" fill="#ffffff" opacity=".05"/>`;
    if (c === 0) celle += `<rect x="18" y="${y + 23}" width="100" height="3" rx="1.5" fill="#000" opacity=".35"/>`;
  }
  return `<svg class="dist-grande${mancano ? ' allarme' : ''}" viewBox="0 0 170 260" aria-hidden="true"><defs>
      <linearGradient id="dg-corpo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d9d1ee"/></linearGradient>
      <linearGradient id="dg-vetro" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2a62"/><stop offset="1" stop-color="#160e2b"/></linearGradient>
      <linearGradient id="dg-insegna" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:var(--a1)"/><stop offset="1" style="stop-color:var(--a2)"/></linearGradient>
      <linearGradient id="dg-riflesso" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    <rect x="4" y="4" width="162" height="250" rx="18" fill="url(#dg-corpo)"/>
    <rect x="4" y="4" width="162" height="34" rx="18" fill="url(#dg-insegna)"/><rect x="4" y="22" width="162" height="16" fill="url(#dg-insegna)"/>
    <text x="85" y="28" text-anchor="middle" class="dg-pct">GD</text>
    <rect x="12" y="42" width="112" height="160" rx="10" fill="url(#dg-vetro)"/>
    ${celle}
    <rect x="12" y="42" width="112" height="160" rx="10" fill="url(#dg-riflesso)"/>
    <rect x="132" y="46" width="26" height="30" rx="5" fill="#1c1233"/><text x="145" y="66" text-anchor="middle" class="dg-num">${daRiportare}</text>
    ${[0, 1, 2].map((r) => [0, 1].map((c) => `<rect x="${134 + c * 12}" y="${84 + r * 12}" width="9" height="8" rx="2" fill="#2a1d45" opacity=".55"/>`).join('')).join('')}
    <circle class="dg-led" cx="145" cy="132" r="6"/><rect x="139" y="146" width="12" height="40" rx="6" fill="#2a1d45" opacity=".3"/>
    <rect x="16" y="212" width="138" height="30" rx="10" fill="#1c1233"/>
    <rect class="dg-cade" x="74" y="219" width="22" height="14" rx="4" fill="#ffd166"/>
  </svg>`;
}

function oggi() {
  const giro = g.prelieviGiro();
  const d = new Date();
  const el = g.elenco();
  const riordino = el.filter((p) => p.sotto || p.negativo || (p.quantita <= 0 && !(p.magazzino > 0)));
  const bozza = g.s.bozza.filter((b) => b.quantita > 0);
  const pezziBozza = bozza.reduce((t, b) => t + b.quantita, 0);
  const sosp = g.s.sospese.length;
  const ora = d.getHours();
  const saluto = ora < 5 ? 'Buonanotte' : ora < 13 ? 'Buongiorno' : ora < 18 ? 'Buon pomeriggio' : 'Buonasera';
  const liv = livelloMagazzino();
  const zu = g.s.zip.filter((z) => !z.eliminato && !z.storico && z.dal).sort((a, b) => (a.al || a.dal).localeCompare(b.al || b.dal) || (a.importato_il || '').localeCompare(b.importato_il || '')).pop();
  const zd = zu ? g.dettaglioZip(zu.nome) : null;
  const manc = giro.mancanti;
  const gg = (x) => isoIta(x).slice(0, 5);
  const frase = manc.length ? `Mancano gli ZIP ${manc.length === 1 ? 'del ' + gg(manc[0]) : 'di ' + manc.length + ' giorni (' + manc.map(gg).join(', ') + ')'}. Da riportare ${num(pezziBozza)} pezzi.`
    : pezziBozza ? `Tutti gli ZIP ci sono. Da riportare ${num(pezziBozza)} pezzi di ${bozza.length} articoli.` : 'Tutto in ordine: niente da riportare.';
  const top = giro.righe.slice(0, 10), podio = top.slice(0, 3), resto = top.slice(3), maxR = Math.max(1, ...resto.map((r) => r.totale));
  const gradino = (r, pos) => r ? `<button type="button" class="gradino g${pos}" data-a="articolo" data-codice="${esc(r.codice)}"><span class="medaglia">${pos}</span><b>${esc(r.codice)}</b><small>${esc(r.descrizione)}</small><strong>${num(r.totale)}</strong><i></i></button>` : '<span></span>';
  return `
  <header class="saluto">
    <div class="sopra">${GIORNI[d.getDay()]} ${d.getDate()} ${MESI[d.getMonth()]} · <span id="orologio">${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span></div>
    <h1>${saluto}, Andrea</h1>
    <p class="frase ${manc.length ? 'rossa' : ''}">${frase}</p>
  </header>
  <section class="vetrina">
    <div class="vetrina-luce"></div>
    ${distributoreGrande(liv.pct, manc.length, pezziBozza)}
    <div class="vetrina-dati">
      <div><span>Pieno</span><strong data-conta="${liv.pct ?? 0}">${liv.pct ?? 0}%</strong><small>${num(liv.ora)} di ${num(liv.pieno)} pezzi</small></div>
      <div class="barra-pieno"><i style="width:${liv.pct ?? 0}%"></i></div>
      <button type="button" class="riporta" data-a="rif-passo" data-v="prepara"><strong data-conta="${pezziBozza}">${num(pezziBozza)}</strong><span>da riportare<small>${bozza.length} articoli ›</small></span></button>
    </div>
  </section>
  ${cartaDrive()}
  ${listaCaricamento()}
  ${sosp ? `<button type="button" class="drive attenzione" data-a="apri-drive"><span class="icona" style="background:#8a5a2a">!</span><span style="flex-grow:1;display:flex;flex-direction:column"><b>${sosp} ${sosp === 1 ? 'riga' : 'righe'} da abbinare</b><small class="tenue">Non entrano nel rifornimento finché non scegli il codice AS400</small></span>${ico.freccia}</button>` : ''}
  ${esitiNonVisti()}
  ${strisciaZip()}
  <div class="mini3">
    <button type="button" class="mini" data-a="rif-passo" data-v=""><span class="mi" style="background:#ff9f0a"><svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg></span><small>Prelevati</small><b>${num(giro.totale)}</b><em>dal ${gg(giro.inizio)}</em></button>
    <button type="button" class="mini" data-a="vedi-riordino"><span class="mi" style="background:${riordino.length ? '#ff6b3d' : '#34c759'}"><svg viewBox="0 0 24 24"><path d="M3 4h2l2.4 11h11L21 7H6"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/></svg></span><small>Da riordinare</small><b style="color:${riordino.length ? 'var(--arancio)' : 'var(--verde)'}">${riordino.length}</b><em>${riordino.length ? (riordino.length === 1 ? 'articolo' : 'articoli') : 'tutto ok'}</em></button>
    <button type="button" class="mini" data-a="pagina-diretta" data-pagina="controllo"><span class="mi" style="background:#ff5f8f"><svg viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M8 8v8M11 8v8M14 8v8M17 8v8"/></svg></span><small>Controllo</small><b>${g.controlliInAttesa().length || '›'}</b><em>${g.controlliInAttesa().length ? 'in attesa dello ZIP' : 'sul posto'}</em></button>
  </div>
  <section class="wid largo">
    <div class="wid-riga"><span class="wid-tit">Più prelevati</span><button type="button" class="link" data-a="rif-passo" data-v="">dal ${gg(giro.inizio)} · ${num(giro.totale)} pz ›</button></div>
    ${podio.length ? `<div class="podio">${gradino(podio[1], 2)}${gradino(podio[0], 1)}${gradino(podio[2], 3)}</div>
      ${resto.length ? `<div class="top">${resto.map((r, k) => `<button type="button" class="top-r" data-a="articolo" data-codice="${esc(r.codice)}"><span class="pos">${k + 4}</span><span class="top-n"><b>${esc(r.codice)}</b><small>${esc(r.descrizione)}</small></span><span class="top-b"><i style="--w:${Math.round(r.totale * 100 / maxR)}%"></i></span><b class="top-q">${num(r.totale)}</b></button>`).join('')}</div>` : ''}`
      : '<span class="wid-sotto">Nessun prelievo dall\'ultimo rifornimento</span>'}
  </section>
  `;
}

function articoli() {
  const giroArt = Object.fromEntries(g.prelieviGiro().righe.map((r) => [r.codice, r.totale]));
  const q = chiave(ui.cerca);
  const tutti = g.elenco();
  const filtri = { tutti: () => true, sotto: (p) => p.sotto || p.negativo, magazzino: (p) => p.magazzino > 0, riordino: (p) => p.sotto || p.negativo || (p.quantita <= 0 && !(p.magazzino > 0)) };
  const el = tutti.filter(filtri[ui.filtro]).filter((p) => !q || chiave(p.codice + ' ' + p.descrizione).includes(q));
  if (ui.ordine === 'prelevati') el.sort((a, b) => (giroArt[b.codice] || 0) - (giroArt[a.codice] || 0) || a.codice.localeCompare(b.codice));
  const chip = (k, t, n) => `<button type="button" class="chip" data-a="filtro" data-filtro="${k}" aria-pressed="${ui.filtro === k}">${t} ${n}</button>`;
  return `
  <div class="riga-titolo"><h1>Articoli</h1><button type="button" class="btn vuoto piccolo" data-a="nuovo-articolo">+ Nuovo</button></div>
  <div class="cerca-riga"><label class="cerca">${ico.cerca}<span class="nascosto">Cerca articolo</span><input id="cerca-art" type="search" placeholder="Codice o descrizione" value="${esc(ui.cerca)}" data-input="cerca" autocomplete="off"></label>
    <button type="button" class="scan" data-a="scan" data-dove="articoli" aria-label="Cerca con il barcode">${ico.barcode}</button></div>
  <div class="chips">${ui.filtro === 'riordino' ? chip('riordino', 'Da riordinare', tutti.filter(filtri.riordino).length) : ''}${chip('tutti', 'Tutti', tutti.length)}${chip('sotto', 'Sotto scorta', tutti.filter(filtri.sotto).length)}${chip('magazzino', 'In magazzino', tutti.filter(filtri.magazzino).length)}</div>
  <div class="ordina"><span>Ordina</span><button type="button" class="chip" data-a="ordine" data-v="" aria-pressed="${ui.ordine !== 'prelevati'}">Per codice</button><button type="button" class="chip" data-a="ordine" data-v="prelevati" aria-pressed="${ui.ordine === 'prelevati'}">Prima i più prelevati</button></div>
  ${el.length ? el.map((p) => {
    const c = p.carico_completo;
    const pieno = c ? Math.max(0, Math.min(100, Math.round(p.quantita * 100 / c))) : 0;
    const ultimo = ultimoPrelievo(p.codice);
    const manca = c != null ? Math.max(0, c - p.quantita) : 0;
    const stato = c == null ? '<span class="tenue">Carico completo non impostato: aprilo e scegli Modifica</span>'
      : !manca ? '<span style="color:var(--verde)">Distributore pieno</span>'
      : p.quantita <= 0 && p.magazzino > 0 ? `<span style="color:var(--arancio)">Distributore vuoto: adesso i pezzi escono dal magazzino</span>`
      : p.magazzino > 0 ? `<span style="color:var(--tenue)">Mancano ${num(manca)} per il pieno · il magazzino resta intatto finché il distributore non è vuoto</span>`
      : p.quantita <= 0 ? `<span style="color:var(--rosso)">Distributore vuoto e magazzino vuoto</span>`
      : p.sotto ? `<span style="color:var(--arancio)">Mancano ${num(manca)} per il pieno · sotto la scorta minima</span>`
      : `<span style="color:var(--tenue)">Mancano ${num(manca)} per il pieno: tornano con il rifornimento</span>`;
    return `<button type="button" class="articolo${p.sotto ? ' sotto' : ''}${p.negativo ? ' negativo' : ''}" data-a="articolo" data-codice="${esc(p.codice)}">
      <span class="testa"><span style="display:flex;flex-direction:column;min-width:0"><b style="font-size:16px">${esc(p.codice)}</b><small class="tenue">${esc(p.descrizione)}</small></span>
      ${giroArt[p.codice] ? `<span class="prel"><small>prelevati</small><b>${num(giroArt[p.codice])}</b></span>` : ''}</span>
      <span class="tre-art">
        <span><small>Carico completo</small><b>${c != null ? num(c) : '—'}</b></span>
        <span class="${p.quantita < 0 ? 'neg' : manca ? 'sotto-c' : ''}"><small>Nel distributore</small><b>${num(p.quantita)}</b></span>
        <span><small>Magazzino</small><b>${num(p.magazzino)}</b></span>
      </span>
      ${c ? `<span class="barra"><div style="width:${pieno}%"></div></span>` : ''}
      <span class="piede"><span>${stato}</span></span>
      <span class="piede"><span>Totale <b>${num(p.disponibile)}</b>${p.scorta_minima != null ? ` · scorta min. <b>${num(p.scorta_minima)}</b>` : ''}</span><span>${ultimo}</span></span>
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

// Rifornimento in due passi: prima i prelievi dall'ultimo rifornimento, poi Prepara (più/meno, PDF, fatto)
function passiRif(n) {
  return `<div class="passi"><span class="${n === 1 ? 'on' : 'fatto'}"><i>1</i>Prelievi</span><b></b><span class="${n === 2 ? 'on' : ''}"><i>2</i>Prepara</span><b></b><span><i>3</i>PDF e invio</span></div>`;
}

function rifornimento() {
  if (ui.rifPasso === 'prepara') return `<button type="button" class="indietro" data-a="rif-passo" data-v="">‹ Prelievi</button>${passiRif(2)}${preparaRifornimento()}`;
  const pezzi = g.s.bozza.reduce((t, b) => t + (b.quantita > 0 ? b.quantita : 0), 0), art = g.s.bozza.filter((b) => b.quantita > 0).length;
  const corpo = prelievi().replace("<h1>Prelievi dall'ultimo rifornimento</h1>", "<h1>Rifornimento</h1><div class=\"sopra\">Prelievi dall'ultimo rifornimento</div>");
  return `${passiRif(1)}${corpo}
  <button type="button" class="stampa prepara" data-a="rif-passo" data-v="prepara"><b>${num(pezzi)}</b><span>Prepara il rifornimento<small>${art} articoli · più e meno, PDF con barcode</small></span>${ico.freccia}</button>`;
}

// ordine della lista e del PDF: per codice, più pezzi prima, per descrizione
function ordinaRif(lista) {
  const o = ui.ordineRif || 'codice', desc = (b) => (g.prodotto(b.codice)?.descrizione || b.descrizione || '');
  return [...lista].sort((a, b) => o === 'pezzi' ? b.quantita - a.quantita || a.codice.localeCompare(b.codice)
    : o === 'descrizione' ? desc(a).localeCompare(desc(b)) : a.codice.localeCompare(b.codice));
}

function preparaRifornimento() {
  const righe = ordinaRif(g.bozzaDettaglio());
  const attive = righe.filter((b) => b.quantita > 0);
  const pezzi = attive.reduce((t, b) => t + b.quantita, 0);
  const oltre = attive.filter((b) => b.oltre).length, spira = attive.filter((b) => b.fuori_spira).length;
  const per = periodoBozza();
  return `
  <div><h1>Rifornimento</h1><div class="sopra">${per ? esc(per) + ' · ' : ''}${attive.length} articoli · <b style="color:var(--rosa)">${num(pezzi)} pezzi</b></div></div>
  <div class="ordina"><span>Ordina</span>${[['codice', 'Per codice'], ['pezzi', 'Più pezzi prima'], ['descrizione', 'Per descrizione']].map(([v, t]) => `<button type="button" class="chip" data-a="ordine-rif" data-v="${v}" aria-pressed="${(ui.ordineRif || 'codice') === v}">${t}</button>`).join('')}</div>
  ${oltre || spira ? `<div class="carta ${spira ? 'avviso-carta' : ''}">${oltre ? `<div class="tenue">Per <b style="color:var(--testo)">${oltre}</b> ${oltre === 1 ? 'articolo' : 'articoli'} il distributore è già pieno: i pezzi riportati vanno a ripristinare il magazzino.</div>` : ''}${spira ? `<div><b>${spira}</b> ${spira === 1 ? 'quantità non è' : 'quantità non sono'} multipl${spira === 1 ? 'a' : 'e'} dei pezzi per spira.</div>` : ''}</div>` : ''}
  ${righe.length ? `<div class="lista">${righe.map((b) => `
    <div class="rif ${b.quantita ? '' : 'spento'}"><div class="corpo" role="button" tabindex="0" data-a="articolo" data-codice="${esc(b.codice)}" style="text-align:left;padding:4px 0;cursor:pointer">
        <span class="rif-testa"><b>${esc(b.codice)}</b>${(() => { const m = g.prodotto(b.codice)?.magazzino || 0; return `<span class="mag-chip ${m ? (m >= b.quantita && b.quantita ? 'tanti' : 'si') : 'no'}">mag. ${num(m)}</span>`; })()}</span><small class="tenue taglia">${esc(b.descrizione)}</small>
        <small class="tenue">ora ${b.ora ?? '—'}${b.carico != null ? ` → <b style="color:${b.oltre ? 'var(--arancio)' : 'var(--testo)'}">${b.dopo}</b> / ${b.carico}` : ''}${b.oltre ? ` · +${b.eccesso} in mag.` : ''}${b.modificata ? ` · proposti ${b.proposta}` : ''}${b.blister ? ` · blister da ${b.blister}` : ''}${b.fuori_spira ? ` · <b style="color:var(--arancio)">spira da ${b.spira}</b>` : ''}</small></div>
      <button type="button" class="passo" aria-label="${passoSpira(b.codice)} in meno per ${esc(b.codice)}" data-a="meno" data-codice="${esc(b.codice)}">−</button>
      <span class="n">${b.quantita}${passoSpira(b.codice) > 1 ? `<small>± ${passoSpira(b.codice)}</small>` : ''}</span>
      <button type="button" class="passo piu" aria-label="${passoSpira(b.codice)} in più per ${esc(b.codice)}" data-a="piu" data-codice="${esc(b.codice)}">+</button></div>`).join('')}</div>` : '<div class="vuoto-msg">Niente da rifornire: i prelievi dei prossimi ZIP compariranno qui.</div>'}
  <button type="button" class="btn vuoto piccolo" data-a="aggiungi-rif">+ Aggiungi un articolo a mano</button>
  ${attive.length ? `<button type="button" class="stampa prepara" data-a="stampa-fatto"><b>${num(attive.reduce((t, b) => t + b.quantita, 0))}</b><span>Stampa PDF e registra<small>con i barcode · il giro riparte da zero</small></span>${ico.mail}</button>` : ''}
  ${(() => { const ev = g.eventiRifornimento(); return ev.length ? `<h2>Rifornimenti fatti</h2><div class="tenue">Per tornare indietro: "Ripristina da qui" disfa quel rifornimento e quelli dopo. I loro ZIP tornano liberi e i pezzi tornano da riportare; quello che c'è prima resta solo nello storico.</div>
    <div class="lista">${ev.slice(0, 10).map((e) => `<div class="voce"><span class="corpo"><b>${isoIta(e.data_ora.slice(0, 10))} alle ${e.data_ora.slice(11, 16)}</b><small>${e.articoli} articoli · ${num(e.pezzi)} pezzi${e.app ? '' : ' · fatto col programma'}</small></span>
      ${e.app ? `<button type="button" class="btn vuoto piccolo" data-a="ripdf" data-chiave="${esc(e.chiave)}">PDF</button>` : ''}${e.app ? `<button type="button" class="btn vuoto piccolo" data-a="ripristina-da" data-chiave="${esc(e.chiave)}">Ripristina da qui</button>` : ''}</div>`).join('')}</div>` : ''; })()}`;
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
  const w = g.prelieviGiro();
  const max = Math.max(1, ...w.perGiorno);
  const SIG = ['Do', 'Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa'];
  const sig = (d) => `${SIG[new Date(d + 'T12:00').getDay()]} ${Number(d.slice(8))}`;
  return `
  <h1>Prelievi dall'ultimo rifornimento</h1>
  <div class="tenue">Dal ${isoIta(w.inizio)} a ieri. Quando segni il rifornimento come fatto si riparte da zero: i giri precedenti restano nello storico.</div>
  <div class="carta"><div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:16px">Totale</b><strong style="font-size:28px;color:var(--rosa)">${num(w.totale)} pezzi</strong></div>
    <small class="tenue">${w.zip.length} ZIP da riportare${w.mancanti.length ? ` · <b style="color:var(--rosso)">mancano ${w.mancanti.length} giorni</b>` : ''}</small>
    ${w.giorni.length ? `<div class="grafico">${w.giorni.map((d, i) => `<div><span class="v">${w.perGiorno[i] || ''}</span><span class="b" style="height:${Math.round(w.perGiorno[i] * 100 / max)}%"></span><span class="e">${Number(d.slice(8))}</span></div>`).join('')}</div>` : ''}</div>
  <div class="lista">${w.righe.map((r) => `<button type="button" class="voce" data-a="articolo" data-codice="${esc(r.codice)}"><span class="corpo"><b>${esc(r.codice)}</b><small class="taglia">${esc(r.descrizione)}</small>
    <small class="tenue">${Object.entries(r.giorni).map(([d, q]) => `${sig(d)}: ${q}`).join(' · ')}</small></span><b style="font-size:18px">${num(r.totale)}</b></button>`).join('') || '<div class="vuoto-msg">Nessun prelievo dall\'ultimo rifornimento.</div>'}</div>`;
}

function passoSpira(codice) {
  const p = g.prodotto(codice); if (!p) return 1;
  return Math.max(1, Number(p.pezzi_spira) || 1, p.in_blister ? Number(p.pezzi_blister) || 1 : 1);
}

function periodoBozza() {
  // solo gli ZIP del giro in corso: non ancora riportati, non annullati, non dello storico
  const z = g.s.zip.filter((x) => x.dal && !x.rifornito && !x.eliminato && !x.storico);
  if (!z.length) return '';
  const dal = z.map((x) => x.dal).sort()[0], al = z.map((x) => x.al || x.dal).sort().pop();
  return dal === al ? `Prelievi del ${isoIta(dal)}` : `Prelievi dal ${isoIta(dal)} al ${isoIta(al)}`;
}

// Storico "a eventi": uno ZIP, un rifornimento, un controllo sono una riga sola, che si apre per vedere gli articoli.
// Gli spostamenti interni tra distributore e magazzino non cambiano il totale: si vedono solo se li chiedi.
const GRUPPO_DI = {
  SCARICO_ZIP: 'zip', RIFORNIMENTO: 'rif', CONTROLLO_POSTO: 'ctrl', AMMANCO: 'ctrl', STORICO_IMPORTATO: 'imp',
  MODIFICA_MANUALE: 'corr', CORREZIONE_MAGAZZINO: 'corr', CARICO_MANUALE: 'corr', NUOVO_PRODOTTO: 'corr', CANCELLAZIONE_INVENTARIO: 'corr', ARTICOLO_ELIMINATO: 'corr', ZIP_ELIMINATO: 'corr',
  DAL_MAGAZZINO: 'int', ECCESSO_MAGAZZINO: 'int', REGOLA_MAGAZZINO: 'int', REINTEGRO_MAGAZZINO: 'int', MODIFICA_ARTICOLO: 'int',
};
const ASPETTO_EV = {
  zip: ['#ff6b81', 'Prelievi dallo ZIP', '<path d="M4 4h12l4 4v12H4z"/><path d="M12 10v6M9 13l3 3 3-3"/>'],
  rif: ['#34c759', 'Rifornimento', '<path d="M3 7h13v10H3z"/><path d="M16 10h3l2 3v4h-5"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>'],
  ctrl: ['#ff9f0a', 'Controllo sul posto', '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>'],
  corr: ['#0a84ff', 'Correzione', '<path d="M4 20h4L20 8l-4-4L4 16z"/>'],
  imp: ['#8e8e93', 'Storico importato', '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 20h16"/>'],
  int: ['#636366', 'Distributore ↔ magazzino', '<path d="M7 7h11l-3-3M17 17H6l3 3"/>'],
};
function titoloEvento(ev) {
  const [, nome] = ASPETTO_EV[ev.gruppo];
  const o = ev.origine || '';
  if (ev.gruppo === 'zip') { const z = /(\d{4})(\d{2})(\d{2})/.exec(o); return z ? `Prelievi del ${isoIta(piuGiorni(`${z[1]}-${z[2]}-${z[3]}`, -1))}` : nome; }
  if (ev.gruppo === 'corr') return o === 'Inventario' ? 'Inventario' : o || nome;
  if (ev.gruppo === 'imp') return 'Storico importato';
  return nome;
}

function storico() {
  const q = chiave(ui.cercaStorico);
  const filtro = ui.tipoStorico || 'tutti', interni = !!ui.storicoInterni;
  const tutti = g.s.movimenti.filter((m) => (!ui.meseStorico || (m.data_ora || '').startsWith(ui.meseStorico)) && (!q || chiave(m.codice + ' ' + m.descrizione).includes(q)))
    .filter((m) => { const gr = GRUPPO_DI[m.tipo] || 'corr'; return filtro === 'tutti' ? (interni || gr !== 'int') && gr !== 'imp' : gr === filtro; });
  ui._storicoVisti = tutti;
  // eventi: stesso momento, stessa origine, stesso tipo
  const per = new Map();
  for (const m of tutti) {
    const gr = GRUPPO_DI[m.tipo] || 'corr', k = `${m.data_ora}|${m.origine || ''}|${gr}`;
    let ev = per.get(k);
    if (!ev) { ev = { k, gruppo: gr, data_ora: m.data_ora || '', origine: m.origine || '', righe: new Map(), id: m.id }; per.set(k, ev); }
    const r = ev.righe.get(m.codice) || { codice: m.codice, descrizione: m.descrizione, q: 0, note: m.note || '' };
    if (gr !== 'int' || interni) r.q += Number(m.quantita || 0);
    ev.righe.set(m.codice, r); ev.id = Math.max(ev.id, m.id || 0);
  }
  const eventi = [...per.values()].sort((a, b) => b.data_ora.localeCompare(a.data_ora) || b.id - a.id);
  const mostra = eventi.slice(0, Math.round(ui.quantiStorico / 5));
  const tot = (gr) => tutti.filter((m) => GRUPPO_DI[m.tipo] === gr).reduce((t, m) => t + Number(m.quantita || 0), 0);
  const chip = (k, t) => `<button type="button" class="chip" data-a="tipo-storico" data-tipo="${k}" aria-pressed="${filtro === k}">${t}</button>`;
  let html = '', giorno = '';
  for (const ev of mostra) {
    const gg = ev.data_ora.slice(0, 10);
    if (gg !== giorno) {
      if (giorno) html += '</div>';
      giorno = gg;
      const delG = tutti.filter((m) => (m.data_ora || '').startsWith(gg));
      const pre = -delG.filter((m) => GRUPPO_DI[m.tipo] === 'zip').reduce((t, m) => t + Number(m.quantita || 0), 0), rip = delG.filter((m) => GRUPPO_DI[m.tipo] === 'rif').reduce((t, m) => t + Number(m.quantita || 0), 0);
      html += `<div class="giorno-st"><b>${GIORNI[new Date(gg + 'T12:00').getDay()]} ${isoIta(gg)}</b><span>${pre ? `<i class="meno">−${num(pre)} prelevati</i>` : ''}${rip ? `<i class="piu-t">+${num(rip)} riportati</i>` : ''}</span></div><div class="lista eventi">`;
    }
    const [col, , svg] = ASPETTO_EV[ev.gruppo], righe = [...ev.righe.values()], somma = righe.reduce((t, r) => t + r.q, 0);
    const uno = righe.length === 1 ? righe[0] : null, aperto = !uno && ui.storicoAperti?.has(ev.k);
    html += `<div class="ev ${aperto ? 'aperto' : ''}"><button type="button" class="ev-testa" ${uno ? `data-a="articolo" data-codice="${esc(uno.codice)}"` : `data-a="ev" data-k="${esc(ev.k)}"`}>
        <span class="m-ico" style="background:${col}"><svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg></span>
        <span class="corpo"><b class="taglia">${uno ? esc(uno.codice) + ' · ' : ''}${esc(titoloEvento(ev))}</b><small class="tenue taglia">${ev.data_ora.slice(11, 16)}${uno ? ' · ' + esc(uno.descrizione || '') : ` · ${righe.length} articoli`}${uno && uno.note && ev.gruppo !== 'zip' ? ' · ' + esc(uno.note) : ''}</small></span>
        <span class="qta ${somma < 0 ? 'meno' : somma > 0 ? 'piu-t' : ''}">${somma > 0 ? '+' : ''}${num(somma)}</span>${uno ? '' : `<span class="ev-freccia">${aperto ? '▴' : '▾'}</span>`}</button>
      ${aperto ? `<div class="ev-righe">${righe.sort((a, b) => a.q - b.q || a.codice.localeCompare(b.codice)).map((r) => `<button type="button" class="ev-r" data-a="articolo" data-codice="${esc(r.codice)}"><span class="corpo"><b>${esc(r.codice)}</b><small class="tenue taglia">${esc(r.descrizione || '')}</small></span><span class="qta ${r.q < 0 ? 'meno' : r.q > 0 ? 'piu-t' : ''}">${r.q > 0 ? '+' : ''}${num(r.q)}</span></button>`).join('')}</div>` : ''}</div>`;
  }
  if (giorno) html += '</div>';
  const mesi = [...new Set(g.s.movimenti.map((m) => (m.data_ora || '').slice(0, 7)))].filter(Boolean).sort().reverse();
  return `
  <h1>Storico</h1>
  <label class="cerca">${ico.cerca}<span class="nascosto">Cerca nello storico</span><input id="cerca-st" type="search" placeholder="Cerca un articolo" value="${esc(ui.cercaStorico)}" data-input="cerca-storico" autocomplete="off"></label>
  <div class="chips">${chip('tutti', 'Tutto')}${chip('zip', 'Prelievi')}${chip('rif', 'Rifornimenti')}${chip('ctrl', 'Controlli')}${chip('corr', 'Correzioni')}${chip('imp', 'Storico vecchio')}</div>
  <div class="st-somme"><div><span>Prelevati</span><strong class="meno">${num(-tot('zip'))}</strong></div><div><span>Riportati</span><strong class="piu-t">${num(tot('rif'))}</strong></div><div><span>Eventi</span><strong>${num(eventi.length)}</strong></div></div>
  <div class="st-barra"><select id="st-mese" data-a-cambio="st-mese" aria-label="Mese"><option value="">Tutti i mesi</option>${mesi.map((m) => `<option value="${m}" ${ui.meseStorico === m ? 'selected' : ''}>${new Date(m + '-15').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}</option>`).join('')}</select>
    <button type="button" class="btn vuoto piccolo" data-a="esporta-storico">Esporta</button>${ui.meseStorico ? '<button type="button" class="btn pericolo piccolo" data-a="cancella-mese">Cancella</button>' : ''}</div>
  ${filtro === 'tutti' ? `<label class="interruttore"><input type="checkbox" data-a-cambio="st-interni" ${interni ? 'checked' : ''}> Mostra anche gli spostamenti tra distributore e magazzino</label>` : ''}
  ${html || '<div class="vuoto-msg">Nessun movimento.</div>'}
  ${eventi.length > mostra.length ? '<button type="button" class="btn vuoto" data-a="altri-storico">Mostra altri</button>' : ''}`;
}

function altro() {
  const ICONE = {
    controllo: ['#ff5f8f', '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>'],
    prelievi: ['#ff9f0a', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'],
    riepilogo: ['#af52de', '<path d="M3 4h18v16H3z"/><path d="M7 15l3-3 3 2 4-5"/>'],
    storico: ['#5e5ce6', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'],
    magazzino: ['#a2845e', '<path d="M3 9l9-5 9 5v11H3z"/><path d="M7 20v-7h10v7M7 16h10"/>'],
    inventario: ['#30b0c7', '<path d="M9 4h6v3H9z"/><path d="M8 5H5v16h14V5h-3"/><path d="M8 12h8M8 16h5"/>'],
    zipimportati: ['#34c759', '<path d="M4 4h12l4 4v12H4z"/><path d="M10 4v4M10 10v2M10 14v2"/>'],
    storicoimporta: ['#64d2ff', '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 20h16"/>'],
    abbinamenti: ['#ff375f', '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'],
    barcodeab: ['#bf5af2', '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8M10 8v8M13 8v8M16 8v8"/>'],
    impostazioni: ['#0a84ff', '<path d="M7 18a5 5 0 0 1-.5-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>'],
    ignorate: ['#8e8e93', '<circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/>'],
    aspetto: ['#ff2d92', '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="#fff"/>'],
    backup: ['#32d74b', '<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/><path d="M9 12l2 2 4-4"/>'],
    info: ['#636366', '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'],
  };
  const voce = (pag, titolo, sotto) => { const [col, svg] = ICONE[pag] || ['#636366', '']; return `<button type="button" class="voce menu" data-a="pagina" data-pagina="${pag}"><span class="m-ico" style="background:${col}"><svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg></span><span class="corpo"><b>${titolo}</b><small>${sotto}</small></span>${ico.freccia}</button>`; };
  const attesa = g.controlliInAttesa().length;
  const conMag = Object.values(g.s.prodotti).filter((p) => p.magazzino > 0).length;
  return `
  <h1>Altro</h1>
  <h2>Ogni giorno</h2>
  <div class="lista">
    ${voce('controllo', 'Controllo sul posto', attesa ? `${attesa} in attesa dello ZIP` : 'Segna i pezzi mancanti al distributore')}
    ${voce('prelievi', 'Prelievi dall\'ultimo rifornimento', `${num(g.prelieviGiro().totale)} pezzi dal ${isoIta(g.inizioGiro())}, articolo per articolo`)}
    ${voce('riepilogo', 'Riepilogo della settimana', 'Com\'è andata la settimana scorsa')}
    ${voce('storico', 'Storico', `${num(g.s.movimenti.length)} movimenti · ricerca, mesi, esporta`)}
  </div>
  <h2>Inventario</h2>
  <div class="lista">
    ${voce('inventario', 'Inventario', 'Conta e correggi · foglio PDF · scorte minime')}
  </div>
  <h2>ZIP</h2>
  <div class="lista">
    ${voce('zipimportati', 'ZIP importati', `${g.s.zip.filter((z) => !z.eliminato && !z.storico).length} ZIP · vedi o annulla`)}
    ${voce('storicoimporta', 'Importa storico', 'ZIP vecchi solo per statistiche e scorte')}
  </div>
  <h2>Abbinamenti</h2>
  <div class="lista">
    ${voce('abbinamenti', 'PDF e AS400', `${g.s.abbinamenti.length} descrizioni del PDF collegate ai codici AS400 · aggiungi e modifica`)}
    ${voce('barcodeab', 'AS400 e barcode', `${Object.values(g.s.prodotti).filter((p) => (p.barcode || []).length).length} di ${Object.keys(g.s.prodotti).length} articoli con il barcode · carica col lettore`)}
  </div>
  <h2>Impostazioni</h2>
  <div class="lista">
    ${voce('impostazioni', 'Google Drive', drive.collegato ? `Collegato · cartella ${esc(g.s.impostazioni.drive_cartella_nome || '—')}` : 'Non collegato')}
    ${voce('ignorate', 'Descrizioni ignorate', `${g.s.ignorate.length} descrizioni che non conto`)}
    ${voce('aspetto', 'Aspetto e colori', `${{ chiaro: 'Chiaro', scuro: 'Scuro', auto: 'Automatico' }[pref('tema', 'auto')] || 'Automatico'} · notte ${COLORI_NOTTE.find(([k]) => k === pref('colori', 'grafite'))?.[1] || ''}`)}
    ${voce('backup', 'Backup e ripristino', drive.collegato ? 'Automatico su Drive · copie nel telefono · file' : 'Copie nel telefono · file')}
    ${voce('info', 'Informazioni', `Versione ${VERSIONE}`)}
  </div>
  <div class="tenue" style="text-align:center;padding:10px">Distributore web ${VERSIONE} · AC</div>`;
}

function inventario() {
  const el = g.elenco();
  const conti = ui.inventario;
  const cambiati = Object.keys(conti).length;
  return `<h1>Inventario</h1>
  <div class="carta"><b>Foglio d'inventario</b><small class="tenue">PDF A4 in bianco e nero con tutti gli articoli, le giacenze attuali, il barcode e lo spazio per scrivere i conteggi.</small>
    <button type="button" class="btn secondario" data-a="pdf-inventario">${ico.mail} Crea il foglio e mandalo</button></div>
  <div class="carta"><b>Conta e correggi</b><small class="tenue">Scrivi quanti pezzi hai in tutto di ogni articolo, solo quelli diversi. Fino al carico completo li metto nel distributore, quelli in più sono magazzino. Applico tutto insieme e finisce nello storico.</small>
    <button type="button" class="btn vuoto" data-a="scan" data-dove="inventario">${ico.barcode} Trova con il barcode</button></div>
  <div class="lista">${el.map((p) => `<div class="inv" data-codice="${esc(p.codice)}"><span class="corpo"><b>${esc(p.codice)}</b><small class="tenue taglia">${esc(p.descrizione)}</small><small class="tenue">adesso ${num(p.quantita + (p.magazzino || 0))}${p.carico_completo != null ? ` · carico ${num(p.carico_completo)}` : ''}</small></span>
    <label class="inv-c"><span>Totale contato</span><input type="number" inputmode="numeric" placeholder="${p.quantita + (p.magazzino || 0)}" value="${esc(conti[p.codice] ?? '')}" data-inv="${esc(p.codice)}" aria-label="Pezzi contati di ${esc(p.codice)}"></label></div>`).join('')}</div>
  <button type="button" class="btn" data-a="inv-applica" ${cambiati ? '' : 'disabled'}>Applica i conteggi${cambiati ? ` (${cambiati} articoli)` : ''}</button>
  <h2>Scorte minime</h2>
  <div class="carta"><small class="tenue">Come nel programma: una settimana di consumo medio degli ultimi 30 giorni. Si aggiornano da sole ogni 7 giorni${g.s.scorte_calcolate_il ? ` (ultima volta il ${isoIta(g.s.scorte_calcolate_il)})` : ''}.</small>
    <button type="button" class="btn vuoto piccolo" data-a="ricalcola-scorte">Ricalcola adesso</button></div>
  <h2>Azzera</h2>
  <div class="carta"><small class="tenue">Porta a zero distributore e magazzino di tutti gli articoli (prima faccio un backup). Articoli, abbinamenti e storico restano.</small>
    <button type="button" class="btn pericolo piccolo" data-a="azzera">Azzera tutte le giacenze</button></div>`;
}

function zipimportati() {
  const tutti = g.s.zip.filter((z) => !z.storico).slice().reverse();
  const el = ui.zipVecchi ? tutti : tutti.filter((z) => !z.rifornito);
  const vecchi = tutti.length - tutti.filter((z) => !z.rifornito).length;
  return `<h1>ZIP importati</h1>
  <div class="affianca"><button type="button" class="btn ${ui.zipVecchi ? 'vuoto' : 'secondario'} piccolo" data-a="zip-vecchi" data-v="">Dall'ultimo rifornimento</button><button type="button" class="btn ${ui.zipVecchi ? 'secondario' : 'vuoto'} piccolo" data-a="zip-vecchi" data-v="1">Tutti (+${vecchi} già riportati)</button></div><div class="tenue">Tocca uno ZIP per vederlo riga per riga. Uno ZIP non ancora riportato si può annullare: i pezzi tornano nel distributore, poi lo puoi reimportare.</div>
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
  </div>
  <h2>File per i colleghi</h2>
  <div class="carta"><small class="tenue">Nel tuo Drive tengo la cartella <b style="color:var(--testo)">"Distributore - per i colleghi"</b> con un Foglio Google sempre aggiornato (rifornimento da preparare, giacenze, prelievi, ZIP: si apre da Drive senza scaricare niente), il PDF del rifornimento da preparare (come lo vedi tu, con i barcode: un solo file, col giorno nel nome) e il PDF dell'ultimo rifornimento stampato. Si aggiorna quando apri l'app e dopo ogni modifica. Condividi la cartella col collega da Google Drive (una volta sola): lui la apre dal PC.</small>
    <label class="interruttore"><input type="checkbox" data-a-cambio="colleghi" ${colleghiAttivo() ? 'checked' : ''}> Tieni aggiornato il file</label>
    <small class="tenue">${(() => { try { const u = localStorage.getItem('colleghi_ultimo'); return u ? `Ultimo aggiornamento: ${new Date(u).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Non ancora creato.'; } catch { return ''; } })()}</small>
    <div class="affianca"><button type="button" class="btn vuoto piccolo" data-a="colleghi-ora" ${drive.token() ? '' : 'disabled'}>Aggiorna adesso</button>${drive.linkCartellaColleghi() ? `<a class="btn vuoto piccolo" href="${drive.linkCartellaColleghi()}" target="_blank" rel="noopener">Apri la cartella</a>` : ''}</div></div>`;
}

function abbinamenti() {
  const q = chiave(ui.cercaAbb || '');
  const tutte = g.descrizioniPdf(), senza = tutte.filter((d) => !g.s.abbinamenti.some((a) => a.chiave === d.chiave) && !g.s.ignorate.includes(d.chiave));
  const el = g.s.abbinamenti.filter((a) => !q || chiave(a.codice + ' ' + a.descrizione_pdf + ' ' + (g.prodotto(a.codice)?.descrizione || '') + ' ' + (a.codice_pdf || '')).includes(q))
    .sort((a, b) => a.codice.localeCompare(b.codice) || a.descrizione_pdf.localeCompare(b.descrizione_pdf));
  return `<h1>PDF e AS400</h1><div class="tenue">Comanda il PDF: ogni descrizione del PDF va a un codice AS400. Qui li aggiungi e li cambi quando vuoi; valgono per gli ZIP che arrivano da adesso.</div>
  <button type="button" class="btn" data-a="abb-nuovo">+ Nuovo abbinamento</button>
  ${senza.length ? `<div class="carta avviso-carta"><b>${senza.length} ${senza.length === 1 ? 'descrizione vista nei PDF non è abbinata' : 'descrizioni viste nei PDF non sono abbinate'}</b>
    <div class="lista">${senza.map((d) => `<button type="button" class="voce" data-a="abb-modifica" data-desc="${esc(d.descrizione_pdf)}" data-cp="${esc(d.codice_pdf)}"><span class="corpo"><b class="taglia">${esc(d.descrizione_pdf)}</b><small>PDF ${esc(d.codice_pdf || '—')} · tocca per abbinare</small></span>${ico.freccia}</button>`).join('')}</div></div>` : ''}
  <div class="campo"><input type="search" placeholder="Cerca codice, descrizione PDF o AS400…" value="${esc(ui.cercaAbb || '')}" data-input="cercaAbb" id="cerca-abb" autocomplete="off" aria-label="Cerca abbinamento"></div>
  <div class="tenue">${el.length} abbinamenti · tocca per cambiarlo</div>
  <div class="lista">${el.map((a) => `<button type="button" class="voce" data-a="abb-modifica" data-chiave="${esc(a.chiave)}"><span class="corpo"><small class="taglia">PDF ${esc(a.codice_pdf || '—')} · ${esc(a.descrizione_pdf)}</small><b>→ ${esc(a.codice)}</b><small class="tenue taglia">${esc((g.prodotto(a.codice) || {}).descrizione || '')}</small></span>${ico.freccia}</button>`).join('') || '<div class="vuoto-msg">Nessuno</div>'}</div>`;
}

function foglioAbbinamento({ chiaveA = '', desc = '', cp = '', art = '' } = {}) {
  const a = chiaveA ? g.s.abbinamenti.find((x) => x.chiave === chiaveA) : null;
  const d = a ? a.descrizione_pdf : desc, c = a ? a.codice_pdf : cp;
  const codici = Object.keys(g.s.prodotti).sort();
  apriFoglio(`<h1>${a ? 'Cambia abbinamento' : 'Nuovo abbinamento'}</h1>
    <form id="form-abb" data-vecchia="${esc(chiaveA)}" data-art="${esc(art)}" style="display:flex;flex-direction:column;gap:12px">
      <div class="campo"><label for="abb-desc">Descrizione come è nel PDF</label><input id="abb-desc" name="desc" value="${esc(d)}" autocomplete="off" required ${a ? '' : 'autofocus'}></div>
      <div class="campo"><label for="abb-cp">Codice PDF (facoltativo)</label><input id="abb-cp" name="cp" value="${esc(c || '')}" autocomplete="off"></div>
      <div class="campo"><label for="abb-cod">Codice AS400</label>${sceltaCodice('abb-cod', d || ' ', codici)}</div>
      <div class="affianca"><button type="button" class="btn vuoto" data-a="chiudi">Annulla</button><button type="submit" class="btn">Salva</button></div>
    </form>
    ${a ? `<button type="button" class="btn pericolo piccolo" data-a="togli-abbinamento" data-chiave="${esc(a.chiave)}">Togli questo abbinamento</button>` : ''}`);
  if (a) $('#abb-cod').value = a.codice; else if (art) $('#abb-cod').value = art;
}

function barcodeab() {
  const el = g.elenco();
  const con = el.filter((p) => (p.barcode || []).length).length;
  return `<h1>AS400 e barcode</h1><div class="tenue">Il barcode del produttore (EAN) di ogni articolo. Tocca un articolo e inquadra il suo barcode, oppure caricali tutti in fila.</div>
  <div class="numeri"><div><span>Con barcode</span><strong style="color:var(--verde)">${con}</strong><span>articoli</span></div><div><span>Senza</span><strong style="color:${el.length - con ? 'var(--arancio)' : 'var(--verde)'}">${el.length - con}</strong><span>articoli</span></div></div>
  <button type="button" class="btn modo-barcode" data-a="bar-fila" ${el.length - con ? '' : 'disabled'}>Caricali in fila <small>uno dietro l'altro: ti dico l'articolo, inquadri, beep, avanti</small></button>
  <div class="lista">${el.map((p) => `<div class="voce bar-riga" data-codice="${esc(p.codice)}"><button type="button" class="corpo" data-a="bar-uno" data-codice="${esc(p.codice)}" style="background:none;border:0;text-align:left;padding:0">
      <b>${esc(p.codice)}</b><small class="taglia tenue">${esc(p.descrizione)}</small>
      ${(p.barcode || []).length ? `<small style="color:var(--verde)">${p.barcode.map(esc).join(' · ')}</small>` : '<small style="color:var(--arancio)">nessun barcode · tocca e inquadra</small>'}</button>
      <button type="button" class="scan" data-a="bar-uno" data-codice="${esc(p.codice)}" aria-label="Leggi il barcode di ${esc(p.codice)}">${ico.barcode}</button></div>`).join('')}</div>`;
}

// abbina i barcode: uno solo (articolo scelto) o in fila (tutti quelli senza barcode)
function caricaBarcode(codici, dopo = null) {
  let i = 0;
  const titolo = () => { const p = g.prodotto(codici[i]); return `${i + 1} di ${codici.length} · ${p.codice} — ${p.descrizione}`; };
  apriLettore((testo, { riprendi, chiudi, box }) => {
    const k = codici[i], gia = g.trovaBarcode(testo), st = box.querySelector('.let-stato');
    if (gia && gia !== k) { st.textContent = `${testo} è già di ${gia}: non lo abbino a ${k}`; setTimeout(riprendi, 1600); return; }
    if (!gia) { g.associaBarcode(k, testo); salva(); }
    i++;
    if (i >= codici.length) { avviso(codici.length === 1 ? `Barcode abbinato a ${k}.` : `Fatto: ${codici.length} articoli abbinati.`); chiudi(); return; }
    box.querySelector('.let-testa b').textContent = titolo(); riprendi(); st.textContent = `${k} ✓ · adesso ${codici[i]}`;
  }, titolo(), {
    continuo: true,
    chiuso: () => { disegna(); dopo?.(); },
  });
  if (codici.length > 1) setTimeout(() => {
    const box = document.getElementById('lettore'); if (!box) return;
    box.insertAdjacentHTML('beforeend', '<div class="let-fondo"><button type="button" class="btn vuoto" data-x="salta" style="color:#fff">Salta questo</button><button type="button" class="btn" data-x="fine">Fine</button></div>');
    box.querySelector('[data-x="fine"]').onclick = () => box.querySelector('.let-chiudi').click();
    box.querySelector('[data-x="salta"]').onclick = () => { i++; if (i >= codici.length) { box.querySelector('.let-chiudi').click(); return; } box.querySelector('.let-testa b').textContent = titolo(); };
  }, 0);
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
// conferma grande, difficile da premere per sbaglio: il pulsante si sblocca dopo un attimo
function chiediConferma({ titolo, testo, si, pericolo = false }) {
  return new Promise((ok) => {
    apriFoglio(`<h1>${titolo}</h1><div style="font-size:16px;line-height:1.45">${testo}</div>
      <div class="affianca"><button type="button" class="btn vuoto" id="conf-no">Annulla</button><button type="button" class="btn ${pericolo ? 'pericolo' : ''}" id="conf-si" disabled>${si}</button></div>`);
    const b = $('#conf-si'); setTimeout(() => { b.disabled = false; }, 900);
    const fine = (v) => { chiudiFoglio(); ok(v); };
    b.onclick = () => fine(true); $('#conf-no').onclick = () => fine(false);
    $('#foglio .chiudi').onclick = () => fine(false);
  });
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
        <div class="griglia2">${campo('totale', 'Pezzi in tutto', (p.quantita || 0) + (p.magazzino || 0))}
        ${campo('carico_completo', 'Carico completo', p.carico_completo)}${campo('scorta_minima', 'Scorta minima', p.scorta_minima)}${campo('pezzi_spira', 'Pezzi per spira', p.pezzi_spira)}${campo('pezzi_blister', 'Pezzi per blister (vuoto = no)', p.in_blister ? p.pezzi_blister : '')}</div>
        <small class="tenue">Ogni modifica finisce nello storico. Dei pezzi in tutto, fino al carico completo sono nel distributore, quelli in più sono magazzino.</small>
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
    ${(() => {
      // prima di tutto: i prelievi di questo giro di rifornimento, giorno per giorno
      const gr = g.prelieviGiro(), r = gr.righe.find((x) => x.codice === codice), SIG = ['Do', 'Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa'];
      const val = gr.giorni.map((d) => (r && r.giorni[d]) || 0), mx = Math.max(1, ...val), manc = new Set(gr.mancanti);
      const b = g.s.bozza.find((x) => x.codice === codice);
      return `<div class="carta giro-art">
        <div class="giro-testa"><span><small>Prelevati da questo rifornimento</small><b>dal ${isoIta(gr.inizio).slice(0, 5)} a ieri</b></span><strong>${num(r ? r.totale : 0)}</strong></div>
        ${gr.giorni.length ? `<div class="grafico giro" style="grid-template-columns:repeat(${gr.giorni.length}, 1fr)">${gr.giorni.map((d, k) => `<div class="${manc.has(d) ? 'manca' : ''}"><span class="v">${val[k] || (manc.has(d) ? '?' : '')}</span><span class="b" style="height:${Math.round(val[k] * 100 / mx)}%"></span><span class="e">${SIG[new Date(d + 'T12:00').getDay()]}<br>${Number(d.slice(8))}</span></div>`).join('')}</div>` : ''}
        ${r ? `<div class="giro-lista">${Object.entries(r.giorni).sort().map(([d, q]) => `<span><b>${num(q)}</b> ${GIORNI[new Date(d + 'T12:00').getDay()].slice(0, 3).toLowerCase()} ${isoIta(d).slice(0, 5)}</span>`).join('')}</div>` : '<small class="tenue">Nessun prelievo in questo giro.</small>'}
        ${gr.mancanti.length ? `<small class="tenue">Mancano ancora gli ZIP del ${gr.mancanti.map((d) => isoIta(d).slice(0, 5)).join(', ')}: i loro prelievi arrivano con lo ZIP.</small>` : ''}
        ${b && b.quantita ? `<div class="giro-rif">Nel rifornimento da preparare: <b>${num(b.quantita)} pezzi</b></div>` : ''}
      </div>`;
    })()}
    <div class="tre">
      <div><span>Distributore</span><strong class="${p.quantita < 0 ? 'rosso' : ''}">${num(p.quantita)}</strong><small>${c != null ? `su ${num(c)}` : 'carico ?'}</small></div>
      <div><span>Magazzino</span><strong>${num(p.magazzino)}</strong><small>di riserva</small></div>
      <div class="${sotto ? 'allarme' : ''}"><span>Totale</span><strong>${num(disp)}</strong><small>${p.scorta_minima != null ? `scorta min. ${num(p.scorta_minima)}` : 'scorta ?'}</small></div>
    </div>
    ${c ? `<div class="barra grande"><div style="width:${Math.max(0, Math.min(100, Math.round(p.quantita * 100 / c)))}%"></div></div>` : ''}
    <div class="carta">
      <div>Con i prelievi delle ultime 4 settimane (<b>${num(st.pezzi_28)}</b> pezzi, ${st.media.toLocaleString('it-IT', { maximumFractionDigits: 1 })} al giorno) ti dura ${durata}.</div>
      ${sotto ? '<div style="color:var(--arancio);font-weight:700">Sotto la scorta minima: da riordinare.</div>' : ''}
      ${g.consiglio(codice) ? `<div style="color:var(--rosa);font-weight:600">${esc(g.consiglio(codice))}</div>` : ''}
      <small class="tenue">Ultimo prelievo ${st.ultimo_prelievo ? isoIta(st.ultimo_prelievo) : '—'} · ultimo rifornimento ${st.ultimo_rifornimento ? isoIta(st.ultimo_rifornimento.slice(0, 10)) : '—'}</small>
    </div>
    <h2>Prelievi degli ultimi 14 giorni</h2>
    <div class="grafico">${st.giorni.map((x) => `<div title="${isoIta(x.giorno)}: ${x.pezzi}"><span class="v">${x.pezzi || ''}</span><span class="b" style="height:${Math.round(x.pezzi * 100 / maxG)}%"></span><span class="e">${Number(x.giorno.slice(8))}</span></div>`).join('')}</div>
    <h2>Per settimana</h2>
    <div class="grafico sett">${st.settimane.map((x) => `<div><span class="v">${x.pezzi || ''}</span><span class="b" style="height:${Math.round(x.pezzi * 100 / maxS)}%"></span><span class="e">${isoIta(x.dal).slice(0, 5)}</span></div>`).join('')}</div>
    <h2>Codici e abbinamenti</h2>
    <div class="carta codici">
      <div class="cod-riga"><span class="cod-et">AS400</span><span class="cod-val"><b>${esc(codice)}</b><small>${esc(p.descrizione)}</small></span><button type="button" class="btn vuoto piccolo" data-a="rinomina" data-codice="${esc(codice)}">Cambia</button></div>
      <div class="cod-riga alto"><span class="cod-et">PDF</span><span class="cod-val">${st.abbinamenti.length ? st.abbinamenti.map((a) => `<button type="button" class="cod-voce" data-a="abb-modifica" data-chiave="${esc(a.chiave)}" data-art="${esc(codice)}"><b>${esc(a.descrizione_pdf)}</b><small>codice PDF ${esc(a.codice_pdf || '—')} · cambia ›</small></button>`).join('') : '<small class="tenue">Nessuna descrizione del PDF</small>'}</span></div>
      <div class="cod-riga alto"><span class="cod-et">EAN</span><span class="cod-val">${(p.barcode || []).length ? p.barcode.map((b) => `<span class="cod-bar"><b>${esc(b)}</b><button type="button" class="link" data-a="togli-bar" data-codice="${esc(codice)}" data-testo="${esc(b)}">Togli</button></span>`).join('') : '<small class="tenue">Nessun barcode</small>'}
        <button type="button" class="link" data-a="bar-uno" data-codice="${esc(codice)}">+ Leggi il barcode con la fotocamera</button></span></div>
    </div>
    <div class="affianca"><button type="button" class="btn secondario" data-a="modifica-articolo" data-codice="${esc(codice)}">Modifica</button></div>
    <h2>Avanti e indietro: distributore e magazzino</h2>
    <div class="lista">${storia.map((m) => {
      const q = Number(m.quantita || 0);
      return `<div class="mov"><span class="corpo"><b>${esc(TIPI[m.tipo] || m.tipo)}</b>
        <small class="tenue">${isoIta((m.data_ora || '').slice(0, 10))} ${(m.data_ora || '').slice(11, 16)}${m.note ? ' · ' + esc(m.note) : ''}</small>
        <small>Distributore ${freccia(m.distr_prima, m.distr_dopo)} · Magazzino ${freccia(m.mag_prima, m.mag_dopo)}</small></span>
        <span class="qta ${q < 0 ? 'meno' : q > 0 ? 'piu-t' : ''}">${q > 0 ? '+' : ''}${num(q)}</span></div>`;
    }).join('') || '<div class="vuoto-msg">Nessun movimento</div>'}</div>
    `);
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
  if (!x.zip.length && g.s.consumi[giorno] && Object.values(g.s.consumi[giorno]).some((q) => q > 0)) {
    const righe = Object.entries(g.s.consumi[giorno]).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]);
    apriFoglio(`<h1>${titolo}</h1>
      <div class="tenue"><b style="color:#ff8a8a">già riportato</b> · prelievi dallo storico del programma</div>
      <div class="carta"><b>${righe.length} articoli · ${num(righe.reduce((t, [, q]) => t + q, 0))} pezzi</b></div>
      <div class="lista">${righe.map(([k, q]) => `<button type="button" class="voce" data-a="articolo" data-codice="${esc(k)}"><span class="corpo"><b>${esc(k)}</b><small class="taglia">${esc(g.prodotto(k)?.descrizione || '')}</small></span><b style="font-size:18px">${num(q)}</b></button>`).join('')}</div>`);
    return;
  }
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

async function filePdfRifornimento(etichetta = 'stampato') {
  const righe = ordinaRif(g.s.bozza.filter((b) => b.quantita > 0))
    .map((b) => ({ ...b, descrizione: g.prodotto(b.codice)?.descrizione || b.descrizione }));
  const pezzi = righe.reduce((s, r) => s + r.quantita, 0);
  const per = periodoBozza();
  const ora = new Date();
  const info = `${per ? per + '   ·   ' : ''}${righe.length} articoli   ·   ${pezzi} pezzi   ·   ${etichetta} il ${ora.toLocaleDateString('it-IT')} ${ora.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
  const byte = await pdfRifornimento(righe, info);
  return new File([byte], nomeFile(oggiIso()), { type: 'application/pdf' });
}

// aggiorna solo la riga toccata, così la lista non salta
function ctrlCambia(k, d) {
  const r = ui.controllo.righe, q = Math.max(0, (r[k] || 0) + d);
  if (q) r[k] = q; else delete r[k];
  const riga = document.querySelector(`.ctrl-riga[data-codice="${CSS.escape(k)}"]`);
  if (riga) { riga.querySelector('.ctrl-q').textContent = q; riga.classList.toggle('segnato', q > 0); riga.querySelector('[data-a="ctrl-meno"]').disabled = !q; }
  const b = document.querySelector('[data-a="ctrl-salva"]'); if (b) { b.textContent = testoCtrl(); b.disabled = !Object.keys(r).length; }
}

// Controllo sul posto in modalità barcode: beep → articolo e quantità → Aggiungi → si continua a leggere
function modalitaBarcode() {
  const r = ui.controllo.righe;
  const conta = () => { const v = Object.values(r); return v.length ? `${v.length} ${v.length === 1 ? 'articolo' : 'articoli'} · ${v.reduce((a, b) => a + b, 0)} pezzi` : 'Ancora nessun pezzo'; };
  let barra;
  apriLettore((testo, { riprendi, box }) => {
    const pannello = document.createElement('div'); pannello.className = 'let-pannello';
    const mostra = (k) => {
      const p = g.prodotto(k), gia = r[k] || 0;
      pannello.innerHTML = `<div class="lp-art"><b>${esc(k)}</b><span>${esc(p.descrizione)}</span><small>nel distributore ${num(p.quantita)}${gia ? ` · già segnati <b>${gia}</b>` : ''}</small></div>
        <div class="lp-q"><span>Quantità</span><button type="button" class="pm" data-d="-1" aria-label="Meno">−</button><input type="number" inputmode="numeric" min="1" value="1" aria-label="Pezzi mancanti"><button type="button" class="pm piu" data-d="1" aria-label="Più">+</button></div>
        <div class="affianca"><button type="button" class="btn vuoto" data-x="salta">Salta</button><button type="button" class="btn" data-x="ok">Aggiungi</button></div>`;
      const inp = pannello.querySelector('input');
      pannello.querySelectorAll('.pm').forEach((b) => b.onclick = () => { inp.value = Math.max(1, (Number(inp.value) || 0) + Number(b.dataset.d)); });
      pannello.querySelector('[data-x="salta"]').onclick = () => { pannello.remove(); riprendi(); };
      pannello.querySelector('[data-x="ok"]').onclick = () => {
        const q = Math.round(Number(inp.value)); if (!(q > 0)) { inp.focus(); return; }
        r[k] = gia + q; barra.textContent = conta(); pannello.remove();
        riprendi(); box.querySelector('.let-stato').textContent = `${k} +${q} ✓ · inquadra il prossimo`;
      };
      setTimeout(() => { inp.focus(); inp.select(); }, 50);
    };
    const k = g.trovaBarcode(testo);
    if (!k) {
      pannello.innerHTML = `<div class="lp-art"><b>Barcode nuovo</b><span>${esc(testo)}</span><small>Non è ancora abbinato. A quale articolo appartiene? Lo abbini una volta sola, poi lo riconosco da solo.</small></div>
        <select aria-label="Articolo"><option value="">Scegli l'articolo…</option>${Object.keys(g.s.prodotti).sort().map((c) => `<option value="${esc(c)}">${esc(c)} – ${esc(g.prodotto(c).descrizione)}</option>`).join('')}</select>
        <div class="affianca"><button type="button" class="btn vuoto" data-x="salta">Salta</button><button type="button" class="btn" data-x="abbina">Abbina</button></div>`;
      pannello.querySelector('[data-x="salta"]').onclick = () => { pannello.remove(); riprendi(); };
      pannello.querySelector('[data-x="abbina"]').onclick = () => { const c = pannello.querySelector('select').value; if (!c) return; g.associaBarcode(c, testo); salva(); mostra(c); };
      box.appendChild(pannello);
      return;
    }
    mostra(k);
    box.appendChild(pannello);
  }, 'Controllo sul posto · Barcode', {
    continuo: true,
    chiuso: () => { disegna(); if (Object.keys(r).length) avviso(`${conta()}: controlla e premi Salva il controllo.`); },
  });
  // in alto il conteggio e il pulsante Fine
  setTimeout(() => {
    const box = document.getElementById('lettore'); if (!box) return;
    box.insertAdjacentHTML('beforeend', `<div class="let-fondo"><span class="let-conta">${conta()}</span><button type="button" class="btn" data-x="fine">Fine</button></div>`);
    barra = box.querySelector('.let-conta');
    box.querySelector('[data-x="fine"]').onclick = () => box.querySelector('.let-chiudi').click();
  }, 0);
}

function dopoScan(testo, dove) {
  const k = g.trovaBarcode(testo);
  if (k) { vaiAlPezzo(k, dove); return; }
  // barcode del produttore mai visto: si abbina una volta e poi si riconosce da solo; finché non è abbinato non tocca niente
  apriFoglio(`<h1>Barcode nuovo</h1><div class="tenue">Ho letto <b style="color:var(--testo)">${esc(testo)}</b> ma non è ancora abbinato. A quale articolo appartiene? Da adesso lo riconosco da solo.</div>
    <div class="campo"><label for="bar-art">Articolo</label><select id="bar-art"><option value="">Scegli l'articolo…</option>${Object.keys(g.s.prodotti).sort().map((c) => `<option value="${esc(c)}">${esc(c)} – ${esc(g.prodotto(c).descrizione)}</option>`).join('')}</select></div>
    <div class="affianca"><button type="button" class="btn vuoto" data-a="chiudi">Lascia stare</button><button type="button" class="btn" data-a="associa-bar" data-testo="${esc(testo)}" data-dove="${esc(dove)}">Abbina</button></div>`);
}

function vaiAlPezzo(k, dove) {
  if (dove === 'articoli') { foglioArticolo(k); return; }
  const sel = dove === 'controllo' ? `.ctrl-riga[data-codice="${CSS.escape(k)}"]` : `.inv[data-codice="${CSS.escape(k)}"]`;
  const cerca = document.getElementById('ctrl-cerca'); if (cerca && cerca.value) { cerca.value = ''; cerca.dispatchEvent(new Event('input', { bubbles: true })); }
  const riga = document.querySelector(sel);
  if (!riga) { avviso(`${k} non è in questa pagina.`, true); return; }
  riga.scrollIntoView({ behavior: 'smooth', block: 'center' });
  riga.classList.remove('lampo'); void riga.offsetWidth; riga.classList.add('lampo');
  avviso(`${k} · ${g.prodotto(k).descrizione}`);
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
  'elimina-articolo': async (el) => { if (!confirm(`Elimino ${el.dataset.codice}? Spariscono anche i suoi abbinamenti. Lo storico resta.`)) return; await backupLocale(`prima di eliminare ${el.dataset.codice}`); cambia(() => g.eliminaArticolo(el.dataset.codice), 'Articolo eliminato.').then(chiudiFoglio); },
  'pdf-inventario': async (el) => { el.disabled = true; try { const ora = new Date(); const b = await pdfInventario(g.elenco(), `${Object.keys(g.s.prodotti).length} articoli · giacenze al ${ora.toLocaleDateString('it-IT')} ${ora.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`); await condividi(new File([b], `Inventario_${isoIta(oggiIso()).replace(/\//g, '-')}.pdf`, { type: 'application/pdf' }), 'Inventario distributore'); } catch (e) { avviso('PDF non creato: ' + e.message, true); } el.disabled = false; },
  'inv-applica': async () => { const n = Object.keys(ui.inventario).length; if (!confirm(`Applico i conteggi di ${n} articoli?`)) return; await backupLocale('prima dell\'inventario'); cambia(() => g.applicaInventarioTotale(ui.inventario), (k) => `Inventario applicato: ${k} correzioni.`).then(() => { ui.inventario = {}; disegna(); }); },
  'ricalcola-scorte': () => cambia(() => g.ricalcolaScorte(true), (n) => `Scorte minime ricalcolate: ${n} articoli aggiornati.`),
  'azzera': async () => { if (!confirm('Azzero distributore e magazzino di TUTTI gli articoli?')) return; if (!confirm('Sicuro? Prima faccio un backup nel telefono.')) return; await backupLocale('prima di azzerare le giacenze'); cambia(() => g.azzeraGiacenze(), 'Giacenze azzerate.'); },
  'annulla-zip': async (el) => { if (!confirm(`Annullo ${el.dataset.nome}? I suoi pezzi tornano nel distributore e spariscono dal rifornimento.`)) return; await backupLocale(`prima di annullare ${el.dataset.nome}`); cambia(() => g.annullaZip(el.dataset.nome), (r) => `ZIP annullato: ${r.pezzi} pezzi rimessi.`); },

  'ripdf': async (el) => { const r = g.s.rifornimenti.find((x) => (x.id || x.data_ora) === el.dataset.chiave || x.data_ora === el.dataset.chiave); if (!r || !r.righe) { avviso('PDF non disponibile per questo rifornimento.', true); return; } const righe = r.righe.filter((b) => b.quantita > 0).sort((a, b) => a.codice.localeCompare(b.codice)).map((b) => ({ ...b, descrizione: g.prodotto(b.codice)?.descrizione || b.descrizione })); const byte = await pdfRifornimento(righe, `Rifornimento del ${isoIta(r.data_ora.slice(0, 10))} ${r.data_ora.slice(11, 16)}   ·   ${r.articoli} articoli   ·   ${r.pezzi} pezzi   ·   copia`); condividi(new File([byte], nomeFile(r.data_ora.slice(0, 10)), { type: 'application/pdf' }), 'Rifornimento distributore'); },
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
  'pref-tema': (el) => { try { localStorage.setItem('pref_tema', el.dataset.v); } catch { /* niente */ } applicaColori(); disegna(); },
  'ctrl-barcode': () => modalitaBarcode(),
  'colleghi-ora': async (el) => { el.disabled = true; avviso('Aggiorno il file per i colleghi…'); await aggiornaColleghi(true); avviso(localStorage.getItem('colleghi_ultimo') ? 'File per i colleghi aggiornato su Drive.' : 'Non sono riuscito ad aggiornarlo.'); disegna(); },
  'ordine-rif': (el) => { ui.ordineRif = el.dataset.v; try { localStorage.setItem('ordine_rif', ui.ordineRif); } catch { /* niente */ } disegna(); },
  'abb-nuovo': () => foglioAbbinamento(),
  'abb-modifica': (el) => foglioAbbinamento({ chiaveA: el.dataset.chiave || '', desc: el.dataset.desc || '', cp: el.dataset.cp || '', art: el.dataset.art || '' }),
  'abb-art': (el) => foglioAbbinamento({ art: el.dataset.codice }),
  'rinomina': (el) => { const v = el.dataset.codice; const n = prompt(`Nuovo codice AS400 per ${v}?\n(Cambia ovunque: giacenze, storico, abbinamenti, rifornimento.)`, v); if (!n || n.trim().toUpperCase() === v) return; cambia(() => g.rinominaArticolo(v, n), (k) => `Codice cambiato: ${v} → ${k}.`).then((k) => { if (k) foglioArticolo(k); }); },
  'bar-uno': (el) => { const dalFoglio = !$('#foglio').hidden; chiudiFoglio(); caricaBarcode([el.dataset.codice], dalFoglio ? () => foglioArticolo(el.dataset.codice) : null); },
  'bar-fila': () => caricaBarcode(g.elenco().filter((p) => !(p.barcode || []).length).map((p) => p.codice)),
  'rif-passo': (el) => { ui.scheda = 'rifornimento'; ui.pagina = ''; ui.rifPasso = el.dataset.v; disegna(); window.scrollTo(0, 0); },
  'ordine': (el) => { ui.ordine = el.dataset.v; try { localStorage.setItem('ordine_articoli', ui.ordine); } catch { /* niente */ } disegna(); },
  'associa-bar': (el) => { const k = $('#bar-art').value; if (!k) { avviso('Scegli l\'articolo.', true); return; } cambia(() => g.associaBarcode(k, el.dataset.testo), `Barcode abbinato a ${k}.`).then(() => { chiudiFoglio(); vaiAlPezzo(k, el.dataset.dove); }); },
  'togli-bar': (el) => { if (confirm(`Tolgo il barcode ${el.dataset.testo} da ${el.dataset.codice}?`)) cambia(() => g.togliBarcode(el.dataset.codice, el.dataset.testo), 'Barcode tolto.').then(() => foglioArticolo(el.dataset.codice)); },
  'scan': (el) => { const dove = el.dataset.dove; apriLettore((testo) => dopoScan(testo, dove), dove === 'controllo' ? 'Controllo sul posto: inquadra il barcode' : 'Inquadra il barcode'); },
  'attiva-numerino': async () => { try { await Notification.requestPermission(); } catch { /* niente */ } aggiornaNumerino(); disegna(); },
  'pref-colori': (el) => { try { localStorage.setItem('pref_colori', el.dataset.v); } catch { /* niente */ } applicaColori(); disegna();
    if (!eNotte()) { document.documentElement.setAttribute('data-colori', el.dataset.v); avviso('Anteprima della notte: adesso è giorno, torna rosa fra 3 secondi.'); clearTimeout(applicaColori.t); applicaColori.t = setTimeout(applicaColori, 3000); } },
  'pagina-diretta': (el) => { ui.scheda = 'altro'; ui.pagina = el.dataset.pagina; disegna(); window.scrollTo(0, 0); },
  'zip-vecchi': (el) => { ui.zipVecchi = !!el.dataset.v; disegna(); },
  'riepilogo-ok': (el) => { try { localStorage.setItem('riepilogo_visto', el.dataset.settimana); } catch { /* niente */ } chiudiFoglio(); },
  'esito-visto': (el) => cambia(() => { g.s.esiti_controlli.forEach((x) => { if (x.data === el.dataset.data) x.visto = true; }); g.s.aggiornato = new Date().toISOString(); }),
  'ctrl-piu': (el) => ctrlCambia(el.dataset.codice, 1),
  'ctrl-meno': (el) => ctrlCambia(el.dataset.codice, -1),
  'ctrl-salva': () => {
    const c = ui.controllo;
    cambia(() => g.salvaControllo(c.data, c.righe), (r) => `Controllo salvato: ${r.aggiunti} pezzi aggiunti al rifornimento. Il distributore lo scala lo ZIP di quel giorno.${r.esiti.length ? ' Confrontato subito con lo ZIP già arrivato.' : ''}`)
      .then((r) => { if (r) ui.controllo = { data: c.data, righe: {} }; disegna(); });
  },
  'ctrl-modifica': (el) => { const d = el.dataset.data; ui.controllo = { data: d, righe: Object.fromEntries(g.s.controlli.filter((x) => x.data === d && x.stato === 'attesa').map((x) => [x.codice, x.mancanti])) }; disegna(); window.scrollTo(0, 0); },
  'ctrl-elimina': (el) => { if (confirm(`Elimino il controllo del ${isoIta(el.dataset.data)}? I pezzi tolti tornano nel distributore.`)) cambia(() => g.eliminaControllo(el.dataset.data), 'Controllo eliminato.'); },
  'vedi-riordino': () => { ui.scheda = 'articoli'; ui.filtro = 'riordino'; ui.pagina = ''; disegna(); window.scrollTo(0, 0); },
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
  'ev': (el) => { const a = (ui.storicoAperti ||= new Set()); if (a.has(el.dataset.k)) a.delete(el.dataset.k); else a.add(el.dataset.k); disegna(); },
  'altri-storico': () => { ui.quantiStorico += 300; disegna(); },
  // + e − vanno avanti di una spira (o di un blister): si riempiono spire intere
  'meno': (el) => { const b = g.s.bozza.find((x) => x.codice === el.dataset.codice), n = passoSpira(b.codice); cambia(() => g.impostaQuantitaBozza(b.codice, Math.max(0, Math.ceil(b.quantita / n) * n - n))); },
  'piu': (el) => { const b = g.s.bozza.find((x) => x.codice === el.dataset.codice), n = passoSpira(b.codice); cambia(() => g.impostaQuantitaBozza(b.codice, Math.floor(b.quantita / n) * n + n)); },
  'stampa-fatto': async (el) => {
    const righe = g.s.bozza.filter((b) => b.quantita > 0), pezzi = righe.reduce((t, b) => t + b.quantita, 0);
    if (!await chiediConferma({ titolo: 'Stampo e registro?', si: 'Sì, stampa e registra',
      testo: `Creo il PDF con <b>${num(pezzi)} pezzi</b> di <b>${righe.length} articoli</b> e registro il rifornimento: i pezzi tornano nel distributore (oltre il carico completo in magazzino) e il giro riparte da zero.<br><br><small class="tenue">${esc(periodoBozza())}. Se sbagli: Rifornimenti fatti → Ripristina da qui.</small>` })) return;
    el.disabled = true;
    try {
      const file = await filePdfRifornimento();          // prima il PDF: se non si crea, non registro niente
      await backupLocale('prima del rifornimento');
      const r = g.rifornimentoFatto(); await salva(); disegna();
      avviso(`Rifornimento registrato: ${r.articoli} articoli, ${r.pezzi} pezzi.`);
      if (colleghiAttivo() && drive.token()) drive.salvaPerColleghi('pdf', 'Ultimo rifornimento.pdf', 'application/pdf', new Uint8Array(await file.arrayBuffer())).catch((e) => console.warn('PDF per i colleghi', e));
      await condividi(file, 'Rifornimento distributore');
    } catch (e) { avviso('Non fatto: ' + e.message, true); }
    el.disabled = false;
  },
  'ripristina-da': async (el) => {
    const ev = g.eventiRifornimento(), e = ev.find((x) => x.chiave === el.dataset.chiave), dopo = ev.filter((x) => x.data_ora >= e.data_ora);
    if (!await chiediConferma({ titolo: 'Ripristino da qui?', si: 'Sì, ripristina', pericolo: true,
      testo: `Disfo ${dopo.length === 1 ? 'il rifornimento' : `${dopo.length} rifornimenti, dal`} del <b>${isoIta(e.data_ora.slice(0, 10))} alle ${e.data_ora.slice(11, 16)}</b>${dopo.length > 1 ? ' in poi' : ''}: <b>${num(dopo.reduce((t, x) => t + x.pezzi, 0))} pezzi</b> tornano da riportare, gli ZIP che coprivano tornano liberi e il giro riparte da lì. Quello che c'è prima resta solo nello storico.<br><br><small class="tenue">Prima salvo una copia nel telefono.</small>` })) return;
    await backupLocale(`prima di ripristinare dal ${isoIta(e.data_ora.slice(0, 10))}`);
    cambia(() => g.ripristinaDa(e.chiave), (r) => `Ripristinato: ${r.pezzi} pezzi tornati da riportare.`);
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
  'togli-abbinamento': (el) => { if (confirm('Tolgo questo abbinamento? La descrizione tornerà da abbinare al prossimo ZIP.')) cambia(() => g.togliAbbinamento(el.dataset.chiave), 'Abbinamento tolto.').then(() => { const art = $('#form-abb')?.dataset.art; if (art) foglioArticolo(art); else chiudiFoglio(); }); },
  'backup': () => scaricaBackup(),
};

document.addEventListener('click', (e) => {
  const s = e.target.closest('[data-scheda]');
  if (s) { if (s.dataset.scheda === 'rifornimento' && s.closest('#schede')) ui.rifPasso = ''; if (ui.scheda === s.dataset.scheda || s.dataset.scheda !== 'altro') ui.pagina = ''; ui.scheda = s.dataset.scheda; chiudiFoglio(); disegna(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-a]');
  if (el && azioni[el.dataset.a]) { e.preventDefault(); azioni[el.dataset.a](el); }
});
$('#velo').addEventListener('click', chiudiFoglio);
document.addEventListener('input', (e) => {
  if (e.target.id === 'ctrl-cerca') { const q = chiave(e.target.value); document.querySelectorAll('.ctrl-riga').forEach((r) => { r.hidden = !!q && !r.dataset.cerca.includes(q); }); return; }
  if (e.target.dataset.inv) {
    const c = e.target.dataset.inv, v = e.target.value;
    if (v === '') delete ui.inventario[c]; else ui.inventario[c] = v;
    const b = document.querySelector('[data-a="inv-applica"]');
    if (b) { const n = Object.keys(ui.inventario).length; b.disabled = !n; b.textContent = `Applica i conteggi${n ? ` (${n} articoli)` : ''}`; }
    return;
  }
  const k = e.target.dataset.input;
  if (k === 'cerca') { ui.cerca = e.target.value; ui.focus = 'cerca-art'; disegna(); }
  if (k === 'cerca-storico') { ui.cercaStorico = e.target.value; ui.quantiStorico = 150; ui.focus = 'cerca-st'; disegna(); }
  if (k === 'cercaAbb') { ui.cercaAbb = e.target.value; ui.focus = 'cerca-abb'; disegna(); }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.file === 'dati' && t.files[0]) caricaDati(t.files[0]);
  if (t.dataset.file === 'zip' && t.files.length) importaFileZip([...t.files]);
  if (t.dataset.aCambio === 'ctrl-data') { ui.controllo.data = t.value; }
  if (t.dataset.aCambio === 'colleghi') { try { localStorage.setItem('colleghi', t.checked ? 'si' : 'no'); } catch { /* niente */ } if (t.checked) aggiornaColleghi(true).then(disegna); }
  if (t.dataset.aCambio === 'st-interni') { ui.storicoInterni = t.checked; disegna(); }
  if (t.dataset.aCambio === 'st-mese') { ui.meseStorico = t.value; ui.quantiStorico = 150; disegna(); }
  if (t.dataset.file === 'storico' && t.files.length) importaFileStorico([...t.files]);
  if (t.dataset.aCambio === 'partenza') cambia(() => { g.s.impostazioni.zip_partenza = t.value ? piuGiorni(t.value, 1) : ''; g.s.aggiornato = new Date().toISOString(); }, `Prelievi presi dal ${isoIta(t.value)}.`);
});
document.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'form-abb') {
    const d = Object.fromEntries(new FormData(f));
    cambia(() => g.salvaAbbinamento(d.desc, d.cp, d.codice, f.dataset.vecchia), `Abbinato a ${d.codice}.`).then((r) => { if (r) { if (f.dataset.art) foglioArticolo(d.codice); else chiudiFoglio(); } });
    return;
  }
  if (f.id === 'form-articolo') {
    const dati = Object.fromEntries(new FormData(f));
    const pb = String(dati.pezzi_blister || '').trim(); delete dati.pezzi_blister;
    if ('totale' in dati) {   // il totale si divide da solo: fino al carico completo distributore, il resto magazzino
      const t = Math.max(0, Math.round(Number(dati.totale) || 0)), cc = String(dati.carico_completo ?? '').trim() === '' ? null : Math.round(Number(dati.carico_completo));
      const d = cc != null ? Math.min(t, cc) : t; dati.quantita = d; dati.magazzino = t - d; delete dati.totale;
    }
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
  chiudiSplash();
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
