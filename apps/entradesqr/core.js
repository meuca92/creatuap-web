// EntradesQR · nucli compartit entre la pàgina d'entrades (clients) i el panell (discoteca / organitzador).
//
// Model (el mateix que la botiga, perquè el servidor ja el sap fer anar):
//   config.categories = esdeveniments  { id, name, date 'AAAA-MM-DD', time 'HH:MM', end?, emoji, desc, active }
//   config.products   = tipus d'entrada { id, cat (esdeveniment), name, price, stock (aforament que queda), desc, active }
//   comanda (record 'order') = una compra: { lines, total, payment 'targeta'|'porta', customer, eventId }
//     status: 'nova' (entrada vàlida) → 'validada' (ja ha entrat) · 'cancel·lada'
//   El QR de l'entrada és "EQR:<id de la comanda>"; a la porta el panell el llegeix i la marca com a validada.

const tr = (field, lang) => (field && (typeof field === 'string' ? field : (field[lang] || field.ca))) || '';
const fmtPrice = n => Number(n || 0).toLocaleString('ca-ES', { style: 'currency', currency: 'EUR' });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round2 = n => Math.round(n * 100) / 100;
const pad = n => String(n).padStart(2, '0');
const toISODate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISODate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const normPhone = p => String(p || '').replace(/[^\d+]/g, '');
const qrText = order => 'EQR:' + order.id;

const STATUSES = {
  nova: { ca: 'Vàlida', es: 'Válida' },
  validada: { ca: 'Ja ha entrat', es: 'Ya ha entrado' },
  'cancel·lada': { ca: 'Cancel·lada', es: 'Cancelada' }
};

// Esdeveniments encara per fer (o d'avui), ordenats per data.
function upcoming(client, includePast = false) {
  const today = toISODate(new Date());
  return (client.categories || []).filter(e => e.active !== false && (includePast || (e.date || today) >= today))
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}
const ticketsOf = (client, eventId) => (client.products || []).filter(p => p.cat === eventId);
const eventOf = (client, order) => (client.categories || []).find(e => e.id === (order.eventId || (client.products.find(p => p.id === (order.lines[0] || {}).productId) || {}).cat));
const people = order => (order.lines || []).reduce((s, l) => s + (l.qty || 0), 0);

