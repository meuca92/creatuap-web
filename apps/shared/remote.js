// Connexió de les apps amb el servidor (Supabase). Necessita, abans:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="../shared/config.js"></script>
//
// Quin negoci es fa servir ho diu el paràmetre ?c=<slug> de l'adreça:
//   demo     → fitxer clients/demo.json + dades al navegador (demostracions)
//   local-…  → creat amb l'assistent i guardat només en aquest navegador
//   altres   → negoci real, guardat al servidor
//
// Les comandes i cites del servidor es tradueixen al mateix format que fan servir les
// apps en mode local ({...dades, id, num, status, createdAt}), així la resta del codi no canvia.

// Marca del negoci: logo (emoji o imatge pujada) i foto de portada opcional.
const Brand = {
  logo(c) {
    const e = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    return c.logoImg ? `<img src="${e(c.logoImg)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">` : e(c.logo);
  },
  // Quan algú desa l'app a la pantalla d'inici: el nom i la icona del negoci (no els de la plantilla).
  // Android ho llegeix del manifest (shared/manifest.js); l'iPhone, d'aquestes etiquetes.
  homeScreen(c, panel) {
    const name = c.name + (panel ? ' · Panell' : '');
    const set = (sel, make) => { let el = document.head.querySelector(sel); if (!el) { el = make(); document.head.appendChild(el); } return el; };
    const meta = (n, v) => { set(`meta[name="${n}"]`, () => Object.assign(document.createElement('meta'), { name: n })).content = v; };
    meta('apple-mobile-web-app-title', panel ? 'Panell' : String(c.name).slice(0, 20));
    meta('apple-mobile-web-app-capable', 'yes');
    meta('mobile-web-app-capable', 'yes');
    if (c.color) meta('theme-color', c.color);
    if (c.icon) set('link[rel="apple-touch-icon"]', () => Object.assign(document.createElement('link'), { rel: 'apple-touch-icon' })).href = c.icon;
    if (!document.title.startsWith('(')) document.title = name;
  },
  // Colors de detall triats pel negoci: lletres i requadres (targetes). Si no n'hi ha, els de l'app.
  colors(c) {
    const r = document.documentElement.style;
    if (c.textColor) r.setProperty('--text', c.textColor); else r.removeProperty('--text');
    if (c.cardColor) r.setProperty('--card', c.cardColor); else r.removeProperty('--card');
  },
  // Botó "Entrar al negoci" a la capçalera de l'app dels clients: només el veu qui hi té accés
  // (el propietari o algú del seu equip, amb la sessió iniciada en aquest mòbil). Porta al panell.
  _owner: null,
  ownerLink() {
    if (Brand._owner !== null) return Brand._owner && Brand._paintOwner();
    Brand._owner = false;
    const slug = new URLSearchParams(location.search).get('c');
    if (typeof Remote === 'undefined' || !Remote.isRemote(slug)) return;
    Remote.ownerBusiness(slug).then(async b => {
      if (!b) return;
      const s = await Remote.session();
      Brand._isOwner = !!(s && s.user.id === b.owner_id);   // l'equip pot entrar al panell, però editar l'app és del propietari
      Brand._owner = 'admin.html?c=' + encodeURIComponent(slug);
      Brand._paintOwner();
      new MutationObserver(() => Brand._paintOwner()).observe(document.body, { childList: true, subtree: true });
    }).catch(() => {});
  },
  _paintOwner() {
    const wrap = document.querySelector('header .wrap');
    if (!wrap || wrap.querySelector('.owner-link')) return;
    const slug = new URLSearchParams(location.search).get('c');
    const box = document.createElement('div');
    box.className = 'owner-link';
    box.style.cssText = 'display:flex;gap:8px;margin-top:14px;flex-wrap:wrap';
    const btn = 'display:flex;align-items:center;justify-content:center;gap:8px;border-radius:14px;font-weight:800;text-decoration:none;box-shadow:0 6px 18px rgba(0,0,0,.22);text-shadow:none';
    box.innerHTML = `<a href="${Brand._owner}" style="${btn};flex:2 1 200px;padding:15px 18px;font-size:1.08rem;background:#fff;color:#111">🛠️ Entrar al negoci</a>`
      + (Brand._isOwner ? `<a href="../../crea/?editar=${encodeURIComponent(slug)}" style="${btn};flex:1 1 130px;padding:15px 14px;font-size:.98rem;background:rgba(0,0,0,.55);color:#fff;border:1px solid rgba(255,255,255,.35)">✏️ Editar l'app</a>` : '');
    wrap.appendChild(box);
  },
  // A les demos (?c=demo): botons per tornar a creatuap.com o crear-ne una de veritat.
  _demo: false,
  demoLink() {
    if (Brand._demo || new URLSearchParams(location.search).get('c') !== 'demo') return;
    Brand._demo = true;
    const app = (location.pathname.match(/apps\/([a-z]+)\//) || [])[1] || '';
    const paint = () => {
      const wrap = document.querySelector('header .wrap');
      if (!wrap || wrap.querySelector('.demo-back')) return;
      const box = document.createElement('div');
      box.className = 'demo-back';
      box.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px';
      const pill = 'display:inline-flex;align-items:center;padding:8px 14px;border-radius:999px;font-weight:700;font-size:.85rem;text-decoration:none;text-shadow:none;box-shadow:0 4px 14px rgba(0,0,0,.18)';
      box.innerHTML = `<a href="/" style="${pill};background:#fff;color:#111">← Tornar a CreaTuApp</a>`
        + `<a href="/crea/${app ? '?tipus=' + app : ''}" style="${pill};background:#111;color:#fff">✨ Crear la meva app</a>`;
      wrap.appendChild(box);
    };
    paint();
    new MutationObserver(paint).observe(document.documentElement, { childList: true, subtree: true });
  },
  // Atributs per a la capçalera: si hi ha foto, la posa de fons amb una capa fosca perquè el text es llegeixi.
  hero(c) {
    AppFX.set(c.bgfx, c.bgfxAmount);   // fons animat triat pel negoci (o cap)
    Brand.colors(c);
    Brand.ownerLink();
    Brand.demoLink();
    if (!c.cover) return 'class="hero"';
    const url = String(c.cover).replace(/["'()\\\s]/g, ch => encodeURIComponent(ch));
    return `class="hero has-cover" style="background-image:linear-gradient(180deg,rgba(0,0,0,.15),rgba(0,0,0,.62)),url('${url}');background-size:cover;background-position:center"`;
  }
};

// Fons animats de l'app del negoci (fulles de tardor, neu, pètals…). Un <canvas> fix DARRERE de tot
// (el text sempre queda per sobre); mentre està actiu, les targetes es tornen una mica translúcides
// perquè l'animació es vegi també al mòbil, on les targetes ocupen gairebé tota l'amplada. S'atura amb la pestanya amagada i
// no surt si el mòbil té activat "reduir el moviment".
const AppFX = (() => {
  const KINDS = {
    leaves:   { label: '🍂 Fulles de tardor', emojis: ['🍂', '🍁', '🍂'], fall: 1, size: [18, 30], spin: true, sway: 1.2 },
    snow:     { label: '❄️ Neu', dots: ['#ffffff', '#dbeafe', '#e0f2fe'], flake: '❄️', fall: 0.6, size: [4, 9], sway: .8, shadow: true },
    petals:   { label: '🌸 Pètals', emojis: ['🌸', '🌸', '💮'], fall: .7, size: [14, 24], spin: true, sway: 1.4 },
    hearts:   { label: '💕 Cors', emojis: ['💖', '💕', '❤️'], fall: -.6, size: [14, 24], sway: .9 },
    bubbles:  { label: '🫧 Bombolles', bubble: true, fall: -.7, size: [6, 18], sway: .6 },
    stars:    { label: '✨ Estrelles', emojis: ['✨', '⭐', '✨'], twinkle: true, size: [12, 20] },
    confetti: { label: '🎉 Confeti', confetti: ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'], fall: 1.1, size: [6, 10], spin: true, sway: 1 },
    xmas:     { label: '🎄 Nadal', emojis: ['❄️', '⭐', '🎁', '🎄', '❄️', '🔔'], fall: .7, size: [16, 24], sway: 1 },
    reis:     { label: '👑 Reis', emojis: ['👑', '⭐', '🐪', '✨', '🎁'], fall: .6, size: [16, 24], sway: 1 },
    llums:    { label: '💡 Llumetes', lights: ['#ef4444', '#facc15', '#22c55e', '#3b82f6', '#f472b6'], twinkle: true, size: [5, 9] }
  };
  let cv = null, ctx = null, parts = [], kind = null, amount = 2, raf = 0, last = 0, W = 0, H = 0, dpr = 1;
  const sprites = {};
  const rnd = (a, b) => a + Math.random() * (b - a);
  function sprite(em, px) {
    const k = em + px; if (sprites[k]) return sprites[k];
    const c = document.createElement('canvas'), s = Math.ceil(px * 1.4 * dpr);
    c.width = c.height = s; const g = c.getContext('2d');
    g.font = `${px * dpr}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(em, s / 2, s / 2 + px * dpr * .05); return (sprites[k] = c);
  }
  function make(K, anywhere) {
    const sz = rnd(K.size[0], K.size[1]);
    const p = { x: rnd(0, W), y: anywhere ? rnd(0, H) : (K.fall < 0 ? H + 30 : -30), s: sz, rot: rnd(0, 6.28), vr: K.spin ? rnd(-1.5, 1.5) : 0,
      vy: (K.fall || 0) * rnd(30, 60) * (sz / K.size[1] * .5 + .5), ph: rnd(0, 6.28), sw: (K.sway || 0) * rnd(10, 30), a: rnd(.6, .95) };
    if (K.emojis) p.em = K.emojis[Math.floor(Math.random() * K.emojis.length)];
    if (K.dots) { p.col = K.dots[Math.floor(Math.random() * K.dots.length)]; if (K.flake && Math.random() < .12) { p.em = K.flake; p.s = rnd(12, 18); } }
    if (K.confetti) p.col = K.confetti[Math.floor(Math.random() * K.confetti.length)];
    if (K.lights) p.col = K.lights[Math.floor(Math.random() * K.lights.length)];
    return p;
  }
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  }
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(.05, (t - (last || t)) / 1000); last = t;
    if (document.hidden) return;
    const K = KINDS[kind]; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.ph += dt * 1.3; p.y += p.vy * dt; p.rot += p.vr * dt;
      const x = p.x + Math.sin(p.ph) * p.sw;
      if ((K.fall > 0 && p.y > H + 40) || (K.fall < 0 && p.y < -40)) { parts[i] = make(K, false); continue; }
      ctx.save(); ctx.translate(x, p.y); ctx.rotate(p.rot);
      ctx.globalAlpha = K.twinkle ? p.a * (.35 + .65 * Math.abs(Math.sin(p.ph * 1.6))) : p.a;
      if (p.em) { const sp = sprite(p.em, Math.round(p.s)); ctx.drawImage(sp, -sp.width / dpr / 2, -sp.height / dpr / 2, sp.width / dpr, sp.height / dpr); }
      else if (K.bubble) { ctx.strokeStyle = 'rgba(56,189,248,.55)'; ctx.lineWidth = 1.5; ctx.fillStyle = 'rgba(186,230,253,.18)'; ctx.beginPath(); ctx.arc(0, 0, p.s, 0, 6.28); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.arc(-p.s * .35, -p.s * .35, p.s * .22, 0, 6.28); ctx.fill(); }
      else if (K.lights) { ctx.shadowColor = p.col; ctx.shadowBlur = 14; ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(0, 0, p.s / 2, 0, 6.28); ctx.fill(); }
      else if (K.confetti) { ctx.fillStyle = p.col; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); }
      else { if (K.shadow) { ctx.shadowColor = 'rgba(30,58,138,.55)'; ctx.shadowBlur = 4; } ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(0, 0, p.s / 2, 0, 6.28); ctx.fill(); }
      ctx.restore();
    }
  }
  function stop() { cancelAnimationFrame(raf); raf = 0; parts = []; if (cv) { cv.remove(); cv = null; } removeEventListener('resize', resize); document.documentElement.classList.remove('fx-on'); }
  function css() {
    if (document.getElementById('fx-css')) return;
    const st = document.createElement('style'); st.id = 'fx-css';
    st.textContent = 'html.fx-on{--card:rgba(255,255,255,.74)}html.fx-on .sheet,html.fx-on .modal,html.fx-on .p-modal{--card:#fff}';
    document.head.appendChild(st);
  }
  function set(k, amt) {
    k = KINDS[k] ? k : null; amt = [1, 2, 3].includes(+amt) ? +amt : 2;
    if (k === kind && amt === amount && (cv || !k)) return;
    stop(); kind = k; amount = amt;
    if (!k || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    cv = document.createElement('canvas'); cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none';
    css(); document.documentElement.classList.add('fx-on');
    document.body.prepend(cv); ctx = cv.getContext('2d'); resize(); addEventListener('resize', resize);
    const n = Math.round((W * H) / 26000 * [0, .5, 1, 1.8][amount]) + 6;
    for (let i = 0; i < Math.min(n, 90); i++) parts.push(make(KINDS[k], true));
    last = 0; raf = requestAnimationFrame(frame);
  }
  return { set, KINDS };
})();

const Remote = (() => {
  let sb = null;
  const client = () => sb || (sb = supabase.createClient(CREATUAPP_CONFIG.supabaseUrl, CREATUAPP_CONFIG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }));
  const isRemote = slug => !!slug && slug !== 'demo' && !slug.startsWith('local-');

  async function rpc(fn, args) {
    const { data, error } = await client().rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  }
  const toObj = r => ({ ...r.data, id: r.id, num: r.num, status: r.status, createdAt: Date.parse(r.created_at), history: r.history || [] });

  // ---- Per a tothom (clients finals) ----
  async function loadPublic(slug) {
    const b = await rpc('get_business', { p_slug: slug });
    if (!b) throw new Error('not_found');
    if (!b.live) { const e = new Error('not_live'); e.businessName = b.name; throw e; }
    return { ...b.config, slug, cardPayments: !!b.pay };   // pay: el negoci té els cobraments amb targeta connectats
  }
  // Límit de seguretat del servidor (massa peticions seguides): avís clar en comptes d'un error genèric.
  const place = (slug, kind, data) => rpc('place_record', { p_slug: slug, p_kind: kind, p_data: data })
    .then(r => r.record ? { record: toObj(r.record) } : r)
    .catch(e => {
      if (/too_many|busy/.test(e.message)) {
        const es = (document.documentElement.lang || '').startsWith('es');
        alert(/busy/.test(e.message)
          ? (es ? 'Ahora mismo hay demasiadas peticiones. Vuelve a probarlo en unos minutos.' : "Ara mateix hi ha massa peticions. Torna-ho a provar d'aquí a uns minuts.")
          : (es ? 'Has hecho demasiadas peticiones seguidas con este teléfono. Vuelve a probarlo más tarde.' : 'Has fet massa peticions seguides amb aquest telèfon. Torna-ho a provar més tard.'));
        return { error: 'too_many' };
      }
      throw e;
    });
  const busy = (slug, from, to) => rpc('busy_slots', { p_slug: slug, p_from: from, p_to: to })
    .then(list => list.map(x => ({ ...x, customer: {}, source: 'online' })));
  const mine = (slug, phone) => rpc('my_records', { p_slug: slug, p_phone: phone }).then(list => list.map(toObj));
  const cancelMine = (slug, id, phone) => rpc('cancel_my_appt', { p_slug: slug, p_id: id, p_phone: phone });

  // ---- Per al propietari ----
  async function session() { return (await client().auth.getSession()).data.session; }
  async function ownerBusiness(slug) {
    if (!(await session())) return null;
    const { data, error } = await client().from('businesses').select('*').eq('slug', slug).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }
  async function ownerRecords(businessId, kind, sinceDays = 60) {
    const since = new Date(Date.now() - sinceDays * 864e5).toISOString();
    // Les més recents primer (perquè el límit talli les velles, no les noves) i després en ordre.
    const { data, error } = await client().from('records').select('*').eq('business_id', businessId).eq('kind', kind)
      .gte('created_at', since).order('created_at', { ascending: false }).limit(2000);
    if (error) throw new Error(error.message);
    return data.reverse().map(toObj);
  }
  // Registres entre dues dates (per a la Caixa: un dia o un mes sencer, encara que sigui antic).
  // Cites entre dues dates de la cita (AAAA-MM-DD), per a la Caixa de Tanda.
  async function ownerApptsByDate(businessId, fromDate, toDate) {
    const { data, error } = await client().from('records').select('*').eq('business_id', businessId).eq('kind', 'appt')
      .gte('data->>date', fromDate).lt('data->>date', toDate).limit(10000);
    if (error) throw new Error(error.message);
    return data.map(toObj);
  }
  async function ownerRecordsRange(businessId, kind, fromISO, toISO) {
    const { data, error } = await client().from('records').select('*').eq('business_id', businessId).eq('kind', kind)
      .gte('created_at', fromISO).lt('created_at', toISO).order('created_at', { ascending: true }).limit(10000);
    if (error) throw new Error(error.message);
    return data.map(toObj);
  }
  // Canvia l'estat i/o afegeix camps a les dades d'una comanda o cita.
  async function updateRecord(id, patch, current) {
    const { status, ...rest } = patch;
    const upd = {};
    if (status) upd.status = status;
    if (Object.keys(rest).length) {
      const base = { ...current };
      ['id', 'num', 'status', 'createdAt', 'history'].forEach(k => delete base[k]);
      upd.data = { ...base, ...rest };
    }
    const { error } = await client().from('records').update(upd).eq('id', id);
    if (error) throw new Error(error.message);
  }
  async function saveConfig(businessId, config) {
    const clean = { ...config };
    ['slug', 'adminPinHash'].forEach(k => delete clean[k]);
    const { error } = await client().from('businesses').update({ config: clean }).eq('id', businessId);
    if (error) throw new Error(error.message);
  }

  // Dades només del propietari (p. ex. el cost dels productes): van a la columna "private",
  // que la pàgina pública (get_business) no retorna.
  async function savePrivate(businessId, priv) {
    const { error } = await client().from('businesses').update({ private: priv }).eq('id', businessId);
    if (error) throw new Error(error.message);
  }

  // Pantalla per entrar amb correu i contrasenya (per sobre de tot, com la del PIN).
  function loginScreen({ client: cfg, onDone }) {
    const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    document.body.classList.add('locked');
    if (cfg.color) document.documentElement.style.setProperty('--brand', cfg.color);
    const box = document.createElement('div');
    box.className = 'pin-screen';
    box.innerHTML = `<form class="pin-card login-card">
      <div class="pin-logo" style="background:${e(cfg.color)}">${e(cfg.logo)}</div>
      <h1>${e(cfg.name)}</h1><p>Entra amb el correu i la contrasenya del teu compte de CreaTuApp.</p>
      <input type="email" name="email" placeholder="El teu correu" autocomplete="email" required>
      <input type="password" name="pass" placeholder="Contrasenya" autocomplete="current-password" required>
      <button class="login-link" type="button" style="margin-top:8px" onclick="const i=this.form.pass;const show=i.type==='password';i.type=show?'text':'password';this.textContent=show?'🙈 Amagar la contrasenya':'👁 Mostrar la contrasenya'">👁 Mostrar la contrasenya</button>
      <p class="pin-msg" id="login-msg"></p>
      <button class="login-go" type="submit">Entrar</button>
      <button class="login-link" type="button" id="login-forgot">He oblidat la contrasenya</button>
    </form>`;
    const msg = (t, bad = true) => { const m = box.querySelector('#login-msg'); m.textContent = t; m.className = 'pin-msg' + (bad ? ' bad' : ''); };
    box.querySelector('form').onsubmit = async ev => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      msg('Entrant…', false);
      const { error } = await client().auth.signInWithPassword({ email: f.get('email').trim(), password: f.get('pass') });
      if (error) return msg(/confirm/i.test(error.message) ? 'Encara no has confirmat el correu: busca el missatge de CreaTuApp a la safata d\'entrada.' : 'El correu o la contrasenya no són correctes.');
      claimed = null; await claimInvites();   // per si l'han convidat a l'equip
      const own = await ownerBusiness(cfg.slug).catch(() => null);
      if (!own) { await client().auth.signOut(); return msg('Aquest compte no té accés a aquest negoci. Si t\'hi han convidat, entra amb el correu de la invitació.'); }
      box.remove(); document.body.classList.remove('locked'); onDone(own);
    };
    box.querySelector('#login-forgot').onclick = async () => {
      const email = box.querySelector('input[name=email]').value.trim();
      if (!email) return msg('Escriu el teu correu a dalt i torna a tocar aquí.');
      // L'enllaç del correu porta a /contrasenya/, i d'allà es torna aquí.
      try { localStorage.setItem('creatuapp:tornar', location.href); } catch (_) {}
      const { error } = await client().auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/contrasenya/' });
      msg(error ? 'No s\'ha pogut enviar. Torna-ho a provar d\'aquí a una estona.' : 'T\'hem enviat un correu per canviar la contrasenya.', !!error);
    };
    document.body.appendChild(box);
  }
  async function logout() { await client().auth.signOut(); }

  // Pagaments: obre la pàgina de Stripe (posar la targeta) o el portal (canviar-la, factures, cancel·lar).
  // Pagament amb targeta d'una comanda (Stripe Connect): els diners van al compte del negoci.
  async function payOrder(slug, recordId) {
    const returnUrl = location.href.replace(/([?&])(pagat|pagament|sessio)=[^&]*&?/g, '$1').replace(/[?&]$/, '');
    const { data, error } = await client().functions.invoke('create-checkout', { body: { action: 'order', slug, recordId, returnUrl } });
    if (error || !data || !data.url) throw new Error((data && data.error) || 'pay');
    location.href = data.url;
  }
  // En tornar de Stripe: el servidor comprova el pagament i marca la comanda com a pagada.
  async function confirmOrder(slug, recordId, sessionId) {
    const { data } = await client().functions.invoke('create-checkout', { body: { action: 'order-confirm', slug, recordId, sessionId } });
    return !!(data && data.paid);
  }
  // EntradesQR: una entrada pel seu id (l'enllaç del correu) i enviar-la per correu.
  async function ticket(slug, id) {
    const r = await rpc('get_ticket', { p_slug: slug, p_id: id });
    return r ? toObj(r) : null;
  }
  async function mailTicket(slug, id, email, fn = 'ticket-mail') {
    const { data, error } = await client().functions.invoke(fn, { body: { slug, id, ...(email != null ? { email } : {}) } });
    if (error && !data) return { error: 'network' };
    return data || { error: 'network' };
  }
  // BotigaExpress: confirmació de la comanda per correu.
  const mailOrder = (slug, id, email) => mailTicket(slug, id, email, 'order-mail');
  // Cobraments del negoci: 'connect' obre el formulari de Stripe; 'connect-status' diu com està.
  async function connect(action, slug) {
    const returnUrl = location.href.replace(/([?&])cobraments=[^&]*&?/, '$1').replace(/[?&]$/, '');
    const { data, error } = await client().functions.invoke('create-checkout', { body: { action, slug, returnUrl } });
    if (error && !data) throw new Error('connect');
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  async function billing(kind, slug) {
    const fn = kind === 'portal' ? 'billing-portal' : 'create-checkout';
    const plan = kind === 'onetime' ? 'onetime' : 'monthly';
    const returnUrl = location.href.replace(/([?&])pagament=[^&]*&?/, '$1').replace(/[?&]$/, '');
    const { data, error } = await client().functions.invoke(fn, { body: { slug, returnUrl, plan } });
    if (error || !data || !data.url) throw new Error((data && data.error) || 'billing');
    location.href = data.url;
  }

  // Arrencada del panell d'un negoci real: si ja hi ha sessió del propietari, endavant;
  // si no, pantalla per entrar (amb el logo i el color del negoci).
  // Invitacions a l'equip pendents per al correu de qui ha entrat: passen a ser seves (un cop per pàgina).
  let claimed = null;
  function claimInvites() {
    if (!claimed) claimed = session().then(s => s ? rpc('claim_invites', {}) : 0).catch(() => 0);
    return claimed;
  }
  // Rol de qui ha entrat en aquest negoci. Un membre de l'equip fa servir el seu PIN (no el del propietari);
  // si encara no en té, el tria ara.
  async function applyRole(biz) {
    const s = await session();
    if (!s || s.user.id === biz.owner_id) return;
    biz.isMember = true;
    const { data } = await client().from('business_members').select('pin_hash, email').eq('business_id', biz.id).eq('user_id', s.user.id).maybeSingle();
    let pin = data && data.pin_hash;
    if (!pin) {
      pin = await choosePin(biz);
      await client().from('business_members').update({ pin_hash: pin }).eq('business_id', biz.id).eq('user_id', s.user.id);
    }
    biz.pin_hash = pin;
  }
  function choosePin(biz) {
    return new Promise(resolve => {
      const c = biz.config || {};
      const e = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
      document.body.classList.add('locked');
      const box = document.createElement('div');
      box.className = 'pin-screen';
      box.innerHTML = `<form class="pin-card login-card">
        <div class="pin-logo" style="background:${e(c.color)}">${Brand.logo(c)}</div>
        <h1>Benvingut/da a l'equip!</h1><p>Tria el <b>teu PIN</b> de 4 xifres per entrar al panell de ${e(c.name)} en aquest i altres aparells.</p>
        <input name="p1" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="PIN (4 xifres)" autocomplete="new-password" required>
        <input name="p2" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="Torna'l a escriure" autocomplete="new-password" required>
        <p class="pin-msg" id="pin-msg"></p>
        <button class="login-go" type="submit">Desar el meu PIN</button>
      </form>`;
      box.querySelector('form').onsubmit = ev => {
        ev.preventDefault();
        const f = new FormData(ev.target), a = String(f.get('p1')), b = String(f.get('p2'));
        const m = box.querySelector('#pin-msg');
        if (!/^\d{4}$/.test(a)) { m.textContent = 'Han de ser 4 xifres.'; m.className = 'pin-msg bad'; return; }
        if (a !== b) { m.textContent = 'Els dos PIN no són iguals.'; m.className = 'pin-msg bad'; return; }
        box.remove(); document.body.classList.remove('locked');
        const h = Panel.pinHash(biz.slug, a);
        try { localStorage.setItem(`panel:${biz.app}:${biz.slug}:ok`, h); } catch (_) {}
        resolve(h);
      };
      document.body.appendChild(box);
    });
  }

  async function ownerStart(slug, onReady, onNotFound) {
    const ready = async biz => { await applyRole(biz); await ensureIcon(biz); return onReady(biz); };
    await claimInvites();
    const biz = await ownerBusiness(slug).catch(() => null);
    if (biz) return ready(biz);
    const pub = await rpc('get_business', { p_slug: slug }).catch(() => null);
    if (!pub) return onNotFound();
    const cfg = pub.config || { name: pub.name, color: '#444', logo: '🔒' };
    loginScreen({ client: { ...cfg, slug }, onDone: ready });
  }

  // Icona de l'app (512×512 PNG): el logo del negoci (emoji o imatge) sobre el seu color. Es fa al
  // navegador del propietari quan obre el panell i només si el logo o el color han canviat; es puja a
  // l'emmagatzematge i es desa a config.icon (pública: la fan servir el manifest i l'iPhone).
  // Es fa abans d'arrencar el panell perquè la configuració que fa servir ja la porti.
  async function ensureIcon(biz) {
    const c = biz.config || {};
    const sig = [c.logoImg || '', c.logo || '', c.color || ''].join('|');
    if (c.icon && c.iconSig === sig) return;
    try {
      const blob = await Promise.race([drawIcon(c), new Promise((_, rej) => setTimeout(() => rej(new Error('temps')), 5000))]);
      const session = await client().auth.getSession();
      const uid = session.data.session && session.data.session.user.id;
      if (!uid || uid !== biz.owner_id) return;
      // Nom nou cada cop (només passa si canvia el logo o el color): sobreescriure demanaria més permisos.
      const path = `${uid}/${biz.slug}/icon-${Date.now().toString(36)}.png`;
      const bucket = client().storage.from('media');
      const { error } = await bucket.upload(path, blob, { contentType: 'image/png' });
      if (error) throw error;
      const icon = bucket.getPublicUrl(path).data.publicUrl;
      biz.config = { ...c, icon, iconSig: sig };
      await saveConfig(biz.id, biz.config);
    } catch (e) { console.warn('icona', e); }   // sense icona pròpia, l'app funciona igual
  }
  function drawIcon(c) {
    return new Promise((resolve, reject) => {
      const S = 512, cv = document.createElement('canvas');
      cv.width = cv.height = S;
      const g = cv.getContext('2d');
      g.fillStyle = c.color || '#7c3aed';
      g.fillRect(0, 0, S, S);
      const done = () => cv.toBlob(b => b ? resolve(b) : reject(new Error('png')), 'image/png');
      if (c.logoImg) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          // Dins la zona segura de les icones "maskable" (el 80 % del centre).
          const s = S * .62, x = (S - s) / 2, r = s * .18;
          g.save(); g.beginPath();
          g.moveTo(x + r, x); g.arcTo(x + s, x, x + s, x + s, r); g.arcTo(x + s, x + s, x, x + s, r);
          g.arcTo(x, x + s, x, x, r); g.arcTo(x, x, x + s, x, r); g.closePath(); g.clip();
          const k = Math.max(s / img.width, s / img.height);
          g.drawImage(img, x + (s - img.width * k) / 2, x + (s - img.height * k) / 2, img.width * k, img.height * k);
          g.restore(); done();
        };
        img.onerror = () => reject(new Error('logo'));
        img.src = c.logoImg;
      } else {
        g.font = `${Math.round(S * .5)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(c.logo || '★', S / 2, S * .54);
        done();
      }
    });
  }

  // Comprova cada `ms` si hi ha canvis i avisa (només quan n'hi ha).
  function poll(fetcher, onChange, ms = 5000) {
    let last = null, busyNow = false;
    const tick = async () => {
      if (busyNow || document.hidden) return;
      busyNow = true;
      try { const v = await fetcher(); const sig = JSON.stringify(v); if (sig !== last) { const first = last === null; last = sig; if (!first) onChange(v); } }
      catch (_) { /* sense connexió: ja ho tornarem a provar */ }
      busyNow = false;
    };
    tick(); const t = setInterval(tick, ms);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
    return () => clearInterval(t);
  }

  return { client, isRemote, rpc, loadPublic, place, busy, mine, cancelMine, session, ownerBusiness, ownerRecords, ownerRecordsRange, ownerApptsByDate, updateRecord, saveConfig, savePrivate, loginScreen, logout, ownerStart, claimInvites, billing, payOrder, confirmOrder, connect, ticket, mailTicket, mailOrder, poll };
})();
