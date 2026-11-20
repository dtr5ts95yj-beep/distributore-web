// Lettore di barcode con la fotocamera: EAN-13 / EAN-8 (il barcode del produttore sui pezzi) e Code 128.
// Un barcode vale solo se è abbinato a un articolo (o è proprio il suo codice AS400): gli altri non toccano niente.
// Su iPhone Safari non esiste un lettore di sistema per le pagine web, quindi la lettura è fatta qui:
// si prendono alcune righe orizzontali dell'immagine, si trasformano in barre e spazi e si decodificano.

const P128 = ('212222,222122,222221,121223,121322,131222,122213,122312,132212,221213,221312,231212,112232,122132,122231,113222,123122,123221,223211,221132,221231,213212,223112,312131,311222,321122,321221,312212,322112,322211,212123,212321,232121,111323,131123,131321,112313,132113,132311,211313,231113,231311,112133,112331,132131,113123,113321,133121,313121,211331,231131,213113,213311,213131,311123,311321,331121,312113,312311,332111,314111,221411,431111,111224,111422,121124,121421,141122,141221,112214,112412,122114,122411,142112,142211,241211,221114,413111,241112,134111,111242,121142,121241,114212,124112,124211,411212,421112,421211,212141,214121,412121,111143,111341,131141,114113,114311,411113,411311,113141,114131,311141,411131,211412,211214,211232,233111').split(',').map((p) => [...p].map(Number));
const STOP = [2, 3, 3, 1, 1, 1, 2];

// il simbolo più vicino alle larghezze misurate (normalizzate su 11 moduli); null se troppo lontano
function simbolo128(w) {
  const tot = w.reduce((a, b) => a + b, 0);
  if (!tot) return null;
  const n = w.map((x) => x * 11 / tot);
  let best = -1, err = 1e9;
  for (let s = 0; s < P128.length; s++) {
    let e = 0; const p = P128[s];
    for (let k = 0; k < 6; k++) e += Math.abs(n[k] - p[k]);
    if (e < err) { err = e; best = s; }
  }
  return err < 2.6 ? best : null;
}

function decodifica128(r) {
  // r: larghezze alternate, r[0] è una barra
  for (let i = 0; i + 6 * 3 + 7 <= r.length; i += 2) {
    const st = simbolo128(r.slice(i, i + 6));
    if (st !== 103 && st !== 104 && st !== 105) continue;
    const mod = r.slice(i, i + 6).reduce((a, b) => a + b, 0) / 11;
    if (i > 0 && r[i - 1] < mod * 2.5) continue;            // ci vuole margine chiaro prima dell'inizio
    const vals = [st]; let j = i + 6, ok = false;
    while (j + 6 <= r.length && vals.length < 60) {
      const s = simbolo128(r.slice(j, j + 6));
      if (s == null) break;
      if (s === 106) {   // stop: 6 elementi + la barra finale di 2 moduli
        const w = r.slice(j, j + 7), t = w.reduce((a, b) => a + b, 0);
        const dopo = r[j + 7];   // dopo lo stop ci vuole il margine chiaro: evita letture false dalle scritte
        if (w.length === 7 && Math.abs(w[6] * 13 / t - 2) < 1.1 && (dopo == null || dopo >= mod * 2.5)) ok = true;
        break;
      }
      if (s > 105) break;
      vals.push(s); j += 6;
    }
    if (!ok || vals.length < 3) continue;
    const dati = vals.slice(0, -1), check = vals[vals.length - 1];
    const somma = dati.reduce((t, v, k) => t + v * (k || 1), 0) % 103;
    if (somma !== check) continue;
    // traduzione con i set A / B / C
    let set = st === 103 ? 'A' : st === 104 ? 'B' : 'C', out = '', shift = false;
    for (const v of dati.slice(1)) {
      const s = shift ? (set === 'A' ? 'B' : 'A') : set; shift = false;
      if (s === 'C') {
        if (v < 100) out += String(v).padStart(2, '0');
        else if (v === 100) set = 'B'; else if (v === 101) set = 'A';
      } else {
        if (v < 64) out += String.fromCharCode(v + 32 - (s === 'A' && v >= 64 ? 96 : 0));
        else if (v < 96) out += s === 'B' ? String.fromCharCode(v + 32) : String.fromCharCode(v - 64);
        else if (v === 98) shift = true;
        else if (v === 99) set = 'C';
        else if (v === 100) { if (s === 'A') set = 'B'; }
        else if (v === 101) { if (s === 'B') set = 'A'; }
      }
    }
    if (out) return out;
  }
  return null;
}

