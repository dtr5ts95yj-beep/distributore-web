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
  return v;
}

export class Gestionale {
  constructor(stato) { this.s = normalizza(stato); }

  _id() { return (this.s.movimenti.reduce((m, x) => Math.max(m, x.id || 0), 0) || 0) + 1; }
  _mov(tipo, codice, descrizione, quantita, prima, dopo, origine, note = '', ora = adessoIso()) {
    this.s.movimenti.push({ id: this._id(), data_ora: ora, tipo, codice, descrizione, quantita, prima, dopo, origine, note });
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

  /** Codici AS400 più probabili per una descrizione del PDF (parole in comune con la descrizione AS400). */
  suggerisci(descrizionePdf, quanti = 3) {
    const parole = (t) => new Set(chiave(t).replace(/[.,]/g, ' ').split(' ').filter((w) => w.length > 1 && !['DA', 'DI', 'PER', 'CON', 'MM', 'GR', 'TG'].includes(w)));
    const pdf = parole(descrizionePdf);
    if (!pdf.size) return [];
    return Object.values(this.s.prodotti)
      .map((p) => { const a = parole(p.descrizione); let n = 0; for (const w of pdf) if (a.has(w)) n++; return { codice: p.codice, punti: n / Math.max(pdf.size, a.size) }; })
      .filter((x) => x.punti > 0).sort((a, b) => b.punti - a.punti || a.codice.localeCompare(b.codice)).slice(0, quanti).map((x) => x.codice);
  }

  zipGiaImportato(nome, sha) { return this.s.zip.find((z) => (sha && z.sha === sha) || z.nome === nome); }

  /** Applica uno ZIP letto con leggiZip. Ritorna un riepilogo. */
  importaZip(letto, driveId = '') {
    const ora = adessoIso();
    if (letto.errori.length && !letto.righe.length) return { ok: false, errori: letto.errori };
    if (this.zipGiaImportato(letto.nome, letto.sha)) return { ok: false, gia: true, errori: [] };
    let pezzi = 0, sospese = 0;
    for (const r of letto.righe) {
      const k = chiave(r.descrizione);
      if (this.s.ignorate.includes(k)) continue;
      const codice = this.trovaCodice(r.descrizione, r.codice);
      if (!codice) {
        this.s.sospese.push({ chiave: k, descrizione_pdf: r.descrizione, codice_pdf: r.codice, quantita: r.quantita, nome_zip: letto.nome, dal: letto.dal, al: letto.al });
        sospese++; continue;
      }
      this._scarica(codice, r.quantita, letto, ora);
      pezzi += r.quantita;
    }
    this.s.zip.push({ nome: letto.nome, sha: letto.sha, dal: letto.dal, al: letto.al, importato_il: ora, righe: letto.righe.length, pezzi, drive: driveId });
    this.riempiDaMagazzino('Dopo lo scarico degli ZIP');
    this._tocca();
    return { ok: true, pezzi, righe: letto.righe.length, sospese, errori: letto.errori };
  }

  _scarica(codice, q, letto, ora) {
    const p = this.s.prodotti[codice];
    const prima = p.quantita;
    p.quantita -= q;
    this._mov('SCARICO_ZIP', codice, p.descrizione, -q, prima, p.quantita, letto.nome, letto.dal ? `Prelievi del ${isoIta(letto.dal)}` : '', ora);
    const giorno = letto.dal || oggiIso();
    const c = (this.s.consumi[giorno] ||= {});
    c[codice] = (c[codice] || 0) + q;
    const b = this.s.bozza.find((x) => x.codice === codice);
    if (b) { b.proposta += q; b.quantita += q; } else this.s.bozza.push({ codice, descrizione: p.descrizione, proposta: q, quantita: q });
  }

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
      this._scarica(codice, x.quantita, { nome: x.nome_zip, dal: x.dal }, ora); n += x.quantita; return false;
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
    const partenza = this.s.impostazioni.zip_partenza;
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
