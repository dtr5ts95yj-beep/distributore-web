// Google Drive dal browser, senza server: accesso OAuth con ritorno alla pagina (niente finestre popup,
// che sull'iPhone nelle app della schermata Home non funzionano bene).
// - ZIP: letti dalla cartella condivisa (sola lettura).
// - Dati: un file "Distributore_dati.json" nel TUO Drive, creato da questa web app.

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const NOME_DATI = 'Distributore_dati.json';

const leggi = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const scrivi = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* niente */ } };
const leggiS = (k) => { try { return sessionStorage.getItem(k) || ''; } catch { return ''; } };
const scriviS = (k, v) => { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); } catch { /* niente */ } };

export const drive = {
  get clientId() { return leggi('drive_client_id'); },
  set clientId(v) { scrivi('drive_client_id', (v || '').trim()); },
  get fileDati() { return leggi('drive_file_dati'); },
  set fileDati(v) { scrivi('drive_file_dati', v); },
  get collegato() { return !!leggi('drive_collegato'); },

  indirizzoRitorno() { return location.origin + location.pathname; },

  token() {
    try {
      const t = JSON.parse(leggi('drive_token') || 'null');
      if (t && t.scade > Date.now() + 60000) return t.valore;
    } catch { /* niente */ }
    return '';
  },

  /** Va da Google e torna qui. silenzioso: senza chiedere niente se hai già dato il permesso. */
  accedi(silenzioso = false) {
    if (!this.clientId) throw new Error('Manca il codice client di Google (Altro → Google Drive).');
    const stato = crypto.getRandomValues(new Uint32Array(4)).join('-');
    scriviS('drive_stato', stato);
    const p = new URLSearchParams({
      client_id: this.clientId, redirect_uri: this.indirizzoRitorno(), response_type: 'token', scope: SCOPE,
      include_granted_scopes: 'true', state: stato, prompt: silenzioso ? 'none' : 'consent select_account',
    });
    location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + p.toString());
  },

  /** Al ritorno da Google: legge il token dall'indirizzo. Ritorna 'ok', 'errore:<motivo>' o ''. */
  ritorno() {
    if (!location.hash || location.hash.length < 2) return '';
    const p = new URLSearchParams(location.hash.slice(1));
    if (!p.get('access_token') && !p.get('error')) return '';
    history.replaceState(null, '', location.pathname + location.search);
    if (p.get('state') !== leggiS('drive_stato')) return 'errore:stato';
    scriviS('drive_stato', '');
    if (p.get('error')) return 'errore:' + p.get('error');
    scrivi('drive_token', JSON.stringify({ valore: p.get('access_token'), scade: Date.now() + (Number(p.get('expires_in') || 3600) * 1000) }));
    scrivi('drive_collegato', '1');
    return 'ok';
  },

  scollega() { scrivi('drive_token', ''); scrivi('drive_collegato', ''); scrivi('drive_file_dati', ''); },

  async _chiama(url, opzioni = {}) {
    const t = this.token();
    if (!t) { const e = new Error('Accesso a Google scaduto.'); e.accesso = true; throw e; }
    const r = await fetch(url, { ...opzioni, headers: { ...(opzioni.headers || {}), Authorization: 'Bearer ' + t } });
    if (r.status === 401) { scrivi('drive_token', ''); const e = new Error('Accesso a Google scaduto.'); e.accesso = true; throw e; }
    if (r.status === 403) throw new Error('Google nega l\'accesso a questa cartella o a questi file (403).');
    if (r.status === 404) throw new Error('File o cartella non trovati su Google Drive.');
    if (!r.ok) throw new Error(`Google Drive ha risposto con un errore (${r.status}).`);
    return r;
  },
  async _json(url, opzioni) { return (await this._chiama(url, opzioni)).json(); },

  async cartelleCondivise() {
    const q = "mimeType = 'application/vnd.google-apps.folder' and sharedWithMe = true and trashed = false";
    const d = await this._json(`${API}/files?` + new URLSearchParams({ q, fields: 'files(id,name)', pageSize: '200', orderBy: 'name' }));
    return d.files || [];
  },

  async zipNellaCartella(idCartella) {
    if (!/^[A-Za-z0-9_-]{5,200}$/.test(idCartella || '')) throw new Error('Cartella di Drive non valida.');
    const q = `'${idCartella}' in parents and name contains '.zip' and trashed = false`;
    const out = [];
    let pagina = '';
    for (let i = 0; i < 50; i++) {
      const p = { q, fields: 'nextPageToken,files(id,name,size,modifiedTime)', pageSize: '200', orderBy: 'modifiedTime desc' };
      if (pagina) p.pageToken = pagina;
      const d = await this._json(`${API}/files?` + new URLSearchParams(p));
      out.push(...(d.files || []));
      pagina = d.nextPageToken;
      if (!pagina) break;
    }
    return out;
  },

  async scarica(id) { return new Uint8Array(await (await this._chiama(`${API}/files/${id}?alt=media`)).arrayBuffer()); },

  // --------------------------------------------------------------- cartella per i colleghi (solo in uscita)
  async _cartellaColleghi() {
    const salvata = leggi('drive_cartella_colleghi');
    if (salvata) {
      try { const d = await this._json(`${API}/files/${salvata}?fields=id,trashed`); if (!d.trashed) return salvata; } catch { /* rifatta sotto */ }
    }
    const q = "mimeType = 'application/vnd.google-apps.folder' and trashed = false and 'me' in owners and appProperties has { key='app' and value='distributore-web-colleghi' }";
    const d = await this._json(`${API}/files?` + new URLSearchParams({ q, fields: 'files(id)', pageSize: '5' }));
    let id = d.files && d.files[0] ? d.files[0].id : '';
    if (!id) {
      const meta = { name: 'Distributore - per i colleghi', mimeType: 'application/vnd.google-apps.folder', appProperties: { app: 'distributore-web-colleghi' } };
      id = (await this._json(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) })).id;
    }
    scrivi('drive_cartella_colleghi', id);
    return id;
  },

  /** Scrive (o riscrive) un file nella cartella per i colleghi; tipo distingue i file (excel, pdf). */
  async salvaPerColleghi(tipo, nome, mime, byte) {
    const cartella = await this._cartellaColleghi();
    const q = `'${cartella}' in parents and trashed = false and appProperties has { key='tipo' and value='${tipo}' }`;
    const d = await this._json(`${API}/files?` + new URLSearchParams({ q, fields: 'files(id)', pageSize: '5' }));
    const id = d.files && d.files[0] ? d.files[0].id : '';
    if (id) {
      await this._chiama(`${UPLOAD}/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': mime }, body: byte });
      await this._chiama(`${API}/files/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nome }) });
      return { id, cartella };
    }
    const confine = 'distributore' + Date.now();
    const meta = { name: nome, mimeType: mime, parents: [cartella], appProperties: { app: 'distributore-web', tipo } };
    const testa = `--${confine}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${confine}\r\nContent-Type: ${mime}\r\n\r\n`;
    const corpo = new Blob([testa, byte, `\r\n--${confine}--`]);
    const r = await (await this._chiama(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${confine}` }, body: corpo })).json();
    return { id: r.id, cartella };
  },

  linkCartellaColleghi() { const id = leggi('drive_cartella_colleghi'); return id ? `https://drive.google.com/drive/folders/${id}` : ''; },

  // --------------------------------------------------------------- file dei dati nel tuo Drive
  async _trovaFileDati() {
    if (this.fileDati) return this.fileDati;
    const q = `name = '${NOME_DATI}' and trashed = false and 'me' in owners and appProperties has { key='app' and value='distributore-web' }`;
    const d = await this._json(`${API}/files?` + new URLSearchParams({ q, fields: 'files(id,modifiedTime)', orderBy: 'modifiedTime desc', pageSize: '5' }));
    const id = d.files && d.files[0] ? d.files[0].id : '';
    if (id) this.fileDati = id;
    return id;
  },

  /** Ritorna i dati salvati su Drive (oggetto) oppure null se non ci sono ancora. */
  async leggiDati() {
    const id = await this._trovaFileDati();
    if (!id) return null;
    try { return await (await this._chiama(`${API}/files/${id}?alt=media`)).json(); }
    catch (e) { if (/404/.test(e.message) || /non trovati/.test(e.message)) { this.fileDati = ''; return null; } throw e; }
  },

  async salvaDati(stato) {
    const corpo = JSON.stringify(stato);
    const id = await this._trovaFileDati();
    if (id) {
      await this._chiama(`${UPLOAD}/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: corpo });
      return id;
    }
    const confine = 'distributore' + Date.now();
    const meta = { name: NOME_DATI, mimeType: 'application/json', appProperties: { app: 'distributore-web' } };
    const multipart = `--${confine}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${confine}\r\nContent-Type: application/json\r\n\r\n${corpo}\r\n--${confine}--`;
    const d = await (await this._chiama(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${confine}` }, body: multipart })).json();
    this.fileDati = d.id;
    return d.id;
  },
};
