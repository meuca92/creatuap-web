// CartaQR · nucli compartit entre la carta del client i el panell del restaurant.
//
// Capa de dades: de moment tot es guarda al localStorage del navegador, que serveix
// per a la demo (carta i panell oberts al mateix navegador). Quan connectem un backend
// (Supabase), només caldrà reescriure l'objecte Store; la resta de l'app no canvia.

const ALLERGENS = {
  gluten:        { icon: '🌾', ca: 'Gluten',        es: 'Gluten',          en: 'Gluten' },
  crustacis:     { icon: '🦐', ca: 'Crustacis',     es: 'Crustáceos',      en: 'Crustaceans' },
  ou:            { icon: '🥚', ca: 'Ou',            es: 'Huevo',           en: 'Egg' },
  peix:          { icon: '🐟', ca: 'Peix',          es: 'Pescado',         en: 'Fish' },
  cacauets:      { icon: '🥜', ca: 'Cacauets',      es: 'Cacahuetes',      en: 'Peanuts' },
  soja:          { icon: '🫘', ca: 'Soja',          es: 'Soja',            en: 'Soy' },
  lactosa:       { icon: '🥛', ca: 'Lactis',        es: 'Lácteos',         en: 'Milk' },
  'fruits-secs': { icon: '🌰', ca: 'Fruits secs',   es: 'Frutos secos',    en: 'Tree nuts' },
  api:           { icon: '🥬', ca: 'Api',           es: 'Apio',            en: 'Celery' },
  mostassa:      { icon: '🟡', ca: 'Mostassa',      es: 'Mostaza',         en: 'Mustard' },
  sesam:         { icon: '⚪', ca: 'Sèsam',         es: 'Sésamo',          en: 'Sesame' },
  sulfits:       { icon: '🍷', ca: 'Sulfits',       es: 'Sulfitos',        en: 'Sulphites' },
  tramussos:     { icon: '🫛', ca: 'Tramussos',     es: 'Altramuces',      en: 'Lupin' },
  molluscs:      { icon: '🦑', ca: 'Mol·luscs',     es: 'Moluscos',        en: 'Molluscs' }
};

const LANG_NAMES = { ca: 'Català', es: 'Español', en: 'English' };

const fmtPrice = n => n.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR' });

// Text traduït d'un camp {ca, es, en}; si falta l'idioma, cau al català.
const tr = (field, lang) => (field && (field[lang] || field.ca)) || '';

