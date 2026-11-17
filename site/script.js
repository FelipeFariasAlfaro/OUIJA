(function () {
  var REPO = 'FelipeFariasAlfaro/OUIJA';
  var T = {
    en: {},
    es: {
      nav_what: 'Qué es', nav_goal: 'Objetivo', nav_dl: 'Descargar',
      tag: 'La búsqueda de escritorio murió en 2011.<br><strong>OUIJA la trae de vuelta de entre los muertos.</strong>',
      sub: 'Pregunta con tus palabras. Los espíritus responden dónde está el archivo. Todo corre en tu computador.',
      cta: 'Invoca la descarga', badge: 'Creado para Kiroween 2026 · Resurrection',
      what_h: 'Qué es',
      what_p: 'OUIJA es una app de escritorio para Windows y Linux que resucita una tecnología muerta, la búsqueda personal de escritorio, y los archivos que dejó atrás: documentos en formatos que ningún programa abre, respaldos que nadie recuerda y archivos enviados a la papelera.',
      c1_h: 'Invocar', c1_p: 'Busca por significado, no por palabras clave. «¿Dónde está el poema que escribí para Rosa?» y el tablero lo señala, incluso dentro de un respaldo.',
      c2_h: 'Formatos muertos', c2_p: 'WordPerfect, WordStar, Works, Lotus, chats de MSN Messenger, carpetas de Outlook Express y codificaciones rotas vuelven legibles.',
      c3_h: 'La Cripta', c3_p: 'Abre una herencia digital y obtén un grimorio de recuerdos: años, personas, retratos fechados y un epitafio. Expórtalo en PDF.',
      c4_h: 'Patíbulo y fantasmas', c4_p: 'Recupera lo que enviaste a la papelera y caza archivos olvidados, copias exactas y versiones casi idénticas.',
      c5_h: '100% local', c5_p: 'Sin nube ni telemetría. IA local primero (Ollama, LM Studio…); un modelo externo solo si tú lo eliges.',
      c6_h: 'Abierto a agentes', c6_p: 'Un servidor MCP deja que Kiro, Claude Desktop o cualquier agente pregunte a OUIJA dónde están tus archivos.',
      goal_h: 'Objetivo',
      goal_p1: 'Google Desktop Search prometía buscar en tu PC como Google en la web, y se descontinuó en 2011. Todo se fue a la nube, pero nuestros archivos no: siguen dispersos en discos, respaldos antiguos y formatos que nadie puede abrir.',
      goal_p2: 'OUIJA resucita esa idea con lo que entonces era imposible: embeddings locales, modelos de lenguaje locales y rescate forense de formatos antiguos. La meta es simple: recuerdas algo y tu propio computador lo encuentra, en privado.',
      kiro: 'Creado para <strong>Kiroween 2026</strong>, en la categoría Resurrection: una tecnología muerta, devuelta a la vida.',
      dl_h: 'Descargar', dl_loading: 'Buscando el último release…',
      dl_win: 'Descargar instalador', dl_appimage: 'Descargar AppImage', dl_deb: 'Descargar .deb',
      all_rel: 'Todos los releases',
      linux_note: 'AppImage: dale permisos de ejecución (<code>chmod +x OUIJA-*.AppImage</code>) y ejecútalo.',
      dl_ver: 'Última versión: ', dl_fail: 'No se pudo consultar el release; los botones llevan a la página de releases.'
    }
  };
  var en = {};
  var nodes = document.querySelectorAll('[data-i18n]');
  nodes.forEach(function (n) { en[n.getAttribute('data-i18n')] = n.innerHTML; });
  T.en = en;
  T.en.dl_ver = 'Latest version: ';
  T.en.dl_fail = 'Could not check the release; the buttons open the releases page.';

  var lang = (localStorage.getItem('lang') || (navigator.language || '').slice(0, 2)) === 'es' ? 'es' : 'en';
  var state = { ver: null, failed: false };
  function apply() {
    document.documentElement.lang = lang;
    nodes.forEach(function (n) {
      var k = n.getAttribute('data-i18n');
      if (k === 'dl_loading' && (state.ver || state.failed)) return;
      if (T[lang][k] != null) n.innerHTML = T[lang][k];
    });
    document.getElementById('lang').textContent = lang === 'es' ? 'EN' : 'ES';
    var v = document.getElementById('dl-version');
    if (state.ver) v.textContent = T[lang].dl_ver + state.ver;
    else if (state.failed) v.textContent = T[lang].dl_fail;
  }
  document.getElementById('lang').addEventListener('click', function () {
    lang = lang === 'es' ? 'en' : 'es';
    localStorage.setItem('lang', lang);
    apply();
  });
  apply();

  // Último release: se eligen los assets por extensión.
  fetch('https://api.github.com/repos/' + REPO + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (rel) {
      var map = { 'dl-win': /\.exe$/i, 'dl-appimage': /\.AppImage$/i, 'dl-deb': /\.deb$/i };
      Object.keys(map).forEach(function (id) {
        var a = (rel.assets || []).filter(function (x) { return map[id].test(x.name); })[0];
        if (a) document.getElementById(id).href = a.browser_download_url;
      });
      state.ver = rel.tag_name || rel.name;
      apply();
    })
    .catch(function () { state.failed = true; apply(); });

  // Relámpago ocasional.
  var flash = document.getElementById('flash');
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    (function strike() {
      setTimeout(function () {
        flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on');
        strike();
      }, 9000 + Math.random() * 14000);
    })();
  }
})();
