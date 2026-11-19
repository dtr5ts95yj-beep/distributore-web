// Distributore – logica (nessuna dipendenza dalla pagina: si prova anche con Node)
// Stesse regole di GESTIONE DISTRIBUTORI: lettura del PDF "Totale articoli", abbinamenti,
// scarico, riempimento dal magazzino, rifornimento.

export const TIPI = {
  SCARICO_ZIP: 'Scarico ZIP', RIFORNIMENTO: 'Rifornimento', CARICO_MANUALE: 'Carico manuale',
  NUOVO_PRODOTTO: 'Nuovo prodotto', MODIFICA_MANUALE: 'Modifica giacenza', MODIFICA_ARTICOLO: 'Modifica articolo',
  STORICO_IMPORTATO: 'Storico importato', REINTEGRO_MAGAZZINO: 'Reintegro magazzino',
  CORREZIONE_MAGAZZINO: 'Correzione magazzino', ECCESSO_MAGAZZINO: 'Eccesso a magazzino',
  DAL_MAGAZZINO: 'Dal magazzino al distributore', AMMANCO: 'Ammanco', CONTROLLO_POSTO: 'Controllo sul posto',
  ZIP_ELIMINATO: 'ZIP eliminato', CANCELLAZIONE_INVENTARIO: 'Cancellazione inventario',
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
    consumi: {}, zip: [], bozza: [], sospese: [], giorni_ignorati: [], rifornimenti: [],
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
  constructor(stato) { this.s = normalizza(stato); }

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
    for (const x of Object.values(giorni)) x.stato = x.riportati === x.file ? 'riportato' : 'da_riportare';
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

  zipGiaImportato(nome, sha) { return this.s.zip.find((z) => (sha && z.sha === sha) || z.nome === nome); }

  /** Applica uno ZIP letto con leggiZip. Ritorna un riepilogo. */
  importaZip(letto, driveId = '') {
    const ora = adessoIso();
    if (letto.errori.length && !letto.righe.length) return { ok: false, errori: letto.errori };
    if (this.zipGiaImportato(letto.nome, letto.sha)) return { ok: false, gia: true, errori: [] };
    let pezzi = 0, sospese = 0, ignorati = 0, pezziSospesi = 0;
    const dettaglio = [];
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
      pezzi, pezzi_pdf: pezziPdf, sospesi: pezziSospesi, ignorati, errori: letto.errori, completo, dettaglio, drive: driveId });
    this.riempiDaMagazzino('Dopo lo scarico degli ZIP');
    this._tocca();
    return { ok: true, pezzi, pezzi_pdf: pezziPdf, righe: letto.righe.length, sospese, completo, errori: letto.errori };
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
      return { ...b, descrizione: p.descrizione || b.descrizione, ora: p.quantita, dopo, carico: p.carico_completo, magazzino: p.magazzino || 0,
        oltre: p.carico_completo != null && dopo != null && dopo > p.carico_completo, eccesso: p.carico_completo != null && dopo != null ? Math.max(0, dopo - p.carico_completo) : 0,
        spira, fuori_spira: !!(spira && b.quantita % spira), blister: p.in_blister ? p.pezzi_blister : null, modificata: b.quantita !== b.proposta };
    });
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
      if (p.carico_completo == null || !(p.magazzino > 0) || p.quantita >= p.carico_completo) continue;
      const sposta = Math.min(p.magazzino, p.carico_completo - p.quantita);
      const prima = p.quantita;
      p.quantita += sposta; p.magazzino -= sposta;
      this._mov('DAL_MAGAZZINO', p.codice, p.descrizione, sposta, prima, p.quantita, origine,
        `${sposta} ${sposta === 1 ? 'pezzo preso' : 'pezzi presi'} dal magazzino (in magazzino ${p.magazzino === 1 ? 'resta' : 'ne restano'} ${p.magazzino})`, ora);
      n++;
    }
    if (n) this._tocca();
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
    for (const b of righe) {
      const p = this.s.prodotti[b.codice];
      const prima = p.quantita;
      p.quantita += b.quantita; pezzi += b.quantita;
      this._mov('RIFORNIMENTO', p.codice, p.descrizione, b.quantita, prima, p.quantita, 'Rifornimento',
        b.quantita !== b.proposta ? `Quantità modificata (proposta ${b.proposta})` : '', ora);
      if (p.carico_completo != null && p.quantita > p.carico_completo) {
        const ecc = p.quantita - p.carico_completo, pr = p.quantita;
        p.quantita = p.carico_completo; p.magazzino = (p.magazzino || 0) + ecc;
        this._mov('ECCESSO_MAGAZZINO', p.codice, p.descrizione, -ecc, pr, p.quantita, 'Rifornimento',
          `${ecc} pezzi oltre il carico completo spostati in magazzino (ora ${p.magazzino})`, ora);
      }
    }
    for (const z of this.s.zip) if (!z.rifornito) z.rifornito = ora;      // calendario: rosso = già riportato
    this.s.rifornimenti.push({ data_ora: ora, articoli: righe.length, pezzi });
    this.s.bozza = [];
    this._tocca();
    return { articoli: righe.length, pezzi };
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
