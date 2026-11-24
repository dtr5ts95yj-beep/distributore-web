/**
 * PONTE per "Gestione Distributori" — da incollare in script.google.com (un progetto nuovo).
 * Gira con il TUO account Google: legge e scrive i dati del distributore nel tuo Drive al posto del PC,
 * così sul PC (o su un altro telefono) basta aprire il link con la chiave, senza accedere a Google.
 *
 * Cosa può fare chi ha il link (e niente altro):
 *  - leggere e salvare il file Distributore_dati.json;
 *  - vedere e scaricare gli ZIP della cartella del distributore;
 *  - aggiornare i file nella cartella "Distributore - per i colleghi".
 * Con il link "solo consultazione" può soltanto leggere.
 *
 * Le chiavi e le cartelle le imposta l'app dal tuo telefono (Altro → Google Drive → Link per il PC).
 * Non scrivere niente qui dentro: incolla, salva e distribuisci come "App web".
 */

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

function doGet() {
  return risposta_({ ok: true, ponte: 'distributore', versione: 1 });
}

function doPost(e) {
  try {
    const r = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (r.azione === 'imposta') return risposta_(imposta_(r));
    const ruolo = ruolo_(r.k);
    if (!ruolo) return risposta_({ errore: 'Link non valido o cambiato: chiedi il link nuovo.', chiave: true });
    const scrive = ruolo === 'completo';
    switch (r.azione) {
      case 'prova': return risposta_({ ok: true, ruolo: ruolo });
      case 'versione': return risposta_({ versione: versione_() });
      case 'leggi': return risposta_(leggi_());
      case 'salva': if (!scrive) return soloLettura_(); return risposta_(salva_(r.dati, r.base));
      case 'zip': return risposta_({ files: zip_() });
      case 'scarica': return risposta_({ b64: scarica_(r.id) });
      case 'colleghi': if (!scrive) return soloLettura_(); return risposta_(colleghi_(r));
      case 'togli': if (!scrive) return soloLettura_(); return risposta_(togli_(r.inizio));
      default: return risposta_({ errore: 'Azione sconosciuta.' });
    }
  } catch (err) {
    return risposta_({ errore: String(err && err.message || err) });
  }
}

// ------------------------------------------------------------------ impostazione dal telefono
// Il telefono manda il suo accesso a Google: lo controllo con Google (deve essere il tuo stesso account)
function imposta_(r) {
  const chi = JSON.parse(UrlFetchApp.fetch(API + '/about?fields=user(emailAddress)', {
    headers: { Authorization: 'Bearer ' + r.token }, muteHttpExceptions: true }).getContentText() || '{}');
  const io = Session.getEffectiveUser().getEmail();
  if (!chi.user || !io || chi.user.emailAddress.toLowerCase() !== io.toLowerCase())
    return { errore: 'Il ponte appartiene a un altro account Google: crealo con lo stesso account del telefono.' };
  if (!/^[A-Za-z0-9]{24,80}$/.test(r.chiave || '') || !/^[A-Za-z0-9]{24,80}$/.test(r.lettura || '')) return { errore: 'Chiavi non valide.' };
  const p = PropertiesService.getScriptProperties();
  p.setProperties({ CHIAVE: r.chiave, LETTURA: r.lettura, FILE_DATI: r.fileDati || '', CARTELLA_ZIP: r.cartellaZip || '', CARTELLA_COLLEGHI: r.cartellaColleghi || '' });
  return { ok: true };
}

function ruolo_(k) {
  if (!k) return '';
  const p = PropertiesService.getScriptProperties();
  if (k === p.getProperty('CHIAVE')) return 'completo';
  if (k === p.getProperty('LETTURA')) return 'lettura';
  return '';
}
function prop_(n) { return PropertiesService.getScriptProperties().getProperty(n) || ''; }
function soloLettura_() { return risposta_({ errore: 'Questo link è solo per consultare: non può salvare.', lettura: true }); }
function risposta_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ------------------------------------------------------------------ dati
function fileDati_() { const id = prop_('FILE_DATI'); if (!id) throw new Error('Ponte non ancora impostato dal telefono.'); return DriveApp.getFileById(id); }
function versione_() { return fileDati_().getLastUpdated().toISOString(); }
function leggi_() { const f = fileDati_(); return { versione: f.getLastUpdated().toISOString(), dati: f.getBlob().getDataAsString('UTF-8') }; }

