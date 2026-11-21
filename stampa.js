// PDF A4 del rifornimento, in bianco e nero, con i barcode Code 128 (pdf-lib, nel telefono).
import { barre128, isoIta } from './logica.js';

const pulisci = (t) => String(t ?? '').replace(/[→←]/g, '-').replace(/[^\x20-\x7E -ÿ€]/g, '');

export async function pdfRifornimento(righe, info) {
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const doc = await PDFDocument.create();
  doc.setTitle('Rifornimento distributore');
  doc.setAuthor('AC');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const grassetto = await doc.embedFont(StandardFonts.HelveticaBold);
  const nero = rgb(0, 0, 0), grigio = rgb(0.35, 0.35, 0.35), chiaro = rgb(0.85, 0.85, 0.85);
  const L = 595.28, H = 841.89, M = 32;
  // dallo scaffale (magazzino) e nuovi: quando carichi sai cosa prendi lì e cosa ti devi procurare
  const W = [76, 96, 164, 32, 32, 36, 95], NOMI = ['CODICE', 'DESCRIZIONE', 'BARCODE CODICE', 'DAL\nMAG.', 'NUOVI', 'PEZZI', 'BARCODE PEZZI'];
  const col = NOMI.map((t, i) => [t, M + W.slice(0, i).reduce((a, b) => a + b, 0), W[i]]);
  const X = Object.fromEntries(col.map(([t, x, w]) => [t, [x, w]]));
  const ALTO = 40, TESTA = 22;
  const tronca = (t, f, size, w) => { t = pulisci(t); while (t && f.widthOfTextAtSize(t, size) > w) t = t.slice(0, -1); return t; };
  const pagine = [];
  let pag, y;

  const nuovaPagina = (prima) => {
    pag = doc.addPage([L, H]); pagine.push(pag);
    y = H - M;
    if (prima) {
      pag.drawText('RIFORNIMENTO DISTRIBUTORE', { x: M, y: y - 18, size: 18, font: grassetto, color: nero });
      y -= 34;
      pag.drawText(pulisci(info), { x: M, y: y - 10, size: 9.5, font, color: grigio });
      y -= 24;
    }
    pag.drawRectangle({ x: M, y: y - TESTA, width: L - 2 * M, height: TESTA, color: chiaro });
    for (const [t, x, w] of col) {
      const righe = t.split('\n');
      righe.forEach((r, i) => {
        const sz = Math.min(8.5, (w - 4) / grassetto.widthOfTextAtSize(r, 1)), tw = grassetto.widthOfTextAtSize(r, sz);
        pag.drawText(r, { x: x + (w - tw) / 2, y: y - (righe.length > 1 ? 10 + i * 8.5 : 15), size: sz, font: grassetto, color: nero });
      });
    }
    y -= TESTA;
  };

  nuovaPagina(true);
  for (const r of righe) {
    if (y - ALTO < M + 20) nuovaPagina(false);
    const top = y, base = y - ALTO;
    pag.drawRectangle({ x: M, y: base, width: L - 2 * M, height: ALTO, borderColor: grigio, borderWidth: 0.6 });
    for (const [, x] of col.slice(1)) pag.drawLine({ start: { x, y: base }, end: { x, y: top }, thickness: 0.6, color: grigio });
    const cz = Math.min(10, 72 / Math.max(1, grassetto.widthOfTextAtSize(pulisci(r.codice), 1)));
    pag.drawText(tronca(r.codice, grassetto, cz, 72), { x: M + 3, y: base + 15, size: cz, font: grassetto, color: nero });
    const d = pulisci(r.descrizione), [xd, wd] = X.DESCRIZIONE, wt = wd - 8;
    const parole = d.split(' '); let r1 = '', r2 = '';
    for (const p of parole) { const prova = (r1 ? r1 + ' ' : '') + p; if (font.widthOfTextAtSize(prova, 8) <= wt && !r2) r1 = prova; else r2 = (r2 ? r2 + ' ' : '') + p; }
    r1 = tronca(r1, font, 8, wt); r2 = tronca(r2, font, 8, wt);
    pag.drawText(r1, { x: xd + 4, y: base + (r2 ? 22 : 15), size: 8, font, color: nero });
    if (r2) pag.drawText(r2, { x: xd + 4, y: base + 10, size: 8, font, color: nero });
    // barcode: prima il codice, poi la quantità (si spara da sinistra a destra)
    const disegnaBarre = (testo, x0, larg) => {
      const b = barre128(testo);
      const moduli = [...b].reduce((t, c) => t + Number(c), 0) + 20;
      const mod = Math.min(1.1, (larg - 10) / moduli);
      let x = x0 + (larg - mod * moduli) / 2 + 10 * mod;
      [...b].forEach((c, i) => { const w = Number(c) * mod; if (i % 2 === 0) pag.drawRectangle({ x, y: base + 6, width: w, height: ALTO - 12, color: nero }); x += w; });
    };
    disegnaBarre(r.codice, ...X['BARCODE CODICE']);
    const numero = (t, [x, w], size) => { if (t === '') return; pag.drawText(t, { x: x + (w - grassetto.widthOfTextAtSize(t, size)) / 2, y: base + 14, size, font: grassetto, color: nero }); };
    const haFonte = r.dal_magazzino != null;
    numero(haFonte ? (r.dal_magazzino ? String(r.dal_magazzino) : '–') : '', X['DAL\nMAG.'], 13);
    numero(haFonte ? (r.nuovi ? String(r.nuovi) : '–') : '', X.NUOVI, 13);
    const q = String(r.quantita);
    numero(q, X.PEZZI, 16);
    disegnaBarre(q, ...X['BARCODE PEZZI']);
    y = base;
  }
  pagine.forEach((p, i) => {
    const t = `Pagina ${i + 1} di ${pagine.length}`;
    p.drawText(t, { x: (L - font.widthOfTextAtSize(t, 8)) / 2, y: 16, size: 8, font, color: grigio });
  });
  return doc.save();
}

