// Va al <head> de cada app, just després del <link rel="manifest">. Per als negocis reals canvia el
// manifest genèric de la plantilla pel del negoci (funció "manifest" del servidor): així, en desar l'app
// a la pantalla d'inici, surt amb el seu nom i logo i s'obre directament el seu negoci.
// La demo i les apps de prova (local-…) es queden amb el manifest de la plantilla.
(function () {
  var c = new URLSearchParams(location.search).get('c');
  var panelPage = /admin\.html$/.test(location.pathname);
  var LAST = 'creatuapp:last:' + location.pathname.replace(/[^/]*$/, '') + (panelPage ? 'admin' : 'app');
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  // Una app desada a la pantalla d'inici que s'obre sense dir de quin negoci és (p. ex. si el mòbil va
  // agafar el manifest de la plantilla): tornem a l'últim negoci obert en aquest mòbil, no a la demo.
  if (!c && standalone) {
    try {
      var last = localStorage.getItem(LAST);
      if (last) { location.replace(location.pathname + '?c=' + encodeURIComponent(last)); return; }
    } catch (_) {}
  }
  if (!c || c === 'demo' || c.indexOf('local-') === 0) return;
  try { localStorage.setItem(LAST, c); } catch (_) {}
  var link = document.querySelector('link[rel="manifest"]');
  if (!link) return;
  var panel = /admin\.html$/.test(location.pathname);
  link.href = 'https://yakopwhkkvpjffisdfkk.supabase.co/functions/v1/manifest?c=' + encodeURIComponent(c) + '&p=' + (panel ? 'admin' : 'app');

  // Android/Chrome: si el navegador ofereix instal·lar-la, ho proposem amb un avís petit que es pot tancar
  // (un sol cop per aparell i negoci). A l'iPhone no hi ha aquest avís: ho explica el negoci.
  var KEY = 'creatuapp:install:' + c + (panel ? ':panel' : '');
  window.addEventListener('beforeinstallprompt', function (ev) {
    try { if (localStorage.getItem(KEY)) return; } catch (_) {}
    ev.preventDefault();
    var bar = document.createElement('div');
    bar.setAttribute('role', 'dialog');
    bar.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:10px;' +
      'background:#1c1917;color:#fff;padding:10px 12px 10px 16px;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.25);' +
      'font:600 15px/1.3 "DM Sans",system-ui,sans-serif;max-width:calc(100% - 24px)';
    bar.innerHTML = '<span>📲 Desa aquesta app al mòbil</span>' +
      '<button style="background:#fff;color:#1c1917;border:0;border-radius:10px;padding:8px 12px;font:inherit;cursor:pointer">Instal·lar</button>' +
      '<button aria-label="Tancar" style="background:none;border:0;color:#fff;font-size:20px;cursor:pointer;padding:0 4px">×</button>';
    var bs = bar.querySelectorAll('button');
    var close = function () { bar.remove(); try { localStorage.setItem(KEY, '1'); } catch (_) {} };
    bs[0].onclick = function () { ev.prompt(); close(); };
    bs[1].onclick = close;
    var show = function () { document.body.appendChild(bar); };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  });
})();
