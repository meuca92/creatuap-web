// Tanda · nucli compartit entre la pàgina de reserves del client i el panell del negoci.
//
// Capa de dades: de moment tot es guarda al localStorage del navegador, que serveix per a la
// demo (reserves i panell oberts al mateix navegador). Quan connectem un backend (Supabase),
// només caldrà reescriure l'objecte Store; la resta de l'app no canvia.

const tr = (field, lang) => (field && (field[lang] || field.ca)) || '';
const fmtPrice = n => n.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- Dates i hores (sempre en hora local) ----
const pad = n => String(n).padStart(2, '0');
const toISODate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISODate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const toHHMM = min => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const normPhone = p => String(p || '').replace(/[^\d+]/g, '');

const Store = {
  // Mode servidor (negocis reals): les cites viuen a Supabase i aquí en guardem una còpia
  // (cache) que s'actualitza sola cada pocs segons. Mode local (demo i proves): localStorage.
  remote: false, config: null, biz: null, cache: [], listeners: [],
  key(slug, what) { return `reservafacil:${slug}:${what}`; },
  read(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; }
  },
  write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} },

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
      if (!raw) throw new Error('Client no trobat: ' + slug);
      client = JSON.parse(raw);
    } else {
      const res = await fetch(`clients/${encodeURIComponent(slug)}.json`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Client no trobat: ' + slug);
      client = await res.json();
    }
    const edited = this.read(this.key(slug, 'services'), null);
    if (edited) client.services = edited;
    Object.assign(client, this.read(this.key(slug, 'settings'), {}));   // ajustos fets al panell (p. ex. cada quant dona hora)
    client.slug = slug;
    // La demo arrenca amb l'agenda plena perquè es vegi com treballa un negoci real.
    if (client.demoSeed && localStorage.getItem(this.key(slug, 'appts')) === null) this.write(this.key(slug, 'appts'), demoAppts(client));
    this.config = client;
    return client;
  },

  // Panell del propietari en mode servidor: totes les cites dels últims mesos, amb dades personals.
  async attachOwner(biz) {
    this.remote = true; this.biz = biz;
    this.config = { ...biz.config, slug: biz.slug, adminPinHash: biz.pin_hash };
    const fetch = () => Remote.ownerRecords(biz.id, 'appt', 120);
    this.cache = await fetch();
    Remote.poll(fetch, list => { this.cache = list; this.emit(); }, 5000);
  },
  // Pàgina de reserves en mode servidor: només les hores ocupades (sense dades de ningú).
  async attachPublic(slug) {
    const from = toISODate(addDays(new Date(), -1)), to = toISODate(addDays(new Date(), 90));
    const fetch = () => Remote.busy(slug, from, to);
    this.cache = await fetch();
    Remote.poll(fetch, list => { this.cache = list; this.emit(); }, 15000);
  },

  async saveServices(slug, services) {
    if (this.remote) { this.config.services = services; return Remote.saveConfig(this.biz.id, this.config); }
    this.write(this.key(slug, 'services'), services);
  },
  resetServices(slug) { try { localStorage.removeItem(this.key(slug, 'services')); } catch (_) {} },
  // Ajustos generals del negoci (slotMinutes, fillGaps…).
  async saveSettings(slug, patch) {
    Object.assign(this.config, patch);
    if (this.remote) return Remote.saveConfig(this.biz.id, this.config);
    this.write(this.key(slug, 'settings'), { ...this.read(this.key(slug, 'settings'), {}), ...patch });
  },

  getAppts(slug) { return this.remote ? this.cache : this.read(this.key(slug, 'appts'), []); },

  // Desa una cita nova si l'hora encara és lliure. Retorna la cita o null si algú l'ha agafat abans.
  async addAppt(client, appt) {
    if (this.remote) {
      const r = await Remote.place(client.slug, 'appt', appt);
      if (!r.record) return null;
      this.cache = [...this.cache, r.record];
      return r.record;
    }
    const appts = this.getAppts(client.slug);
    if (!isFree(client, appts, appt.staffId, appt.date, toMin(appt.time), appt.duration)) return null;
    const full = { ...appt, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      code: Math.random().toString(36).slice(2, 6).toUpperCase(), status: 'confirmada', createdAt: Date.now() };
    appts.push(full);
    this.write(this.key(client.slug, 'appts'), appts);
    return full;
  },
  async updateAppt(slug, id, patch) {
    if (this.remote) {
      const cur = this.cache.find(a => a.id === id);
      await Remote.updateRecord(id, patch, cur);
      this.cache = this.cache.map(a => a.id === id ? { ...a, ...patch } : a);
      return;
    }
    this.write(this.key(slug, 'appts'), this.getAppts(slug).map(a => a.id === id ? { ...a, ...patch } : a));
  },
  clearAppts(slug) { this.write(this.key(slug, 'appts'), []); },

  // ---- Caixa (shared/caixa.js) ----
  // paidAt: moment del cobrament (ms) o null. "current" és la cita original (per a mesos antics que
  // no són a la còpia en directe): es reescriuen les seves dades, així que no hi ha de portar res més.
  async setApptPaid(slug, id, paidAt, current) {
    if (this.remote) {
      await Remote.updateRecord(id, { paidAt }, this.cache.find(a => a.id === id) || current);
      this.cache = this.cache.map(a => a.id === id ? { ...a, paidAt } : a);
      return;
    }
    this.write(this.key(slug, 'appts'), this.getAppts(slug).map(a => a.id === id ? { ...a, paidAt } : a));
  },
  // Cost de cada servei (producte, tint…), només per al propietari: va a la part privada del negoci.
  getCosts(slug) {
    if (this.remote) return (this.biz.private && this.biz.private.costs) || {};
    const saved = this.read(this.key(slug, 'costs'), null);
    if (saved) return saved;
    if (this.config && this.config.demoSeed && typeof Caixa !== 'undefined') return Caixa.demoCosts(this.config.services.map(s => ({ key: s.id, price: s.price })));
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

  // "Les meves cites" del client (buscades pel telèfon) i cancel·lar-ne una.
  async findMine(slug, phone) {
    if (this.remote) return (await Remote.mine(slug, phone)).filter(a => a.serviceId);
    return this.getAppts(slug).filter(a => normPhone(a.customer.phone) === normPhone(phone));
  },
  async cancelMine(slug, id, phone) {
    if (this.remote) return Remote.cancelMine(slug, id, phone);
    await this.updateAppt(slug, id, { status: 'cancel·lada', cancelledBy: 'client' });
    return true;
  },

  emit() { this.listeners.forEach(cb => cb()); },
  onChange(cb) {
    this.listeners.push(cb);
    window.addEventListener('storage', e => { if (e.key && e.key.startsWith('reservafacil:')) cb(); });
  }
};

