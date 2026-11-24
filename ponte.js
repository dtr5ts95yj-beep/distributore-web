// PONTE: il PC (o un altro telefono) lavora sui dati di Drive senza accedere a Google.
// Il telefono imposta uno script Google ("ponte", gira col tuo account) e ti dà un link con una chiave.
// Chi apre quel link usa il ponte al posto di Google Drive: stessi dati, stessi ZIP, stessi file per i colleghi.
// Aperta normalmente (dall'icona, senza link), l'app non usa il ponte e funziona come sempre.
import { drive } from './drive.js';

const leggi = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const scrivi = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* niente */ } };
const URL_OK = /^https:\/\/script\.google(usercontent)?\.com\/[A-Za-z0-9/_.?=&-]+$/;

// ------------------------------------------------------------------ arrivo dal link: #ponte=<indirizzo>&k=<chiave>
(function daLink() {
  if (!location.hash.includes('ponte=')) return;
  const p = new URLSearchParams(location.hash.slice(1));
  const url = p.get('ponte') || '', k = p.get('k') || '';
  history.replaceState(null, '', location.pathname + location.search);
  if (!URL_OK.test(url) || !/^[A-Za-z0-9]{24,80}$/.test(k)) return;
  if (leggi('ponte_k') !== k) { scrivi('drive_versione_dati', ''); scrivi('drive_da_salvare', ''); }
  scrivi('ponte_url', url); scrivi('ponte_k', k); scrivi('ponte_ruolo', '');
})();

export const ponte = {
  get attivo() { return !!(leggi('ponte_url') && leggi('ponte_k')); },
  get soloLettura() { return leggi('ponte_ruolo') === 'lettura'; },
  get ruolo() { return leggi('ponte_ruolo'); },
  esci() { ['ponte_url', 'ponte_k', 'ponte_ruolo', 'drive_versione_dati', 'drive_da_salvare'].forEach((k) => scrivi(k, '')); },
};

async function chiama(azione, extra = {}, url = leggi('ponte_url'), k = leggi('ponte_k')) {
  let r;
  // corpo di testo semplice: il browser non fa la richiesta preliminare e Google risponde col permesso giusto
  try { r = await fetch(url, { method: 'POST', body: JSON.stringify({ azione, k, ...extra }), redirect: 'follow' }); }
  catch { throw new Error('Il ponte di Google non risponde (rete o indirizzo).'); }
  if (!r.ok) throw new Error(`Il ponte di Google ha risposto con un errore (${r.status}).`);
  let d; try { d = await r.json(); } catch { throw new Error('Il ponte di Google non ha risposto bene: controlla che sia distribuito come App web, accesso "Chiunque".'); }
  if (d.errore) { const e = new Error(d.errore); e.lettura = !!d.lettura; e.chiave = !!d.chiave; throw e; }
  return d;
}

const aBase64 = (byte) => {
  const u = byte instanceof Uint8Array ? byte : new Uint8Array(byte);
  let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
};
const daBase64 = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };

// ------------------------------------------------------------------ con il link: il ponte prende il posto di Drive
if (ponte.attivo) {
  const def = (nome, get) => Object.defineProperty(drive, nome, { get, configurable: true });
  def('clientId', () => 'ponte');
  def('collegato', () => true);
  Object.assign(drive, {
    token: () => 'ponte',
    accedi() { /* niente: col link non si entra in Google */ },
    scollega() { ponte.esci(); },
    async cartelleCondivise() { return []; },
    linkCartellaColleghi: () => '',
    async versioneDati() {
      if (!ponte.ruolo) { const p = await chiama('prova'); scrivi('ponte_ruolo', p.ruolo); }
      return (await chiama('versione')).versione || '';
    },
    async leggiDati() {
      const d = await chiama('leggi');
      this._lettaVersione = d.versione;
      return JSON.parse(d.dati);
    },
    async salvaDati(stato, forza = false) {
      if (ponte.soloLettura) return '';
      const d = await chiama('salva', { dati: JSON.stringify(stato), base: forza ? '' : this.versioneNota });
      if (d.conflitto) { const e = new Error('I dati su Drive sono stati cambiati dall\'altro dispositivo.'); e.conflitto = true; throw e; }
      this.versioneNota = d.versione;
      return 'ponte';
    },
    async zipNellaCartella() { return (await chiama('zip')).files || []; },
    async scarica(id) { return daBase64((await chiama('scarica', { id })).b64); },
    async salvaPerColleghi(tipo, nome, mime, byte, converti = '') {
      if (ponte.soloLettura) return {};
      const b = byte instanceof Blob ? new Uint8Array(await byte.arrayBuffer()) : byte;
      return chiama('colleghi', { tipo, nome, mime, converti, b64: aBase64(b) });
    },
    async togliVecchiColleghi(inizio) { if (!ponte.soloLettura) await chiama('togli', { inizio }); },
  });
}

// ------------------------------------------------------------------ dal telefono: imposta il ponte e crea i link
const chiaveNuova = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; return [...crypto.getRandomValues(new Uint32Array(32))].map((n) => a[n % a.length]).join(''); };

export async function impostaPonte(url, g, nuoveChiavi = false) {
  url = (url || '').trim();
  if (!URL_OK.test(url) || !/\/exec$/.test(url)) throw new Error('Incolla l\'indirizzo dell\'App web dello script: comincia con https://script.google.com/ e finisce con /exec.');
  if (!drive.token()) throw new Error('Prima accedi a Google Drive da qui.');
  let fileDati = await drive._trovaFileDati();
  if (!fileDati) fileDati = await drive.salvaDati(g.s, true);
  const cartellaColleghi = await drive._cartellaColleghi().catch(() => '');
  const chiave = !nuoveChiavi && leggi('ponte_imp_k') || chiaveNuova(), lettura = !nuoveChiavi && leggi('ponte_imp_l') || chiaveNuova();
  await chiama('imposta', { token: drive.token(), chiave, lettura, fileDati, cartellaZip: g.s.impostazioni.drive_cartella_id || '', cartellaColleghi }, url, '');
  const prova = await chiama('prova', {}, url, chiave);
  if (prova.ruolo !== 'completo') throw new Error('Il ponte non ha accettato la chiave.');
  scrivi('ponte_imp_url', url); scrivi('ponte_imp_k', chiave); scrivi('ponte_imp_l', lettura);
  return linkPonte();
}

export function linkPonte() {
  const url = leggi('ponte_imp_url'), k = leggi('ponte_imp_k'), l = leggi('ponte_imp_l');
  if (!url || !k) return null;
  const base = location.origin + location.pathname + '#ponte=' + encodeURIComponent(url) + '&k=';
  return { url, completo: base + k, lettura: base + l };
}