const Store = {
  // Mode servidor (restaurants reals): comandes a Supabase, amb una còpia que s'actualitza sola.
  remote: false, config: null, biz: null, cache: [], listeners: [],
  key(slug, what) { return `cartaqr:${slug}:${what}`; },

  read(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (_) { return fallback; }
  },

  write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  },

  // Configuració del client (marca, idiomes, carta). Els canvis fets al panell
  // (preus, disponibilitat) es guarden a part i se superposen a l'original.
  async loadClient(slug) {
    // Les apps creades amb l'assistent "Crea la teva app" (slug local-…) viuen, de moment,
    // al navegador on s'han creat. Quan hi hagi backend, es llegiran del servidor.
    if (typeof Remote !== 'undefined' && Remote.isRemote(slug)) {
      this.remote = true;
      this.config = await Remote.loadPublic(slug);
      return this.config;
    }
    let client;
    if (slug.startsWith('local-')) {
      const raw = localStorage.getItem('creatuapp:draft:' + slug);
      if (!raw) throw new Error('Client no trobat: ' + slug);
      client = JSON.parse(raw);
    } else {
      const res = await fetch(`clients/${encodeURIComponent(slug)}.json`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Client no trobat: ' + slug);
      client = await res.json();
    }
    const edited = this.read(this.key(slug, 'products'), null);
    if (edited) client.products = edited;
    client.slug = slug;
    // A la demo, comandes dels dies anteriors perquè la Caixa no surti buida.
    if (slug === 'demo' && localStorage.getItem(this.key(slug, 'orders')) === null) {
      this.write(this.key(slug, 'orders'), demoPastOrders(client));
      this.write(this.key(slug, 'counter'), 140);
    }
    this.config = client;
    return client;
  },

  // Carta pública: si el restaurant canvia preus o apaga un plat, es refresca sola.
  attachPublic(slug) {
    Remote.poll(() => Remote.loadPublic(slug), cfg => { this.config = cfg; this.emit(); }, 30000);
  },
  async attachOwner(biz) {
    this.remote = true; this.biz = biz;
    this.config = { ...biz.config, slug: biz.slug, adminPinHash: biz.pin_hash };
    const fetch = () => Remote.ownerRecords(biz.id, 'order', 7);
    this.cache = await fetch();
    Remote.poll(fetch, list => { this.cache = list; this.emit(); }, 4000);
  },
  async saveProducts(slug, products) {
    if (this.remote) { this.config.products = products; return Remote.saveConfig(this.biz.id, this.config); }
    this.write(this.key(slug, 'products'), products);
  },
  resetProducts(slug) { try { localStorage.removeItem(this.key(slug, 'products')); } catch (_) {} },

  getOrders(slug) { return this.remote ? this.cache : this.read(this.key(slug, 'orders'), []); },

  async addOrder(slug, order) {
    if (this.remote) {
      const r = await Remote.place(slug, 'order', order);
      if (!r.record) throw new Error(r.error || 'error');
      return r.record;
    }
    const orders = this.getOrders(slug);
    const num = this.read(this.key(slug, 'counter'), 100) + 1;
    this.write(this.key(slug, 'counter'), num);
    const full = { ...order, id: Date.now().toString(36), num, status: 'nova', createdAt: Date.now() };
    orders.push(full);
    this.write(this.key(slug, 'orders'), orders);
    return full;
  },

  async updateOrder(slug, id, patch) {
    if (this.remote) {
      await Remote.updateRecord(id, patch, this.cache.find(o => o.id === id));
      this.cache = this.cache.map(o => o.id === id ? { ...o, ...patch } : o);
      return;
    }
    const orders = this.getOrders(slug).map(o => o.id === id ? { ...o, ...patch } : o);
    this.write(this.key(slug, 'orders'), orders);
  },

  clearOrders(slug) { this.write(this.key(slug, 'orders'), []); },

  // ---- Caixa (shared/caixa.js) ----
  // paidAt: moment del cobrament (ms) o null. "current" és la comanda tal com la veu la Caixa, per si
  // és d'un mes antic que no és a la còpia en directe.
  async setPaid(slug, id, paidAt, current) {
    if (this.remote) {
      await Remote.updateRecord(id, { paidAt }, this.cache.find(o => o.id === id) || current);
      this.cache = this.cache.map(o => o.id === id ? { ...o, paidAt } : o);
      return;
    }
    this.write(this.key(slug, 'orders'), this.getOrders(slug).map(o => o.id === id ? { ...o, paidAt } : o));
  },
  // Cost de cada plat ({ id: euros }), només per al propietari: va a la part privada del negoci.
  getCosts(slug) {
    if (this.remote) return (this.biz.private && this.biz.private.costs) || {};
    const saved = this.read(this.key(slug, 'costs'), null);
    if (saved) return saved;
    if (slug === 'demo' && this.config && typeof Caixa !== 'undefined') return Caixa.demoCosts(this.config.products.map(p => ({ key: p.id, price: p.price })));
    return {};
  },
  async saveCosts(slug, costs) {
    if (this.remote) {
      const priv = { ...(this.biz.private || {}), costs };
      await Remote.savePrivate(this.biz.id, priv);
      this.biz.private = priv;
      return;
    }
    this.write(this.key(slug, 'costs'), costs);
  },

  // Avisa quan les dades canvien des d'una altra pestanya.
  emit() { this.listeners.forEach(cb => cb()); },
  onChange(cb) {
    this.listeners.push(cb);
    window.addEventListener('storage', e => { if (e.key && e.key.startsWith('cartaqr:')) cb(); });
  }
};

// Comandes d'exemple dels 6 dies anteriors (ja servides; gairebé totes cobrades) per a la Caixa de la demo.
function demoPastOrders(client) {
  const prods = client.products.filter(p => p.price > 0);
  const out = [];
  let num = 101, seed = 7;
  const rnd = n => { seed = (seed * 9301 + 49297) % 233280; return Math.floor(seed / 233280 * n); };
  for (let back = 6; back >= 1; back--) {
    const base = new Date(); base.setDate(base.getDate() - back); base.setHours(13, 0, 0, 0);
    const n = 3 + rnd(4);
    for (let k = 0; k < n; k++) {
      const items = [];
      for (let j = 0, m = 2 + rnd(3); j < m; j++) {
        const p = prods[rnd(prods.length)];
        const ex = items.find(i => i.id === p.id);
        if (ex) ex.qty++; else items.push({ id: p.id, qty: 1, name: tr(p.name, 'ca'), price: p.price });
      }
      const created = base.getTime() + k * 35 * 60e3 + (k > 2 ? 6 * 3600e3 : 0);   // dinars i sopars
      const total = Math.round(items.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100;
      const paid = !(back === 1 && k === n - 1);   // l'última d'ahir, encara per cobrar
      out.push({ id: 'demo' + num, num: num++, table: String(1 + rnd(8)), note: '', lang: 'ca', items, total,
        status: 'servida', createdAt: created, ...(paid ? { paidAt: created + 55 * 60e3 } : { paidAt: null }) });
    }
  }
  return out;
}
