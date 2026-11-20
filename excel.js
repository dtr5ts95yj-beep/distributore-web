// File Excel (.xlsx) fatto a mano con JSZip: più fogli, intestazioni in grassetto, numeri come numeri.
// Serve al collega che apre il file da Google Drive sul PC.

const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colonna = (n) => { let s = ''; n++; while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

function foglioXml({ righe, larghezze = [], intestazione = 0 }) {
  const cols = larghezze.length ? `<cols>${larghezze.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const dati = righe.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => {
    const rif = colonna(j) + (i + 1);
    // stili: 0 normale, 1 grassetto (intestazione), 2 titolo grande, 3 grigio
    const st = i === 0 ? 2 : i === intestazione ? 1 : i < intestazione ? 3 : 0;
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${rif}" s="${st}"><v>${v}</v></c>`;
    return `<c r="${rif}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const blocca = intestazione ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${intestazione + 1}" topLeftCell="A${intestazione + 2}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '';
  const filtro = intestazione && righe.length > intestazione + 1 ? `<autoFilter ref="A${intestazione + 1}:${colonna(Math.max(...righe.map((r) => r.length)) - 1)}${righe.length}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${blocca}${cols}<sheetData>${dati}</sheetData>${filtro}<pageSetup orientation="portrait" paperSize="9"/></worksheet>`;
}

/** fogli: [{ nome, righe: [[...]], larghezze: [..], intestazione: indice della riga dei titoli }] → Uint8Array */
export async function creaExcel(JSZip, fogli) {
  const z = new JSZip();
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${fogli.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  z.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  z.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${fogli.map((f, i) => `<sheet name="${esc(f.nome.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
<definedNames>${fogli.map((f, i) => f.intestazione && f.righe.length > f.intestazione + 1 ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(f.nome.slice(0, 31))}'!$A$${f.intestazione + 1}:$${colonna(Math.max(...f.righe.map((r) => r.length)) - 1)}$${f.righe.length}</definedName>` : '').join('')}</definedNames></workbook>`);
  z.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${fogli.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${fogli.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  z.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF666666"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/></patternFill></fill></fills>
<borders count="2"><border/><border><bottom style="thin"><color rgb="FF000000"/></bottom></border></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="4"><xf fontId="0" fillId="0" borderId="0"/><xf fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/><xf fontId="2" fillId="0" borderId="0" applyFont="1"/><xf fontId="3" fillId="0" borderId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`);
  fogli.forEach((f, i) => z.file(`xl/worksheets/sheet${i + 1}.xml`, foglioXml(f)));
  return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** I fogli per il collega: rifornimento da fare, giacenze, prelievi del giro, ZIP. */
export function fogliColleghi(g, { isoIta, num = (x) => x }) {
  const ora = new Date(), quando = `Aggiornato il ${ora.toLocaleDateString('it-IT')} alle ${ora.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })} dall'app del distributore`;
  const giro = g.prelieviGiro(), perArt = Object.fromEntries(giro.righe.map((r) => [r.codice, r]));
  const bozza = g.s.bozza.filter((b) => b.quantita > 0).sort((a, b) => a.codice.localeCompare(b.codice));
  const desc = (k) => g.prodotto(k)?.descrizione || '';
  const rif = [['RIFORNIMENTO DA PREPARARE'], [quando], [`Prelievi dal ${isoIta(giro.inizio)}${giro.mancanti.length ? ` · ZIP mancanti: ${giro.mancanti.map(isoIta).join(', ')}` : ''} · ${bozza.length} articoli · ${bozza.reduce((t, b) => t + b.quantita, 0)} pezzi`],
    ['Codice', 'Descrizione', 'Pezzi da portare', 'Distributore ora', 'Carico completo', 'Magazzino'],
    ...bozza.map((b) => { const p = g.prodotto(b.codice) || {}; return [b.codice, desc(b.codice), b.quantita, p.quantita ?? '', p.carico_completo ?? '', p.magazzino || 0]; })];
  const gia = [['GIACENZE'], [quando], [''],
    ['Codice', 'Descrizione', 'Distributore', 'Magazzino', 'Totale', 'Carico completo', 'Scorta minima', 'Prelevati dall\'ultimo rifornimento', 'Da portare'],
    ...g.elenco().map((p) => [p.codice, p.descrizione, p.quantita, p.magazzino || 0, p.quantita + (p.magazzino || 0), p.carico_completo ?? '', p.scorta_minima ?? '', perArt[p.codice]?.totale || 0, g.s.bozza.find((b) => b.codice === p.codice)?.quantita || 0])];
  const giorni = giro.giorni;
  const pre = [['PRELIEVI DALL\'ULTIMO RIFORNIMENTO'], [quando], [`Dal ${isoIta(giro.inizio)} · totale ${giro.totale} pezzi`],
    ['Codice', 'Descrizione', ...giorni.map((d) => isoIta(d).slice(0, 5)), 'Totale'],
    ...giro.righe.map((r) => [r.codice, desc(r.codice), ...giorni.map((d) => r.giorni[d] || ''), r.totale]),
    ['', 'TOTALE', ...giro.perGiorno, giro.totale]];
  const zipRighe = g.giorniZip(Math.max(1, giorni.length)).map((x) => [isoIta(x.giorno), x.stato === 'manca' ? 'MANCA' : x.stato === 'ok' ? 'arrivato' : x.stato, x.zip.map((z) => z.nome).join(', '), x.zip.reduce((t, z) => t + (g.dettaglioZip(z.nome)?.pezzi || 0), 0)]);
  const zip = [['ZIP DEL GIRO'], [quando], [''], ['Giorno dei prelievi', 'Stato', 'File', 'Pezzi'], ...zipRighe];
  return [
    { nome: 'Rifornimento', righe: rif, larghezze: [16, 40, 16, 16, 16, 12], intestazione: 3 },
    { nome: 'Giacenze', righe: gia, larghezze: [16, 40, 13, 12, 10, 15, 14, 18, 12], intestazione: 3 },
    { nome: 'Prelievi', righe: pre, larghezze: [16, 36, ...giorni.map(() => 8), 10], intestazione: 3 },
    { nome: 'ZIP', righe: zip, larghezze: [20, 12, 40, 10], intestazione: 3 },
  ];
}
