// BotigaExpress · nucli compartit entre la botiga online i el panell del comerç.
//
// Capa de dades: de moment tot es guarda al localStorage del navegador, que serveix per a la
// demo (botiga i panell oberts al mateix navegador). Quan connectem un backend (Supabase) i el
// pagament (Stripe), només caldrà reescriure l'objecte Store; la resta de l'app no canvia.

const tr = (field, lang) => (field && (field[lang] || field.ca)) || '';
const fmtPrice = n => n.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR' });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round2 = n => Math.round(n * 100) / 100;

const pad = n => String(n).padStart(2, '0');
const toISODate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISODate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const toHHMM = min => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const normPhone = p => String(p || '').replace(/[^\d+]/g, '');

// Estats d'una comanda, en ordre. "enviada" només s'usa per a enviaments a domicili.
const STATUSES = {
  nova:        { ca: 'Rebuda',            es: 'Recibido' },
  preparant:   { ca: 'Preparant',         es: 'Preparando' },
  'a-punt':    { ca: 'A punt per recollir', es: 'Listo para recoger' },
  enviada:     { ca: 'En camí',           es: 'En camino' },
  lliurada:    { ca: 'Lliurada',          es: 'Entregado' },
  'cancel·lada': { ca: 'Cancel·lada',     es: 'Cancelado' }
};

