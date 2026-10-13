// ==============================================================================
// MINERAÍ - LEITURA DA PÁGINA PARA O "MODELAR PÁGINA"
// ==============================================================================
// `capturarDaPagina` é injetada na aba da página de vendas pelo background
// (chrome.scripting.executeScript). Por isso precisa ser AUTOSSUFICIENTE: roda
// isolada, sem acesso a nada fora dela. Tudo o que ela usa mora aqui dentro.
//
// O que ela faz, em ordem:
//   1. rola a página inteira (revela conteúdo e imagem preguiçosa);
//   2. marca carrosséis, sanfonas (FAQ) e abas com atributos data-mx-*, que o
//      script de movimentos do pacote usa para fazer tudo funcionar de novo;
//   3. destrava o que ficou invisível esperando animação (menos resposta de
//      FAQ fechada e aba escondida, que precisam continuar fechadas);
//   4. monta o mapa das seções (vira o ESTRUTURA.md, barato para a IA ler);
//   5. clona o HTML já limpo de script e com endereços absolutos;
//   6. junta o CSS (inclusive @import) e mede o design system.
// Baixar imagens, vídeos e fontes e montar o zip é com o empacotador
// (offscreen), que roda fora da página.
// ==============================================================================

/* eslint-disable no-unused-vars */
async function capturarDaPagina() {
  const base = document.baseURI;
  const absoluta = (u, origem) => {
    try {
      return new URL(u, origem || base).href;
    } catch (e) {
      return u;
    }
  };

  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const visivel = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const texto = (el, max) => String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, max);

  // ---------------------------------------------------------------------------
  // 1. Rolar a página inteira antes de capturar.
  //    Página de vendas carrega imagem e revela seção conforme se desce. Sem
  //    isso, só o primeiro visor era capturado e o resto vinha vazio.
  // ---------------------------------------------------------------------------
  document.querySelectorAll('img[loading="lazy"]').forEach((img) => img.setAttribute('loading', 'eager'));

  const alturaJanela = window.innerHeight || 800;
  let ultimaAltura = 0;

  for (let volta = 0; volta < 80; volta += 1) {
    const alturaTotal = document.body.scrollHeight;
    const y = Math.min(volta * alturaJanela * 0.8, alturaTotal);
    window.scrollTo(0, y);
    await espera(140);

    if (y >= alturaTotal) {
      // Confere se a rolagem não fez a página crescer (carregamento contínuo).
      if (alturaTotal === ultimaAltura) break;
      ultimaAltura = alturaTotal;
    }
  }

  window.scrollTo(0, 0);
  await espera(600);

  // Marcas de uma captura anterior na mesma aba não podem atrapalhar.
  document.querySelectorAll('[data-mx-carousel],[data-mx-track],[data-mx-slide],[data-mx-dup],[data-mx-prev],[data-mx-next],[data-mx-dots],[data-mx-acc-btn],[data-mx-acc-panel],[data-mx-tab],[data-mx-tab-panel],[data-mx-secao],[data-mx-viewport]').forEach((el) => {
    Array.from(el.attributes).forEach((a) => {
      if (a.name.startsWith('data-mx-')) el.removeAttribute(a.name);
    });
  });

  // ---------------------------------------------------------------------------
  // 2a. Carrosséis.
  //     As bibliotecas (Swiper, Slick, Owl, Splide, Glide, Flickity, Keen e o
  //     carrossel do Elementor, que é Swiper) movem os slides por JavaScript.
  //     Sem ele, o carrossel congela torto. Aqui medimos quantos slides cabem
  //     por vez, o espaço entre eles e se ele roda sozinho; o script de
  //     movimentos do pacote refaz o resto.
  // ---------------------------------------------------------------------------
  const BIBLIOTECAS = [
    { nome: 'swiper', raiz: '.swiper, .swiper-container', trilho: '.swiper-wrapper', slide: '.swiper-slide', clone: 'swiper-slide-duplicate' },
    { nome: 'slick', raiz: '.slick-slider', visor: '.slick-list', trilho: '.slick-track', slide: '.slick-slide', clone: 'slick-cloned' },
    { nome: 'owl', raiz: '.owl-carousel', visor: '.owl-stage-outer', trilho: '.owl-stage', slide: '.owl-item', clone: 'cloned' },
    { nome: 'splide', raiz: '.splide', visor: '.splide__track', trilho: '.splide__list', slide: '.splide__slide', clone: 'splide__slide--clone' },
    { nome: 'glide', raiz: '.glide', visor: '.glide__track', trilho: '.glide__slides', slide: '.glide__slide', clone: 'glide__slide--clone' },
    { nome: 'flickity', raiz: '.flickity-enabled', visor: '.flickity-viewport', trilho: '.flickity-slider', slide: null, clone: 'is-clone' },
    { nome: 'keen', raiz: '.keen-slider', trilho: null, slide: '.keen-slider__slide', clone: null }
  ];

  const PREV = '.swiper-button-prev, .slick-prev, .owl-prev, .splide__arrow--prev, .flickity-prev-next-button.previous, .glide__arrow--left, .elementor-swiper-button-prev, [aria-label*="prev" i], [aria-label*="anterior" i], [class*="arrow-prev"], [class*="prev-arrow"]';
  const NEXT = '.swiper-button-next, .slick-next, .owl-next, .splide__arrow--next, .flickity-prev-next-button.next, .glide__arrow--right, .elementor-swiper-button-next, [aria-label*="next" i], [aria-label*="próxim" i], [aria-label*="proxim" i], [class*="arrow-next"], [class*="next-arrow"]';
  const DOTS = '.swiper-pagination, .slick-dots, .owl-dots, .splide__pagination, .flickity-page-dots, .glide__bullets';

  /** Lê `autoplay` das configurações que os construtores gravam no HTML. */
  function autoplayDe(raiz) {
    try {
      // Instância viva do Swiper fica pendurada no elemento.
      const sw = raiz.swiper;
      if (sw && sw.params && sw.params.autoplay && sw.params.autoplay.enabled !== false && sw.params.autoplay.delay) {
        return Number(sw.params.autoplay.delay) || 4000;
      }
    } catch (e) { /* sem instância */ }
    const comConfig = raiz.closest('[data-settings]');
    if (comConfig) {
      try {
        const cfg = JSON.parse(comConfig.getAttribute('data-settings') || '{}');
        if (cfg.autoplay === 'yes' || cfg.autoplay === true) return Number(cfg.autoplay_speed) || 5000;
        if (cfg.autoplay === 'no' || cfg.autoplay === false) return 0;
      } catch (e) { /* JSON quebrado */ }
    }
    const slick = raiz.getAttribute('data-slick');
    if (slick) {
      try {
        const cfg = JSON.parse(slick);
        if (cfg.autoplay) return Number(cfg.autoplaySpeed) || 3000;
      } catch (e) { /* JSON quebrado */ }
    }
    if (raiz.getAttribute('data-autoplay') === 'true' || raiz.hasAttribute('data-autoplay-speed')) {
      return Number(raiz.getAttribute('data-autoplay-speed')) || 4000;
    }
    return -1; // não deu para saber
  }

  /** Setas e bolinhas: dentro do carrossel ou logo ao lado (até 2 níveis acima). */
  function controlesDe(raiz, seletor) {
    let escopo = raiz;
    for (let nivel = 0; nivel < 3 && escopo; nivel += 1) {
      const achado = Array.from(escopo.querySelectorAll(seletor)).filter((el) => {
        const outro = el.closest('[data-mx-carousel]');
        return !outro || outro === raiz;
      });
      if (achado.length) return achado;
      escopo = escopo.parentElement;
      // Não sobe para um bloco que já contém outro carrossel.
      if (escopo && escopo.querySelectorAll('[data-mx-carousel]').length > 1) break;
    }
    return [];
  }

  let carrosseis = 0;

  function registrarCarrossel(raiz, visor, trilho, slides, biblioteca, duplicados) {
    const reais = slides.filter((s) => visivel(s) || s.getBoundingClientRect().width > 0);
    if (reais.length < 2 || !trilho) return;

    const larguraVisor = (visor || raiz).getBoundingClientRect().width;
    const larguraSlide = reais[0].getBoundingClientRect().width;
    if (!larguraVisor || !larguraSlide) return;

    let porVez = Math.round(larguraVisor / larguraSlide);
    porVez = Math.min(6, Math.max(1, porVez));

    let espaco = 0;
    const r0 = reais[0].getBoundingClientRect();
    const r1 = reais[1].getBoundingClientRect();
    const diferenca = Math.round(r1.left - r0.right);
    if (Math.abs(r1.top - r0.top) < 4 && diferenca > 0 && diferenca < 200) espaco = diferenca;

    carrosseis += 1;
    const id = `mx-car-${carrosseis}`;
    raiz.setAttribute('data-mx-carousel', id);
    raiz.setAttribute('data-mx-per-view', String(porVez));
    raiz.setAttribute('data-mx-gap', String(espaco));
    raiz.setAttribute('data-mx-lib', biblioteca);
    const auto = autoplayDe(raiz);
    raiz.setAttribute('data-mx-autoplay', String(auto));
    if (visor && visor !== raiz) visor.setAttribute('data-mx-viewport', id);
    trilho.setAttribute('data-mx-track', id);
    reais.forEach((s) => s.setAttribute('data-mx-slide', id));
    duplicados.forEach((s) => s.setAttribute('data-mx-dup', ''));

    controlesDe(raiz, PREV).forEach((el) => el.setAttribute('data-mx-prev', id));
    controlesDe(raiz, NEXT).forEach((el) => el.setAttribute('data-mx-next', id));
    controlesDe(raiz, DOTS).slice(0, 1).forEach((el) => el.setAttribute('data-mx-dots', id));
  }

  BIBLIOTECAS.forEach((lib) => {
    document.querySelectorAll(lib.raiz).forEach((raiz) => {
      if (raiz.hasAttribute('data-mx-carousel') || raiz.closest('[data-mx-carousel]')) return;
      const visor = lib.visor ? raiz.querySelector(lib.visor) : raiz;
      let trilho = lib.trilho ? raiz.querySelector(lib.trilho) : null;
      let slides;
      if (lib.slide) {
        slides = Array.from(raiz.querySelectorAll(lib.slide)).filter((s) => !trilho || s.parentElement === trilho);
      } else {
        slides = trilho ? Array.from(trilho.children) : [];
      }
      if (!trilho && slides.length) trilho = slides[0].parentElement;
      const duplicados = lib.clone ? slides.filter((s) => s.classList.contains(lib.clone)) : [];
      const reais = slides.filter((s) => !duplicados.includes(s));
      registrarCarrossel(raiz, visor, trilho, reais, lib.nome, duplicados);
    });
  });

  // Carrossel feito à mão: área com overflow escondido cujo único filho é uma
  // fileira mais larga que ela, e que NÃO anda sozinha por CSS (letreiro
  // corrido em CSS continua funcionando sem a nossa ajuda).
  for (const el of Array.from(document.body.querySelectorAll('div, section, ul'))) {
    if (el.closest('[data-mx-carousel]') || el.querySelector('[data-mx-carousel]')) continue;
    const s = getComputedStyle(el);
    if (!/hidden|clip/.test(s.overflowX)) continue;
    const filhos = Array.from(el.children).filter(visivel);
    if (filhos.length !== 1) continue;
    const trilho = filhos[0];
    const slides = Array.from(trilho.children).filter(visivel);
    if (slides.length < 3) continue;
    const st = getComputedStyle(trilho);
    if (st.animationName && st.animationName !== 'none') continue;
    const larguraVisor = el.getBoundingClientRect().width;
    if (larguraVisor < 200 || trilho.scrollWidth < larguraVisor * 1.3) continue;
    const topo = slides[0].getBoundingClientRect().top;
    if (!slides.every((sl) => Math.abs(sl.getBoundingClientRect().top - topo) < 4)) continue;
    if (!/carousel|carrossel|slider|slide|gallery|galeria|depoiment|testimon/i.test(`${el.className} ${trilho.className}`)) continue;
    registrarCarrossel(el, el, trilho, slides, 'generico', []);
  }

  // ---------------------------------------------------------------------------
  // 2b. Sanfonas (perguntas frequentes) e abas.
  //     <details> funciona sozinho; o resto depende do JS do site. Ligamos
  //     cada botão ao seu painel com um id nosso.
  // ---------------------------------------------------------------------------
  let sanfonas = 0;
  let abas = 0;
  const idDoPainel = (painel, prefixo, n) => {
    const id = `${prefixo}-${n}`;
    painel.setAttribute(prefixo === 'mx-acc' ? 'data-mx-acc-panel' : 'data-mx-tab-panel', id);
    return id;
  };
  const porSeletor = (sel) => {
    if (!sel || sel === '#') return null;
    try {
      return document.querySelector(sel);
    } catch (e) {
      return null;
    }
  };

  function ligarSanfona(botao, painel) {
    if (!botao || !painel || botao === painel || painel.contains(botao)) return;
    if (botao.hasAttribute('data-mx-acc-btn') || painel.hasAttribute('data-mx-acc-panel')) return;
    if (botao.closest('[data-mx-carousel]')) return;
    sanfonas += 1;
    const id = idDoPainel(painel, 'mx-acc', sanfonas);
    botao.setAttribute('data-mx-acc-btn', id);
    const sp = getComputedStyle(painel);
    const aberto = painel.getBoundingClientRect().height > 2 && sp.display !== 'none' &&
      sp.visibility !== 'hidden' && parseFloat(sp.opacity) > 0.05 && sp.maxHeight !== '0px';
    if (aberto) painel.setAttribute('data-mx-open', '');
  }

  function ligarAba(aba, painel, grupo) {
    if (!aba || !painel || aba.hasAttribute('data-mx-tab')) return;
    abas += 1;
    const id = idDoPainel(painel, 'mx-tab', abas);
    aba.setAttribute('data-mx-tab', id);
    aba.setAttribute('data-mx-tab-group', grupo);
    painel.setAttribute('data-mx-tab-group', grupo);
  }

  // Abas pelo padrão de acessibilidade (Elementor, Bootstrap e a maioria).
  let grupos = 0;
  document.querySelectorAll('[role="tablist"]').forEach((lista) => {
    grupos += 1;
    const grupo = `mx-grupo-${grupos}`;
    lista.querySelectorAll('[role="tab"]').forEach((aba) => {
      const alvo = aba.getAttribute('aria-controls') || (aba.getAttribute('data-bs-target') || aba.getAttribute('href') || '').replace(/^#/, '');
      ligarAba(aba, alvo ? document.getElementById(alvo) : null, grupo);
    });
  });
  // Abas do Elementor sem role (versões antigas): título e conteúdo pelo data-tab.
  document.querySelectorAll('.elementor-tabs').forEach((caixa) => {
    grupos += 1;
    const grupo = `mx-grupo-${grupos}`;
    caixa.querySelectorAll('.elementor-tab-desktop-title[data-tab]').forEach((titulo) => {
      const painel = caixa.querySelector(`.elementor-tab-content[data-tab="${CSS.escape(titulo.getAttribute('data-tab'))}"]`);
      ligarAba(titulo, painel, grupo);
    });
  });

  // Sanfonas: Elementor (acordeão e toggle), Bootstrap e padrão ARIA.
  document.querySelectorAll('.elementor-accordion-item, .elementor-toggle-item').forEach((item) => {
    ligarSanfona(item.querySelector('.elementor-tab-title'), item.querySelector('.elementor-tab-content'));
  });
  document.querySelectorAll('[data-bs-toggle="collapse"], [data-toggle="collapse"]').forEach((botao) => {
    ligarSanfona(botao, porSeletor(botao.getAttribute('data-bs-target') || botao.getAttribute('data-target') || botao.getAttribute('href')));
  });
  document.querySelectorAll('[aria-controls][aria-expanded]').forEach((botao) => {
    if (botao.getAttribute('role') === 'tab' || botao.hasAttribute('data-mx-tab')) return;
    ligarSanfona(botao, document.getElementById(botao.getAttribute('aria-controls')));
  });
  // Construtores sem ARIA (Duda, temas WordPress, Webflow): o item da FAQ
  // tem uma parte "título" e uma parte "conteúdo" reconhecíveis pela classe.
  const TITULO_FAQ = /(^|[\s_-])(title|titulo|header|heading|head|question|pergunta|trigger|toggle|button|label|summary)([\s_-]|$)/i;
  const CONTEUDO_FAQ = /(^|[\s_-])(content|conteudo|body|answer|resposta|panel|collapse|text|desc|description|inner|detail)([\s_-]|$)/i;
  document.querySelectorAll('[class*="accordion-item"], [class*="accordion__item"], [class*="faq-item"], [class*="faq__item"], [class*="toggle-item"], [class*="collapsible-item"], [class*="accordion"] > li, [class*="faq"] > li').forEach((item) => {
    if (item.querySelector('[data-mx-acc-btn]') || item.closest('details')) return;
    const filhos = Array.from(item.children);
    const titulo = filhos.find((f) => TITULO_FAQ.test(String(f.className || '')) || /^(H[2-6]|BUTTON|DT)$/.test(f.tagName));
    const conteudo = filhos.find((f) => f !== titulo && (CONTEUDO_FAQ.test(String(f.className || '')) || f.tagName === 'DD'));
    ligarSanfona(titulo, conteudo);
  });

  // ---------------------------------------------------------------------------
  // 3. Destravar o que ficou invisível esperando animação.
  //    O JavaScript do site é removido do arquivo final, então quem depende
  //    dele para aparecer ficaria invisível para sempre.
  // ---------------------------------------------------------------------------
  let destravados = 0;
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    const s = getComputedStyle(el);

    // display:none costuma ser conteúdo realmente desligado — não mexemos.
    // Fixos são banner de cookie, menu flutuante, modal: também ficam de fora.
    if (s.display === 'none' || s.position === 'fixed') continue;
    // Resposta de FAQ fechada e aba escondida continuam escondidas: antes
    // elas eram "destravadas", a página saía com tudo aberto e enorme.
    if (el.closest('[data-mx-acc-panel]:not([data-mx-open]), [data-mx-tab-panel]')) continue;

    const invisivel = s.opacity === '0' || s.visibility === 'hidden';
    const deslocado = s.transform && s.transform !== 'none' && /matrix|translate/.test(s.transform);

    if (invisivel) {
      // A transição precisa morrer junto: viva, ela faria o valor novo só
      // valer meio segundo depois, e o clone sairia ainda invisível.
      el.style.setProperty('transition', 'none', 'important');
      el.style.setProperty('animation', 'none', 'important');
      el.style.setProperty('opacity', '1', 'important');
      el.style.setProperty('visibility', 'visible', 'important');
      destravados += 1;
      // Estava escondido esperando o script do site revelar: é entrada animada.
      const r = el.getBoundingClientRect();
      if (r.width > 120 && r.height > 40) el.setAttribute('data-minerai-anima', '');
    }
    if (invisivel && deslocado) {
      el.style.setProperty('transform', 'none', 'important');
    }
  }

  // ---------------------------------------------------------------------------
  // 3b. Quem foi feito para animar na entrada.
  //     O site anima esses blocos por JavaScript, que é removido do arquivo.
  //     Marcando aqui, o script de movimentos do pacote devolve o efeito.
  // ---------------------------------------------------------------------------
  //     Conta: o que foi destravado no passo 2 (estava invisível esperando o
  //     script) + o que as bibliotecas de animação marcam no HTML (AOS, WOW,
  //     Animate.css, Elementor). Efeito de passar o mouse NÃO entra: antes
  //     qualquer transição virava "entrada" e a imagem do topo sumia.
  document.querySelectorAll('[data-aos], .wow, .elementor-invisible, .animated, [class*="animate__"], [data-animate], [data-sal], .reveal, [data-scroll-reveal]').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 120 && r.height > 40) el.setAttribute('data-minerai-anima', '');
  });
  // Dentro de carrossel o movimento é do carrossel; e bloco animado dentro de
  // outro bloco animado anima duas vezes.
  document.querySelectorAll('[data-minerai-anima]').forEach((el) => {
    if (el.closest('[data-mx-carousel]') || el.parentElement?.closest('[data-minerai-anima]')) {
      el.removeAttribute('data-minerai-anima');
    }
  });
  const animaveis = document.querySelectorAll('[data-minerai-anima]').length;

  // ---------------------------------------------------------------------------
  // 4. Mapa das seções (vira o ESTRUTURA.md).
  //    A IA lê esse resumo em vez do HTML inteiro: é o que economiza tokens.
  // ---------------------------------------------------------------------------
  const PARECE_SECAO = /(^|\s)(elementor-section|elementor-top-section|e-con|e-parent|section|secao|bloco|block|wp-block-group|row|container)(\s|$)/i;
  // Largura do conteúdo da página: muita página de venda é feita para
  // celular (430px centralizados) mesmo vista no computador. É o elemento
  // mais estreito que ainda cobre quase toda a altura da página.
  function larguraDoConteudo() {
    const altura = document.body.scrollHeight || 1;
    let largura = window.innerWidth;
    for (const el of Array.from(document.body.querySelectorAll('body > *, body > * > *, body > * > * > *'))) {
      const r = el.getBoundingClientRect();
      if (r.height >= altura * 0.8 && r.width >= 280 && r.width < largura) largura = r.width;
    }
    return largura;
  }

  function blocosDaPagina() {
    const referencia = larguraDoConteudo();
    const alturaTotal = document.body.scrollHeight || 1;
    const altura = (el) => el.getBoundingClientRect().height;
    const largos = (el) => {
      const r = el.getBoundingClientRect();
      return r.height >= 80 && r.width >= referencia * 0.6;
    };

    // Quanto da altura da página os blocos cobrem (sem contar sobreposição).
    const cobertura = (blocos) => {
      const faixas = blocos
        .map((el) => {
          const r = el.getBoundingClientRect();
          return [r.top + window.scrollY, r.bottom + window.scrollY];
        })
        .sort((a, b) => a[0] - b[0]);
      let total = 0;
      let fim = -Infinity;
      faixas.forEach(([a, b]) => {
        if (b <= fim) return;
        total += b - Math.max(a, fim);
        fim = b;
      });
      return total / alturaTotal;
    };

    // Caminho 1: elementos que se declaram seção e não estão dentro de outra.
    const declarados = Array.from(document.body.querySelectorAll('section, header, footer, [class]'))
      .filter((el) => (/^(SECTION|HEADER|FOOTER)$/.test(el.tagName) || PARECE_SECAO.test(String(el.className || ''))) && largos(el));
    const deTopo = (lista, dentroDe) => lista.filter((el) =>
      (!dentroDe || (el !== dentroDe && dentroDe.contains(el))) &&
      !lista.some((outro) => outro !== el && outro !== dentroDe && outro.contains(el) && (!dentroDe || dentroDe.contains(outro))));
    let topo = deTopo(declarados, null);
    // Um "invólucro" que abraça a página quase toda não é seção: abre ele.
    for (let volta = 0; volta < 4; volta += 1) {
      const gigante = topo.find((el) => altura(el) > alturaTotal * 0.5);
      if (!gigante) break;
      const dentro = deTopo(declarados, gigante);
      if (dentro.length < 2) break;
      topo = topo.flatMap((el) => (el === gigante ? dentro : [el]));
    }
    const ordenar = (lista) => lista.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    if (topo.length >= 3 && cobertura(topo) >= 0.7) return ordenar(topo);

    // Caminho 2: divide o conteúdo pelos blocos grandes. Construtor que não
    // usa nome de seção (Duda, páginas feitas à mão) cai aqui.
    const filhosLargos = (el) => {
      let atual = el;
      // Construtor embrulha a página em muitas camadas de um filho só.
      for (let i = 0; i < 30; i += 1) {
        const filhos = Array.from(atual.children).filter(largos);
        if (filhos.length !== 1) return filhos;
        atual = filhos[0];
      }
      return [];
    };
    let blocos = filhosLargos(document.querySelector('main') || document.body);
    for (let volta = 0; volta < 8; volta += 1) {
      const gigante = blocos.find((el) => altura(el) > alturaTotal * 0.35 && filhosLargos(el).length >= 2);
      if (!gigante) break;
      blocos = blocos.flatMap((el) => (el === gigante ? filhosLargos(el) : [el]));
    }
    // Fica com o caminho que cobrir mais a página.
    if (topo.length >= 3 && cobertura(topo) >= cobertura(blocos)) return ordenar(topo);
    return ordenar(blocos);
  }

  const TIPOS = [
    ['Depoimentos', /depoiment|testemunh|o que (dizem|falam)|avalia(ç|c)(õ|o)es|resultados de alunos|review/i],
    ['Perguntas frequentes', /perguntas frequentes|d(ú|u)vidas|faq\b/i],
    ['Garantia', /garantia|risco zero|devolvemos/i],
    ['Bônus', /b(ô|o)nus/i],
    ['Oferta e preço', /r\$\s?\d|por apenas|12x|parcel|comprar agora|quero (comprar|garantir)|investimento|escolha (a |o )?(sua|seu) (oferta|plano)|planos?\b|pre(ç|c)os?\b/i],
    ['Autor / quem ensina', /quem (sou|é|e) |sobre (mim|a autora|o autor)|prazer, eu sou|conhe(ç|c)a/i],
    ['Conteúdo do produto', /m(ó|o)dulo|o que voc(ê|e) vai (receber|aprender)|conte(ú|u)do|aulas?/i]
  ];

  const secoes = [];
  blocosDaPagina().slice(0, 40).forEach((bloco, i) => {
    const n = i + 1;
    bloco.setAttribute('data-mx-secao', String(n));
    const r = bloco.getBoundingClientRect();
    const titulos = Array.from(bloco.querySelectorAll('h1, h2, h3')).map((h) => texto(h, 140)).filter(Boolean).slice(0, 3);
    const paragrafos = Array.from(bloco.querySelectorAll('p')).map((p) => texto(p, 180)).filter((t) => t.length >= 25).slice(0, 2);
    const botoes = Array.from(bloco.querySelectorAll('a, button'))
      .filter((b) => {
        const t = texto(b, 60);
        if (t.length < 2 || t.length > 50) return false;
        const classe = `${b.className || ''} ${b.getAttribute('role') || ''}`;
        const destino = b.getAttribute('href') || '';
        return /btn|button|botao|cta/i.test(classe) || /hotmart|kiwify|eduzz|monetizze|braip|pay\.|checkout|wa\.me|whatsapp/i.test(destino);
      })
      .slice(0, 3)
      .map((b) => ({ texto: texto(b, 50), destino: b.getAttribute('href') ? absoluta(b.getAttribute('href')) : '' }));
    const imagens = Array.from(bloco.querySelectorAll('img')).filter((img) => img.getBoundingClientRect().width > 40).length;
    const videos = bloco.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="vturb"], iframe[src*="panda"], [id^="vid_"], vturb-smartplayer').length;
    const conteudo = texto(bloco, 2000);
    let tipo = n === 1 ? 'Topo (primeira dobra)' : '';
    if (!tipo) {
      // O título diz melhor do que o texto todo (um bloco de preço também
      // cita os bônus; o de bônus também cita o preço).
      const pelosTitulos = TIPOS.find(([, rx]) => rx.test(titulos.join(' ')));
      const peloTexto = TIPOS.find(([, rx]) => rx.test(conteudo));
      tipo = (pelosTitulos || peloTexto || [''])[0];
    }
    if (bloco.tagName === 'FOOTER' || (i > 2 && /todos os direitos|copyright|©|pol(í|i)tica de privacidade/i.test(conteudo) && conteudo.length < 600)) tipo = 'Rodapé';

    // Quantas colunas: maior grupo de irmãos lado a lado nos primeiros níveis.
    let colunas = 1;
    const fila = [bloco];
    for (let passo = 0; passo < 60 && fila.length; passo += 1) {
      const el = fila.shift();
      const filhos = Array.from(el.children).filter((c) => c.getBoundingClientRect().width > 100);
      if (filhos.length >= 2) {
        const topo = filhos[0].getBoundingClientRect().top;
        const mesmaLinha = filhos.filter((c) => Math.abs(c.getBoundingClientRect().top - topo) < 6).length;
        colunas = Math.max(colunas, Math.min(6, mesmaLinha));
      }
      fila.push(...filhos);
    }

    const fundo = getComputedStyle(bloco).backgroundColor;
    secoes.push({
      n,
      tipo,
      altura: Math.round(r.height),
      fundo: fundo && fundo !== 'rgba(0, 0, 0, 0)' ? fundo : '',
      colunas,
      titulos,
      paragrafos,
      botoes,
      imagens,
      videos,
      carrossel: bloco.querySelectorAll('[data-mx-carousel]').length + (bloco.hasAttribute('data-mx-carousel') ? 1 : 0),
      // <details> abre e fecha sozinho, sem script: conta junto.
      sanfona: bloco.querySelectorAll('[data-mx-acc-btn], details').length,
      abas: bloco.querySelectorAll('[data-mx-tab]').length
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Imagem certa de cada <img>.
  //    srcset/<picture> oferecem várias versões; guardamos só a que o
  //    navegador escolheu (currentSrc). Uma por imagem, nada repetido.
  // ---------------------------------------------------------------------------
  document.querySelectorAll('img').forEach((img) => {
    const escolhida = img.currentSrc || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('src') || '';
    if (escolhida && !escolhida.startsWith('data:')) img.setAttribute('data-mx-src', absoluta(escolhida));
    // Primeira tela carrega na hora; o resto, conforme a pessoa rola.
    img.setAttribute('data-mx-carga', img.getBoundingClientRect().top < window.innerHeight * 1.2 ? 'eager' : 'lazy');
  });
  document.querySelectorAll('video').forEach((video) => {
    const escolhida = video.currentSrc || video.getAttribute('src') || '';
    if (escolhida && /^https?:/i.test(absoluta(escolhida))) video.setAttribute('data-mx-src', absoluta(escolhida));
  });

  // ---------------------------------------------------------------------------
  // 6. Clonar já com tudo revelado e marcado.
  // ---------------------------------------------------------------------------
  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll('script, noscript, [data-mx-dup]').forEach((el) => el.remove());
  // Interface de extensões do navegador (inclusive a nossa) não é da página.
  clone.querySelectorAll('#minerai-floating-panel, .minerai-toast, .minerai-injected, [id^="grammarly"], grammarly-extension').forEach((el) => el.remove());

  // Nada que execute ou redirecione sobrevive no arquivo salvo: atributos
  // onclick/onload, links javascript:, <meta http-equiv="refresh">, <base>
  // (que reapontaria todos os links) e srcdoc também executam ou redirecionam.
  // A CSP adicionada pelo empacotador é a segunda barreira.
  clone.querySelectorAll('base, meta[http-equiv]').forEach((el) => el.remove());
  const atributosDeUrl = ['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster', 'ping'];
  for (const el of Array.from(clone.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const nome = attr.name.toLowerCase();
      if (nome.startsWith('on') || nome === 'srcdoc') {
        el.removeAttribute(attr.name);
        continue;
      }
      if (atributosDeUrl.includes(nome)) {
        const valor = (attr.value || '').trim().replace(/[\u0000- ]/g, '').toLowerCase();
        if (valor.startsWith('javascript:') || valor.startsWith('vbscript:')) {
          el.removeAttribute(attr.name);
        }
      }
    }
  }

  // <img>: fica uma versão só (a escolhida), sem srcset nem <source>.
  clone.querySelectorAll('img').forEach((img) => {
    const escolhida = img.getAttribute('data-mx-src');
    if (escolhida) img.setAttribute('src', escolhida);
    img.removeAttribute('data-mx-src');
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.removeAttribute('data-src');
    img.removeAttribute('data-srcset');
    img.removeAttribute('data-lazy-src');
    img.removeAttribute('data-lazy-srcset');
    img.setAttribute('loading', img.getAttribute('data-mx-carga') || 'lazy');
    img.removeAttribute('data-mx-carga');
  });
  clone.querySelectorAll('picture source').forEach((source) => source.remove());
  clone.querySelectorAll('video').forEach((video) => {
    const escolhida = video.getAttribute('data-mx-src');
    video.removeAttribute('data-mx-src');
    if (escolhida) {
      video.setAttribute('src', escolhida);
      video.querySelectorAll('source').forEach((s) => s.remove());
    }
    // Vídeo de fundo precisa voltar a tocar sozinho sem o script do site.
    if (video.hasAttribute('autoplay') || video.hasAttribute('loop')) {
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
    }
  });

  clone.querySelectorAll('[src]').forEach((el) => {
    const v = el.getAttribute('src');
    if (v && !v.startsWith('data:') && !v.startsWith('blob:')) el.setAttribute('src', absoluta(v));
  });
  clone.querySelectorAll('[poster]').forEach((el) => {
    const v = el.getAttribute('poster');
    if (v && !v.startsWith('data:')) el.setAttribute('poster', absoluta(v));
  });
  clone.querySelectorAll('link[href], a[href]').forEach((el) => {
    const v = el.getAttribute('href');
    if (v && !v.startsWith('data:') && !v.startsWith('#')) el.setAttribute('href', absoluta(v));
  });
  clone.querySelectorAll('[srcset]').forEach((el) => {
    const v = el.getAttribute('srcset') || '';
    el.setAttribute(
      'srcset',
      v.split(',').map((parte) => {
        const [u, d] = parte.trim().split(/\s+/);
        return u ? absoluta(u) + (d ? ' ' + d : '') : parte;
      }).join(', ')
    );
  });
  clone.querySelectorAll('[style]').forEach((el) => {
    const s = el.getAttribute('style') || '';
    if (s.includes('url(')) {
      el.setAttribute('style', s.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) =>
        u.startsWith('data:') ? m : `url("${absoluta(u)}")`));
    }
  });
  // Fundo preguiçoso guardado em data-bg (comum em construtor de página).
  clone.querySelectorAll('[data-bg], [data-background], [data-bg-image]').forEach((el) => {
    const v = el.getAttribute('data-bg') || el.getAttribute('data-background') || el.getAttribute('data-bg-image');
    if (v && /\.(png|jpe?g|webp|gif|avif|svg)/i.test(v) && !/background/.test(el.getAttribute('style') || '')) {
      el.setAttribute('style', `${el.getAttribute('style') || ''};background-image:url("${absoluta(v)}")`);
    }
  });

  // ---------------------------------------------------------------------------
  // 7. CSS. Um `url(...)` dentro da folha de estilo é relativo ao ENDEREÇO DA
  //    FOLHA, não ao HTML: ao embutir o CSS sem reescrever, toda imagem de
  //    fundo e toda fonte quebrava. @import de outra origem não dá para ler
  //    aqui — vai para a lista de folhas que o empacotador baixa.
  // ---------------------------------------------------------------------------
  const reescreverUrls = (css, origemDaFolha) =>
    css.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) => {
      // chrome-extension:// vem de OUTRA extensão do navegador injetando
      // fonte na página. Não é conteúdo do site e não existe fora daqui.
      if (/^chrome-extension:/i.test(u)) return 'none';
      if (/^(data:|#)/i.test(u)) return m;
      return `url("${absoluta(u, origemDaFolha)}")`;
    });

  const cssInterno = [];
  const cssExterno = [];

  function lerFolha(folha, origem, profundidade) {
    let txt = '';
    for (const regra of Array.from(folha.cssRules)) {
      if (regra.type === CSSRule.IMPORT_RULE) {
        const alvo = absoluta(regra.href, origem);
        try {
          if (profundidade < 3 && regra.styleSheet) txt += lerFolha(regra.styleSheet, alvo, profundidade + 1);
        } catch (e) {
          // Marcador no lugar exato: o empacotador baixa e encaixa aqui,
          // preservando a ordem das regras (a cascata depende dela).
          txt += `/*@mx-externo ${alvo}*/
`;
          cssExterno.push(alvo);
        }
        continue;
      }
      txt += regra.cssText + '\n';
    }
    return reescreverUrls(txt, origem);
  }

  for (const folha of Array.from(document.styleSheets)) {
    const origem = folha.href || base;
    try {
      const txt = lerFolha(folha, origem, 0);
      if (txt.trim()) cssInterno.push(txt);
    } catch (e) {
      if (folha.href) {
        cssInterno.push(`/*@mx-externo ${folha.href}*/`);
        cssExterno.push(folha.href);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 8. Design system: os valores que a página realmente aplica, por frequência.
  // ---------------------------------------------------------------------------
  const conta = { cor: {}, fundo: {}, fonte: {}, tamanho: {}, raio: {}, espaco: {} };
  const somar = (mapa, valor) => {
    if (!valor) return;
    mapa[valor] = (mapa[valor] || 0) + 1;
  };
  const ignoraCor = (c) => !c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent';

  // Famílias de fonte realmente usadas (inclusive ícones em ::before/::after).
  // O empacotador baixa só estas: muito construtor declara dezenas de fontes
  // que a página nem usa.
  const fontesUsadas = new Set();
  const anotarFonte = (familia) => String(familia || '').split(',').forEach((f) => {
    const nome = f.trim().replace(/^["']|["']$/g, '').toLowerCase();
    if (nome) fontesUsadas.add(nome);
  });

  const visiveis = Array.from(document.body.querySelectorAll('*')).slice(0, 4000);
  for (const el of visiveis) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const s = getComputedStyle(el);
    anotarFonte(s.fontFamily);
    ['::before', '::after'].forEach((pseudo) => {
      const p = getComputedStyle(el, pseudo);
      if (p.content && p.content !== 'none' && p.content !== 'normal') anotarFonte(p.fontFamily);
    });
    if (!ignoraCor(s.color)) somar(conta.cor, s.color);
    if (!ignoraCor(s.backgroundColor)) somar(conta.fundo, s.backgroundColor);
    somar(conta.fonte, s.fontFamily);
    somar(conta.tamanho, s.fontSize);
    if (s.borderRadius && s.borderRadius !== '0px') somar(conta.raio, s.borderRadius);
    [s.paddingTop, s.paddingBottom, s.marginBottom].forEach((v) => {
      if (v && v !== '0px') somar(conta.espaco, v);
    });
  }

  const topoDe = (mapa, n) => Object.entries(mapa)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([valor, vezes]) => ({ valor, vezes }));

  // Players de plataforma (Vturb, Panda, Converte.ai) dependem do script deles.
  const players = document.querySelectorAll('vturb-smartplayer, [id^="vid_"], iframe[src*="vturb"], iframe[src*="converteai"], iframe[src*="pandavideo"], div[id^="smartplayer"]').length;

  return {
    titulo: document.title || 'pagina',
    url: location.href,
    html: '<!doctype html>\n' + clone.outerHTML,
    cssInterno,
    cssExterno: Array.from(new Set(cssExterno)),
    destravados,
    animaveis,
    carrosseis,
    // Perguntas em <details> funcionam sem script, mas também são sanfona.
    sanfonas: sanfonas + document.querySelectorAll('details').length,
    abas,
    players,
    secoes,
    fontesUsadas: Array.from(fontesUsadas),
    larguraCaptura: window.innerWidth,
    alturaPagina: document.body.scrollHeight,
    elementos: document.body.querySelectorAll('*').length,
    tokens: {
      cores: topoDe(conta.cor, 10),
      fundos: topoDe(conta.fundo, 10),
      fontes: topoDe(conta.fonte, 5),
      tamanhos: topoDe(conta.tamanho, 10),
      raios: topoDe(conta.raio, 6),
      espacos: topoDe(conta.espaco, 10)
    }
  };
}