// EAN: cifre L (dispari), G (pari), R; in larghezze di 4 elementi su 7 moduli
const EAN_L = ['3211', '2221', '2122', '1411', '1132', '1231', '1114', '1312', '1213', '3112'].map((p) => [...p].map(Number));
const EAN_G = EAN_L.map((p) => [...p].reverse());
const PRIMA = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function cifra(w, tabelle) {
  const t = w.reduce((a, b) => a + b, 0), n = w.map((x) => x * 7 / t);
  let best = null, err = 1e9;
  for (const [nome, tab] of tabelle) tab.forEach((p, d) => { const e = p.reduce((s, x, k) => s + Math.abs(n[k] - x), 0); if (e < err) { err = e; best = [d, nome]; } });
  return err < 2.2 ? best : null;
}

function controlloEan(cifre) {
  const c = cifre.slice(0, -1).reverse().reduce((s, d, k) => s + d * (k % 2 === 0 ? 3 : 1), 0);
  return (10 - (c % 10)) % 10 === cifre[cifre.length - 1];
}

function decodificaEan(r) {
  for (let i = 0; i + 3 <= r.length; i += 2) {
    const m = (r[i] + r[i + 1] + r[i + 2]) / 3;
    if (Math.max(r[i], r[i + 1], r[i + 2]) > m * 1.8 || (i > 0 && r[i - 1] < m * 2)) continue;
    // EAN-13: 3 + 24 + 5 + 24 + 3 elementi
    for (const [quante, totale] of [[6, 59], [4, 43]]) {
      if (i + totale > r.length) continue;
      const cifre = [], parita = [];
      let j = i + 3, ok = true;
      for (let k = 0; k < quante; k++) { const c = cifra(r.slice(j, j + 4), quante === 6 ? [['L', EAN_L], ['G', EAN_G]] : [['L', EAN_L]]); if (!c) { ok = false; break; } cifre.push(c[0]); parita.push(c[1]); j += 4; }
      if (!ok) continue;
      j += 5;
      for (let k = 0; k < quante; k++) { const c = cifra(r.slice(j, j + 4), [['R', EAN_L]]); if (!c) { ok = false; break; } cifre.push(c[0]); j += 4; }
      if (!ok) continue;
      let tutte = cifre;
      if (quante === 6) { const p = PRIMA.indexOf(parita.join('')); if (p < 0) continue; tutte = [p, ...cifre]; }
      if (controlloEan(tutte)) return tutte.join('');
    }
  }
  return null;
}

// una riga di luminanza → larghezze di barre e spazi a partire dalla prima barra
function righeInLarghezze(L) {
  const n = L.length;
  const s = new Float32Array(n);
  for (let x = 0; x < n; x++) s[x] = (L[Math.max(0, x - 1)] + 2 * L[x] + L[Math.min(n - 1, x + 1)]) / 4;
  let min = 255, max = 0;
  for (let x = Math.floor(n * 0.03); x < n * 0.97; x++) { if (s[x] < min) min = s[x]; if (s[x] > max) max = s[x]; }
  const contrasto = max - min;
  if (contrasto < 35) return null;
  // soglia locale: a metà fra il più chiaro e il più scuro vicini (regge ombre e luce non uniforme)
  const win = Math.max(10, Math.round(n / 28));
  const soglia = new Float32Array(n), piatto = new Uint8Array(n);
  for (let x = 0; x < n; x++) {
    let a = 255, b = 0;
    for (let k = Math.max(0, x - win), f = Math.min(n - 1, x + win); k <= f; k++) { const v = s[k]; if (v < a) a = v; if (v > b) b = v; }
    soglia[x] = (a + b) / 2;
    piatto[x] = b - a < contrasto * 0.3 ? 1 : 0;
  }
  const r = []; let scuro = null, inizio = 0;
  for (let x = 0; x < n; x++) {
    const iso = contrasto * 0.03;
    const d = piatto[x] ? false : (scuro ? s[x] < soglia[x] + iso : s[x] < soglia[x] - iso);
    if (scuro === null) { if (!d) scuro = false; continue; }   // si parte dal chiaro
    if (d !== scuro) { if (scuro || r.length) r.push(x - inizio); else r.length = 0; inizio = x; scuro = d; }
  }
  return r.length > 20 ? r : null;
}

export function leggiRiga(L) {
  const r = righeInLarghezze(L);
  if (!r) return null;
  const rev = [...L].reverse(), rr = righeInLarghezze(rev);
  return decodifica128(r) || decodificaEan(r) || (rr && (decodifica128(rr) || decodificaEan(rr))) || null;
}

