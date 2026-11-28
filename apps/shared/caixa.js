// Caixa: full de vendes tipus Excel, compartit pels panells (BotigaExpress, CartaQR…).
//   · Dia: una fila per comanda; en verd les cobrades (amb l'hora del cobrament), botó "Cobrar".
//   · Mes: una fila per dia; total del mes. Tocar un dia obre el dia.
//   · Cost dels productes (privat del propietari) → benefici. Descàrrega CSV per a l'Excel.
//
// L'app crida Caixa.init({...}) un cop i Caixa.view() per pintar la pestanya. Opcions:
//   store      objecte Store de l'app amb getOrders, setPaid(slug,id,paidAt,current), getCosts, saveCosts, remote, biz
//   slug       negoci
//   items(o)   línies de la comanda: [{ key, qty, label }]   (key = clau del cost: "producte" o "producte:variant")
//   who(o)     text curt de qui/on: "Marta Puig", "Taula 4"…
//   payLabel(o) com havia de pagar (o '' si no aplica)
//   statusText(o) nom de l'estat per a l'Excel
//   costItems() llista per posar costos: [{ key, name, price }]
//   modal(html), closeModal(), toast(text), render()
//   rangeFetch(fromISO, toISO) → Promise<comandes>   (només en mode servidor; si no, es fan servir les de getOrders)
const Caixa = (() => {
  let o, mode = 'dia', day = null, month = null;
  const cache = new Map();           // 'AAAA-MM' → { at, list } comandes del servidor d'aquell mes
  const loading = new Set();
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d || 1); };
  const r2 = n => Math.round(n * 100) / 100;
  const money = n => n.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR' });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dayOf = ord => iso(new Date(ord.createdAt));
  const time = ts => new Date(ts).toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' });
  const short = ts => new Date(ts).toLocaleString('ca-ES', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  const dayName = (d, f) => fromIso(d).toLocaleDateString('ca-ES', f);
  // Paraules que canvien segons l'app (Tanda parla de cites i serveis, no de comandes i productes).
  const W = () => ({ one: 'comanda', many: 'comandes', Title: 'Comanda', things: 'productes', thing: 'producte', ofThings: 'dels productes', ...(o.words || {}) });

  // Moment del cobrament, o null. Sense marca: amb targeta es va cobrar en fer-la; la resta, pendent.
  function paidAt(ord) {
    if (ord.paidAt !== undefined) return ord.paidAt;
    return ord.payment === 'targeta' ? ord.createdAt : null;
  }
  function cost(ord, costs) {
    return r2(o.items(ord).reduce((s, it) => s + (costs[it.key] ?? costs[it.key.split(':')[0]] ?? 0) * it.qty, 0));
  }
  function figures(list, costs) {
    const live = list.filter(x => x.status !== 'cancel·lada');
    const sales = r2(live.reduce((s, x) => s + (x.total || 0), 0));
    const paid = r2(live.filter(paidAt).reduce((s, x) => s + (x.total || 0), 0));
    const c = r2(live.reduce((s, x) => s + cost(x, costs), 0));
    return { n: live.length, sales, paid, pending: r2(sales - paid), cost: c, profit: r2(sales - c) };
  }

  // Comandes d'un mes: les del servidor (carregades sota demanda) barrejades amb les que ja té el panell
  // en directe (més noves). En mode local, directament les de l'app.
  function monthOrders(m) {
    const live = o.store.getOrders(o.slug);
    if (!o.store.remote || !o.rangeFetch) return live.filter(x => dayOf(x).startsWith(m));
    const c = cache.get(m);
    if ((!c || Date.now() - c.at > 60e3) && !loading.has(m)) {
      loading.add(m);
      const from = fromIso(m + '-01'), to = new Date(from); to.setMonth(to.getMonth() + 1);
      o.rangeFetch(from.toISOString(), to.toISOString())
        .then(list => { cache.set(m, { at: Date.now(), list }); })
        .catch(() => o.toast('⚠️ No s\'han pogut carregar les vendes. Revisa la connexió.'))
        .finally(() => { loading.delete(m); o.render(); });
    }
    const byId = new Map(((c && c.list) || []).map(x => [x.id, x]));
    live.filter(x => dayOf(x).startsWith(m)).forEach(x => byId.set(x.id, x));
    return [...byId.values()];
  }
  const isLoading = m => o.store.remote && o.rangeFetch && !cache.has(m);
  const findOrder = id => {
    for (const c of cache.values()) { const x = c.list.find(y => y.id === id); if (x) return x; }
    return o.store.getOrders(o.slug).find(y => y.id === id);
  };

  function view() {
    const today = iso(new Date());
    day = day || today; month = month || today.slice(0, 7);
    const costs = o.store.getCosts(o.slug);
    const hasCosts = Object.values(costs).some(v => v > 0);
    const m = mode === 'dia' ? day.slice(0, 7) : month;
    const list = monthOrders(m);
    const bar = `<div class="cx-bar">
        <div class="cx-seg"><button class="${mode === 'dia' ? 'on' : ''}" onclick="Caixa.setMode('dia')">Dia</button><button class="${mode === 'mes' ? 'on' : ''}" onclick="Caixa.setMode('mes')">Mes</button></div>
        <div class="cx-nav"><button onclick="Caixa.move(-1)" aria-label="Anterior">‹</button><span>${mode === 'dia'
          ? (day === today ? 'Avui' : dayName(day, { weekday: 'short', day: 'numeric', month: 'long' }))
          : fromIso(month + '-01').toLocaleDateString('ca-ES', { month: 'long', year: 'numeric' })}</span><button onclick="Caixa.move(1)" aria-label="Següent">›</button></div>
        <div class="cx-tools"><button onclick="Caixa.askCosts()">🏷️ Cost ${W().ofThings}</button><button onclick="Caixa.exportCSV()">⬇️ Descarregar per a Excel</button><button onclick="Caixa.askColors()">🎨 Colors</button></div>
      </div>`;
    const kpis = f => `<div class="cx-kpis">
        <div class="cx-kpi"><small>Vendes</small><b>${money(f.sales)}</b></div>
        <div class="cx-kpi good"><small>Cobrat</small><b>${money(f.paid)}</b></div>
        <div class="cx-kpi ${f.pending ? 'warn' : ''}"><small>Per cobrar</small><b>${money(f.pending)}</b></div>
        <div class="cx-kpi"><small>${hasCosts ? 'Benefici' : 'Benefici (sense costos)'}</small><b>${money(f.profit)}</b></div>
      </div>
      ${hasCosts ? '' : `<div class="cx-help">💡 Per veure el <b>benefici de veritat</b>, posa quant et costa cada ${W().thing} a <b>🏷️ Cost ${W().ofThings}</b>. Només ho veus tu: els clients no ho veuen mai.</div>`}`;
    const wait = isLoading(m) ? '<p class="cx-loading">Carregant les vendes…</p>' : '';

    if (mode === 'dia') {
      const rows = list.filter(x => dayOf(x) === day).sort((a, b) => a.createdAt - b.createdAt);
      const f = figures(rows, costs);
      const cols = hasCosts ? 8 : 6;
      const body = rows.map(x => {
        const p = paidAt(x), cancel = x.status === 'cancel·lada', c = cost(x, costs);
        return `<tr class="${cancel ? 'cancel' : p ? 'paid' : 'unpaid'}">
          <td>${time(x.createdAt)}</td><td>#${x.num}</td><td>${esc(o.who(x))}</td><td>${esc(o.payLabel(x))}</td>
          <td class="r">${money(x.total || 0)}</td>${hasCosts ? `<td class="r">${money(c)}</td><td class="r">${money(r2((x.total || 0) - c))}</td>` : ''}
          <td>${cancel ? 'Cancel·lada' : p ? `<span class="cx-ok">✓ ${short(p)}<button onclick="Caixa.unpay('${x.id}')">desfer</button></span>` : `<button class="cx-pay" onclick="Caixa.pay('${x.id}')">💶 Cobrar</button>`}</td></tr>`;
      }).join('');
      return `<h2>Caixa</h2><p class="sub">Totes les vendes, com en un full de càlcul. <b style="color:var(--c-paid, #166534)">■ Cobrades</b> · <b style="color:var(--c-due, #dc2626)">■ Falta cobrar</b></p>${bar}${wait}
        <div class="cx-wrap"><table class="cx-sheet"><thead><tr><th>Hora</th><th>${W().Title}</th><th>Client</th><th>${o.words && o.words.noPay ? '' : 'Pagament'}</th><th class="r">Total</th>${hasCosts ? '<th class="r">Cost</th><th class="r">Benefici</th>' : ''}<th>Cobrada</th></tr></thead>
          <tbody>${body || `<tr><td colspan="${cols}" class="cx-none"><span>Cap venda aquest dia.</span></td></tr>`}</tbody>
          ${rows.length ? `<tfoot><tr><td colspan="4">Total del dia · ${f.n} ${f.n === 1 ? W().one : W().many}</td><td class="r">${money(f.sales)}</td>${hasCosts ? `<td class="r">${money(f.cost)}</td><td class="r">${money(f.profit)}</td>` : ''}<td>${f.pending ? `<span class="neg">Falta ${money(f.pending)}</span>` : '✓ Tot cobrat'}</td></tr></tfoot>` : ''}
        </table></div>${kpis(f)}`;
    }

    const days = [...new Set(list.map(dayOf))].sort();
    const f = figures(list, costs);
    const body = days.map(d => {
      const g = figures(list.filter(x => dayOf(x) === d), costs);
      return `<tr class="click ${g.pending ? 'unpaid' : 'paid'}" onclick="Caixa.openDay('${d}')">
        <td>${dayName(d, { weekday: 'short', day: 'numeric' })}</td><td class="r">${g.n}</td><td class="r">${money(g.sales)}</td>
        <td class="r">${money(g.paid)}</td><td class="r ${g.pending ? 'neg' : ''}">${money(g.pending)}</td>
        ${hasCosts ? `<td class="r">${money(g.cost)}</td>` : ''}<td class="r"><b>${money(g.profit)}</b></td></tr>`;
    }).join('');
    return `<h2>Caixa</h2><p class="sub">El mes, dia per dia. Toca un dia per veure'n les ${W().many}.</p>${bar}${wait}
      <div class="cx-wrap"><table class="cx-sheet"><thead><tr><th>Dia</th><th class="r">${W().many[0].toUpperCase() + W().many.slice(1)}</th><th class="r">Vendes</th><th class="r">Cobrat</th><th class="r">Per cobrar</th>${hasCosts ? '<th class="r">Cost</th>' : ''}<th class="r">Benefici</th></tr></thead>
        <tbody>${body || `<tr><td colspan="${hasCosts ? 7 : 6}" class="cx-none"><span>Cap venda aquest mes.</span></td></tr>`}</tbody>
        ${days.length ? `<tfoot><tr><td>Total del mes</td><td class="r">${f.n}</td><td class="r">${money(f.sales)}</td><td class="r">${money(f.paid)}</td><td class="r">${money(f.pending)}</td>${hasCosts ? `<td class="r">${money(f.cost)}</td>` : ''}<td class="r">${money(f.profit)}</td></tr></tfoot>` : ''}
      </table></div>${kpis(f)}`;
  }

  function setMode(m) { mode = m; o.render(); }
  function openDay(d) { mode = 'dia'; day = d; o.render(); }
  function move(n) {
    if (mode === 'dia') { const d = fromIso(day); d.setDate(d.getDate() + n); day = iso(d); }
    else { const d = fromIso(month + '-01'); d.setMonth(d.getMonth() + n); month = iso(d).slice(0, 7); }
    o.render();
  }
  // Canvia el cobrament i ho reflecteix també a la còpia del mes, per no haver d'esperar el servidor.
  function setPaid(id, when) {
    const cur = findOrder(id);
    if (!cur) return;
    for (const c of cache.values()) c.list = c.list.map(x => x.id === id ? { ...x, paidAt: when } : x);
    Promise.resolve(o.store.setPaid(o.slug, id, when, cur)).then(o.render, () => o.toast('⚠️ No s\'ha pogut desar. Revisa la connexió.'));
    o.render();
  }
  function pay(id) { setPaid(id, Date.now()); o.toast('💶 Cobrada'); }
  function unpay(id) {
    const x = findOrder(id);
    o.modal(`<h3>Marcar #${x.num} com a no cobrada?</h3><p>${esc(o.who(x))} · ${money(x.total || 0)}. Tornarà a sortir en vermell, com a pendent de cobrar.</p>
      <div class="cx-row"><button class="cx-btn sec" onclick="Caixa.close()">No</button><button class="cx-btn bad" onclick="Caixa.close();Caixa.doUnpay('${id}')">Sí, no cobrada</button></div>`);
  }

  // ---- Colors dels estats (cobrat / pendent / falta pagar), al gust de cada negoci ----
  const DEF = { paid: '#16a34a', pending: '#7c3aed', due: '#dc2626' };
  const colorsKey = () => 'panelColors:' + o.slug;
  function getColors() {
    const c = (o.store.config && o.store.config.panelColors) || (() => { try { return JSON.parse(localStorage.getItem(colorsKey())); } catch (_) { return null; } })();
    return { ...DEF, ...(c || {}) };
  }
  function applyColors() {
    const c = getColors(), r = document.documentElement.style;
    r.setProperty('--c-paid', c.paid); r.setProperty('--c-pending', c.pending); r.setProperty('--c-due', c.due);
  }
  function askColors() {
    const c = getColors();
    const row = (k, label, hint) => `<label class="cx-cost"><span>${label}<small>${hint}</small></span>
      <input type="color" data-ck="${k}" value="${c[k]}" style="width:64px;height:44px;padding:2px;border-radius:10px"></label>`;
    o.modal(`<h3>🎨 Colors del panell</h3><p>Tria el color de cada estat. Només canvia el que veus tu i el teu equip; els clients no ho veuen.</p>
      <div class="cx-costs">${row('paid', '✅ Cobrat', 'Vendes o cites ja pagades')}${row('pending', '⏳ Pendent', 'Cites que encara han de venir')}${row('due', '💶 Falta per pagar', 'El que encara no s\'ha cobrat')}</div>
      <div class="cx-row"><button class="cx-btn sec" onclick="Caixa.resetColors()">Tornar als de sempre</button><button class="cx-btn main" onclick="Caixa.saveColors()">Desar</button></div>`);
  }
  async function storeColors(c) {
    if (o.store.remote && o.store.config) {
      o.store.config.panelColors = c;
      await Remote.saveConfig(o.store.biz.id, o.store.config);
    } else {
      if (o.store.config) o.store.config.panelColors = c;
      try { localStorage.setItem(colorsKey(), JSON.stringify(c)); } catch (_) {}
    }
  }
  function saveColors() {
    const c = {};
    document.querySelectorAll('[data-ck]').forEach(i => { c[i.dataset.ck] = i.value; });
    o.closeModal(); applyColors.call(null);
    Promise.resolve(storeColors(c)).then(() => { applyColors(); o.toast('🎨 Colors desats'); o.render(); }, () => o.toast('⚠️ No s\'han pogut desar. Revisa la connexió.'));
  }
  function resetColors() {
    o.closeModal();
    Promise.resolve(storeColors({ ...DEF })).then(() => { applyColors(); o.toast('Colors de sempre'); o.render(); });
  }

  function askCosts() {
    const costs = o.store.getCosts(o.slug);
    o.modal(`<h3>🏷️ Quant et costa cada ${W().thing}?</h3><p>${(o.words && o.words.costHint) || 'Posa el que et costa fer-lo o comprar-lo (per unitat).'} Serveix per calcular el benefici. <b>Només ho veus tu.</b></p>
      <div class="cx-costs">${o.costItems().map(it => `<label class="cx-cost"><span>${esc(it.name)}<small>Es ven a ${money(it.price)}</small></span>
        <input type="number" inputmode="decimal" step="0.01" min="0" data-key="${esc(it.key)}" value="${costs[it.key] ?? ''}" placeholder="0,00"></label>`).join('')}</div>
      <div class="cx-row"><button class="cx-btn sec" onclick="Caixa.close()">Tornar</button><button class="cx-btn main" onclick="Caixa.saveCosts()">Desar</button></div>`);
  }
  function saveCosts() {
    const costs = {};
    document.querySelectorAll('input[data-key]').forEach(i => {
      const v = parseFloat(String(i.value).replace(',', '.'));
      if (!isNaN(v) && v >= 0) costs[i.dataset.key] = Math.round(v * 100) / 100;
    });
    Promise.resolve(o.store.saveCosts(o.slug, costs)).then(o.render, () => o.toast('⚠️ No s\'ha pogut desar. Revisa la connexió.'));
    o.closeModal(); o.toast('Costos desats'); o.render();
  }

  // El que es veu (dia o mes) en un CSV que obre l'Excel: separat per ; i amb comes decimals.
  function exportCSV() {
    const costs = o.store.getCosts(o.slug);
    const num = n => String(r2(n)).replace('.', ',');
    const cell = v => /[;"\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
    let rows, name;
    if (mode === 'dia') {
      name = `caixa-${day}.csv`;
      rows = [['Data', 'Hora', W().Title, 'Client', W().things[0].toUpperCase() + W().things.slice(1), 'Pagament', 'Estat', 'Total', 'Cost', 'Benefici', 'Cobrada', 'Cobrada el']];
      monthOrders(day.slice(0, 7)).filter(x => dayOf(x) === day).sort((a, b) => a.createdAt - b.createdAt).forEach(x => {
        const c = cost(x, costs), p = paidAt(x);
        rows.push([day, time(x.createdAt), x.num, o.who(x), o.items(x).map(it => `${it.qty}x ${it.label}`).join(', '), o.payLabel(x),
          o.statusText(x), num(x.total || 0), num(c), num((x.total || 0) - c), x.status === 'cancel·lada' ? '' : p ? 'Sí' : 'No', p ? new Date(p).toLocaleString('ca-ES') : '']);
      });
    } else {
      name = `caixa-${month}.csv`;
      rows = [['Dia', W().many[0].toUpperCase() + W().many.slice(1), 'Vendes', 'Cobrat', 'Per cobrar', 'Cost', 'Benefici']];
      const list = monthOrders(month);
      [...new Set(list.map(dayOf))].sort().forEach(d => {
        const g = figures(list.filter(x => dayOf(x) === d), costs);
        rows.push([d, g.n, num(g.sales), num(g.paid), num(g.pending), num(g.cost), num(g.profit)]);
      });
      const f = figures(list, costs);
      rows.push(['TOTAL', f.n, num(f.sales), num(f.paid), num(f.pending), num(f.cost), num(f.profit)]);
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    o.toast('⬇️ Fitxer descarregat');
  }

  // Cost per defecte de la demo (35 % del preu), perquè es vegi el benefici sense haver de posar res.
  function demoCosts(items) {
    const c = {};
    items.forEach(it => { c[it.key] = r2(it.price * .35); });
    return c;
  }

  return {
    init(opts) { o = opts; applyColors(); }, applyColors, askColors, saveColors, resetColors, view, paidAt, cost, setMode, openDay, move, pay, unpay, askCosts, saveCosts, exportCSV, demoCosts,
    doUnpay: id => setPaid(id, null), close: () => o.closeModal()
  };
})();