function salva_(dati, base) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const f = fileDati_();
    if (base && f.getLastUpdated().toISOString() !== base) return { conflitto: true, versione: f.getLastUpdated().toISOString() };
    JSON.parse(dati);   // mai salvare roba rotta
    f.setContent(dati);
    Utilities.sleep(300);
    return { ok: true, versione: DriveApp.getFileById(f.getId()).getLastUpdated().toISOString() };
  } finally { lock.releaseLock(); }
}

// ------------------------------------------------------------------ ZIP (solo dalla cartella del distributore)
function zip_() {
  const cartella = prop_('CARTELLA_ZIP'); if (!cartella) return [];
  const out = [];
  const it = DriveApp.getFolderById(cartella).getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (!/\.zip/i.test(f.getName()) || f.isTrashed()) continue;
    out.push({ id: f.getId(), name: f.getName(), size: String(f.getSize()), modifiedTime: f.getLastUpdated().toISOString() });
  }
  out.sort(function (a, b) { return a.modifiedTime < b.modifiedTime ? 1 : -1; });
  return out;
}
function scarica_(id) {
  const f = DriveApp.getFileById(id);
  const cartella = prop_('CARTELLA_ZIP');
  let dentro = false; const pa = f.getParents();
  while (pa.hasNext()) if (pa.next().getId() === cartella) dentro = true;
  if (!dentro) throw new Error('File fuori dalla cartella del distributore.');
  return Utilities.base64Encode(f.getBlob().getBytes());
}

// ------------------------------------------------------------------ file per i colleghi (come fa il telefono)
function drive_(metodo, url, corpo, tipo) {
  const o = { method: metodo, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  if (corpo !== undefined) { o.payload = corpo; o.contentType = tipo || 'application/json'; }
  const r = UrlFetchApp.fetch(url, o);
  if (r.getResponseCode() >= 300) throw new Error('Drive ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  const t = r.getContentText(); return t ? JSON.parse(t) : {};
}
function colleghi_(r) {
  const cartella = prop_('CARTELLA_COLLEGHI'); if (!cartella) throw new Error('Cartella per i colleghi non impostata.');
  if (!/^[a-z0-9-]{2,20}$/.test(r.tipo || '')) throw new Error('Tipo non valido.');
  const byte = Utilities.base64Decode(r.b64);
  const q = "'" + cartella + "' in parents and trashed = false and appProperties has { key='tipo' and value='" + r.tipo + "' }";
  const d = drive_('get', API + '/files?' + 'q=' + encodeURIComponent(q) + '&fields=files(id)&pageSize=5');
  const id = d.files && d.files[0] ? d.files[0].id : '';
  if (id) {
    try {
      drive_('patch', UPLOAD + '/files/' + id + '?uploadType=media', byte, r.mime);
      drive_('patch', API + '/files/' + id, JSON.stringify({ name: r.nome }));
      return { ok: true, id: id };
    } catch (err) { try { drive_('patch', API + '/files/' + id, JSON.stringify({ trashed: true })); } catch (e2) { /* niente */ } }
  }
  const confine = 'distributore' + Date.now();
  const meta = { name: r.nome, mimeType: r.converti || r.mime, parents: [cartella], appProperties: { app: 'distributore-web', tipo: r.tipo } };
  const testa = Utilities.newBlob('--' + confine + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + confine + '\r\nContent-Type: ' + r.mime + '\r\n\r\n').getBytes();
  const coda = Utilities.newBlob('\r\n--' + confine + '--').getBytes();
  const nuovo = drive_('post', UPLOAD + '/files?uploadType=multipart&fields=id', testa.concat(byte).concat(coda), 'multipart/related; boundary=' + confine);
  return { ok: true, id: nuovo.id };
}
function togli_(inizio) {
  const cartella = prop_('CARTELLA_COLLEGHI'); if (!cartella || !inizio) return { ok: true };
  const q = "'" + cartella + "' in parents and trashed = false and appProperties has { key='app' and value='distributore-web' }";
  const d = drive_('get', API + '/files?' + 'q=' + encodeURIComponent(q) + '&fields=files(id,appProperties)&pageSize=100');
  (d.files || []).forEach(function (f) {
    if (((f.appProperties || {}).tipo || '').indexOf(inizio) === 0) drive_('patch', API + '/files/' + f.id, JSON.stringify({ trashed: true }));
  });
  return { ok: true };
}

// serve solo perché Google chieda il permesso di Drive quando autorizzi lo script
function autorizza() { DriveApp.getRootFolder(); UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true }); Logger.log(Session.getEffectiveUser().getEmail()); }