// iPhone chiede il permesso della fotocamera a ogni nuova apertura: la teniamo "in pausa" per qualche minuto,
// così aprendola di nuovo non lo richiede. Si spegne davvero dopo 3 minuti o quando l'app va in secondo piano.
let tenuto = null, spegni = null;
function spegniDavvero() { clearTimeout(spegni); tenuto?.getTracks().forEach((t) => t.stop()); tenuto = null; }
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.hidden && !document.getElementById('lettore')) spegniDavvero(); });
async function prendiFotocamera() {
  clearTimeout(spegni);
  if (tenuto && tenuto.getVideoTracks().some((t) => t.readyState === 'live')) { tenuto.getTracks().forEach((t) => { t.enabled = true; }); return tenuto; }
  tenuto = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  return tenuto;
}
function lasciaFotocamera() { tenuto?.getTracks().forEach((t) => { t.enabled = false; }); clearTimeout(spegni); spegni = setTimeout(spegniDavvero, 180000); }

/** Apre la fotocamera a tutto schermo; chiama trovato(testo) alla prima lettura sicura. */
export async function apriLettore(trovato, titolo = 'Inquadra il barcode', opz = {}) {
  const box = document.createElement('div');
  box.id = 'lettore';
  box.innerHTML = `<video playsinline muted autoplay></video>
    <div class="let-velo"><div class="let-cornice"><i></i></div></div>
    <div class="let-testa"><b>${titolo}</b><small>Tienilo orizzontale dentro il riquadro, a 10-15 cm</small></div>
    <div class="let-stato" aria-live="polite">Cerco…</div>
    <button type="button" class="let-chiudi" aria-label="Chiudi">✕</button>`;
  document.body.appendChild(box);
  const video = box.querySelector('video'), stato = box.querySelector('.let-stato');
  let flusso = null, attivo = true, timer = null;
  const chiudi = () => { attivo = false; clearTimeout(timer); video.srcObject = null; lasciaFotocamera(); box.remove(); opz.chiuso?.(); };
  let fermo = false, ignora = '', ignoraFino = 0;
  // modalità continua: dopo la lettura la fotocamera resta aperta e si riprende con riprendi()
  const riprendi = (ultimoLetto) => { box.classList.remove('preso'); fermo = false; ignora = ultimoLetto || ''; ignoraFino = performance.now() + 3000; stato.textContent = 'Cerco…'; };
  box.querySelector('.let-chiudi').onclick = chiudi;
  try {
    flusso = await prendiFotocamera();
  } catch (e) {
    stato.textContent = e.name === 'NotAllowedError' ? 'Permesso fotocamera negato: abilitalo in Impostazioni iPhone → Safari → Fotocamera.' : 'Fotocamera non disponibile: ' + e.message;
    return;
  }
  video.srcObject = flusso;
  await video.play().catch(() => {});
  try { const [t] = flusso.getVideoTracks(); const c = t.getCapabilities?.(); if (c?.focusMode?.includes('continuous')) await t.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { /* niente */ }
  const nativo = ('BarcodeDetector' in window) && !window.__soloLettoreInterno
    ? await window.BarcodeDetector.getSupportedFormats().then((f) => f.length ? new window.BarcodeDetector({ formats: f.filter((x) => ['code_128', 'ean_13', 'ean_8', 'upc_a'].includes(x)) }) : null).catch(() => null) : null;
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d', { willReadFrequently: true });
  let ultimo = '', volte = 0;
  const giro = async () => {
    if (!attivo) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (vw && vh && !fermo) {
      let letto = null;
      if (nativo) { try { const r = await nativo.detect(video); if (r.length) letto = r[0].rawValue; } catch { /* niente */ } }
      if (!letto) {
        // fascia centrale, quella del riquadro
        const W = Math.min(1280, vw), H = Math.round(vh * 0.3 * W / vw);
        cv.width = W; cv.height = H;
        ctx.drawImage(video, 0, vh * 0.35, vw, vh * 0.3, 0, 0, W, H);
        const img = ctx.getImageData(0, 0, W, H).data;
        for (let k = 1; k <= 13 && !letto; k++) {
          const y = Math.round(H * k / 14), L = new Uint8ClampedArray(W);
          for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; L[x] = (img[o] * 3 + img[o + 1] * 6 + img[o + 2]) / 10; }
          letto = leggiRiga(L);
        }
      }
      if (letto && letto === ignora && performance.now() < ignoraFino) letto = null;
      if (letto) {
        if (letto === ultimo) volte++; else { ultimo = letto; volte = 1; }
        stato.textContent = `Letto ${letto}…`;
        if (volte >= 2 || nativo) {
          box.classList.add('preso');
          try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(), gg = a.createGain(); o.frequency.value = 1760; gg.gain.value = 0.08; o.connect(gg).connect(a.destination); o.start(); o.stop(a.currentTime + 0.09); } catch { /* niente */ }
          if (opz.continuo) { fermo = true; ultimo = ''; volte = 0; trovato(letto, { riprendi: () => riprendi(letto), chiudi, box }); }
          else { setTimeout(() => { chiudi(); trovato(letto); }, 220); return; }
        }
      }
    }
    timer = setTimeout(giro, 90);
  };
  giro();
}
