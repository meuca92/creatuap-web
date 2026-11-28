// Idiomes de la web de CreaTuApp: català (el text original de cada pàgina), castellà i anglès.
// Com funciona: cada pàgina està escrita en català i carrega, després d'aquest fitxer, el seu diccionari
// (i18n/<pàgina>.js) amb cada frase en castellà i anglès: I18N.add({ 'text en català': ['castellà', 'anglès'] }).
// En arrencar (i18nStart()) i cada cop que el JS de la pàgina pinta alguna cosa nova, es canvien els textos
// que surten al diccionari. Un text que no hi és surt en català: si canvies o afegeixes una frase en català
// a una pàgina, posa-la també al seu diccionari.
// La tria es guarda a localStorage ('creatuapp:lang'); la primera vegada es fa servir l'idioma del navegador.
(function () {
  const LANGS = ['ca', 'es', 'en'];
  let lang = '';
  try { lang = localStorage.getItem('creatuapp:lang') || ''; } catch (_) {}
  if (!LANGS.includes(lang)) lang = (navigator.language || '').slice(0, 2);
  if (!LANGS.includes(lang)) lang = 'ca';
  window.LANG = lang;
  window.LOCALE = { ca: 'ca-ES', es: 'es-ES', en: 'en-GB' }[lang];
  window.setLang = l => { try { localStorage.setItem('creatuapp:lang', l); } catch (_) {} location.reload(); };

  const D = {}, R = [], META = {};
  const col = lang === 'es' ? 0 : 1;
  window.I18N = {
    // dict: { ca: [es, en] }   rules: [[regex, es, en]] (es/en poden ser funcions (m) => text)   meta: { title: [es, en], description: [es, en] }
    add(dict, rules, meta) { Object.assign(D, dict || {}); (rules || []).forEach(r => R.push(r)); Object.assign(META, meta || {}); }
  };

  const norm = s => String(s).replace(/\s+/g, ' ').trim();
  function tr(s) {
    if (lang === 'ca' || s == null) return null;
    const k = norm(s);
    if (!k) return null;
    if (Object.prototype.hasOwnProperty.call(D, k)) return D[k][col];
    for (const r of R) {
      const m = k.match(r[0]);
      if (m) { const v = r[1 + col]; return typeof v === 'function' ? v(m) : k.replace(r[0], v); }
    }
    return null;
  }
  // T('text en català') → el text en l'idioma triat (o el mateix si no hi és). Per a alert(), confirm(), etc.
  window.T = s => { const v = tr(s); return v == null ? s : v; };

  const ATTRS = ['placeholder', 'aria-label', 'title'];
  const SKIP = /^(SCRIPT|STYLE|TEXTAREA|INPUT|IFRAME)$/;
  const NOTR = el => el.closest && el.closest('[data-notr]');   // contingut escrit pels usuaris: no es toca
  function text(n) {
    if (n.parentNode && NOTR(n.parentNode)) return;
    const v = tr(n.data);
    if (v == null) return;
    const lead = n.data.match(/^\s*/)[0], trail = n.data.match(/\s*$/)[0];
    const nv = lead + v + trail;
    if (nv !== n.data) n.data = nv;
  }
  function attrs(e) {
    for (const a of ATTRS) if (e.hasAttribute(a)) { const v = tr(e.getAttribute(a)); if (v != null) e.setAttribute(a, v); }
  }
  function walk(root) {
    if (root.nodeType === 3) return text(root);
    if (root.nodeType !== 1 || NOTR(root)) return;
    if (SKIP.test(root.nodeName)) { if (root.nodeName === 'INPUT' || root.nodeName === 'TEXTAREA') attrs(root); return; }
    attrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.nodeType === 1 && (n.hasAttribute('data-notr') || /^(SCRIPT|STYLE|IFRAME|TEXTAREA)$/.test(n.nodeName))
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    let n;
    while ((n = w.nextNode())) n.nodeType === 3 ? text(n) : attrs(n);
  }

  // Selector petit (CA · ES · EN) dins de l'element #langs de la pàgina
  function switcher() {
    const box = document.getElementById('langs');
    if (!box) return;
    if (!document.getElementById('langs-css')) {
      const st = document.createElement('style'); st.id = 'langs-css';
      st.textContent = '.langs{display:inline-flex;border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:2px;background:rgba(255,255,255,.04)}'
        + '.langs button{border:0;background:none;color:#9aa2b6;font:600 .72rem/1 system-ui,sans-serif;letter-spacing:.04em;padding:6px 7px;border-radius:999px;cursor:pointer}'
        + '.langs button:hover{color:#fff}.langs button.on{background:rgba(139,92,246,.28);color:#fff}';
      document.head.appendChild(st);
    }
    box.classList.add('langs');
    box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Idioma');
    box.innerHTML = LANGS.map(l => `<button type="button" class="${l === lang ? 'on' : ''}" aria-pressed="${l === lang}" title="${{ ca: 'Català', es: 'Español', en: 'English' }[l]}">${l.toUpperCase()}</button>`).join('');
    box.querySelectorAll('button').forEach((b, i) => b.onclick = () => { if (LANGS[i] !== lang) window.setLang(LANGS[i]); });
  }

  let started = false;
  window.i18nStart = function () {
    if (started) return; started = true;
    switcher();
    if (lang === 'ca') return;
    document.documentElement.lang = lang;
    if (META.title) document.title = META.title[col];
    const md = document.querySelector('meta[name=description]');
    if (md && META.description) md.content = META.description[col];
    walk(document.body);
    // Tot el que el JS de la pàgina pinti després també es tradueix.
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(walk))).observe(document.body, { childList: true, subtree: true });
  };
})();