// Les cites que ocupen agenda (les cancel·lades no).
const BLOCKING = new Set(['confirmada', 'feta', 'no-presentat']);

// Trams d'obertura d'un professional un dia concret: [[inici, fi], ...] en minuts.
function staffRanges(client, staff, date) {
  const dow = String(fromISODate(date).getDay());
  const hours = (staff.hours || client.hours)[dow] || [];
  return hours.map(([a, b]) => [toMin(a), toMin(b)]);
}

function isFree(client, appts, staffId, date, start, duration) {
  const staff = client.staff.find(s => s.id === staffId);
  if (!staff) return false;
  const end = start + duration;
  if (!staffRanges(client, staff, date).some(([a, b]) => start >= a && end <= b)) return false;
  return !appts.some(x => x.staffId === staffId && x.date === date && BLOCKING.has(x.status) &&
    start < toMin(x.time) + x.duration && toMin(x.time) < end);
}

// Hores disponibles per a un servei un dia. staffId = 'any' busca qualsevol professional.
// Retorna [{ time: 'HH:MM', staffIds: [...] }].
function availableSlots(client, appts, date, serviceId, staffId, { respectNotice = true } = {}) {
  const service = client.services.find(s => s.id === serviceId);
  if (!service) return [];
  const staffList = client.staff.filter(s => s.services.includes(serviceId) && (staffId === 'any' || s.id === staffId));
  const now = new Date();
  const minStart = date === toISODate(now) && respectNotice
    ? now.getHours() * 60 + now.getMinutes() + (client.minNoticeMinutes || 0) : (date < toISODate(now) ? Infinity : -1);
  const step = client.slotMinutes || 15;
  const byTime = new Map();
  for (const s of staffList) {
    // Hores en què acaba una cita d'aquest professional: si el negoci ho vol (fillGaps, per defecte sí),
    // també s'ofereixen, perquè no quedin forats (p. ex. una barba de 15 min en una graella de 30).
    const ends = client.fillGaps === false ? [] : appts
      .filter(x => x.staffId === s.id && x.date === date && BLOCKING.has(x.status))
      .map(x => toMin(x.time) + x.duration);
    for (const [a, b] of staffRanges(client, s, date)) {
      const starts = new Set();
      for (let t = Math.ceil(a / step) * step; t + service.duration <= b; t += step) starts.add(t);
      ends.forEach(t => { if (t >= a && t + service.duration <= b) starts.add(t); });
      for (const t of [...starts].sort((x, y) => x - y)) {
        if (t < minStart) continue;
        if (isFree(client, appts, s.id, date, t, service.duration)) {
          if (!byTime.has(t)) byTime.set(t, []);
          byTime.get(t).push(s.id);
        }
      }
    }
  }
  return [...byTime.entries()].sort((x, y) => x[0] - y[0]).map(([t, ids]) => ({ time: toHHMM(t), staffIds: ids }));
}

