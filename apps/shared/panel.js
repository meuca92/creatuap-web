// Peces comunes dels panells (CartaQR, Tanda, BotigaExpress):
// pantalla de PIN, avisos, finestretes, so de comanda nova i barra de pestanyes.
//
// IMPORTANT sobre el PIN: ara és un pany de la pantalla, pensat perquè un client o un
// empleat no hi entri per error. No és seguretat de veritat: les dades encara viuen al
// navegador. Quan connectem el backend (Supabase), l'accés es farà amb usuari i el
// servidor ho comprovarà; aquesta pantalla es mantindrà com a "desbloqueig ràpid".

const Panel = (() => {
  // ---- SHA-256 petit (funciona també en http dins la wifi, on crypto.subtle no hi és) ----
  function sha256(str) {
    const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const bytes = new TextEncoder().encode(str);
    const len = bytes.length, bitLen = len * 8;
    const total = ((len + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(total); m.set(bytes); m[len] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(total - 4, bitLen >>> 0); dv.setUint32(total - 8, Math.floor(bitLen / 2 ** 32));
    let H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const W = new Uint32Array(64), rot = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < total; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rot(W[i-15], 7) ^ rot(W[i-15], 18) ^ (W[i-15] >>> 3), s1 = rot(W[i-2], 17) ^ rot(W[i-2], 19) ^ (W[i-2] >>> 10);
        W[i] = (W[i-16] + s0 + W[i-7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
        const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H = H.map((v, i) => (v + [a, b, c, d, e, f, g, h][i]) >>> 0);
    }
    return H.map(v => v.toString(16).padStart(8, '0')).join('');
  }
  // El hash porta el nom del negoci barrejat perquè el mateix PIN no doni el mateix hash a tothom.
  const pinHash = (slug, pin) => sha256(`creatuapp:${slug}:${pin}`);

  const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- Pantalla de PIN ----
  // Mostra el teclat fins que el PIN és correcte i després crida onUnlock().
  // Es recorda en aquest aparell fins que es prem "Tancar el panell".
  // A les demos (?c=demo): un enllaç petit a dalt del panell per tornar a creatuap.com.
  (function demoBack() {
    if (new URLSearchParams(location.search).get('c') !== 'demo') return;
    const put = () => {
      const h = document.querySelector('header.p-top, header.top');
      if (!h || document.getElementById('demo-exit')) return;
      const a = document.createElement('a');
      a.id = 'demo-exit'; a.href = '/'; a.textContent = '← Sortir de la demo';
      a.style.cssText = 'display:block;text-align:center;font:700 .8rem system-ui,sans-serif;padding:6px;background:#111;color:#fff;text-decoration:none';
      h.parentNode.insertBefore(a, h);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', put); else put();
  })();
  function lock({ app, client, onUnlock }) {
    const memKey = `panel:${app}:${client.slug}:ok`;
    const expected = client.adminPinHash;
    const go = () => { document.body.classList.remove('locked'); onUnlock(); };
    if (!expected) return go(); // sense PIN configurat (no hauria de passar en un client real)
    try { if (localStorage.getItem(memKey) === expected) return go(); } catch (_) {}

    document.body.classList.add('locked');
    const box = document.createElement('div');
    box.className = 'pin-screen';
    let typed = '', fails = 0, waitUntil = 0;
    const draw = (msg = '', bad = false) => {
      box.innerHTML = `<div class="pin-card">
        <div class="pin-logo" style="background:${e(client.color)}">${e(client.logo)}</div>
        <h1>${e(client.name)}</h1>
        <p>Escriu el teu PIN per entrar al panell</p>
        <div class="pin-dots ${bad ? 'shake' : ''}">${[0, 1, 2, 3].map(i => `<span class="${i < typed.length ? 'on' : ''}"></span>`).join('')}</div>
        <p class="pin-msg ${bad ? 'bad' : ''}">${e(msg)}</p>
        <div class="pin-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-n="${n}">${n}</button>`).join('')}
          <span></span><button data-n="0">0</button><button data-del aria-label="Esborrar">⌫</button></div>
        ${client.demoSeed || new URLSearchParams(location.search).get('c') === 'demo' ? '<p class="pin-hint">Demo: el PIN és <b>1234</b></p><p class="pin-hint"><a href="/" style="color:inherit;font-weight:700">← Tornar a CreaTuApp</a></p>' : ''}
      </div>`;
    };
    const press = n => {
      if (Date.now() < waitUntil) return;
      if (n === 'del') typed = typed.slice(0, -1);
      else if (typed.length < 4) typed += n;
      draw();
      if (typed.length === 4) setTimeout(() => {
        if (pinHash(client.slug, typed) === expected) {
          try { localStorage.setItem(memKey, expected); } catch (_) {}
          box.remove(); go();
        } else {
          fails++; typed = '';
          if (fails >= 5) { waitUntil = Date.now() + 30000; draw('Massa intents. Espera 30 segons.', true); setTimeout(() => draw(), 30000); }
          else draw('PIN incorrecte. Torna-ho a provar.', true);
        }
      }, 120);
    };
    box.addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) press(b.dataset.del !== undefined ? 'del' : b.dataset.n); });
    document.addEventListener('keydown', function onKey(ev) {
      if (!box.isConnected) return document.removeEventListener('keydown', onKey);
      if (/^\d$/.test(ev.key)) press(ev.key); else if (ev.key === 'Backspace') press('del');
    });
    draw();
    document.body.appendChild(box);
  }
  function logout(app, slug) {
    try { localStorage.removeItem(`panel:${app}:${slug}:ok`); } catch (_) {}
    location.reload();
  }

  // ---- Avisos i finestretes ----
  let toastEl, toastT;
  function toast(text) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'p-toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = text; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }
  let back;
  function modal(html) {
    if (!back) {
      back = document.createElement('div'); back.className = 'p-backdrop';
      back.innerHTML = '<div class="p-modal"></div>';
      back.addEventListener('click', ev => { if (ev.target === back) closeModal(); });
      document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeModal(); });
      document.body.appendChild(back);
    }
    back.firstChild.innerHTML = html; back.classList.add('open');
    setTimeout(() => { const i = back.querySelector('input'); if (i) { i.focus(); i.select && i.select(); } }, 50);
  }
  function closeModal() { if (back) back.classList.remove('open'); }
  const modalOpen = () => !!(back && back.classList.contains('open'));
  // Pregunta de sí/no amb botons grans (en lloc del confirm() del navegador).
  function ask(title, text, yesLabel, onYes, danger = true) {
    window.__panelYes = () => { closeModal(); onYes(); };
    modal(`<h3>${e(title)}</h3>${text ? `<p>${e(text)}</p>` : ''}
      <div class="p-row"><button class="p-btn sec" onclick="Panel.closeModal()">No</button><button class="p-btn ${danger ? 'bad' : 'main'}" onclick="__panelYes()">${e(yesLabel)}</button></div>`);
  }

  // ---- So de "comanda nova" ----
  let ctx = null;
  const soundKey = 'panel:sound';
  const soundOn = () => { try { return localStorage.getItem(soundKey) === '1'; } catch (_) { return false; } };
  function enableSound() {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    try { localStorage.setItem(soundKey, '1'); } catch (_) {}
    beep();
  }
  // Els navegadors només deixen sonar després d'un toc: si ja estava activat, el reactivem al primer clic.
  document.addEventListener('click', () => {
    try { if (!ctx && localStorage.getItem(soundKey) === '1') ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
  }, { once: true });
  function beep() {
    if (!ctx) return;
    [0, .22, .44].forEach(dt => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = dt === .44 ? 1175 : 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(.0001, ctx.currentTime + dt);
      g.gain.exponentialRampToValueAtTime(.3, ctx.currentTime + dt + .02);
      g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + dt + .18);
      o.start(ctx.currentTime + dt); o.stop(ctx.currentTime + dt + .2);
    });
  }
  const soundTip = () => soundOn() ? '' : `<div class="p-tip"><span>🔔 Activa el so per sentir-ho quan entri alguna cosa nova.</span><button onclick="Panel.enableSound();this.parentElement.remove()">Activar so</button></div>`;

  function ago(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'ara mateix'; if (m < 60) return `fa ${m} min`;
    const h = Math.round(m / 60); if (h < 24) return `fa ${h} ${h === 1 ? 'hora' : 'hores'}`;
    const d = Math.round(h / 24); return `fa ${d} ${d === 1 ? 'dia' : 'dies'}`;
  }

  // Avís de l'estat del pagament a dalt del panell dels negocis reals (amb el botó que toca).
  function trialBanner(biz) {
    if (!biz || biz.isMember) return '';   // els pagaments només els veu el propietari
    const fmt = iso => new Date(iso).toLocaleDateString('ca-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    const btn = (label, kind) => `<button onclick="Panel.pay('${kind}', '${biz.slug}', this)">${label}</button>`;
    const box = (html, buttons, bad) => `<div class="p-tip"${bad ? ' style="background:#fee2e2;color:#991b1b"' : ''}><span>${html}</span><span style="display:flex;gap:8px;flex-wrap:wrap">${buttons || ''}</span></div>`;
    if (biz.status === 'pending') return box(`🪪 <b>Falta un pas:</b> tria com vols pagar per activar l'app. Amb la quota mensual, els primers 14 dies no es cobra res.`, btn('Activar', 'choose'));
    if (biz.status === 'paused') return box(`⏸️ <b>L'app està aturada.</b> Els teus clients no la poden fer servir, però les teves dades continuen guardades.`, btn('Reactivar', 'choose'), true);
    if (biz.sub_status === 'prepaid') {
      const days = Math.ceil((Date.parse(biz.trial_ends_at) - Date.now()) / 864e5);
      return days <= 60 ? box(`📅 El teu pagament únic cobreix fins al <b>${fmt(biz.trial_ends_at)}</b>.`, btn('Renovar', 'choose')) : '';
    }
    if (biz.sub_status === 'past_due') return box(`⚠️ <b>No s'ha pogut cobrar l'últim pagament.</b> Revisa la targeta perquè l'app no s'aturi.`, btn('Revisar la targeta', 'portal'), true);
    if (biz.sub_status === 'trialing') {
      const days = Math.max(0, Math.ceil((Date.parse(biz.trial_ends_at) - Date.now()) / 864e5));
      return box(`🎁 Prova gratuïta: et ${days === 1 ? 'queda <b>1 dia</b>' : `queden <b>${days} dies</b>`}. El ${fmt(biz.trial_ends_at)} es cobraran 159 € de desenvolupament i 19 €/mes.`,
        btn('Pagaments', 'portal') + btn('Pagar 399 € un sol cop', 'onetime'));
    }
    if (biz.status === 'trial') {   // negocis antics, d'abans de demanar la targeta
      const days = Math.ceil((Date.parse(biz.trial_ends_at) - Date.now()) / 864e5);
      return days > 0 ? box(`🎁 Prova gratuïta: et queden <b>${days} dies</b>.`, btn('Activar', 'choose')) : box(`⏸️ <b>La prova s'ha acabat.</b>`, btn('Activar', 'choose'), true);
    }
    return '';
  }

  // Les dues maneres de pagar, explicades amb paraules senzilles.
  function chooseModal(slug) {
    modal(`<h3>Com vols pagar?</h3>
      <div class="choices wide" style="margin-top:12px">
        <button onclick="Panel.pay('checkout', '${slug}', this)"><b>Quota mensual</b><br><span style="font-weight:400">14 dies gratis. Després, 159 € de desenvolupament (un sol cop) i 19 €/mes. Cancel·les quan vulguis.</span></button>
        <button onclick="Panel.pay('onetime', '${slug}', this)"><b>Pagament únic: 399 €</b><br><span style="font-weight:400">Sense quotes mensuals. L'app és teva per sempre, amb el suport inclòs.</span></button>
      </div>
      <p style="margin-top:12px">El pagament el fa Stripe, de manera segura. Nosaltres no veiem mai la teva targeta.</p>
      <div class="p-row"><button class="p-btn sec" onclick="Panel.closeModal()">Tornar</button></div>`);
  }

  // Botons de pagament: obren Stripe (targeta), el pagament únic o el portal de pagaments.
  async function pay(kind, slug, el) {
    if (kind === 'choose') return chooseModal(slug);
    if (typeof Remote === 'undefined') return;
    const label = el ? el.innerHTML : '';
    if (el) { el.disabled = true; el.textContent = 'Obrint…'; }
    try { await Remote.billing(kind, slug); }
    catch (_) {
      toast(`⚠️ Ara mateix no es pot obrir el pagament. Torna-ho a provar d'aquí a una estona.`);
      if (el) { el.disabled = false; el.innerHTML = label; }
    }
  }

  return { trialBanner, pay, sha256, pinHash, lock, logout, toast, modal, closeModal, modalOpen, ask, enableSound, beep, soundOn, soundTip, ago };
})();