const Store = {
  // Mode servidor (negocis reals): comandes a Supabase, amb una còpia (cache) que s'actualitza sola.
  remote: false, config: null, biz: null, cache: [], listeners: [],
  key(slug, what) { return `botigaexpress:${slug}:${what}`; },
  read(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; }
  },
  write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} },

  // Configuració del client. Els canvis del panell als productes (preu, estoc, actiu) es
  // guarden a part i se superposen a l'original.
  async loadClient(slug) {
    if (typeof Remote !== 'undefined' && Remote.isRemote(slug)) {
      this.remote = true;
      this.config = await Remote.loadPublic(slug);
      return this.config;
    }
    // Les apps creades amb l'assistent sense compte (slug local-…) viuen al navegador on s'han creat.
    let client;
    if (slug.startsWith('local-')) {
      const raw = localStorage.getItem('creatuapp:draft:' + slug);
      if (!raw) throw new Error('Botiga no trobada: ' + slug);
      client = JSON.parse(raw);
    } else {
      const res = await fetch(`clients/${encodeURIComponent(slug)}.json`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Botiga no trobada: ' + slug);
      client = await res.json();
    }
    const edited = this.read(this.key(slug, 'products'), null);
    if (edited) client.products = edited;
    client.slug = slug;
    if (client.demoSeed && localStorage.getItem(this.key(slug, 'orders')) === null) {
      this.write(this.key(slug, 'orders'), demoOrders(client));
      this.write(this.key(slug, 'counter'), 1040);
    }
    this.config = client;
    return client;
  },
  // Correu de confirmació de la comanda (només a l'app real; a la demo no s'envia res).
  async mailOrder(slug, id, email) {
    if (!this.remote) return { ok: true, demo: true };
    return Remote.mailOrder(slug, id, email);
  },
  async attachOwner(biz) {
    this.remote = true; this.biz = biz;
    this.config = { ...biz.config, slug: biz.slug, adminPinHash: biz.pin_hash };
    // En directe, els últims 60 dies; la Caixa carrega els mesos que calgui a part.
    const fetch = () => Remote.ownerRecords(biz.id, 'order', 60);
    this.cache = await fetch();
    Remote.poll(fetch, list => { this.cache = list; this.emit(); }, 5000);
    // L'estoc el canvien les comandes dels clients: el refresquem també.
    Remote.poll(() => Remote.ownerBusiness(biz.slug).then(b => b && b.config.products), products => {
      if (products) { this.config.products = products; this.emit(); }
    }, 15000);
  },
  async saveProducts(slug, products) {
    if (this.remote) { this.config.products = products; return Remote.saveConfig(this.biz.id, this.config); }
    this.write(this.key(slug, 'products'), products);
  },
  resetProducts(slug) { try { localStorage.removeItem(this.key(slug, 'products')); } catch (_) {} },

  getOrders(slug) { return this.remote ? this.cache : this.read(this.key(slug, 'orders'), []); },

  // Desa la comanda i descompta l'estoc. Retorna { order } o { error, productId } si algun
  // producte s'ha esgotat mentrestant.
  async placeOrder(client, order) {
    if (this.remote) {
      const r = await Remote.place(client.slug, 'order', order);
      return r.record ? { order: r.record } : r;
    }
    const products = client.products.map(p => ({ ...p }));
    for (const line of order.lines) {
      const p = products.find(x => x.id === line.productId);
      if (!p || p.active === false) return { error: 'unavailable', productId: line.productId };
      if (p.stock != null) {
        const want = order.lines.filter(l => l.productId === p.id).reduce((s, l) => s + l.qty, 0);
        if (want > p.stock) return { error: 'stock', productId: p.id, left: p.stock };
      }
    }
    for (const line of order.lines) {
      const p = products.find(x => x.id === line.productId);
      if (p.stock != null) p.stock -= line.qty;
    }
    client.products = products;
    this.saveProducts(client.slug, products);
    const num = this.read(this.key(client.slug, 'counter'), 1000) + 1;
    this.write(this.key(client.slug, 'counter'), num);
    const full = { ...order, id: Date.now().toString(36), num, status: 'nova', createdAt: Date.now(),
      history: [{ status: 'nova', at: Date.now() }] };
    const orders = this.getOrders(client.slug);
    orders.push(full);
    this.write(this.key(client.slug, 'orders'), orders);
    return { order: full };
  },

  async setStatus(slug, id, status) {
    if (this.remote) {
      await Remote.updateRecord(id, { status }, this.cache.find(o => o.id === id));
      this.cache = this.cache.map(o => o.id === id ? { ...o, status } : o);
      return;
    }
    this.write(this.key(slug, 'orders'), this.getOrders(slug).map(o => o.id === id
      ? { ...o, status, history: [...(o.history || []), { status, at: Date.now() }] } : o));
  },

  // ---- Caixa ----
  // Cobrada o no: paidAt = moment del cobrament (ms) o null. Si no s'ha tocat mai, les pagades amb
  // targeta compten com a cobrades en fer la comanda i les de "pagar a la botiga", com a pendents.
  async setPaid(slug, id, paidAt, current) {
    if (this.remote) {
      const cur = this.cache.find(o => o.id === id) || current;   // les velles no són a la còpia en directe
      await Remote.updateRecord(id, { paidAt }, cur);
      this.cache = this.cache.map(o => o.id === id ? { ...o, paidAt } : o);
      return;
    }
    this.write(this.key(slug, 'orders'), this.getOrders(slug).map(o => o.id === id ? { ...o, paidAt } : o));
  },
  // Cost de cada producte (o variant), que només veu el propietari: { "pa-pages": 1.1, "pa-pages:500": 0.6 }.
  getCosts(slug) {
    if (this.remote) return (this.biz.private && this.biz.private.costs) || {};
    const saved = this.read(this.key(slug, 'costs'), null);
    if (saved) return saved;
    // A la demo, un cost d'exemple (35 % del preu) perquè es vegi el benefici.
    if (this.config && this.config.demoSeed && typeof Caixa !== 'undefined') {
      return Caixa.demoCosts(this.config.products.flatMap(p => p.variants && p.variants.length
        ? p.variants.map(v => ({ key: p.id + ':' + v.id, price: v.price })) : [{ key: p.id, price: p.price }]));
    }
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

  async findMine(slug, phone) {
    if (this.remote) return (await Remote.mine(slug, phone)).filter(o => o.lines);
    return this.getOrders(slug).filter(o => normPhone(o.customer.phone) === normPhone(phone));
  },
  emit() { this.listeners.forEach(cb => cb()); },
  onChange(cb) {
    this.listeners.push(cb);
    window.addEventListener('storage', e => { if (e.key && e.key.startsWith('botigaexpress:')) cb(); });
  }
};

// Preu d'un producte (o de la seva variant).
function unitPrice(product, variantId) {
  const v = variantId && (product.variants || []).find(x => x.id === variantId);
  return v ? v.price : product.price;
}

// Totals d'una cistella [{productId, variantId, qty}] segons el mètode d'entrega.
function totals(client, lines, method) {
  const subtotal = round2(lines.reduce((s, l) => {
    const p = client.products.find(x => x.id === l.productId);
    return s + (p ? unitPrice(p, l.variantId) * l.qty : 0);
  }, 0));
  const d = client.delivery || {};
  const shipping = method === 'enviament' ? (subtotal >= (d.freeFrom ?? Infinity) ? 0 : (d.price || 0)) : 0;
  return { subtotal, shipping, total: round2(subtotal + shipping) };
}

// Franges de recollida d'un dia: ['08:00', '08:30', ...].
function pickupSlots(client, date) {
  const p = client.pickup || {};
  const ranges = (p.hours || {})[String(fromISODate(date).getDay())] || [];
  const now = new Date();
  const today = toISODate(now);
  if (date < today) return [];
  const minStart = date === today ? now.getHours() * 60 + now.getMinutes() + (p.minNoticeMinutes || 0) : -1;
  const step = p.slotMinutes || 30;
  const out = [];
  for (const [a, b] of ranges) {
    for (let t = Math.ceil(toMin(a) / step) * step; t + step <= toMin(b); t += step) if (t >= minStart) out.push(toHHMM(t));
  }
  return out;
}

// Comandes d'exemple per a la demo: les d'avui en diferents estats i alguns dies enrere.
function demoOrders(client) {
  const people = [['Marta Puig', '600 11 22 33'], ['Jordi Vila', '611 22 33 44'], ['Anna Soler', '622 33 44 55'], ['Pere Roca', '633 44 55 66'],
    ['Laura Font', '644 55 66 77'], ['Pol Serra', '666 77 88 99'], ['Clara Mas', '677 88 99 00'], ['Joan Riera', '688 12 34 56']];
  const baskets = [
    [['pa-pages', '1000', 1], ['croissant', null, 4]], [['coca-recapte', null, 2], ['barra', null, 2]], [['tortell', '12', 1]],
    [['ensaimada', null, 6], ['xuixo', null, 2]], [['integral', null, 1], ['pa-pages', '500', 2]], [['sacher', null, 1], ['croissant', null, 6]],
    [['barra', null, 3], ['coca-recapte', null, 1]], [['croissant', null, 12]]
  ];
  const plan = [
    [0, 'nova', 'recollida'], [0, 'nova', 'enviament'], [0, 'preparant', 'recollida'], [0, 'a-punt', 'recollida'],
    [0, 'enviada', 'enviament'], [0, 'lliurada', 'recollida'], [-1, 'lliurada', 'enviament'], [-1, 'lliurada', 'recollida'],
    [-2, 'lliurada', 'recollida'], [-2, 'cancel·lada', 'recollida'], [-3, 'lliurada', 'enviament'], [-4, 'lliurada', 'recollida']
  ];
  const order = ['nova', 'preparant', 'a-punt', 'enviada', 'lliurada'];
  const now = Date.now();
  return plan.map(([dayOff, status, method], i) => {
    const [name, phone] = people[i % people.length];
    const lines = baskets[i % baskets.length].map(([productId, variantId, qty]) => {
      const p = client.products.find(x => x.id === productId);
      const v = variantId && (p.variants || []).find(x => x.id === variantId);
      return { productId, variantId, qty, name: tr(p.name, 'ca') + (v ? ' · ' + tr(v.name, 'ca') : ''), price: unitPrice(p, variantId) };
    });
    const created = now + dayOff * 864e5 - (plan.length - i) * 25 * 60e3;
    const date = toISODate(new Date(created));
    const t = totals(client, lines, method);
    const steps = status === 'cancel·lada' ? ['nova', 'cancel·lada']
      : order.slice(0, order.indexOf(status) + 1).filter(s => method === 'enviament' ? s !== 'a-punt' : s !== 'enviada');
    return {
      id: 'demo' + i, num: 1029 + i, status, method, createdAt: created, lines, ...t, payment: i % 3 ? 'targeta' : 'botiga',
      // Les de pagar a la botiga que ja s'han endut, es van cobrar en recollir-les.
      ...(i % 3 === 0 && status === 'lliurada' ? { paidAt: created + steps.length * 20 * 60e3 } : {}),
      // Les d'avui encara pendents es recullen més tard; les altres, a una hora qualsevol.
      pickup: method === 'recollida' ? { date, time: dayOff === 0 && status !== 'lliurada'
        ? toHHMM(Math.min(Math.ceil((new Date().getHours() * 60 + new Date().getMinutes() + 45 + i * 30) / 30) * 30, 23 * 60))
        : ['09:00', '10:30', '12:00', '13:00', '18:00', '19:30'][i % 6] } : null,
      address: method === 'enviament' ? { street: ['C. de la Riera, 8, 2n', 'Rbla. del Passeig, 31', 'C. Sant Pere, 5'][i % 3], town: ['Vic', 'Manlleu', 'Tona'][i % 3] } : null,
      customer: { name, phone, email: '' }, note: i === 2 ? 'Amb "Per molts anys, Berta!" escrit, si us plau.' : '',
      history: steps.map((s, k) => ({ status: s, at: created + k * 20 * 60e3 }))
    };
  });
}