export function nomeFile(oggi) { return `Rifornimento_${isoIta(oggi).replace(/\//g, '-')}.pdf`; }

/** Foglio d'inventario: tutti gli articoli, con le giacenze del programma e lo spazio per i conteggi. */
export async function pdfInventario(articoli, info) {
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const doc = await PDFDocument.create();
  doc.setTitle('Inventario distributore'); doc.setAuthor('AC');
  const font = await doc.embedFont(StandardFonts.Helvetica), gr = await doc.embedFont(StandardFonts.HelveticaBold);
  const nero = rgb(0, 0, 0), grigio = rgb(0.35, 0.35, 0.35), chiaro = rgb(0.85, 0.85, 0.85);
  const L = 595.28, H = 841.89, M = 28, ALTO = 34, TESTA = 22;
  const col = [['CODICE', M, 86], ['DESCRIZIONE', M + 86, 176], ['TOTALE', M + 262, 50], ['BARCODE', M + 312, 128], ['CONTATI', M + 440, 99]];
  const tronca = (t, f, z, w) => { t = pulisci(t); while (t && f.widthOfTextAtSize(t, z) > w) t = t.slice(0, -1); return t; };
  const pagine = []; let pag, y;
  const nuova = (prima) => {
    pag = doc.addPage([L, H]); pagine.push(pag); y = H - M;
    if (prima) { pag.drawText('INVENTARIO DISTRIBUTORE', { x: M, y: y - 18, size: 18, font: gr, color: nero }); y -= 32; pag.drawText(pulisci(info), { x: M, y: y - 10, size: 9.5, font, color: grigio }); y -= 22; }
    pag.drawRectangle({ x: M, y: y - TESTA, width: L - 2 * M, height: TESTA, color: chiaro });
    for (const [t, x, w] of col) pag.drawText(t, { x: x + (w - gr.widthOfTextAtSize(t, 8)) / 2, y: y - 15, size: 8, font: gr, color: nero });
    y -= TESTA;
  };
  nuova(true);
  for (const a of articoli) {
    if (y - ALTO < M + 20) nuova(false);
    const base = y - ALTO;
    pag.drawRectangle({ x: M, y: base, width: L - 2 * M, height: ALTO, borderColor: grigio, borderWidth: 0.6 });
    for (const [, x] of col.slice(1)) pag.drawLine({ start: { x, y: base }, end: { x, y }, thickness: 0.6, color: grigio });
    pag.drawText(tronca(a.codice, gr, 10, 80), { x: M + 4, y: base + 12, size: 10, font: gr, color: nero });
    pag.drawText(tronca(a.descrizione, font, 8.5, 170), { x: M + 90, y: base + 12, size: 8.5, font, color: nero });
    { const t = String((a.quantita || 0) + (a.magazzino || 0)); pag.drawText(t, { x: M + 262 + (50 - gr.widthOfTextAtSize(t, 12)) / 2, y: base + 11, size: 12, font: gr, color: nero }); }
    const b = barre128(a.codice); const mod = Math.min(1, (128 - 8) / ([...b].reduce((t, c) => t + Number(c), 0) + 20));
    let x = M + 312 + (128 - mod * ([...b].reduce((t, c) => t + Number(c), 0) + 20)) / 2 + 10 * mod;
    [...b].forEach((c, i) => { const w = Number(c) * mod; if (i % 2 === 0) pag.drawRectangle({ x, y: base + 5, width: w, height: ALTO - 10, color: nero }); x += w; });
    y = base;
  }
  pagine.forEach((p, i) => { const t = `Pagina ${i + 1} di ${pagine.length}`; p.drawText(t, { x: (L - font.widthOfTextAtSize(t, 8)) / 2, y: 14, size: 8, font, color: grigio }); });
  return doc.save();
}