// Fitxer de calendari (.ics) perquè el client es guardi la cita al mòbil.
function icsFor(client, appt, serviceName) {
  const d = fromISODate(appt.date);
  const start = toMin(appt.time);
  const stamp = (min) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(Math.floor(min / 60))}${pad(min % 60)}00`;
  const clean = s => String(s).replace(/[,;\\]/g, m => '\\' + m).replace(/\n/g, ' ');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CreaTuApp//Tanda//CA', 'BEGIN:VEVENT',
    `UID:${appt.id}@reservafacil`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(start + appt.duration)}`,
    `SUMMARY:${clean(serviceName + ' · ' + client.name)}`, `LOCATION:${clean(client.address || '')}`,
    `DESCRIPTION:${clean('Codi de reserva: ' + appt.code)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Recordatori', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
}

// Cites d'exemple per a la demo: avui i els propers dies oberts, amb clients inventats.
function demoAppts(client) {
  const people = [['Marta Puig', '600 11 22 33'], ['Jordi Vila', '611 22 33 44'], ['Anna Soler', '622 33 44 55'], ['Pere Roca', '633 44 55 66'],
    ['Laura Font', '644 55 66 77'], ['Núria Camps', '655 66 77 88'], ['Pol Serra', '666 77 88 99'], ['Clara Mas', '677 88 99 00'],
    ['Joan Riera', '688 12 34 56'], ['Berta Coll', '699 23 45 67'], ['Oriol Pujol', '610 34 56 78'], ['Irene Sala', '620 45 67 89'],
    ['Xavi Martí', '630 56 78 90'], ['Elena Bosch', '640 67 89 01'], ['Arnau Prat', '650 78 90 12'], ['Mireia Costa', '660 89 01 23']];
  const plan = ['10:00', '11:00', '12:30', '16:30', '18:00', '09:30', '17:15'];
  const appts = [];
  const now = new Date();
  const today = toISODate(now);
  let k = 0;
  for (let d = -7, openDays = 0; d < 21 && openDays < 6; d++) {
    const date = toISODate(addDays(now, d));
    if (d >= 0 && client.staff.some(s => staffRanges(client, s, date).length)) openDays++;
    client.staff.forEach((s, si) => {
      const count = d < 0 ? 2 : d === 0 ? 4 : 3;
      for (let i = 0; i < count; i++) {
        const svcId = s.services[(k + i) % s.services.length];
        const svc = client.services.find(x => x.id === svcId);
        const time = plan[(i * 2 + si + Math.abs(d)) % plan.length];
        if (!svc || !isFree(client, appts, s.id, date, toMin(time), svc.duration)) continue;
        // Cada client com a molt una cita per dia.
        let pi = (k++ * 3 + si) % people.length;
        for (let tries = 0; tries < people.length && appts.some(a => a.date === date && a.customer.name === people[pi][0]); tries++) pi = (pi + 1) % people.length;
        const [name, phone] = people[pi];
        const isPast = date < today || (date === today && toMin(time) + svc.duration <= now.getHours() * 60 + now.getMinutes());
        appts.push({ id: 'demo' + k, code: 'D' + String(100 + k).slice(-3), serviceId: svc.id, serviceName: tr(svc.name, 'ca'), staffId: s.id, date, time,
          duration: svc.duration, price: svc.price, customer: { name, phone, email: '' }, note: '', source: k % 3 ? 'online' : 'panell',
          status: isPast ? (k % 9 === 0 ? 'no-presentat' : 'feta') : 'confirmada', createdAt: Date.now() - (30 - d) * 864e5 });
      }
    });
  }
  return appts;
}
