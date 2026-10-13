/* ==============================================================================
   MINERAÍ - MOVIMENTOS DA PÁGINA MODELADA
   ==============================================================================
   Este arquivo vai DENTRO do pacote do "Modelar página" (assets/js/), não roda
   na extensão. Ele devolve o que o JavaScript original do site fazia e que foi
   removido na captura (o original traz pixel, rastreador e redirecionamento):

     - carrossel/slider  -> elementos com data-mx-carousel
     - perguntas (FAQ)   -> data-mx-acc-btn / data-mx-acc-panel
     - abas              -> data-mx-tab / data-mx-tab-panel
     - entrada animada   -> data-minerai-anima

   É à prova de falha: o conteúdo já nasce visível no HTML. Se este script não
   rodar, a página fica estática, nunca em branco.

   Para quem for editar a página: mantenha os atributos data-mx-* nos
   elementos; é por eles que tudo aqui funciona.
   ============================================================================== */
(function () {
  'use strict';

  var ATIVOS = ['active', 'is-active', 'elementor-active', 'show', 'open', 'selected'];

  function todos(seletor, raiz) {
    return Array.prototype.slice.call((raiz || document).querySelectorAll(seletor));
  }

  function estilo(css) {
    var tag = document.createElement('style');
    tag.setAttribute('data-minerai', 'movimentos');
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  estilo(
    '[data-mx-carousel],[data-mx-viewport]{overflow:hidden!important;position:relative}' +
    '[data-mx-track]{display:flex!important;flex-wrap:nowrap!important;transition:transform .55s ease;will-change:transform;height:auto!important}' +
    '[data-mx-slide]{position:relative!important;left:auto!important;top:auto!important;transform:none!important;flex-shrink:0!important;opacity:1!important;visibility:visible!important}' +
    '[data-mx-prev],[data-mx-next]{cursor:pointer;pointer-events:auto!important;opacity:1}' +
    '.mx-dots{display:flex;justify-content:center;gap:8px;margin-top:14px}' +
    '.mx-dots button{width:9px;height:9px;padding:0;border:0;border-radius:50%;background:currentColor;opacity:.3;cursor:pointer}' +
    '.mx-dots button.mx-on{opacity:1}' +
    '[data-minerai-anima].mx-oculto{opacity:0!important;transform:translateY(24px)!important}' +
    '[data-minerai-anima]{transition:opacity .6s ease,transform .6s ease}' +
    '@media (prefers-reduced-motion: reduce){[data-mx-track],[data-minerai-anima]{transition:none}[data-minerai-anima].mx-oculto{opacity:1!important;transform:none!important}}'
  );

  /* ---------------------------------------------------------------- carrossel */
  function carrossel(raiz) {
    var id = raiz.getAttribute('data-mx-carousel');
    var trilho = document.querySelector('[data-mx-track="' + id + '"]');
    if (!trilho) return;
    var slides = todos('[data-mx-slide="' + id + '"]', trilho);
    if (slides.length < 2) return;

    var porVezOriginal = Math.max(1, Number(raiz.getAttribute('data-mx-per-view')) || 1);
    var espaco = Math.max(0, Number(raiz.getAttribute('data-mx-gap')) || 0);
    var auto = Number(raiz.getAttribute('data-mx-autoplay'));
    var anteriores = todos('[data-mx-prev="' + id + '"]');
    var proximos = todos('[data-mx-next="' + id + '"]');
    // Sem setas e sem saber se rodava sozinho: roda, senão ninguém vê os slides.
    if (auto === -1 || isNaN(auto)) auto = anteriores.length || proximos.length ? 0 : 4500;

    var atual = 0;
    var bolinhas = [];

    function porVez() {
      var largura = window.innerWidth;
      if (largura < 640) return 1;
      if (largura < 1024) return Math.min(porVezOriginal, 2);
      return porVezOriginal;
    }

    function ultimo() {
      return Math.max(0, slides.length - porVez());
    }

    function ir(indice) {
      var fim = ultimo();
      atual = indice > fim ? 0 : indice < 0 ? fim : indice;
      var deslocamento = slides[atual].offsetLeft - slides[0].offsetLeft;
      trilho.style.transform = 'translate3d(' + -deslocamento + 'px,0,0)';
      bolinhas.forEach(function (b, i) { b.classList.toggle('mx-on', i === atual); });
    }

    function montar() {
      var n = porVez();
      var largura = 'calc((100% - ' + espaco * (n - 1) + 'px) / ' + n + ')';
      slides.forEach(function (s) {
        s.style.setProperty('flex', '0 0 ' + largura, 'important');
        s.style.setProperty('width', largura, 'important');
        s.style.setProperty('max-width', largura, 'important');
        s.style.setProperty('margin-right', espaco + 'px', 'important');
        s.style.setProperty('margin-left', '0', 'important');
      });
      trilho.style.setProperty('width', '100%', 'important');
      trilho.style.setProperty('transform', 'none');
      ir(Math.min(atual, ultimo()));
    }

    todos('[data-mx-dots="' + id + '"]').slice(0, 1).forEach(function (caixa) {
      caixa.innerHTML = '';
      caixa.classList.add('mx-dots');
      for (var i = 0; i < slides.length; i += 1) {
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', 'Ir para o slide ' + (i + 1));
        b.addEventListener('click', (function (alvo) { return function () { ir(alvo); }; })(i));
        caixa.appendChild(b);
        bolinhas.push(b);
      }
    });

    anteriores.forEach(function (b) {
      b.removeAttribute('disabled');
      b.classList.remove('swiper-button-disabled', 'slick-disabled', 'disabled');
      b.addEventListener('click', function (e) { e.preventDefault(); ir(atual - 1); });
    });
    proximos.forEach(function (b) {
      b.removeAttribute('disabled');
      b.classList.remove('swiper-button-disabled', 'slick-disabled', 'disabled');
      b.addEventListener('click', function (e) { e.preventDefault(); ir(atual + 1); });
    });

    // Arrastar com o dedo ou o mouse.
    var inicioX = null;
    raiz.addEventListener('pointerdown', function (e) { inicioX = e.clientX; });
    raiz.addEventListener('pointerup', function (e) {
      if (inicioX === null) return;
      var dx = e.clientX - inicioX;
      inicioX = null;
      if (Math.abs(dx) > 40) ir(atual + (dx < 0 ? 1 : -1));
    });

    var relogio = null;
    function tocar() {
      if (auto > 0 && !relogio) relogio = setInterval(function () { ir(atual + 1); }, auto);
    }
    function pausar() {
      clearInterval(relogio);
      relogio = null;
    }
    raiz.addEventListener('mouseenter', pausar);
    raiz.addEventListener('mouseleave', tocar);

    var espera = null;
    window.addEventListener('resize', function () {
      clearTimeout(espera);
      espera = setTimeout(montar, 150);
    });

    montar();
    tocar();
  }

  /* ----------------------------------------------- sanfona (FAQ) e abas */
  function mostrar(painel, sim) {
    if (!painel) return;
    if (sim) {
      painel.removeAttribute('hidden');
      painel.style.removeProperty('display');
      ATIVOS.forEach(function (c) { if (c === 'show' || c === 'active') painel.classList.add(c); });
      if (getComputedStyle(painel).display === 'none') painel.style.display = 'block';
      if (parseFloat(getComputedStyle(painel).maxHeight) === 0) painel.style.maxHeight = 'none';
      if (parseFloat(getComputedStyle(painel).height) === 0) painel.style.height = 'auto';
    } else {
      painel.style.display = 'none';
      painel.classList.remove('show', 'active');
    }
  }

  function marcar(botao, sim) {
    botao.setAttribute('aria-expanded', sim ? 'true' : 'false');
    if (botao.getAttribute('role') === 'tab') botao.setAttribute('aria-selected', sim ? 'true' : 'false');
    ATIVOS.forEach(function (c) {
      if (c === 'show') return;
      if (sim) botao.classList.add(c);
      else botao.classList.remove(c);
    });
    botao.classList.remove('collapsed');
    if (!sim) botao.classList.add('collapsed');
  }

  todos('[data-mx-acc-btn]').forEach(function (botao) {
    var id = botao.getAttribute('data-mx-acc-btn');
    var painel = document.querySelector('[data-mx-acc-panel="' + id + '"]');
    if (!painel) return;
    var aberto = painel.hasAttribute('data-mx-open');
    // O item que abraça título e resposta costuma levar a classe de "aberto"
    // (é ela que gira a setinha no CSS do site).
    var item = botao.parentElement && botao.parentElement.contains(painel) ? botao.parentElement : null;
    function aplicar() {
      mostrar(painel, aberto);
      marcar(botao, aberto);
      if (item) {
        ['expanded', 'active', 'open', 'is-open', 'is-active', 'elementor-active'].forEach(function (c) {
          if (aberto) item.classList.add(c);
          else item.classList.remove(c);
        });
      }
    }
    aplicar();
    botao.style.cursor = 'pointer';
    botao.addEventListener('click', function (e) {
      e.preventDefault();
      aberto = !aberto;
      aplicar();
    });
  });

  var grupos = {};
  todos('[data-mx-tab]').forEach(function (aba) {
    var g = aba.getAttribute('data-mx-tab-group');
    (grupos[g] = grupos[g] || []).push(aba);
  });
  Object.keys(grupos).forEach(function (g) {
    var abas = grupos[g];
    function escolher(escolhida) {
      abas.forEach(function (aba) {
        var painel = document.querySelector('[data-mx-tab-panel="' + aba.getAttribute('data-mx-tab') + '"]');
        var sim = aba === escolhida;
        mostrar(painel, sim);
        marcar(aba, sim);
      });
    }
    var inicial = abas.filter(function (a) {
      return a.getAttribute('aria-selected') === 'true' || ATIVOS.some(function (c) { return a.classList.contains(c); });
    })[0] || abas[0];
    abas.forEach(function (aba) {
      aba.style.cursor = 'pointer';
      aba.addEventListener('click', function (e) { e.preventDefault(); escolher(aba); });
    });
    escolher(inicial);
  });

  /* ------------------------------------------------------ entrada animada */
  var animaveis = todos('[data-minerai-anima]');
  if (animaveis.length && 'IntersectionObserver' in window) {
    animaveis.forEach(function (el) { el.classList.add('mx-oculto'); });
    var observador = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (entrada) {
        if (!entrada.isIntersecting) return;
        entrada.target.classList.remove('mx-oculto');
        observador.unobserve(entrada.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
    animaveis.forEach(function (el) { observador.observe(el); });
    // Rede de segurança: passados 6 segundos, mostra tudo de qualquer jeito.
    setTimeout(function () {
      animaveis.forEach(function (el) { el.classList.remove('mx-oculto'); });
    }, 6000);
  }

  todos('[data-mx-carousel]').forEach(carrossel);

  // Vídeo de fundo (autoplay/loop) volta a tocar sozinho.
  todos('video[autoplay], video[loop]').forEach(function (v) {
    v.muted = true;
    var p = v.play && v.play();
    if (p && p.catch) p.catch(function () {});
  });
})();