const Store = {
  remote: false, config: null, biz: null, cache: [], listeners: [],
  key(slug, what) { return `entradesqr:${slug}:${what}`; },
  read(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } },
  write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} },

  async loadClient(slug) {
    if (typeof Remote !== 'undefined' && Remote.isRemote(slug)) {
      this.remote = true;
      this.config = await Remote.loadPublic(slug);
      return this.config;
    }
    let client;
    if (slug.startsWith('local-')) {
      const raw = localStorage.getItem('creatuapp:draft:' + slug);
      if (!raw) throw new Error('No trobat: ' + slug);
      client = JSON.parse(raw);
    } else {
      const res = await fetch(`clients/${encodeURIComponent(slug)}.json`, { cache: 'no-store' });
      if (!res.ok) throw new Error('No trobat: ' + slug);
      client = await res.json();
    }
    // A la demo, els esdeveniments es mouen sols a partir d'avui (dayOffset) perquè sempre n'hi hagi.
    (client.categories || []).forEach(e => {
      if (e.dayOffset != null && !e.date) e.date = toISODate(addDays(new Date(), e.dayOffset));
      if (e.yearly && !e.date) { const y = new Date().getFullYear(), d = `${y}-${e.yearly}`; e.date = d >= toISODate(new Date()) ? d : `${y + 1}-${e.yearly}`; }   // p. ex. Cap d'Any: "12-31"
    });
    const edited = this.read(this.key(slug, 'events'), null);
    if (edited) { client.categories = edited.categories; client.products = edited.products; }
    client.slug = slug;
    if (client.demoSeed && localStorage.getItem(this.key(slug, 'orders')) === null) {
      this.write(this.key(slug, 'orders'), demoOrders(client));
      this.write(this.key(slug, 'counter'), 2040);
    }
    this.config = client;
    return client;
  },
  async attachOwner(biz) {
    this.remote = true; this.biz = biz;
    this.config = { ...biz.config, slug: biz.slug, adminPinHash: biz.pin_hash };
    const fetch = () => Remote.ownerRecords(biz.id, 'order', 180);
    this.cache = await fetch();
    Remote.poll(fetch, list => { this.cache = list; this.emit(); }, 5000);
    // L'aforament que queda el canvien les compres: el refresquem.
    Remote.poll(() => Remote.ownerBusiness(biz.slug).then(b => b && b.config.products), products => {
      if (products) { this.config.products = products; this.emit(); }
    }, 15000);
  },
  // Desa esdeveniments i entrades (panell).
  async saveEvents(slug, categories, products) {
    this.config.categories = categories; this.config.products = products;
    if (this.remote) return Remote.saveConfig(this.biz.id, this.config);
    this.write(this.key(slug, 'events'), { categories, products });
  },
  resetEvents(slug) { try { localStorage.removeItem(this.key(slug, 'events')); } catch (_) {} },

  getOrders(slug) { return this.remote ? this.cache : this.read(this.key(slug, 'orders'), []); },

  async placeOrder(client, order) {
    if (this.remote) {
      const r = await Remote.place(client.slug, 'order', order);
      return r.record ? { order: r.record } : r;
    }
    const products = client.products.map(p => ({ ...p }));
    for (const l of order.lines) {
      const p = products.find(x => x.id === l.productId);
      if (!p || p.active === false) return { error: 'unavailable', productId: l.productId };
      if (p.stock != null && l.qty > p.stock) return { error: 'stock', productId: p.id, left: p.stock };
    }
    order.lines.forEach(l => { const p = products.find(x => x.id === l.productId); if (p.stock != null) p.stock -= l.qty; });
    client.products = products;
    await this.saveEvents(client.slug, client.categories, products);
    const num = this.read(this.key(client.slug, 'counter'), 2000) + 1;
    this.write(this.key(client.slug, 'counter'), num);
    const full = { ...order, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), num, status: 'nova', createdAt: Date.now(),
      history: [{ status: 'nova', at: Date.now() }] };
    this.write(this.key(client.slug, 'orders'), [...this.getOrders(client.slug), full]);
    return { order: full };
  },

  // Porta: marcar l'entrada com a utilitzada (o desfer-ho).
  async setStatus(slug, id, status, extra = {}) {
    if (this.remote) {
      const cur = this.cache.find(o => o.id === id);
      await Remote.updateRecord(id, { status, ...extra }, cur);
      this.cache = this.cache.map(o => o.id === id ? { ...o, status, ...extra } : o);
      return;
    }
    this.write(this.key(slug, 'orders'), this.getOrders(slug).map(o => o.id === id
      ? { ...o, status, ...extra, history: [...(o.history || []), { status, at: Date.now() }] } : o));
  },

  // ---- Caixa ----
  async setPaid(slug, id, paidAt, current) {
    if (this.remote) {
      await Remote.updateRecord(id, { paidAt }, this.cache.find(o => o.id === id) || current);
      this.cache = this.cache.map(o => o.id === id ? { ...o, paidAt } : o);
      return;
    }
    this.write(this.key(slug, 'orders'), this.getOrders(slug).map(o => o.id === id ? { ...o, paidAt } : o));
  },
  getCosts(slug) {
    if (this.remote) return (this.biz.private && this.biz.private.costs) || {};
    return this.read(this.key(slug, 'costs'), {});
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

  // Correu amb l'entrada (només a l'app real; a la demo no s'envia res).
  async mailTicket(slug, id, email) {
    if (!this.remote) return { ok: true, demo: true };
    return Remote.mailTicket(slug, id, email);
  },
  async getTicket(slug, id) {
    if (this.remote) return Remote.ticket(slug, id);
    return this.getOrders(slug).find(o => o.id === id) || null;
  },
  async findMine(slug, phone) {
    if (this.remote) return (await Remote.mine(slug, phone)).filter(o => o.lines);
    return this.getOrders(slug).filter(o => normPhone(o.customer.phone) === normPhone(phone));
  },
  emit() { this.listeners.forEach(cb => cb()); },
  onChange(cb) {
    this.listeners.push(cb);
    window.addEventListener('storage', e => { if (e.key && e.key.startsWith('entradesqr:')) cb(); });
  }
};

function totals(client, lines) {
  const total = round2(lines.reduce((s, l) => {
    const p = client.products.find(x => x.id === l.productId);
    return s + (p ? p.price * l.qty : 0);
  }, 0));
  return { subtotal: total, shipping: 0, total };
}

// Vendes d'exemple per a la demo.
function demoOrders(client) {
  const names = [['Marta Puig', '600 11 22 33'], ['Jordi Vila', '611 22 33 44'], ['Anna Soler', '622 33 44 55'], ['Pere Roca', '633 44 55 66'],
    ['Laura Font', '644 55 66 77'], ['Pol Serra', '666 77 88 99'], ['Clara Mas', '677 88 99 00'], ['Joan Riera', '688 12 34 56'], ['Núria Camps', '699 23 45 67']];
  const ev = upcoming(client);
  const out = [];
  const now = Date.now();
  names.forEach(([name, phone], i) => {
    const e = ev[i % ev.length]; if (!e) return;
    const t = ticketsOf(client, e.id); const p = t[i % t.length];
    const qty = 1 + (i % 3);
    const created = now - (i + 1) * 5 * 3600e3;
    out.push({ id: 'demo' + i, num: 2031 + i, status: i === 2 ? 'validada' : 'nova', eventId: e.id, createdAt: created,
      lines: [{ productId: p.id, qty, name: `${tr(e.name, 'ca')} · ${tr(p.name, 'ca')}`, price: p.price }], subtotal: p.price * qty, shipping: 0, total: p.price * qty,
      payment: i % 4 === 3 ? 'porta' : 'targeta', customer: { name, phone, email: '' }, history: [{ status: 'nova', at: created }] });
  });
  return out;
}
