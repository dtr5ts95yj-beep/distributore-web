// Distributore – logica (nessuna dipendenza dalla pagina: si prova anche con Node)
// Stesse regole di GESTIONE DISTRIBUTORI: lettura del PDF "Totale articoli", abbinamenti,
// scarico, riempimento dal magazzino, rifornimento.

export const TIPI = {
  SCARICO_ZIP: 'Scarico ZIP', RIFORNIMENTO: 'Rifornimento', CARICO_MANUALE: 'Carico manuale',
  NUOVO_PRODOTTO: 'Nuovo prodotto', MODIFICA_MANUALE: 'Modifica giacenza', MODIFICA_ARTICOLO: 'Modifica articolo',
  STORICO_IMPORTATO: 'Storico importato', REINTEGRO_MAGAZZINO: 'Reintegro magazzino',
  CORREZIONE_MAGAZZINO: 'Correzione magazzino', ECCESSO_MAGAZZINO: 'Eccesso a magazzino',
  DAL_MAGAZZINO: 'Dal magazzino al distributore', REGOLA_MAGAZZINO: 'Ricalcolo con la regola nuova del magazzino', AMMANCO: 'Ammanco', CONTROLLO_POSTO: 'Controllo sul posto',
  ZIP_ELIMINATO: 'ZIP annullato', CANCELLAZIONE_INVENTARIO: 'Azzeramento giacenze', ARTICOLO_ELIMINATO: 'Articolo eliminato',
};

export const chiave = (t) => String(t ?? '').toUpperCase().replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------------ somiglianza (come abbinamento.py)
const SINONIMI = { BOMB: 'BOMBOLETTA', GUANTI: 'GUANTO', SALD: 'SALDATURA', AURICOL: 'AURICOLARE', PENNARELLI: 'PENNARELLO', PUNTE: 'PUNTA', DISCHI: 'DISCO', LAME: 'LAMA', OCCHIALE: 'OCCHIALI' };
const VUOTE = new Set(['A', 'DA', 'DI', 'PER', 'IL', 'LA', 'LO', 'MM', 'D', 'TG', 'MT', 'G', 'GR', 'EX', 'DEL', 'DELLA', 'CON', 'IN', 'E', 'N', 'NR', 'PZ']);
function parole(t) {
  t = chiave(t).replace(/,/g, '.').replace(/(\d)\s*X\s*(\d)/g, '$1X$2');
  return (t.match(/\d+(?:\.\d+)?(?:X\d+(?:\.\d+)?)*|[A-Z]+/g) || []).map((p) => SINONIMI[p] || p).filter((p) => !VUOTE.has(p));
}
function numeri(pp) {
  const n = new Set();
  for (const p of pp) if (/^\d/.test(p)) for (const x of p.split('X')) n.add(x.includes('.') ? x.replace(/0+$/, '').replace(/\.$/, '') : x);
  return n;
}
const simili = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));
function rapporto(a, b) {          // come difflib.SequenceMatcher.ratio (Ratcliff/Obershelp)
  const conta = (a, b) => {
    if (!a || !b) return 0;
    let best = 0, ia = 0, ib = 0;
    const prev = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      let diag = 0;
      for (let j = 1; j <= b.length; j++) {
        const tmp = prev[j];
        prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
        if (prev[j] > best) { best = prev[j]; ia = i - best; ib = j - best; }
        diag = tmp;
      }
    }
    if (!best) return 0;
    return best + conta(a.slice(0, ia), b.slice(0, ib)) + conta(a.slice(ia + best), b.slice(ib + best));
  };
  return (a.length + b.length) ? 2 * conta(a, b) / (a.length + b.length) : 1;
}
export function somiglianza(pdf, as400) {
  const pa = parole(pdf), pb = parole(as400);
  if (!pa.length || !pb.length) return 0;
  const wa = pa.filter((p) => !/^\d/.test(p)), wb = pb.filter((p) => !/^\d/.test(p));
  const na = numeri(pa), nb = numeri(pb);
  const pw = wb.filter((x) => wa.some((y) => simili(x, y))).length / Math.max(1, wb.length);
  const comuni = [...nb].filter((x) => na.has(x)).length;
  const pn = nb.size ? comuni / nb.size : (na.size ? 0.8 : 1);
  let punti = 0.55 * pw + 0.30 * pn + 0.15 * rapporto(pa.join(' '), pb.join(' '));
  if (na.size && nb.size && !comuni) punti *= 0.6;
  return Math.round(100 * punti);
}

