(function () {
  var REPO = 'FelipeFariasAlfaro/OUIJA';
  var SUPPORTED = ['en', 'es', 'pt', 'fr', 'ja', 'zh'];
  var T = {
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
    },
    pt: {
      nav_what: 'O que é', nav_goal: 'Objetivo', nav_dl: 'Baixar',
      tag: 'A busca de desktop morreu em 2011.<br><strong>OUIJA a traz de volta dos mortos.</strong>',
      sub: 'Pergunte com suas palavras. Os espíritos respondem onde está o arquivo. Tudo roda no seu computador.',
      cta: 'Invoque o download', badge: 'Criado para a Kiroween 2026 · Resurrection',
      what_h: 'O que é',
      what_p: 'OUIJA é um app de desktop para Windows e Linux que ressuscita uma tecnologia morta, a busca pessoal no desktop, e os arquivos que ela deixou: documentos em formatos que nenhum programa abre mais, backups que ninguém lembra e arquivos enviados para a lixeira.',
      c1_h: 'Invocar', c1_p: 'Busque por significado, não por palavras-chave. «Onde está o poema que escrevi para a Rosa?» e o tabuleiro aponta, até dentro de um backup.',
      c2_h: 'Formatos mortos', c2_p: 'WordPerfect, WordStar, Works, Lotus, conversas do MSN Messenger, pastas do Outlook Express e codificações quebradas voltam legíveis.',
      c3_h: 'A Cripta', c3_p: 'Abra uma herança digital e receba um grimório de memórias: anos, pessoas, retratos datados e um epitáfio. Exporte em PDF.',
      c4_h: 'Forca e fantasmas', c4_p: 'Recupere o que foi para a lixeira e cace arquivos esquecidos, cópias exatas e versões quase idênticas.',
      c5_h: '100% local', c5_p: 'Sem nuvem nem telemetria. IA local primeiro (Ollama, LM Studio…); um modelo externo só se você escolher.',
      c6_h: 'Aberto a agentes', c6_p: 'Um servidor MCP permite que Kiro, Claude Desktop ou qualquer agente pergunte ao OUIJA onde estão seus arquivos.',
      goal_h: 'Objetivo',
      goal_p1: 'O Google Desktop Search prometia buscar no seu PC como o Google na web e foi descontinuado em 2011. Tudo foi para a nuvem, mas nossos arquivos não: continuam espalhados por discos, backups antigos e formatos que ninguém abre.',
      goal_p2: 'O OUIJA ressuscita essa ideia com o que era impossível na época: embeddings locais, modelos de linguagem locais e resgate forense de formatos antigos. A meta é simples: você lembra de algo e o seu próprio computador encontra, em privado.',
      kiro: 'Criado para a <strong>Kiroween 2026</strong>, na categoria Resurrection: uma tecnologia morta, trazida de volta à vida.',
      dl_h: 'Baixar', dl_loading: 'Procurando o último release…',
      dl_win: 'Baixar instalador', dl_appimage: 'Baixar AppImage', dl_deb: 'Baixar .deb',
      all_rel: 'Todos os releases',
      linux_note: 'AppImage: dê permissão de execução (<code>chmod +x OUIJA-*.AppImage</code>) e execute.',
      dl_ver: 'Última versão: ', dl_fail: 'Não foi possível consultar o release; os botões levam à página de releases.'
    },
    fr: {
      nav_what: 'Qu’est-ce que c’est', nav_goal: 'Objectif', nav_dl: 'Télécharger',
      tag: 'La recherche de bureau est morte en 2011.<br><strong>OUIJA la ramène d’entre les morts.</strong>',
      sub: 'Posez votre question avec vos mots. Les esprits répondent où se trouve le fichier. Tout tourne sur votre ordinateur.',
      cta: 'Invoquer le téléchargement', badge: 'Créé pour Kiroween 2026 · Resurrection',
      what_h: 'Qu’est-ce que c’est',
      what_p: 'OUIJA est une application de bureau pour Windows et Linux qui ressuscite une technologie morte, la recherche personnelle sur le bureau, et les fichiers qu’elle a laissés : des documents dans des formats que plus aucun programme n’ouvre, des sauvegardes oubliées et des fichiers envoyés à la corbeille.',
      c1_h: 'Invoquer', c1_p: 'Cherchez par le sens, pas par mots-clés. « Où est le poème que j’ai écrit pour Rosa ? » et la planche le désigne, même dans une sauvegarde.',
      c2_h: 'Formats morts', c2_p: 'WordPerfect, WordStar, Works, Lotus, conversations MSN Messenger, dossiers Outlook Express et encodages cassés redeviennent lisibles.',
      c3_h: 'La Crypte', c3_p: 'Ouvrez un héritage numérique et obtenez un grimoire de souvenirs : années, personnes, portraits datés et une épitaphe. Exportez-le en PDF.',
      c4_h: 'Gibet et fantômes', c4_p: 'Récupérez ce que vous avez mis à la corbeille et traquez les fichiers oubliés, copies exactes et versions presque identiques.',
      c5_h: '100 % local', c5_p: 'Pas de cloud, pas de télémétrie. IA locale d’abord (Ollama, LM Studio…) ; un modèle externe seulement si vous le choisissez.',
      c6_h: 'Ouvert aux agents', c6_p: 'Un serveur MCP permet à Kiro, Claude Desktop ou tout agent de demander à OUIJA où sont vos fichiers.',
      goal_h: 'Objectif',
      goal_p1: 'Google Desktop Search promettait de chercher dans votre PC comme Google sur le web, et a été arrêté en 2011. Tout est parti dans le cloud, mais pas nos fichiers : ils restent dispersés sur des disques, de vieilles sauvegardes et des formats que personne ne sait ouvrir.',
      goal_p2: 'OUIJA ressuscite cette idée avec ce qui était impossible alors : embeddings locaux, modèles de langage locaux et récupération forensique de formats anciens. Le but est simple : vous vous souvenez de quelque chose et votre propre ordinateur le retrouve, en privé.',
      kiro: 'Créé pour <strong>Kiroween 2026</strong>, dans la catégorie Resurrection : une technologie morte, ramenée à la vie.',
      dl_h: 'Télécharger', dl_loading: 'Recherche de la dernière version…',
      dl_win: 'Télécharger l’installeur', dl_appimage: 'Télécharger l’AppImage', dl_deb: 'Télécharger le .deb',
      all_rel: 'Toutes les versions',
      linux_note: 'AppImage : rendez-le exécutable (<code>chmod +x OUIJA-*.AppImage</code>) puis lancez-le.',
      dl_ver: 'Dernière version : ', dl_fail: 'Impossible de vérifier la version ; les boutons ouvrent la page des versions.'
    },
    ja: {
      nav_what: '概要', nav_goal: '目的', nav_dl: 'ダウンロード',
      tag: 'デスクトップ検索は2011年に死んだ。<br><strong>OUIJAが黄泉から呼び戻す。</strong>',
      sub: '自分の言葉で尋ねるだけ。霊がファイルの場所を教えてくれます。すべてあなたのPCの中で動きます。',
      cta: 'ダウンロードを召喚する', badge: 'Kiroween 2026 向けに制作 · Resurrection',
      what_h: '概要',
      what_p: 'OUIJAは、WindowsとLinux向けのデスクトップアプリです。死んだ技術であるパーソナル・デスクトップ検索と、それが残したファイルを蘇らせます。もう開けない形式の文書、誰も覚えていないバックアップ、ゴミ箱に送ったファイルなどです。',
      c1_h: '召喚', c1_p: 'キーワードではなく意味で検索。「ロサに書いた詩はどこ？」と聞けば、バックアップの中からでも指し示します。',
      c2_h: '死んだ形式', c2_p: 'WordPerfect、WordStar、Works、Lotus、MSN Messengerのチャット、Outlook Expressのフォルダ、壊れた文字コードが読める形で戻ります。',
      c3_h: '地下墓所', c3_p: 'デジタル遺産を開くと、年、人物、日付つきの肖像、墓碑銘からなる思い出の魔導書ができます。PDFで書き出せます。',
      c4_h: '絞首台と幽霊', c4_p: 'ゴミ箱に送ったものを取り戻し、忘れられたファイル、完全な複製、ほぼ同じ版を見つけ出します。',
      c5_h: '100% ローカル', c5_p: 'クラウドもテレメトリもありません。まずローカルAI（Ollama、LM Studioなど）。外部モデルは選んだ場合のみ。',
      c6_h: 'エージェントに開放', c6_p: 'MCPサーバーにより、Kiro、Claude Desktopなどのエージェントがファイルの場所をOUIJAに尋ねられます。',
      goal_h: '目的',
      goal_p1: 'Google Desktop SearchはWebのようにPCを検索できると約束し、2011年に終了しました。すべてがクラウドへ移りましたが、私たちのファイルは移っていません。ディスクや古いバックアップ、誰も開けない形式の中に散らばったままです。',
      goal_p2: 'OUIJAは、当時は不可能だったローカル埋め込み、ローカル言語モデル、古い形式のフォレンジック復元でその発想を蘇らせます。目標はシンプルです。何かを思い出したら、あなた自身のPCがプライベートに見つけてくれること。',
      kiro: '<strong>Kiroween 2026</strong> の Resurrection 部門のために制作。死んだ技術を、生き返らせる。',
      dl_h: 'ダウンロード', dl_loading: '最新リリースを確認中…',
      dl_win: 'インストーラーをダウンロード', dl_appimage: 'AppImageをダウンロード', dl_deb: '.debをダウンロード',
      all_rel: 'すべてのリリース',
      linux_note: 'AppImage: 実行権限を付けて（<code>chmod +x OUIJA-*.AppImage</code>）起動してください。',
      dl_ver: '最新バージョン: ', dl_fail: 'リリースを確認できませんでした。ボタンはリリースページへ移動します。'
    },
    zh: {
      nav_what: '简介', nav_goal: '目标', nav_dl: '下载',
      tag: '桌面搜索在2011年死去。<br><strong>OUIJA 让它从亡者中归来。</strong>',
      sub: '用自己的话提问，亡灵会告诉你文件在哪里。一切都在你的电脑上运行。',
      cta: '召唤下载', badge: '为 Kiroween 2026 而作 · Resurrection',
      what_h: '简介',
      what_p: 'OUIJA 是一款适用于 Windows 和 Linux 的桌面应用，它复活一项已死的技术，即个人桌面搜索，以及它留下的文件：再也没有程序能打开的格式的文档、没人记得的备份，以及被扔进回收站的文件。',
      c1_h: '召唤', c1_p: '按含义搜索，而不是关键词。“我写给 Rosa 的那首诗在哪？”灵板会指出来，即使它在备份里。',
      c2_h: '死去的格式', c2_p: 'WordPerfect、WordStar、Works、Lotus、MSN Messenger 聊天、Outlook Express 文件夹和损坏的编码都能重新读取。',
      c3_h: '地下墓穴', c3_p: '打开一份数字遗产，得到一本记忆魔法书：年份、人物、带日期的肖像和一段墓志铭。可导出为 PDF。',
      c4_h: '绞刑架与幽灵', c4_p: '找回你扔进回收站的东西，并追查被遗忘的文件、完全相同的副本和几乎一样的版本。',
      c5_h: '100% 本地', c5_p: '没有云，没有遥测。优先使用本地 AI（Ollama、LM Studio 等）；只有你选择时才使用外部模型。',
      c6_h: '向智能体开放', c6_p: 'MCP 服务器让 Kiro、Claude Desktop 或任何智能体都能询问 OUIJA 你的文件在哪里。',
      goal_h: '目标',
      goal_p1: 'Google Desktop Search 曾承诺像 Google 搜索网页一样搜索你的电脑，并在2011年停止服务。一切都搬到了云端，但我们的文件没有：它们仍散落在磁盘、旧备份和没人能打开的格式里。',
      goal_p2: 'OUIJA 用当年做不到的技术复活这个想法：本地嵌入、本地语言模型和旧格式的取证式恢复。目标很简单：你记得某件事，你自己的电脑就能私密地找到它。',
      kiro: '为 <strong>Kiroween 2026</strong> 的 Resurrection 类别而作：让一项已死的技术重获新生。',
      dl_h: '下载', dl_loading: '正在查找最新版本…',
      dl_win: '下载安装程序', dl_appimage: '下载 AppImage', dl_deb: '下载 .deb',
      all_rel: '所有版本',
      linux_note: 'AppImage：先赋予执行权限（<code>chmod +x OUIJA-*.AppImage</code>）再运行。',
      dl_ver: '最新版本：', dl_fail: '无法查询版本；按钮将打开发布页面。'
    }
  };
  var nodes = document.querySelectorAll('[data-i18n]');
  var en = {};
  nodes.forEach(function (n) { en[n.getAttribute('data-i18n')] = n.innerHTML; });
  en.dl_ver = 'Latest version: ';
  en.dl_fail = 'Could not check the release; the buttons open the releases page.';
  T.en = en;

  function detect() {
    var saved = localStorage.getItem('lang');
    if (SUPPORTED.indexOf(saved) >= 0) return saved;
    var prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
    for (var i = 0; i < prefs.length; i++) {
      var code = String(prefs[i]).toLowerCase().slice(0, 2);
      if (SUPPORTED.indexOf(code) >= 0) return code;
    }
    return 'en';
  }
  var lang = detect();
  var state = { ver: null, failed: false };
  var sel = document.getElementById('lang');

  function t(k) { return T[lang][k] != null ? T[lang][k] : T.en[k]; }
  function apply() {
    document.documentElement.lang = lang;
    nodes.forEach(function (n) {
      var k = n.getAttribute('data-i18n');
      if (k === 'dl_loading' && (state.ver || state.failed)) return;
      n.innerHTML = t(k);
    });
    sel.value = lang;
    var v = document.getElementById('dl-version');
    if (state.ver) v.textContent = t('dl_ver') + state.ver;
    else if (state.failed) v.textContent = t('dl_fail');
  }
  sel.addEventListener('change', function () {
    lang = sel.value;
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

// Rayos visibles y susto aleatorio (una vez por visita).
(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var rnd = function (a, b) { return a + Math.random() * (b - a); };

  // Rayo: línea quebrada de arriba hacia abajo con alguna rama.
  var bolt = document.getElementById('bolt');
  function jag(x, y, len, w) {
    var d = 'M' + x + ' ' + y;
    for (var i = 0; i < len; i++) { x += rnd(-w, w); y += rnd(18, 34); d += ' L' + x.toFixed(1) + ' ' + y.toFixed(1); }
    return d;
  }
  function strikeBolt() {
    var main = jag(90, 0, 22, 22), branch = jag(90 + rnd(-10, 10), rnd(120, 260), 9, 24);
    bolt.innerHTML = '<svg viewBox="0 0 180 700" preserveAspectRatio="none"><path d="' + main + '" fill="none" stroke="#f5f3ff" stroke-width="3" stroke-linejoin="round"/><path d="' + branch + '" fill="none" stroke="#ddd6fe" stroke-width="2" stroke-linejoin="round"/></svg>';
    bolt.style.left = rnd(2, 88) + 'vw';
    bolt.classList.remove('on'); void bolt.offsetWidth; bolt.classList.add('on');
    document.getElementById('flash').classList.remove('on');
    void document.getElementById('flash').offsetWidth;
    document.getElementById('flash').classList.add('on');
  }
  (function loop() { setTimeout(function () { strikeBolt(); loop(); }, rnd(6000, 16000)); })();
  setTimeout(strikeBolt, 2500);

  // Imágenes de terror dibujadas en SVG (sin archivos externos).
  var BONE = '#e7e5f2', RED = '#b91c1c';
  function eyesImg() {
    var s = '';
    for (var i = 0; i < 26; i++) {
      var x = rnd(40, 560), y = rnd(40, 560), r = rnd(5, 16), g = rnd(14, 40), c = Math.random() < .5 ? RED : '#fde68a';
      s += '<ellipse cx="' + x + '" cy="' + y + '" rx="' + r + '" ry="' + r * .6 + '" fill="' + c + '"/><ellipse cx="' + (x + g) + '" cy="' + y + '" rx="' + r + '" ry="' + r * .6 + '" fill="' + c + '"/>';
    }
    return s;
  }
  var IMGS = [
    // Calavera
    '<path d="M300 40C170 40 90 130 100 270C104 330 130 360 160 380L160 470L440 470L440 380C470 360 496 330 500 270C510 130 430 40 300 40Z" fill="' + BONE + '"/><ellipse cx="225" cy="260" rx="52" ry="62" fill="#000"/><ellipse cx="375" cy="260" rx="52" ry="62" fill="#000"/><path d="M300 320L270 395L330 395Z" fill="#000"/><path d="M190 430V560M240 430V570M300 430V575M360 430V570M410 430V560" stroke="#000" stroke-width="12"/>',
    // Fantasma gritando
    '<path d="M300 30C190 30 130 110 120 230L60 210C20 195 0 240 25 280L100 400C106 480 100 540 110 590C160 620 200 580 250 600C300 625 340 585 390 600C440 615 500 590 520 570C500 510 510 450 500 400L575 280C600 240 580 195 540 210L480 230C470 110 410 30 300 30Z" fill="' + BONE + '"/><path d="M190 170C240 190 270 215 265 245C230 250 195 235 185 205Z" fill="#000"/><path d="M410 170C360 190 330 215 335 245C370 250 405 235 415 205Z" fill="#000"/><ellipse cx="300" cy="400" rx="95" ry="140" fill="#000"/><ellipse cx="300" cy="440" rx="55" ry="70" fill="' + RED + '" fill-opacity=".5"/>',
    // Ojos en la oscuridad
    eyesImg(),
    // Rostro pálido con sonrisa
    '<path d="M300 20C190 20 150 120 160 230C165 320 190 400 220 470L220 590L380 590L380 470C410 400 435 320 440 230C450 120 410 20 300 20Z" fill="#d6d3e6"/><ellipse cx="245" cy="215" rx="38" ry="62" fill="#000"/><ellipse cx="355" cy="215" rx="38" ry="62" fill="#000"/><path d="M175 400C230 520 370 520 425 400C400 470 200 470 175 400Z" fill="#000"/><path d="M200 435L215 460M235 450L245 478M275 458L278 485M325 458L322 485M365 450L355 478M400 435L385 460" stroke="' + BONE + '" stroke-width="7"/>'
  ];
  function show(scare, i, flip) {
    scare.innerHTML = '<svg viewBox="0 0 600 620" style="transform:' + (flip ? 'scaleX(-1) ' : '') + 'scale(' + rnd(1, 1.35).toFixed(2) + ') rotate(' + rnd(-6, 6).toFixed(1) + 'deg);filter:' + (Math.random() < .3 ? 'invert(1)' : 'contrast(1.4) saturate(1.5)') + '">' + IMGS[i] + '</svg>';
  }

  function scare() {
    var el = document.getElementById('scare');
    var done = false;
    function end() { if (done) return; done = true; el.classList.remove('on'); el.innerHTML = ''; }
    el.addEventListener('click', end);
    document.addEventListener('keydown', end, { once: true });
    el.innerHTML = '';
    el.classList.add('on');                   // todo negro
    setTimeout(function () {
      var t0 = Date.now(), last = -1;
      (function flick() {
        if (done) return;
        if (Date.now() - t0 > rnd(2400, 3200)) { end(); return; }
        if (Math.random() < .55) {            // parpadeo: imagen o negro
          var i; do { i = Math.floor(Math.random() * IMGS.length); } while (i === last);
          last = i; show(el, i, Math.random() < .5);
        } else { el.innerHTML = ''; }
        setTimeout(flick, rnd(60, 190));
      })();
    }, rnd(1800, 2600));
  }

  // Una vez por visita (sesión), en un momento aleatorio. ?scare=1 lo dispara enseguida.
  var force = /[?&]scare=1/.test(location.search);
  if (force || !sessionStorage.getItem('scared')) {
    setTimeout(function () { sessionStorage.setItem('scared', '1'); scare(); }, force ? 1500 : rnd(12000, 45000));
  }
})();