const pad = (n) => String(n).padStart(2, '0');
export function oggiIso(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function adessoIso(d = new Date()) { return `${oggiIso(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
export function itaIso(t) { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; }
export function isoIta(t) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : (t || ''); }
export function piuGiorni(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return oggiIso(d); }

// ------------------------------------------------------------------ lettura PDF
const TOLL_RIGA = 3, TOLL_COL = 2;
const RE_PERIODO = /DAL:\s*(\d{2}\/\d{2}\/\d{4})\s+AL:\s*(\d{2}\/\d{2}\/\d{4})/;

function quantita(t) {
  t = (t || '').trim();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return parseInt(t.replace(/\./g, ''), 10);
  return null;
}

function trovaColonne(riga) {
  const testi = riga.map((p) => p.text.toLowerCase());
  if (!testi.some((t) => t.startsWith('codice')) || !testi.some((t) => t.startsWith('quantit'))) return null;
  const chiavi = [['codice', 'codice'], ['descrizione', 'descrizione'], ['categoria', 'categoria'], ['tipo', 'tipo'], ['quantit', 'quantita']];
  const col = {};
  for (const p of riga) {
    const t = p.text.toLowerCase();
    for (const [pre, nome] of chiavi) if (t.startsWith(pre) && !(nome in col)) { col[nome] = p.x; break; }
  }
  return ('codice' in col && 'descrizione' in col && 'quantita' in col) ? col : null;
}

/** pagine: [[{text, x, y}]] con y crescente verso il basso. Ritorna {dal, al, righe, errori}. */
export function leggiParole(pagine) {
  const errori = [], righe = [];
  let dal = '', al = '', col = null, intestazione = false;
  pagine.forEach((parole, n) => {
    const nPag = n + 1;
    const gruppi = [];
    for (const p of [...parole].filter((p) => p.text.trim()).sort((a, b) => a.y - b.y || a.x - b.x)) {
      const ultimo = gruppi[gruppi.length - 1];
      if (ultimo && Math.abs(ultimo[0].y - p.y) <= TOLL_RIGA) ultimo.push(p); else gruppi.push([p]);
    }
    gruppi.forEach((g) => g.sort((a, b) => a.x - b.x));
    let iInt = -1;
    for (let i = 0; i < gruppi.length; i++) { const c = trovaColonne(gruppi[i]); if (c) { col = c; iInt = i; intestazione = true; break; } }
    for (let i = 0; i < gruppi.length; i++) {
      const riga = gruppi[i];
      const testo = riga.map((p) => p.text).join(' ').trim();
      if (!dal) { const m = RE_PERIODO.exec(testo); if (m) { dal = itaIso(m[1]); al = itaIso(m[2]); } }
      if (!col || (iInt >= 0 && i <= iInt)) continue;
      if (testo.startsWith('Stampato') || /^Pagina \d+ di \d+$/.test(testo)) break;
      const xD = col.descrizione - TOLL_COL, xC = (col.categoria ?? col.quantita) - TOLL_COL,
        xT = (col.tipo ?? col.quantita) - TOLL_COL, xQ = col.quantita - TOLL_COL;
      const unisci = (arr) => arr.map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim();
      const codice = unisci(riga.filter((p) => p.x < xD));
      const descr = unisci(riga.filter((p) => p.x >= xD && p.x < xC));
      const qTesto = unisci(riga.filter((p) => p.x >= xQ));
      if (!codice && !qTesto) {
        if (descr && righe.length && righe[righe.length - 1].pagina === nPag) righe[righe.length - 1].descrizione += ' ' + descr;
        else if (testo) errori.push(`Pagina ${nPag}: riga non riconosciuta «${testo}».`);
        continue;
      }
      if (!codice) { errori.push(`Pagina ${nPag}: quantità senza codice «${testo}».`); continue; }
      if (codice.includes(' ')) { errori.push(`Pagina ${nPag}: codice non chiaro «${codice}».`); continue; }
      const q = quantita(qTesto);
      if (q === null) { errori.push(`Pagina ${nPag}: quantità non valida per il codice ${codice} («${qTesto || 'vuota'}»).`); continue; }
      righe.push({ codice, descrizione: descr, categoria: unisci(riga.filter((p) => p.x >= xC && p.x < xT)), quantita: q, pagina: nPag });
    }
  });
  if (!intestazione) throw new Error('Non trovo la tabella con le colonne «Codice» e «Quantità»: il file non sembra un report «Totale articoli».');
  if (!dal) errori.push('Periodo DAL/AL non trovato nel PDF.');
  return { dal, al, righe, errori };
}

export async function leggiPdf(pdfjs, dati) {
  const compito = pdfjs.getDocument({ data: dati, isEvalSupported: false });
  const doc = await compito.promise;
  const pagine = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pag = await doc.getPage(i);
    const alt = pag.getViewport({ scale: 1 }).height;
    const tc = await pag.getTextContent();
    pagine.push(tc.items.filter((it) => it.str !== undefined).map((it) => ({ text: it.str, x: it.transform[4], y: alt - it.transform[5] })));
  }
  await compito.destroy();
  return leggiParole(pagine);
}

export async function sha256(dati) {
  const h = await crypto.subtle.digest('SHA-256', dati);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function leggiZip(JSZip, pdfjs, dati, nome) {
  const ris = { nome, sha: await sha256(dati), dal: '', al: '', righe: [], errori: [] };
  let zip;
  try { zip = await JSZip.loadAsync(dati); } catch { ris.errori.push('Il file non è un archivio ZIP valido.'); return ris; }
  const pdf = Object.values(zip.files).filter((f) => !f.dir && f.name.toLowerCase().endsWith('.pdf') && !f.name.startsWith('__MACOSX/'));
  if (!pdf.length) { ris.errori.push('Lo ZIP non contiene nessun PDF.'); return ris; }
  if (pdf.length > 1) { ris.errori.push(`Lo ZIP contiene ${pdf.length} PDF: ne è previsto uno solo.`); return ris; }
  try {
    const l = await leggiPdf(pdfjs, await pdf[0].async('uint8array'));
    Object.assign(ris, { dal: l.dal, al: l.al, righe: l.righe }); ris.errori.push(...l.errori);
  } catch (e) { ris.errori.push(e.message || String(e)); }
  return ris;
}

export function dataZip(nome, modificato = '') {
  const m = /(20\d{2})(\d{2})(\d{2})/.exec(nome || '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : (modificato || '').slice(0, 10);
}

// ------------------------------------------------------------------ barcode Code 128 (set B)
const P128 = ('212222,222122,222221,121223,121322,131222,122213,122312,132212,221213,221312,231212,112232,122132,122231,113222,123122,123221,223211,221132,221231,213212,223112,312131,311222,321122,321221,312212,322112,322211,212123,212321,232121,111323,131123,131321,112313,132113,132311,211313,231113,231311,112133,112331,132131,113123,113321,133121,313121,211331,231131,213113,213311,213131,311123,311321,331121,312113,312311,332111,314111,221411,431111,111224,111422,121124,121421,141122,141221,112214,112412,122114,122411,142112,142211,241211,221114,413111,241112,134111,111242,121142,121241,114212,124112,124211,411212,421112,421211,212141,214121,412121,111143,111341,131141,114113,114311,411113,411311,113141,114131,311141,411131,211412,211214,211232,2331112').split(',');
export function barre128(testo) {
  let s = P128[104], somma = 104;
  [...String(testo)].forEach((ch, i) => { let v = ch.charCodeAt(0) - 32; if (v < 0 || v > 94) v = 0; s += P128[v]; somma += v * (i + 1); });
  return s + P128[somma % 103] + P128[106];
}

// ------------------------------------------------------------------ dati
export function statoVuoto() {
  return {
    formato: 'distributore-web', versione: 1, prodotti: {}, abbinamenti: [], ignorate: [], movimenti: [],
    consumi: {}, zip: [], bozza: [], sospese: [], giorni_ignorati: [], rifornimenti: [], controlli: [], esiti_controlli: [], scorte_calcolate_il: '',
    impostazioni: { zip_partenza: '', drive_cartella_id: '', drive_cartella_nome: '' }, aggiornato: '',
  };
}

export function normalizza(s) {
  const v = Object.assign(statoVuoto(), s || {});
  v.impostazioni = Object.assign(statoVuoto().impostazioni, v.impostazioni || {});
  if (!v.rifornito_migrato) {
    // dati del programma del PC: gli ZIP importati prima dell'ultimo rifornimento stampato sono già riportati
    const ultimo = v.ultimo_documento || (String(v.esportato_da || '').includes('17/11/2026') ? '2026-11-13 12:23:59' : '');
    if (ultimo) for (const z of v.zip) if (!z.rifornito && (z.importato_il || '') <= ultimo) z.rifornito = ultimo;
    v.rifornito_migrato = true;
  }
  return v;
}

export class Gestionale {
  constructor(stato) { this.s = normalizza(stato); if (stato && !this.s.regola_magazzino) this._regolaNuovaMagazzino(); }

  /** Una volta sola: disfa gli spostamenti dal magazzino fatti con la regola vecchia (riempire fino al carico completo).
   *  Con la regola nuova il magazzino si tocca solo quando il distributore è a zero. Il totale non cambia. */
  _regolaNuovaMagazzino() {
    const ora = adessoIso(), per = {};
    for (const m of this.s.movimenti) {
      if (m.tipo === 'DAL_MAGAZZINO' && m.origine !== 'Rifornimento dal magazzino') per[m.codice] = (per[m.codice] || 0) + Number(m.quantita || 0);
      if (m.tipo === 'REGOLA_MAGAZZINO') per[m.codice] = (per[m.codice] || 0) + Number(m.quantita || 0);   // già disfatti: non due volte
    }
    let n = 0;
    for (const [codice, q] of Object.entries(per)) {
      const p = this.s.prodotti[codice];
      if (!p || !(q > 0)) continue;
      const prima = p.quantita;
      p.quantita -= q; p.magazzino = (p.magazzino || 0) + q;
      this._mov('REGOLA_MAGAZZINO', codice, p.descrizione, -q, prima, p.quantita, 'Regola nuova del magazzino',
        `${q} pezzi tornati in magazzino: li aveva spostati la regola vecchia. Il magazzino si usa solo quando il distributore è a zero.`, ora);
      n++;
    }
    this.s.regola_magazzino = 2;
    if (n) { this.riempiDaMagazzino('Regola nuova del magazzino'); this._tocca(); }
    this.s.regola_magazzino_articoli = n;
  }

  _id() { return (this.s.movimenti.reduce((m, x) => Math.max(m, x.id || 0), 0) || 0) + 1; }
  _mov(tipo, codice, descrizione, quantita, prima, dopo, origine, note = '', ora = adessoIso()) {
    const p = this.s.prodotti[codice];
    this.s.movimenti.push({ id: this._id(), data_ora: ora, tipo, codice, descrizione, quantita, prima, dopo, origine, note,
      mag: p ? (p.magazzino || 0) : null });          // magazzino DOPO il movimento
  }
  _tocca() { this.s.aggiornato = new Date().toISOString(); }

  prodotto(c) { return this.s.prodotti[c]; }
  elenco() {
    return Object.values(this.s.prodotti).map((p) => {
      const disp = (p.quantita || 0) + (p.magazzino || 0);
      return { ...p, disponibile: disp, sotto: p.scorta_minima != null && disp <= p.scorta_minima, negativo: p.quantita < 0 };
    }).sort((a, b) => a.codice.localeCompare(b.codice));
  }

  /** Articolo dal barcode letto: un barcode del produttore abbinato una volta, o il codice AS400 stesso. Altrimenti null. */
  trovaBarcode(testo) {
    const t = String(testo || '').trim();
    if (!t) return null;
    const ab = Object.values(this.s.prodotti).find((p) => (p.barcode || []).includes(t));
    if (ab) return ab.codice;
    const su = t.toUpperCase();
    return Object.keys(this.s.prodotti).find((c) => c.toUpperCase() === su) || null;
  }

  associaBarcode(codice, testo) {
    const p = this.s.prodotti[codice];
    if (!p) throw new Error('Articolo non trovato.');
    const t = String(testo).trim();
    for (const q of Object.values(this.s.prodotti)) if (q.barcode) q.barcode = q.barcode.filter((b) => b !== t);
    (p.barcode ||= []).push(t);
    this._tocca();
  }

  togliBarcode(codice, testo) {
    const p = this.s.prodotti[codice];
    if (p?.barcode) p.barcode = p.barcode.filter((b) => b !== testo);
    this._tocca();
  }

  /** Aggiunge o cambia un abbinamento PDF → AS400 (vale per i prossimi ZIP; quelli già importati non cambiano). */
  salvaAbbinamento(descrizionePdf, codicePdf, codice, chiaveVecchia = '') {
    const d = String(descrizionePdf || '').trim();
    if (!d) throw new Error('Scrivi la descrizione come è nel PDF.');
    if (!this.s.prodotti[codice]) throw new Error('Scegli il codice AS400.');
    const k = chiave(d);
    this.s.abbinamenti = this.s.abbinamenti.filter((a) => a.chiave !== k && (!chiaveVecchia || a.chiave !== chiaveVecchia));
    this.s.abbinamenti.push({ chiave: k, descrizione_pdf: d, codice_pdf: String(codicePdf || '').trim(), codice });
    this.s.ignorate = this.s.ignorate.filter((x) => x !== k);
    this._tocca();
    return true;
  }

  togliAbbinamento(k) { this.s.abbinamenti = this.s.abbinamenti.filter((a) => a.chiave !== k); this._tocca(); }

  /** Le descrizioni viste nei PDF (ZIP importati, storico, righe sospese) con il loro codice PDF. */
  descrizioniPdf() {
    const per = new Map();
    const metti = (d, cp) => { d = String(d || '').trim(); if (!d) return; const k = chiave(d); if (!per.has(k)) per.set(k, { chiave: k, descrizione_pdf: d, codice_pdf: String(cp || '') }); };
    for (const z of this.s.zip) for (const r of z.dettaglio || []) metti(r.d, r.cp);
    for (const m of this.s.movimenti) { const x = /PDF: (.*) \(cod\. PDF ([^)]*)\)/.exec(m.note || ''); if (x) metti(x[1], x[2]); }
    for (const x of this.s.sospese) metti(x.descrizione_pdf, x.codice_pdf);
    for (const a of this.s.abbinamenti) metti(a.descrizione_pdf, a.codice_pdf);
    return [...per.values()].sort((a, b) => a.descrizione_pdf.localeCompare(b.descrizione_pdf));
  }

  trovaCodice(descrizione, codicePdf) {
    const k = chiave(descrizione);
    const a = this.s.abbinamenti.find((x) => x.chiave === k) ||
      (codicePdf ? this.s.abbinamenti.find((x) => String(x.codice_pdf || '').trim() === String(codicePdf).trim()) : null);
    return a && this.s.prodotti[a.codice] ? a.codice : null;
  }

  /** Codici AS400 più probabili per una descrizione del PDF (stesso punteggio del programma). */
  suggerisci(descrizionePdf, quanti = 3) {
    return Object.values(this.s.prodotti).map((p) => ({ codice: p.codice, punti: somiglianza(descrizionePdf, p.descrizione) }))
      .filter((x) => x.punti >= 35).sort((a, b) => b.punti - a.punti || a.codice.localeCompare(b.codice)).slice(0, quanti);
  }

  /** Gli ultimi n giorni di prelievo (fino a ieri) con il loro ZIP: per la vista "a colpo d'occhio". */
  giorniZip(n = 7, oggi = oggiIso()) {
    const out = [];
    for (let i = n; i >= 1; i--) {
      const g = piuGiorni(oggi, -i);
      const zips = this.s.zip.filter((z) => !z.nascosto && z.dal && g >= z.dal && g <= (z.al || z.dal));
      const stato = zips.length ? (zips.some((z) => z.completo === false) ? 'controlla' : 'ok')
        : this.s.giorni_ignorati.includes(g) ? 'ignorato'
        : (this.s.impostazioni.zip_partenza && g < piuGiorni(this.s.impostazioni.zip_partenza, -1)) ? 'prima' : 'manca';
      out.push({ giorno: g, stato, zip: zips });
    }
    return out;
  }

  /** Righe di uno ZIP: quelle salvate all'importazione, o ricostruite dai movimenti per gli ZIP del programma. */
  dettaglioZip(nome) {
    const z = this.s.zip.find((x) => x.nome === nome);
    if (!z) return null;
    if (z.dettaglio) return { ...z, ricostruito: false };
    const righe = this.s.movimenti.filter((m) => m.origine === nome && (m.tipo === 'SCARICO_ZIP' || m.tipo === 'CONTROLLO_POSTO'))
      .map((m) => {
        const pdf = /PDF: (.*) \(cod\. PDF ([^)]*)\)/.exec(m.note || '');
        return { cp: pdf ? pdf[2] : '', d: pdf ? pdf[1] : m.descrizione, q: -m.quantita, cod: m.codice, esito: m.tipo === 'CONTROLLO_POSTO' ? 'controllo sul posto' : 'scaricata' };
      });
    const pezzi = righe.filter((r) => r.esito === 'scaricata').reduce((t, r) => t + r.q, 0);
    return { ...z, dettaglio: righe, pezzi, ricostruito: true };
  }

  /** Storia di un articolo, dal più recente: distributore e magazzino prima/dopo di ogni movimento.
   *  Il magazzino dei movimenti vecchi si ricostruisce all'indietro partendo da quello di oggi. */
  storiaArticolo(codice, quanti = 60) {
    const p = this.s.prodotti[codice];
    if (!p) return [];
    const movs = this.s.movimenti.filter((m) => m.codice === codice)
      .sort((a, b) => (b.data_ora || '').localeCompare(a.data_ora || '') || b.id - a.id);
    let mag = p.magazzino || 0, noto = true;
    const out = [];
    for (const m of movs) {
      let dMag = 0, sa = true;
      const nota = m.note || '';
      const corr = /magazzino (-?\d+) → (-?\d+)/i.exec(nota);
      if (m.tipo === 'ECCESSO_MAGAZZINO') dMag = -Number(m.quantita || 0);
      else if (m.tipo === 'DAL_MAGAZZINO') dMag = -Number(m.quantita || 0);
      else if (m.tipo === 'REINTEGRO_MAGAZZINO') dMag = Number(m.quantita || 0);
      else if (corr) dMag = Number(corr[2]) - Number(corr[1]);
      else if (/magazzino/i.test(nota) && (m.tipo === 'MODIFICA_MANUALE' || m.tipo === 'CORREZIONE_MAGAZZINO')) sa = false;
      if (m.mag != null) { mag = m.mag; noto = true; }
      const dopo = noto ? mag : null;
      const prima = noto && sa ? mag - dMag : null;
      // il distributore: per gli scarichi e i rifornimenti prima/dopo sono quelli del distributore
      const totale = m.tipo === 'CORREZIONE_MAGAZZINO' && !m.mag;
      out.push({ ...m, distr_prima: totale ? null : m.prima, distr_dopo: totale ? null : m.dopo, mag_prima: prima, mag_dopo: dopo, d_mag: sa ? dMag : null });
      if (!sa) noto = false; else mag = mag - dMag;
      if (out.length >= quanti) break;
    }
    return out;
  }

  /** Numeri per la scheda di un articolo: prelievi degli ultimi giorni e settimane, media e durata. */
  statistiche(codice, oggi = oggiIso()) {
    const p = this.s.prodotti[codice];
    if (!p) return null;
    const giorni = [];
    for (let i = 13; i >= 0; i--) { const g = piuGiorni(oggi, -i); giorni.push({ giorno: g, pezzi: (this.s.consumi[g] || {})[codice] || 0 }); }
    const d = new Date(oggi + 'T12:00:00');
    const lun = piuGiorni(oggi, -((d.getDay() + 6) % 7));
    const settimane = [];
    for (let i = 7; i >= 0; i--) {
      const da = piuGiorni(lun, -7 * i), a = piuGiorni(da, 6);
      let t = 0;
      for (const [g, c] of Object.entries(this.s.consumi)) if (g >= da && g <= a) t += c[codice] || 0;
      settimane.push({ dal: da, al: a, pezzi: t });
    }
    // media sui 28 giorni prima di oggi
    let t28 = 0;
    for (let i = 1; i <= 28; i++) t28 += (this.s.consumi[piuGiorni(oggi, -i)] || {})[codice] || 0;
    const media = t28 / 28;
    const disp = (p.quantita || 0) + (p.magazzino || 0);
    let ultimo = '';
    for (const [g, c] of Object.entries(this.s.consumi)) if (c[codice] && g > ultimo) ultimo = g;
    const rif = this.s.movimenti.filter((m) => m.codice === codice && m.tipo === 'RIFORNIMENTO').sort((a, b) => b.data_ora.localeCompare(a.data_ora))[0];
    return {
      giorni, settimane, media, disponibile: disp,
      durata: media > 0 ? Math.floor(disp / media) : null,
      ultimo_prelievo: ultimo, ultimo_rifornimento: rif ? rif.data_ora : '', pezzi_28: t28,
      abbinamenti: this.s.abbinamenti.filter((a) => a.codice === codice),
      in_rifornimento: (this.s.bozza.find((b) => b.codice === codice) || {}).quantita || 0,
    };
  }

  /** Calendario di un mese: per giorno (quello dei prelievi) gli ZIP, articoli e pezzi; verde = da riportare, rosso = riportato. */
  calendario(inizio, fine) {
    const giorni = {};
    for (const z of this.s.zip) {
      if (z.nascosto) continue;
      const g = z.al || z.dal;
      if (!g || g < inizio || g > fine) continue;
      const d = this.dettaglioZip(z.nome);
      const cod = new Set((d.dettaglio || []).filter((r) => r.cod && r.esito === 'scaricata').map((r) => r.cod));
      const x = (giorni[g] ||= { file: 0, riportati: 0, articoli: 0, pezzi: 0, zip: [] });
      x.file++; x.riportati += z.rifornito ? 1 : 0; x.articoli += cod.size; x.pezzi += d.pezzi || 0; x.zip.push(z.nome);
    }
    // i giorni più vecchi, senza ZIP salvato: dallo storico dei prelievi (già riportati)
    for (const [g, c] of Object.entries(this.s.consumi)) {
      if (g < inizio || g > fine || giorni[g]) continue;
      const v = Object.values(c).filter((q) => q > 0);
      if (v.length) giorni[g] = { file: 0, riportati: 0, articoli: v.length, pezzi: v.reduce((a, b) => a + b, 0), zip: [], storico: true };
    }
    for (const x of Object.values(giorni)) x.stato = x.storico || x.riportati === x.file ? 'riportato' : 'da_riportare';
    return giorni;
  }

  /** Prelievi di una settimana (da lunedì): per articolo i pezzi giorno per giorno. */
  prelieviSettimana(lunedi) {
    const giorni = [...Array(7)].map((_, i) => piuGiorni(lunedi, i));
    const per = {};
    giorni.forEach((g, i) => { for (const [cod, q] of Object.entries(this.s.consumi[g] || {})) { (per[cod] ||= Array(7).fill(0))[i] += q; } });
    const righe = Object.entries(per).map(([codice, gg]) => ({ codice, descrizione: (this.s.prodotti[codice] || {}).descrizione || '', giorni: gg, totale: gg.reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.totale - a.totale || a.codice.localeCompare(b.codice));
    return { giorni, righe, totale: righe.reduce((t, r) => t + r.totale, 0), perGiorno: giorni.map((_, i) => righe.reduce((t, r) => t + r.giorni[i], 0)) };
  }

  // ------------------------------------------------------------ CONTROLLO SUL POSTO
  // 1. al salvataggio i pezzi segnati NON si tolgono dal distributore: mancano già, si aggiungono solo al rifornimento;
  // 2. quando arriva lo ZIP di quel giorno, lo ZIP scarica il distributore come sempre; per gli articoli segnati
  //    i suoi prelievi sono gli stessi pezzi già messi nel rifornimento, quindi lì non si aggiungono una seconda volta;
  // 3. con lo ZIP di quel giorno il controllo si chiude: i pezzi segnati senza movimento nello ZIP sono l'ammanco,
  //    restano nel rifornimento e si tolgono dal distributore (mancano davvero).
  _bozzaMeno(codice, q) {
    const b = this.s.bozza.find((x) => x.codice === codice);
    if (!b) return;
    b.proposta = Math.max(0, b.proposta - q); b.quantita = Math.max(0, b.quantita - q);
    if (b.proposta <= 0 && b.quantita <= 0) this.s.bozza = this.s.bozza.filter((x) => x !== b);
  }
  _bozzaPiu(codice, q) {
    const p = this.s.prodotti[codice];
    let b = this.s.bozza.find((x) => x.codice === codice);
    if (b) { b.proposta += q; b.quantita += q; } else { b = { codice, descrizione: p.descrizione, proposta: q, quantita: q }; this.s.bozza.push(b); }
    this._quadraBlister(b);
  }
  _prelevatiFinoA(giorno, codice) {
    let t = 0;
    for (const z of this.s.zip) {
      if (z.rifornito || z.nascosto || !z.dal || z.dal > giorno) continue;
      for (const m of this.s.movimenti) if (m.tipo === 'SCARICO_ZIP' && m.origine === z.nome && m.codice === codice) t += -Number(m.quantita || 0);
    }
    return t;
  }
  _zipDelGiorno(giorno) { return [...this.s.zip].reverse().find((z) => !z.nascosto && z.dal && z.dal <= giorno && (z.al || z.dal) >= giorno); }

  controlliInAttesa() {
    const per = {};
    for (const c of this.s.controlli) if (c.stato === 'attesa') (per[c.data] ||= []).push(c);
    return Object.entries(per).sort(([a], [b]) => a.localeCompare(b)).map(([data, righe]) => ({ data, righe, pezzi: righe.reduce((t, r) => t + r.mancanti, 0) }));
  }

  salvaControllo(giorno, voci) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno || '')) throw new Error('Data del controllo non valida.');
    if (this.s.controlli.some((c) => c.data === giorno && c.stato === 'chiuso')) throw new Error('Il controllo di quel giorno è già stato confrontato con lo ZIP.');
    const pulite = Object.entries(voci || {}).map(([c, q]) => [c, Math.round(Number(q))]).filter(([, q]) => q > 0);
    for (const [c] of pulite) if (!this.s.prodotti[c]) throw new Error(`L'articolo ${c} non esiste.`);
    const ora = adessoIso(), gg = isoIta(giorno);
    this._annullaControllo(giorno, ora);
    let aggiunti = 0;
    for (const [codice, mancanti] of pulite) {
      const p = this.s.prodotti[codice];
      const b0 = this.s.bozza.find((x) => x.codice === codice), q0 = b0 ? b0.quantita : 0, pr0 = b0 ? b0.proposta : 0;
      this._bozzaPiu(codice, mancanti);
      const b1 = this.s.bozza.find((x) => x.codice === codice);   // con i blister la lista può crescere più dei pezzi segnati
      this._mov('CONTROLLO_POSTO', codice, p.descrizione, 0, p.quantita, p.quantita, `Controllo sul posto del ${gg}`, `Segnati ${mancanti} mancanti: aggiunti al rifornimento, il distributore lo scala lo ZIP`, ora);
      this.s.controlli.push({ data: giorno, codice, mancanti, aggiunti: mancanti, assorbiti: 0, stato: 'attesa', salvato_il: ora, in_lista: b1.quantita - q0, in_proposta: b1.proposta - pr0 });
      aggiunti += mancanti;
    }
    // se lo ZIP di quel giorno c'è già, confronto subito
    const z = this._zipDelGiorno(giorno);
    if (z) this._assorbiControlli(z.nome, z.dal, ora, z.al);
    const esiti = this._chiudiControlli(ora);
    this._tocca();
    return { articoli: pulite.length, tolti: 0, aggiunti, esiti };
  }

  eliminaControllo(giorno) { this._annullaControllo(giorno, adessoIso()); this._tocca(); }

  _annullaControllo(giorno, ora) {
    const righe = this.s.controlli.filter((c) => c.data === giorno && c.stato === 'attesa');
    for (const r of righe) {
      const p = this.s.prodotti[r.codice];
      if (r.aggiunti != null) {
        // tolgo dalla lista quello che il controllo ci aveva messo (blister compresi); la parte già coperta dallo ZIP resta
        const b = this.s.bozza.find((x) => x.codice === r.codice), ass = r.assorbiti || 0;
        if (b) {
          b.quantita = Math.max(0, b.quantita - Math.max(0, (r.in_lista ?? r.aggiunti ?? 0) - ass));
          b.proposta = Math.max(0, b.proposta - Math.max(0, (r.in_proposta ?? r.aggiunti ?? 0) - ass));
          if (b.quantita <= 0 && b.proposta <= 0) this.s.bozza = this.s.bozza.filter((x) => x !== b);
        }
        if (p) this._mov('CONTROLLO_POSTO', r.codice, p.descrizione, 0, p.quantita, p.quantita, `Controllo sul posto del ${isoIta(giorno)}`, 'Controllo cambiato o eliminato: tolti dal rifornimento', ora);
      } else if (p) {   // controlli salvati con la regola vecchia (pezzi tolti subito)
        const netto = (r.scalati || 0) - (r.assorbiti || 0);
        if (netto) { const prima = p.quantita; p.quantita += netto; this._bozzaMeno(r.codice, netto); this._mov('CONTROLLO_POSTO', r.codice, p.descrizione, netto, prima, p.quantita, `Controllo sul posto del ${isoIta(giorno)}`, 'Controllo eliminato: pezzi rimessi', ora); }
      }
    }
    this.s.controlli = this.s.controlli.filter((c) => !(c.data === giorno && c.stato === 'attesa'));
  }

  /** Arriva uno ZIP: per gli articoli segnati nel controllo di uno dei suoi giorni, i suoi prelievi erano già nel rifornimento. */
  _assorbiControlli(nomeZip, dal, ora, al) {
    if (!dal) return;
    const fine = al || dal;
    for (const r of this.s.controlli) {
      if (r.stato !== 'attesa' || r.data < dal || r.data > fine) continue;
      const base = r.aggiunti != null ? r.aggiunti : (r.scalati || 0);
      if (!(base > (r.assorbiti || 0))) continue;
      const pre = this.s.movimenti.filter((m) => m.tipo === 'SCARICO_ZIP' && m.origine === nomeZip && m.codice === r.codice).reduce((t, m) => t - Number(m.quantita || 0), 0);
      const gia = (r.da_zip || {})[nomeZip] || 0;
      const assorbi = Math.min(base - (r.assorbiti || 0), pre - gia);
      if (assorbi <= 0) continue;
      const p = this.s.prodotti[r.codice];
      this._bozzaMeno(r.codice, assorbi);
      if (r.aggiunti == null) { const prima = p.quantita; p.quantita += assorbi; this._mov('CONTROLLO_POSTO', r.codice, p.descrizione, assorbi, prima, p.quantita, nomeZip, `Già tolti dal controllo sul posto del ${isoIta(r.data)}`, ora); }
      else this._mov('CONTROLLO_POSTO', r.codice, p.descrizione, 0, p.quantita, p.quantita, nomeZip, `${assorbi} prelevati nello ZIP: erano già nel rifornimento dal controllo del ${isoIta(r.data)}`, ora);
      r.assorbiti = (r.assorbiti || 0) + assorbi;
      (r.da_zip ||= {})[nomeZip] = gia + assorbi;
    }
  }

  _chiudiControlli(ora) {
    const esiti = [];
    const giorni = [...new Set(this.s.controlli.filter((c) => c.stato === 'attesa').map((c) => c.data))].sort();
    for (const giorno of giorni) {
      const z = this._zipDelGiorno(giorno);
      if (!z) continue;
      let coperti = 0; const ammanchi = [];
      for (const r of this.s.controlli.filter((c) => c.data === giorno && c.stato === 'attesa')) {
        const base = r.aggiunti != null ? r.aggiunti : (r.scalati || 0);
        const amm = base - (r.assorbiti || 0);
        const pre = r.mancanti - amm;
        if (amm > 0) {
          ammanchi.push({ codice: r.codice, descrizione: (this.s.prodotti[r.codice] || {}).descrizione || '', pezzi: amm, mancanti: r.mancanti, prelevati: pre });
          // mancano davvero ma nessuno ZIP li ha scaricati: si tolgono dal distributore (nel rifornimento ci sono già)
          const p = this.s.prodotti[r.codice];
          if (p && r.aggiunti != null) { const prima = p.quantita; p.quantita -= amm; this._mov('CONTROLLO_POSTO', r.codice, p.descrizione, -amm, prima, p.quantita, z.nome, `Ammanco del controllo del ${isoIta(giorno)}: ${amm} mancanti senza prelievo nello ZIP`, ora); }
        } else coperti++;
        Object.assign(r, { stato: 'chiuso', prelevati: pre, ammanco: amm, zip: z.nome, chiuso_il: ora });
      }
      esiti.push({ data: giorno, zip: z.nome, coperti, ammanchi, visto: false });
    }
    if (esiti.length) { this.s.esiti_controlli = [...this.s.esiti_controlli, ...esiti].slice(-20); this.riempiDaMagazzino('Dopo il controllo sul posto'); }
    return esiti;
  }

  // ------------------------------------------------------------ RIEPILOGO DELLA SETTIMANA (come il programma)
  riepilogoSettimana(oggi = oggiIso()) {
    const d = new Date(oggi + 'T12:00:00');
    const lunedi = piuGiorni(oggi, -((d.getDay() + 6) % 7) - 7), domenica = piuGiorni(lunedi, 6);
    const primaDal = piuGiorni(lunedi, -7), primaAl = piuGiorni(lunedi, -1);
    const somma = (da, a) => { let t = 0; for (const [g, c] of Object.entries(this.s.consumi)) if (g >= da && g <= a) for (const v of Object.values(c)) t += v; return t; };
    const pezzi = somma(lunedi, domenica), pezziPrima = somma(primaDal, primaAl);
    const w = this.prelieviSettimana(lunedi);
    const rif = this.s.rifornimenti.filter((r) => r.data_ora.slice(0, 10) >= lunedi && r.data_ora.slice(0, 10) <= domenica);
    const rifProgramma = new Set(this.s.movimenti.filter((m) => m.tipo === 'RIFORNIMENTO' && m.data_ora.slice(0, 10) >= lunedi && m.data_ora.slice(0, 10) <= domenica && !this.s.rifornimenti.some((r) => r.data_ora === m.data_ora)).map((m) => m.data_ora));
    const isoW = (() => { const t = new Date(lunedi + 'T12:00:00'); t.setDate(t.getDate() + 3); const a = t.getFullYear(); const s1 = new Date(a, 0, 4); return `${a}-${String(1 + Math.round(((t - s1) / 86400000 - 3 + ((s1.getDay() + 6) % 7)) / 7)).padStart(2, '0')}`; })();
    return {
      settimana: isoW, dal: lunedi, al: domenica, pezzi, pezzi_prima: pezziPrima,
      variazione: pezziPrima ? Math.round((pezzi - pezziPrima) * 100 / pezziPrima) : null,
      articoli: w.righe.length, giorni: w.giorni.map((g, i) => ({ giorno: g, pezzi: w.perGiorno[i] })),
      piu_prelevati: w.righe.slice(0, 5), rifornimenti: rif.length + rifProgramma.size,
      pezzi_riforniti: rif.reduce((t, r) => t + r.pezzi, 0) + this.s.movimenti.filter((m) => m.tipo === 'RIFORNIMENTO' && rifProgramma.has(m.data_ora)).reduce((t, m) => t + m.quantita, 0),
      giorni_mancanti: this.giorniMancanti(oggi).filter((g) => g >= lunedi && g <= domenica),
      sotto_scorta: this.elenco().filter((p) => p.sotto).length,
    };
  }

  // ------------------------------------------------------------ annullamenti
  /** Annulla l'ultimo rifornimento: i pezzi riportati tornano fuori e la bozza torna com'era. */
  /** I rifornimenti fatti (anche quello del programma del PC), dal più recente: si riconoscono dai movimenti. */
  eventiRifornimento() {
    const per = new Map();
    this.s.movimenti.forEach((m, i) => {
      const daScaffale = m.tipo === 'DAL_MAGAZZINO' && m.rif;
      if ((m.tipo !== 'RIFORNIMENTO' && !daScaffale) || !(Number(m.quantita) > 0) || m.annullato || m.origine === 'Rifornimento annullato') return;
      const k = m.rif || m.data_ora;
      const e = per.get(k) || { chiave: k, data_ora: m.data_ora, codici: new Set(), pezzi: 0, ordine: i };
      e.ordine = Math.min(e.ordine, i); e.codici.add(m.codice); e.pezzi += Number(m.quantita); per.set(k, e);
    });
    return [...per.values()].map(({ codici, ...e }) => ({ ...e, articoli: codici.size })).sort((a, b) => b.ordine - a.ordine)
      .map((e) => ({ ...e, app: this.s.rifornimenti.some((r) => (r.id || r.data_ora) === e.chiave || r.data_ora === e.data_ora) }));
  }

  /** Ripristina da un rifornimento: lui e quelli dopo si disfano, i loro pezzi tornano nel rifornimento da fare
   *  e gli ZIP che coprivano tornano liberi. Quello che c'è prima resta com'è (storico). */
  ripristinaDa(chiave) {
    const ev = this.eventiRifornimento(), quale = ev.find((e) => e.chiave === chiave);
    if (!quale) throw new Error('Rifornimento non trovato.');
    const ora = adessoIso(), da = ev.filter((e) => e.ordine >= quale.ordine);
    if (da.some((e) => !e.app)) throw new Error('Il rifornimento fatto col programma del PC resta nello storico: si può ripristinare solo da quelli fatti con l\'app.');
    let pezzi = 0;
    for (const e of da) {
      const suoi = (m) => (m.rif || m.data_ora) === e.chiave && !m.annullato;
      // quanto di quel rifornimento era andato in magazzino, articolo per articolo
      const ecc = {};
      for (const m of this.s.movimenti.filter((x) => x.tipo === 'ECCESSO_MAGAZZINO' && suoi(x))) { ecc[m.codice] = (ecc[m.codice] || 0) - Number(m.quantita); m.annullato = true; }
      for (const m of this.s.movimenti.filter((x) => x.tipo === 'RIFORNIMENTO' && Number(x.quantita) > 0 && suoi(x))) {
        const p = this.s.prodotti[m.codice]; m.annullato = true; if (!p) continue;
        // i pezzi non sono mai stati riportati: escono prima dal magazzino (la parte che ci era andata, se c'è ancora), poi dal distributore
        const q = Number(m.quantita), daMag = Math.min(p.magazzino || 0, ecc[m.codice] || 0);
        ecc[m.codice] = (ecc[m.codice] || 0) - daMag;
        const prima = p.quantita; p.magazzino = (p.magazzino || 0) - daMag; p.quantita -= q - daMag; pezzi += q;
        this._mov('RIFORNIMENTO', m.codice, p.descrizione, -q, prima, p.quantita, 'Rifornimento annullato', `Ripristinato il rifornimento del ${isoIta(e.data_ora.slice(0, 10))}: i pezzi tornano da riportare`, ora);
        const b = this.s.bozza.find((x) => x.codice === m.codice);   // torna con la quantità che avevi stampato
        if (b) { b.quantita += q; b.proposta += q; } else this.s.bozza.push({ codice: m.codice, descrizione: p.descrizione, proposta: q, quantita: q });
      }
      for (const m of this.s.movimenti.filter((x) => x.tipo === 'DAL_MAGAZZINO' && x.rif && Number(x.quantita) > 0 && suoi(x))) {
        const p = this.s.prodotti[m.codice]; m.annullato = true; if (!p) continue;
        const q = Number(m.quantita), prima = p.quantita;
        p.quantita -= q; p.magazzino = (p.magazzino || 0) + q; pezzi += q;
        this._mov('DAL_MAGAZZINO', m.codice, p.descrizione, -q, prima, p.quantita, 'Rifornimento annullato', `Ripristinato il rifornimento del ${isoIta(e.data_ora.slice(0, 10))}: ${q} pezzi tornano sullo scaffale`, ora);
        const b = this.s.bozza.find((x) => x.codice === m.codice);
        if (b) { b.quantita += q; b.proposta += q; } else this.s.bozza.push({ codice: m.codice, descrizione: p.descrizione, proposta: q, quantita: q });
      }
      for (const z of this.s.zip) if (z.rifornito === e.data_ora) delete z.rifornito;
      this.s.rifornimenti = this.s.rifornimenti.filter((r) => (r.id || r.data_ora) !== e.chiave && r.data_ora !== e.data_ora);
    }
    this.riempiDaMagazzino('Dopo il ripristino del rifornimento');
    this._tocca();
    return { rifornimenti: da.length, pezzi, dal: quale.data_ora };
  }

  annullaUltimoRifornimento() {
    const e = this.eventiRifornimento()[0];
    if (!e) throw new Error('Nessun rifornimento da annullare.');
    return this.ripristinaDa(e.chiave);
  }

  svuotaBozza() { this.s.bozza = []; this._tocca(); }

  _riportaEccesso(codice, ora, origine) {
    const p = this.s.prodotti[codice];
    if (!p || p.carico_completo == null || p.quantita <= p.carico_completo) return;
    const ecc = p.quantita - p.carico_completo, pr = p.quantita;
    p.quantita = p.carico_completo; p.magazzino = (p.magazzino || 0) + ecc;
    this._mov('ECCESSO_MAGAZZINO', codice, p.descrizione, -ecc, pr, p.quantita, origine, `${ecc} pezzi oltre il carico completo spostati in magazzino (ora ${p.magazzino})`, ora);
  }

  /** Annulla uno ZIP importato: i pezzi tornano nel distributore, via dal rifornimento e dai consumi. */
  annullaZip(nome) {
    const z = this.s.zip.find((x) => x.nome === nome && !x.eliminato);
    if (!z) throw new Error('ZIP non trovato.');
    if (z.rifornito) throw new Error('Questo ZIP è già in un rifornimento fatto: annullarlo rimetterebbe pezzi già rimessi.');
    if (z.storico) throw new Error('È uno ZIP dello storico: non ha toccato le giacenze.');
    const ora = adessoIso();
    const scarichi = this.s.movimenti.filter((m) => m.origine === nome && m.tipo === 'SCARICO_ZIP');
    const per = {};
    for (const m of scarichi) per[m.codice] = (per[m.codice] || 0) - Number(m.quantita || 0);
    for (const [codice, q] of Object.entries(per)) {
      const p = this.s.prodotti[codice]; if (!p || !q) continue;
      const prima = p.quantita; p.quantita += q;
      this._mov('ZIP_ELIMINATO', codice, p.descrizione, q, prima, p.quantita, nome, 'ZIP annullato: pezzi rimessi nel distributore', ora);
      this._bozzaMeno(codice, q);
      const cons = z.consumi ? z.consumi[codice] || 0 : q;
      const giorno = z.dal || '';
      if (giorno && this.s.consumi[giorno] && this.s.consumi[giorno][codice]) {
        this.s.consumi[giorno][codice] = Math.max(0, this.s.consumi[giorno][codice] - cons);
        if (!this.s.consumi[giorno][codice]) delete this.s.consumi[giorno][codice];
      }
    }
    // controllo sul posto: si disfa quello che questo ZIP aveva fatto e i controlli chiusi da lui si riaprono
    for (const m of this.s.movimenti.filter((x) => x.origine === nome && x.tipo === 'CONTROLLO_POSTO' && Number(x.quantita))) {
      const p = this.s.prodotti[m.codice]; if (!p) continue;
      const prima = p.quantita; p.quantita -= m.quantita;
      this._mov('CONTROLLO_POSTO', m.codice, p.descrizione, -m.quantita, prima, p.quantita, nome, 'ZIP annullato: si disfa il confronto col controllo sul posto', ora);
      if (m.quantita > 0) this._bozzaPiu(m.codice, m.quantita);   // regola vecchia
    }
    for (const c of this.s.controlli) {
      if (c.da_zip && c.da_zip[nome]) { if (c.aggiunti != null) this._bozzaPiu(c.codice, c.da_zip[nome]); c.assorbiti = Math.max(0, (c.assorbiti || 0) - c.da_zip[nome]); delete c.da_zip[nome]; }
      if (c.stato === 'chiuso' && c.zip === nome) Object.assign(c, { stato: 'attesa', zip: '', prelevati: null, ammanco: null, chiuso_il: '' });
    }
    this.s.esiti_controlli = this.s.esiti_controlli.filter((e) => e.zip !== nome);
    this.s.sospese = this.s.sospese.filter((x) => x.nome_zip !== nome);
    for (const codice of Object.keys(per)) this._riportaEccesso(codice, ora, 'ZIP annullato');
    Object.assign(z, { eliminato: true, nascosto: true, eliminato_il: ora });
    this._tocca();
    return { articoli: Object.keys(per).length, pezzi: Object.values(per).reduce((a, b) => a + b, 0) };
  }

  /** STORICO: ZIP vecchi solo per statistiche e scorte; non toccano giacenze, rifornimento né calendario. */
  importaStorico(letto) {
    if (letto.errori.length && !letto.righe.length) return { ok: false, errori: letto.errori };
    if (this.s.zip.find((z) => z.nome === letto.nome || (letto.sha && z.sha === letto.sha))) return { ok: false, gia: true, errori: [] };
    if (!letto.dal) return { ok: false, errori: ['Nel PDF non trovo il giorno dei prelievi.'] };
    const ora = adessoIso();
    let pezzi = 0; const consumi = {};
    for (const r of letto.righe) {
      const codice = this.trovaCodice(r.descrizione, r.codice);
      if (!codice) continue;
      const c = (this.s.consumi[letto.dal] ||= {});
      c[codice] = (c[codice] || 0) + r.quantita; consumi[codice] = (consumi[codice] || 0) + r.quantita; pezzi += r.quantita;
      this._mov('STORICO_IMPORTATO', codice, this.s.prodotti[codice].descrizione, -r.quantita, null, null, letto.nome, 'Storico', `${letto.dal} 12:00:00`);
    }
    this.s.zip.push({ nome: letto.nome, sha: letto.sha, dal: letto.dal, al: letto.al, importato_il: ora, righe: letto.righe.length, pezzi, storico: true, nascosto: true, consumi });
    this._tocca();
    return { ok: true, pezzi, righe: letto.righe.length };
  }

  // ------------------------------------------------------------ magazzino e inventario
  caricaInMagazzino(codice, q, nota = '') {
    const p = this.s.prodotti[codice];
    if (!p) throw new Error(`L'articolo ${codice} non esiste.`);
    q = Math.round(Number(q));
    if (!(q > 0)) throw new Error('Scrivi quanti pezzi.');
    const ora = adessoIso();
    p.magazzino = (p.magazzino || 0) + q;
    this._mov('REINTEGRO_MAGAZZINO', codice, p.descrizione, q, p.quantita, p.quantita, 'Carico in magazzino', nota || `${q} pezzi nuovi in magazzino (ora ${p.magazzino})`, ora);
    this.riempiDaMagazzino('Dopo il carico in magazzino');
    this._tocca();
  }

  /** Inventario: conteggi {codice: {distributore, magazzino}} applicati tutti insieme. */
  /** Inventario col totale contato: fino al carico completo è distributore, quello che va oltre è magazzino. */
  applicaInventarioTotale(totali) {
    const conti = {};
    for (const [codice, v] of Object.entries(totali || {})) {
      const p = this.s.prodotti[codice]; if (!p || v === '' || v == null) continue;
      const t = Math.max(0, Math.round(Number(v)));
      const d = p.carico_completo != null ? Math.min(t, p.carico_completo) : t;
      conti[codice] = { distributore: d, magazzino: t - d };
    }
    return this.applicaInventario(conti);
  }

  applicaInventario(conti) {
    const ora = adessoIso();
    let n = 0;
    for (const [codice, c] of Object.entries(conti || {})) {
      const p = this.s.prodotti[codice]; if (!p) continue;
      const d = c.distributore === '' || c.distributore == null ? null : Math.round(Number(c.distributore));
      const m = c.magazzino === '' || c.magazzino == null ? null : Math.round(Number(c.magazzino));
      if (d != null && d !== p.quantita) { this._mov('MODIFICA_MANUALE', codice, p.descrizione, d - p.quantita, p.quantita, d, 'Inventario', `Contati ${d} nel distributore`, ora); p.quantita = d; n++; }
      if (m != null && m !== (p.magazzino || 0)) { const pm = p.magazzino || 0; p.magazzino = m; this._mov('CORREZIONE_MAGAZZINO', codice, p.descrizione, m - pm, p.quantita, p.quantita, 'Inventario', `Magazzino ${pm} → ${m}`, ora); n++; }
    }
    this.riempiDaMagazzino('Dopo l\'inventario');
    this._tocca();
    return n;
  }

  azzeraGiacenze() {
    const ora = adessoIso();
    for (const p of Object.values(this.s.prodotti)) {
      if (p.quantita || p.magazzino) this._mov('CANCELLAZIONE_INVENTARIO', p.codice, p.descrizione, -p.quantita, p.quantita, 0, 'Azzera giacenze', `Magazzino ${p.magazzino || 0} → 0`, ora);
      p.quantita = 0; p.magazzino = 0;
    }
    this._tocca();
  }

  eliminaArticolo(codice) {
    if (!this.s.prodotti[codice]) throw new Error('Articolo non trovato.');
    const p = this.s.prodotti[codice];
    this._mov('ARTICOLO_ELIMINATO', codice, p.descrizione, -p.quantita, p.quantita, 0, 'Elimina articolo', `Magazzino ${p.magazzino || 0}`);
    delete this.s.prodotti[codice];
    this.s.abbinamenti = this.s.abbinamenti.filter((a) => a.codice !== codice);
    this.s.bozza = this.s.bozza.filter((b) => b.codice !== codice);
    this._tocca();
  }

  _consumoTra(codice, da, a) { let t = 0; for (const [g, c] of Object.entries(this.s.consumi)) if (g >= da && g <= a) t += c[codice] || 0; return t; }

  /** Scorte minime come il programma: 7 giorni del consumo medio degli ultimi 30 (forza),
   *  poi ogni 7 giorni la soglia segue la variazione del consumo rispetto ai 7 giorni prima. */
  ricalcolaScorte(forza = false, oggi = oggiIso()) {
    const ultimo = this.s.scorte_calcolate_il;
    if (!forza && ultimo && (new Date(oggi) - new Date(ultimo)) / 86400000 < 7) return 0;
    let n = 0;
    for (const p of Object.values(this.s.prodotti)) {
      let valore = null;
      if (forza || !ultimo) {
        const q = this._consumoTra(p.codice, piuGiorni(oggi, -30), oggi);
        if (q > 0) valore = Math.max(1, Math.ceil(q / 30 * 7));
      } else {
        const q = this._consumoTra(p.codice, piuGiorni(oggi, -6), oggi), prima = this._consumoTra(p.codice, piuGiorni(oggi, -13), piuGiorni(oggi, -7));
        if (q > 0) valore = p.scorta_minima != null && prima > 0 ? Math.max(1, Math.ceil(p.scorta_minima * q / prima)) : Math.max(1, Math.ceil(q / 7 * 7));
      }
      if (valore != null && valore !== p.scorta_minima) { p.scorta_minima = valore; p.scorta_fonte = 'calcolo'; n++; }
    }
    this.s.scorte_calcolate_il = oggi;
    this._tocca();
    return n;
  }

  /** Consigli del programma: articoli in aumento (porta giù di più) e articoli fermi (non riportarne). */
  consiglio(codice, oggi = oggiIso()) { return this.consiglioInfo(codice, oggi)?.testo || ''; }

  /** Andamento di un articolo: ultimi 10 giorni contro i 10 prima.
   *  Conta solo l'AUMENTO: il consumo normale lo riporti già col rifornimento. Se si usa almeno il 25% in più,
   *  il consiglio è l'aumento al giorno × 3 giorni, a spire (o blister) intere. Sotto i 2 pezzi niente. */
  andamento(codice, oggi = oggiIso()) {
    const p = this.s.prodotti[codice];
    if (!p) return null;
    const passo = p.in_blister && p.pezzi_blister ? p.pezzi_blister : (p.pezzi_spira || 1);
    const u10 = this._consumoTra(codice, piuGiorni(oggi, -9), oggi), p10 = this._consumoTra(codice, piuGiorni(oggi, -19), piuGiorni(oggi, -10));
    const media = u10 / 10, aumento = Math.max(0, u10 - p10) / 10;   // pezzi in più al giorno
    const sale = u10 > p10 && (p10 === 0 || u10 >= p10 * 1.25), perc = p10 > 0 ? Math.round((u10 / p10 - 1) * 100) : (u10 > 0 ? 100 : 0);
    const tre = Math.ceil(aumento * 3 - 1e-9);
    const extra = sale && tre >= 2 ? Math.ceil(tre / passo) * passo : 0;
    return { codice, u10, p10, media, aumento, perc, sale, extra };
  }

  /** Come consiglio(), ma con i numeri: { tipo: 'piu' | 'fermo', extra, perc, testo }. */
  consiglioInfo(codice, oggi = oggiIso()) {
    const p = this.s.prodotti[codice];
    if (!p) return null;
    const a = this.andamento(codice, oggi);
    if (a && a.extra) {
      const m = Math.round(a.aumento * 10) / 10;
      return { tipo: 'piu', extra: a.extra, perc: a.perc, testo: `Ultimi 10 giorni ${a.u10} pezzi contro ${a.p10} dei 10 prima: ${m.toString().replace('.', ',')} in più al giorno. Porta giù ${a.extra} pezzi in più (3 giorni dell'aumento).` };
    }
    const disp = (p.quantita || 0) + (p.magazzino || 0);
    const giorniStoria = Object.keys(this.s.consumi).sort()[0];
    if (disp > 0 && giorniStoria && (new Date(oggi) - new Date(giorniStoria)) / 86400000 >= 180) {
      const c180 = this._consumoTra(codice, piuGiorni(oggi, -180), oggi);
      if (c180 === 0) return { tipo: 'fermo', extra: 0, testo: `Fermo da 6 mesi: ci sono ${disp} pezzi, non riportarne ora.` };
      const alMese = c180 / 6;
      if (alMese <= 0.2 && disp / alMese >= 6) return { tipo: 'fermo', extra: 0, testo: `Si muove poco (${c180} pezzi in 6 mesi): ci sono ${disp} pezzi, bastano per circa ${Math.floor(disp / alMese)} mesi. Non riportarne ora.` };
    }
    return null;
  }

  /** Pezzi al giorno degli ultimi n giorni (dal più vecchio a oggi); senza codice = tutti gli articoli. */
  serieGiorni(codice = null, n = 20, oggi = oggiIso()) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = piuGiorni(oggi, -i), c = this.s.consumi[d] || {};
      out.push({ d, q: codice ? (c[codice] || 0) : Object.values(c).reduce((t, x) => t + (x || 0), 0) });
    }
    return out;
  }

  /** Più prelevati degli ultimi 10 giorni, con andamento e consiglio. */
  tendenze(oggi = oggiIso()) {
    return Object.keys(this.s.prodotti).map((k) => this.andamento(k, oggi)).filter((a) => a && (a.u10 > 0 || a.p10 > 0))
      .sort((a, b) => b.u10 - a.u10 || b.perc - a.perc);
  }

  /** Tutti gli articoli con un consiglio, i più in aumento per primi. */
  consigli(oggi = oggiIso()) {
    return Object.keys(this.s.prodotti).map((codice) => ({ codice, ...(this.consiglioInfo(codice, oggi) || {}) })).filter((c) => c.tipo)
      .sort((a, b) => (a.tipo === b.tipo ? (b.perc || 0) - (a.perc || 0) : a.tipo === 'piu' ? -1 : 1));
  }

  /** Aggiunge alla lista i pezzi consigliati (una volta sola per articolo in questo giro). */
  applicaConsiglio(codice) {
    const c = this.consiglioInfo(codice), p = this.s.prodotti[codice];
    if (!c || !p) return 0;
    let b = this.s.bozza.find((x) => x.codice === codice);
    if (c.tipo === 'fermo') { if (b) b.quantita = 0; this._tocca(); return 0; }
    if (b && b.consiglio_aggiunto) return 0;
    if (!b) { b = { codice, descrizione: p.descrizione, proposta: 0, quantita: 0 }; this.s.bozza.push(b); }
    b.quantita += c.extra; b.consiglio_aggiunto = c.extra;
    this._tocca();
    return c.extra;
  }

  riabilitaDescrizione(k) { this.s.ignorate = this.s.ignorate.filter((x) => x !== k); this._tocca(); }

  cancellaStoricoMese(mese) {
    const prima = this.s.movimenti.length;
    this.s.movimenti = this.s.movimenti.filter((m) => !(m.data_ora || '').startsWith(mese));
    this._tocca();
    return prima - this.s.movimenti.length;
  }

  zipGiaImportato(nome, sha) { return this.s.zip.find((z) => !z.eliminato && ((sha && z.sha === sha) || z.nome === nome)); }

  /** Applica uno ZIP letto con leggiZip. Ritorna un riepilogo. */
  importaZip(letto, driveId = '') {
    const ora = adessoIso();
    if (letto.errori.length && !letto.righe.length) return { ok: false, errori: letto.errori };
    if (this.zipGiaImportato(letto.nome, letto.sha)) return { ok: false, gia: true, errori: [] };
    this.s.zip = this.s.zip.filter((z) => !(z.eliminato && (z.nome === letto.nome || (letto.sha && z.sha === letto.sha))));
    let pezzi = 0, sospese = 0, ignorati = 0, pezziSospesi = 0;
    const dettaglio = [];
    this._consumiZip = {};
    for (const r of letto.righe) {
      const k = chiave(r.descrizione);
      const riga = { cp: r.codice, d: r.descrizione, q: r.quantita, cod: '', esito: '' };
      dettaglio.push(riga);
      if (this.s.ignorate.includes(k)) { riga.esito = 'ignorata'; ignorati += r.quantita; continue; }
      const codice = this.trovaCodice(r.descrizione, r.codice);
      if (!codice) {
        this.s.sospese.push({ chiave: k, descrizione_pdf: r.descrizione, codice_pdf: r.codice, quantita: r.quantita, nome_zip: letto.nome, dal: letto.dal, al: letto.al });
        riga.esito = 'da abbinare'; sospese++; pezziSospesi += r.quantita; continue;
      }
      riga.cod = codice; riga.esito = 'scaricata';
      this._scarica(codice, r.quantita, letto, ora, r);
      pezzi += r.quantita;
    }
    const pezziPdf = letto.righe.reduce((t, r) => t + r.quantita, 0);
    const completo = !letto.errori.length && pezziPdf === pezzi + pezziSospesi + ignorati;
    this.s.zip.push({ nome: letto.nome, sha: letto.sha, dal: letto.dal, al: letto.al, importato_il: ora, righe: letto.righe.length,
      pezzi, pezzi_pdf: pezziPdf, sospesi: pezziSospesi, ignorati, errori: letto.errori, completo, dettaglio, drive: driveId, consumi: this._consumiZip });
    this._assorbiControlli(letto.nome, letto.dal, ora, letto.al);
    const esitiControlli = this._chiudiControlli(ora);
    this.riempiDaMagazzino('Dopo lo scarico degli ZIP');
    this._tocca();
    return { ok: true, pezzi, pezzi_pdf: pezziPdf, righe: letto.righe.length, sospese, completo, errori: letto.errori, controlli: esitiControlli };
  }

  _scarica(codice, q, letto, ora, riga = null) {
    const p = this.s.prodotti[codice];
    const prima = p.quantita;
    p.quantita -= q;
    const nota = [letto.dal ? `Periodo ${isoIta(letto.dal)}` : '', riga ? `PDF: ${riga.descrizione} (cod. PDF ${riga.codice})` : ''].filter(Boolean).join(' · ');
    this._mov('SCARICO_ZIP', codice, p.descrizione, -q, prima, p.quantita, letto.nome, nota, ora);
    const giorno = letto.dal || oggiIso();
    const c = (this.s.consumi[giorno] ||= {});
    c[codice] = (c[codice] || 0) + q;
    (this._consumiZip ||= {})[codice] = (this._consumiZip[codice] || 0) + q;
    let b = this.s.bozza.find((x) => x.codice === codice);
    if (b) { b.proposta += q; b.quantita += q; } else { b = { codice, descrizione: p.descrizione, proposta: q, quantita: q }; this.s.bozza.push(b); }
    this._quadraBlister(b);
  }

  /** Articolo in blister: la proposta si arrotonda al blister intero, per eccesso (come il programma). */
  _quadraBlister(b) {
    const p = this.s.prodotti[b.codice];
    if (!p || !p.in_blister || !p.pezzi_blister) return;
    const n = p.pezzi_blister;
    const nuova = Math.ceil(b.proposta / n) * n;
    if (nuova !== b.proposta) { b.quantita += nuova - b.proposta; b.proposta = nuova; }
  }

  /** Righe del rifornimento con quello che serve per decidere: giacenza ora/dopo, carico, spira, blister. */
  bozzaDettaglio() {
    return [...this.s.bozza].sort((a, b) => a.codice.localeCompare(b.codice)).map((b) => {
      const p = this.s.prodotti[b.codice] || {};
      const dopo = p.quantita == null ? null : p.quantita + b.quantita;
      const spira = p.pezzi_spira;
      // i pezzi del controllo sul posto in attesa dello ZIP mancano già: non contano per l'eccesso (come in rifornimentoFatto)
      const sospesi = this.s.controlli.filter((c) => c.codice === b.codice && c.stato === 'attesa').reduce((t, c) => t + Math.max(0, (c.mancanti || 0) - (c.assorbiti || 0)), 0);
      const pieno = dopo == null ? null : dopo - sospesi;
      return { ...b, descrizione: p.descrizione || b.descrizione, ora: p.quantita, dopo, carico: p.carico_completo, magazzino: p.magazzino || 0,
        oltre: p.carico_completo != null && pieno != null && pieno > p.carico_completo, eccesso: p.carico_completo != null && pieno != null ? Math.max(0, pieno - p.carico_completo) : 0, sospesi,
        spira, fuori_spira: !!(spira && b.quantita % spira), blister: p.in_blister ? p.pezzi_blister : null, modificata: b.quantita !== b.proposta,
        ...this.fonteRifornimento(b.codice, b.quantita) };
    });
  }

  /** Regola del rifornimento: il numero in lista sono i pezzi NUOVI che porti. Quando registri,
   *  quello che manca ancora per il pieno lo prendo dal magazzino (scaffale), se c'è.
   *  Ritorna quanti pezzi verranno presi dal magazzino se porti q pezzi nuovi. */
  fonteRifornimento(codice, q = 0) {
    const p = this.s.prodotti[codice];
    q = Math.max(0, Math.round(Number(q) || 0));
    if (!p || p.carico_completo == null || !(p.magazzino > 0)) return { dal_magazzino: 0, nuovi: q };
    const manca = p.carico_completo - (p.quantita + q - this._sospesi(codice));
    return { dal_magazzino: Math.max(0, Math.min(p.magazzino, manca)), nuovi: q };
  }

  /** Pezzi del controllo sul posto non ancora scalati dallo ZIP: mancano già dal distributore. */
  _sospesi(codice) {
    return this.s.controlli.filter((c) => c.codice === codice && c.stato === 'attesa').reduce((t, c) => t + Math.max(0, (c.mancanti || 0) - (c.assorbiti || 0)), 0);
  }

  /** Tutti gli articoli che al rifornimento verranno riempiti dal magazzino (anche quelli fuori lista). */
  riempimentiDaMagazzino() {
    const inBozza = Object.fromEntries(this.s.bozza.map((b) => [b.codice, b.quantita > 0 ? b.quantita : 0]));
    return Object.values(this.s.prodotti).map((p) => ({ codice: p.codice, descrizione: p.descrizione, ...this.fonteRifornimento(p.codice, inBozza[p.codice] || 0) }))
      .filter((x) => x.dal_magazzino > 0);
  }

  aggiungiABozza(codice, q) {
    const p = this.s.prodotti[codice];
    if (!p) throw new Error(`L'articolo ${codice} non esiste.`);
    q = Math.round(Number(q));
    if (!(q > 0)) throw new Error('Scrivi quanti pezzi.');
    const b = this.s.bozza.find((x) => x.codice === codice);
    if (b) b.quantita += q; else this.s.bozza.push({ codice, descrizione: p.descrizione, proposta: 0, quantita: q });
    this._tocca();
  }

  togliDaBozza(codice) { this.s.bozza = this.s.bozza.filter((b) => b.codice !== codice); this._tocca(); }

  abbina(indiceSospesa, codice) {
    const sp = this.s.sospese[indiceSospesa];
    if (!sp) throw new Error('Riga non trovata.');
    if (!this.s.prodotti[codice]) throw new Error(`L'articolo ${codice} non esiste.`);
    if (!this.s.abbinamenti.find((a) => a.chiave === sp.chiave))
      this.s.abbinamenti.push({ chiave: sp.chiave, descrizione_pdf: sp.descrizione_pdf, codice_pdf: sp.codice_pdf, codice });
    const ora = adessoIso();
    let n = 0;
    this.s.sospese = this.s.sospese.filter((x) => {
      if (x.chiave !== sp.chiave) return true;
      this._scarica(codice, x.quantita, { nome: x.nome_zip, dal: x.dal }, ora, { descrizione: x.descrizione_pdf, codice: x.codice_pdf }); n += x.quantita;
      const z = this.s.zip.find((zz) => zz.nome === x.nome_zip);
      const r = z && z.dettaglio && z.dettaglio.find((rr) => rr.esito === 'da abbinare' && chiave(rr.d) === x.chiave);
      if (r) { r.esito = 'scaricata'; r.cod = codice; z.pezzi = (z.pezzi || 0) + x.quantita; z.sospesi = Math.max(0, (z.sospesi || 0) - x.quantita); }
      return false;
    });
    this.riempiDaMagazzino('Dopo un abbinamento');
    this._tocca();
    return n;
  }

  ignora(indiceSospesa) {
    const sp = this.s.sospese[indiceSospesa];
    if (!sp) return;
    if (!this.s.ignorate.includes(sp.chiave)) this.s.ignorate.push(sp.chiave);
    this.s.sospese = this.s.sospese.filter((x) => x.chiave !== sp.chiave);
    this._tocca();
  }

  /** Distributore sotto il carico completo: l'operatore lo riempie dal magazzino. Il totale non cambia. */
  riempiDaMagazzino(origine = 'Dal magazzino') {
    const ora = adessoIso();
    let n = 0;
    for (const p of Object.values(this.s.prodotti)) {
      // prima si svuota il distributore: il magazzino si tocca solo per i pezzi prelevati oltre lo zero
      if (!(p.magazzino > 0) || p.quantita >= 0) continue;
      const sposta = Math.min(p.magazzino, -p.quantita);
      const prima = p.quantita;
      p.quantita += sposta; p.magazzino -= sposta;
      this._mov('DAL_MAGAZZINO', p.codice, p.descrizione, sposta, prima, p.quantita, origine,
        `${sposta} ${sposta === 1 ? 'pezzo preso' : 'pezzi presi'} dal magazzino (in magazzino ${p.magazzino === 1 ? 'resta' : 'ne restano'} ${p.magazzino})`, ora);
      n++;
    }
    if (n) this._tocca();
    return n;
  }

  /** Al posto di portare pezzi nuovi si usano quelli del magazzino: vanno nel distributore e il rifornimento cala. */
  usaMagazzino(codice, n) {
    const p = this.s.prodotti[codice], b = this.s.bozza.find((x) => x.codice === codice);
    n = Math.round(Number(n));
    if (!p) throw new Error('Articolo non trovato.');
    if (!(n > 0)) throw new Error('Scrivi quanti pezzi prendi.');
    if (n > (p.magazzino || 0)) throw new Error(`In magazzino ce ne sono solo ${p.magazzino || 0}.`);
    const posto = p.carico_completo != null ? p.carico_completo - p.quantita : Infinity;
    if (n > posto) throw new Error(posto > 0 ? `Nel distributore ci stanno solo ${posto} pezzi (carico completo ${p.carico_completo}).` : 'Il distributore è già pieno.');
    const prima = p.quantita;
    p.magazzino -= n; p.quantita += n;
    this._mov('DAL_MAGAZZINO', codice, p.descrizione, n, prima, p.quantita, 'Rifornimento dal magazzino', `${n} pezzi presi dal magazzino al posto del rifornimento (in magazzino ne restano ${p.magazzino})`);
    if (b) { b.quantita = Math.max(0, b.quantita - n); b.proposta = Math.max(0, b.proposta - n); if (!b.quantita && !b.proposta) this.s.bozza = this.s.bozza.filter((x) => x !== b); }
    this._tocca();
    return n;
  }

  impostaQuantitaBozza(codice, q) {
    const b = this.s.bozza.find((x) => x.codice === codice);
    if (!b) return;
    b.quantita = Math.max(0, Math.round(q));
    this._tocca();
  }

  /** I pezzi sono stati riportati: tornano nel distributore, l'eccesso oltre il carico va in magazzino. */
  rifornimentoFatto() {
    const ora = adessoIso();
    const righe = this.s.bozza.filter((b) => b.quantita > 0 && this.s.prodotti[b.codice]);
    let pezzi = 0;
    const id = 'rif-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), inizio = this.s.movimenti.length;
    const daMag = this.riempimentiDaMagazzino();   // calcolato prima di toccare il distributore
    for (const b of righe) {
      const p = this.s.prodotti[b.codice];
      const prima = p.quantita;
      p.quantita += b.quantita; pezzi += b.quantita;
      this._mov('RIFORNIMENTO', p.codice, p.descrizione, b.quantita, prima, p.quantita, 'Rifornimento',
        b.quantita !== b.proposta ? `Quantità modificata (proposta ${b.proposta})` : '', ora);
      // pezzi segnati nel controllo sul posto e non ancora scalati dallo ZIP: mancano già dal distributore,
      // quindi non sono "oltre il carico" e non vanno in magazzino (li scala lo ZIP quando arriva)
      const sospesi = this._sospesi(p.codice);
      if (p.carico_completo != null && p.quantita - sospesi > p.carico_completo) {
        const ecc = p.quantita - sospesi - p.carico_completo, pr = p.quantita;
        p.quantita -= ecc; p.magazzino = (p.magazzino || 0) + ecc;
        this._mov('ECCESSO_MAGAZZINO', p.codice, p.descrizione, -ecc, pr, p.quantita, 'Rifornimento',
          `${ecc} pezzi oltre il carico completo spostati in magazzino (ora ${p.magazzino})`, ora);
      }
    }
    // quello che manca ancora per il pieno lo prendo dallo scaffale: il distributore torna pieno, il magazzino cala
    for (const x of daMag) {
      const p = this.s.prodotti[x.codice];
      const dal = Math.min(x.dal_magazzino, p.magazzino || 0); if (!(dal > 0)) continue;
      const prima = p.quantita;
      p.quantita += dal; p.magazzino -= dal; pezzi += dal;
      this._mov('DAL_MAGAZZINO', p.codice, p.descrizione, dal, prima, p.quantita, 'Rifornimento dal magazzino',
        `${dal} pezzi presi dallo scaffale per riempire il distributore (in magazzino ${p.magazzino === 1 ? 'resta' : 'ne restano'} ${p.magazzino})`, ora);
      const b = this.s.bozza.find((y) => y.codice === x.codice);
      if (b) b.dal_magazzino = dal; else this.s.bozza.push({ codice: x.codice, descrizione: p.descrizione, proposta: 0, quantita: 0, dal_magazzino: dal });
    }
    const articoli = new Set([...righe.map((b) => b.codice), ...daMag.map((x) => x.codice)]).size;
    for (const m of this.s.movimenti.slice(inizio)) m.rif = id;          // per annullarlo con precisione
    for (const z of this.s.zip) if (!z.rifornito) z.rifornito = ora;      // calendario: rosso = già riportato
    this.s.rifornimenti.push({ id, data_ora: ora, articoli, pezzi, righe: this.s.bozza.filter((b) => b.quantita > 0 || b.dal_magazzino > 0).map((b) => ({ ...b })) });
    this.s.bozza = [];
    this._tocca();
    return { articoli, pezzi, dal_magazzino: daMag.reduce((t, x) => t + x.dal_magazzino, 0) };
  }

  /** Cambia il codice AS400 di un articolo ovunque: giacenze, storico, abbinamenti, rifornimento, controlli. */
  rinominaArticolo(vecchio, nuovo) {
    nuovo = String(nuovo || '').trim().toUpperCase();
    const p = this.s.prodotti[vecchio];
    if (!p) throw new Error('Articolo non trovato.');
    if (!nuovo) throw new Error('Scrivi il codice AS400.');
    if (nuovo === vecchio) return vecchio;
    if (this.s.prodotti[nuovo]) throw new Error(`Il codice ${nuovo} esiste già.`);
    delete this.s.prodotti[vecchio]; p.codice = nuovo; this.s.prodotti[nuovo] = p;
    const cambia = (o, k = 'codice') => { if (o && o[k] === vecchio) o[k] = nuovo; };
    this.s.abbinamenti.forEach((a) => cambia(a)); this.s.bozza.forEach((b) => cambia(b)); this.s.movimenti.forEach((m) => cambia(m));
    this.s.controlli.forEach((c) => cambia(c)); (this.s.esiti_controlli || []).forEach((e) => (e.ammanchi || []).forEach((a) => cambia(a)));
    this.s.rifornimenti.forEach((r) => (r.righe || []).forEach((x) => cambia(x)));
    this.s.zip.forEach((z) => { (z.dettaglio || []).forEach((r) => cambia(r, 'cod')); if (z.consumi && vecchio in z.consumi) { z.consumi[nuovo] = z.consumi[vecchio]; delete z.consumi[vecchio]; } });
    for (const c of Object.values(this.s.consumi)) if (vecchio in c) { c[nuovo] = (c[nuovo] || 0) + c[vecchio]; delete c[vecchio]; }
    this._mov('MODIFICA_MANUALE', nuovo, p.descrizione, 0, p.quantita, p.quantita, 'Modifica a mano', `Codice AS400 cambiato: ${vecchio} → ${nuovo}`);
    this._tocca();
    return nuovo;
  }

  modificaArticolo(codice, campi) {
    const p = this.s.prodotti[codice];
    if (!p) throw new Error('Articolo non trovato.');
    const ora = adessoIso();
    const num = (v) => (v === '' || v == null ? null : Math.round(Number(v)));
    if ('quantita' in campi) {
      const q = num(campi.quantita) ?? 0;
      if (q !== p.quantita) { this._mov('MODIFICA_MANUALE', codice, p.descrizione, q - p.quantita, p.quantita, q, 'Modifica a mano', '', ora); p.quantita = q; }
    }
    if ('magazzino' in campi) {
      const m = num(campi.magazzino) ?? 0;
      if (m !== (p.magazzino || 0)) { this._mov('CORREZIONE_MAGAZZINO', codice, p.descrizione, m - (p.magazzino || 0), p.quantita, p.quantita, 'Modifica a mano', `Magazzino ${p.magazzino || 0} → ${m}`, ora); p.magazzino = m; }
    }
    const cambi = [];
    for (const k of ['carico_completo', 'scorta_minima', 'pezzi_spira']) {
      if (k in campi) { const v = num(campi[k]); if (v !== p[k]) { cambi.push(`${k.replace('_', ' ')} ${p[k] ?? '—'} → ${v ?? '—'}`); p[k] = v; } }
    }
    if ('descrizione' in campi && chiave(campi.descrizione) && campi.descrizione.trim() !== p.descrizione) {
      cambi.push('descrizione'); p.descrizione = campi.descrizione.trim();
    }
    if (cambi.length) this._mov('MODIFICA_ARTICOLO', codice, p.descrizione, 0, p.quantita, p.quantita, 'Modifica a mano', cambi.join(', '), ora);
    this.riempiDaMagazzino('Dopo una modifica');
    this._tocca();
  }

  nuovoArticolo(codice, descrizione) {
    codice = String(codice || '').trim().toUpperCase();
    if (!codice) throw new Error('Scrivi il codice AS400.');
    if (this.s.prodotti[codice]) throw new Error(`L'articolo ${codice} esiste già.`);
    this.s.prodotti[codice] = { codice, descrizione: (descrizione || '').trim(), quantita: 0, magazzino: 0, carico_completo: null, scorta_minima: null, pezzi_spira: null, in_blister: false, pezzi_blister: null };
    this._mov('NUOVO_PRODOTTO', codice, descrizione || '', 0, 0, 0, 'Web app');
    this._tocca();
  }

  giorniMancanti(oggi = oggiIso()) {
    const partenza = this.s.impostazioni.zip_partenza ? piuGiorni(this.s.impostazioni.zip_partenza, -1) : '';   // giorno dei prelievi
    if (!partenza) return [];
    const ieri = piuGiorni(oggi, -1);
    let g = partenza > piuGiorni(ieri, -89) ? partenza : piuGiorni(ieri, -89);
    const presenti = new Set();
    for (const z of this.s.zip) {
      if (z.nascosto || !z.dal) continue;
      for (let d = z.dal; d <= (z.al || z.dal); d = piuGiorni(d, 1)) presenti.add(d);
    }
    const out = [];
    for (; g <= ieri; g = piuGiorni(g, 1)) if (!presenti.has(g) && !this.s.giorni_ignorati.includes(g)) out.push(g);
    return out;
  }

  /** Primo giorno di prelievi del giro in corso: il giorno dopo l'ultimo ZIP già riportato (o la partenza). */
  inizioGiro(oggi = oggiIso()) {
    const part = this.s.impostazioni.zip_partenza ? piuGiorni(this.s.impostazioni.zip_partenza, -1) : '';
    const rip = this.s.zip.filter((z) => z.rifornito && !z.eliminato && !z.storico && z.dal);
    let inizio = rip.length ? piuGiorni(rip.map((z) => z.al || z.dal).sort().pop(), 1) : part;
    if (part && (!inizio || inizio < part)) inizio = part;
    return inizio || piuGiorni(oggi, -7);
  }

  /** Prelievi del giro in corso (dall'ultimo rifornimento a ieri), giorno per giorno e articolo per articolo. */
  prelieviGiro(oggi = oggiIso()) {
    const inizio = this.inizioGiro(oggi), ieri = piuGiorni(oggi, -1);
    const giorni = [];
    for (let d = inizio; d <= ieri && giorni.length < 90; d = piuGiorni(d, 1)) giorni.push(d);
    const per = {};
    let totale = 0;
    const perGiorno = giorni.map((d) => { let t = 0; for (const [k, q] of Object.entries(this.s.consumi[d] || {})) { if (!q) continue; const r = (per[k] ||= { codice: k, descrizione: this.prodotto(k)?.descrizione || '', totale: 0, giorni: {} }); r.totale += q; r.giorni[d] = (r.giorni[d] || 0) + q; t += q; } totale += t; return t; });
    const zip = this.s.zip.filter((z) => !z.eliminato && !z.storico && !z.rifornito);
    return { inizio, fine: ieri, giorni, perGiorno, totale, zip, righe: Object.values(per).sort((a, b) => b.totale - a.totale || a.codice.localeCompare(b.codice)), mancanti: this.giorniMancanti(oggi).filter((d) => d >= inizio) };
  }

  prelevatiSettimana(oggi = oggiIso()) {
    const d = new Date(oggi + 'T12:00:00');
    const lun = piuGiorni(oggi, -((d.getDay() + 6) % 7));
    let tot = 0;
    for (const [giorno, c] of Object.entries(this.s.consumi)) if (giorno >= lun && giorno <= oggi) for (const v of Object.values(c)) tot += v;
    return tot;
  }

  /** ZIP di Drive da importare: dopo la partenza, non già importati, fino a oggi, dal più vecchio. */
  zipDaImportare(fileDrive, oggi = oggiIso()) {
    const partenza = this.s.impostazioni.zip_partenza || '';
    return fileDrive
      .map((f) => ({ ...f, data: dataZip(f.name, f.modifiedTime) }))
      .filter((f) => f.data && f.data <= oggi && (!partenza || f.data >= partenza) && !this.s.zip.find((z) => z.nome === f.name || (z.drive && z.drive === f.id)))
      .sort((a, b) => a.data.localeCompare(b.data) || a.name.localeCompare(b.name));
  }
}
