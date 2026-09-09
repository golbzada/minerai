// ==============================================================================
// MINERAÍ EXTENSÃO - CONTENT SCRIPT (MANIFEST V3)
// Biblioteca de Anúncios do Meta (Meta Ads Library)
// ==============================================================================

(function () {
  'use strict';

  let authInterval = null;
  let currentUser = null;
  let activeFilters = {
    minAds: 0,
    minDays: 0
  };

  // Variáveis de controle de performance do MutationObserver
  let debounceTimer = null;
  let observerInstance = null;
  let mutationTimestamps = [];
  let isCircuitBreakerOpen = false;
  const DEBOUNCE_DELAY_MS = 450;
  const CIRCUIT_BREAKER_MAX_TRIGGERS = 20;
  const CIRCUIT_BREAKER_WINDOW_MS = 2000;
  const CIRCUIT_BREAKER_PAUSE_MS = 3000;

  const PT_MONTHS = {
    'jan': 0, 'janeiro': 0,
    'fev': 1, 'fevereiro': 1,
    'mar': 2, 'março': 2, 'marco': 2,
    'abr': 3, 'abril': 3,
    'mai': 4, 'maio': 4,
    'jun': 5, 'junho': 5,
    'jul': 6, 'julho': 6,
    'ago': 7, 'agosto': 7,
    'set': 8, 'setembro': 8,
    'out': 9, 'outubro': 9,
    'nov': 10, 'novembro': 10,
    'dez': 11, 'dezembro': 11
  };

  // Safe messaging wrapper against context invalidation
  function safeSendMessage(message, callback) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
      if (authInterval) clearInterval(authInterval);
      return;
    }
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime?.lastError) {
          return;
        }
        if (callback) callback(response);
      });
    } catch (e) {
      if (authInterval) clearInterval(authInterval);
    }
  }

  // A inicialização fica no FIM do arquivo: as constantes de extração
  // (NON_NAME_PATTERNS, NICHE_KEYWORDS, MONTH_ISO...) são `const` e ainda não
  // existem neste ponto do script.
  function initExtension() {
    console.log('[Mineraí Extensão] Inicializada com sucesso.');
    checkAuth();
    injectFloatingPanel();
    startCardObserver();

    // Varreduras rápidas iniciais para acompanhar o carregamento do React
    scanAndEnhanceCards();
    setTimeout(scanAndEnhanceCards, 600);
    setTimeout(scanAndEnhanceCards, 1500);
    setTimeout(scanAndEnhanceCards, 3000);

    // Revalidar autenticação periodicamente
    authInterval = setInterval(checkAuth, 10000);
  }

  // Verificar status de autenticação via Background
  function checkAuth() {
    safeSendMessage({ type: 'CHECK_AUTH' }, (response) => {
      currentUser = response?.authenticated ? response.user : null;
      updatePanelAuthStatus();
    });
  }

  // ============================================================================
  // 1. PAINEL FLUTUANTE ARRASTÁVEL ("Filtros Mineraí")
  // ============================================================================

  function injectFloatingPanel() {
    if (document.getElementById('minerai-floating-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'minerai-floating-panel';

    panel.innerHTML = `
      <div class="minerai-panel-header" id="minerai-drag-handle">
        <div class="minerai-header-brand">
          <div class="minerai-logo-icon">M</div>
          <div class="minerai-header-titles">
            <span class="minerai-header-title">Filtros Mineraí</span>
            <span class="minerai-header-sub">arraste para mover</span>
          </div>
        </div>
        <button class="minerai-min-btn" id="minerai-toggle-min" title="Minimizar / Expandir">−</button>
      </div>

      <div class="minerai-panel-body">
        <div class="minerai-auth-badge" id="minerai-auth-box">
          <span>Verificando login...</span>
        </div>

        <!-- Destacar Palavra-Chave (Dourado) -->
        <div class="minerai-field-group">
          <div class="minerai-field-header-row">
            <label>Destacar palavra-chave</label>
            <span class="minerai-search-counter" id="minerai-term-counter" style="display: none;">0 de 0</span>
          </div>
          <div class="minerai-term-input-wrapper">
            <input type="text" id="minerai-term-search" placeholder="Ex: flashcards, mapas, enem..." />
            <div class="minerai-term-nav-btns" id="minerai-term-nav" style="display: none;">
              <button type="button" id="minerai-term-prev" title="Ocorrência anterior (▲)">▲</button>
              <button type="button" id="minerai-term-next" title="Próxima ocorrência (▼)">▼</button>
              <button type="button" id="minerai-term-clear" title="Limpar destaque (✕)">✕</button>
            </div>
          </div>
          <span class="minerai-field-helper">Digite a palavra e clique em Garimpar para destacar em ouro</span>
        </div>

        <div class="minerai-field-group">
          <label>Quantidade mínima de criativos</label>
          <input type="number" id="minerai-min-ads" min="0" value="0" placeholder="Ex: 2 (ou 0 para todos)" />
          <span class="minerai-field-helper">Use 0 para todos (1 a 3 criativos é ideal para testes)</span>
        </div>

        <div class="minerai-field-group">
          <label>Tempo mínimo rodando (dias)</label>
          <input type="number" id="minerai-min-days" min="0" value="0" placeholder="Ex: 30 (ou 0 para todos)" />
          <span class="minerai-field-helper">Use 0 para todos (30 a 50 dias é ideal para escala)</span>
        </div>

        <button class="minerai-btn-primary" id="minerai-apply-filters">
          <span>Garimpar com Filtros</span>
        </button>

        <div class="minerai-panel-footer">
          <span>Anúncios visíveis:</span>
          <span class="minerai-counter-num" id="minerai-counter-display">0 de 0</span>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    setupDraggable(panel);
    setupPanelEvents(panel);
  }

  // Nosso painel. Não trocar por minerarads.com.br — aquele domínio é de outro
  // produto e mandava o cliente logar na conta errada.
  const OFFICIAL_DASHBOARD_URL = 'https://mineraiofertas.vercel.app';

  // Depois de mandar a pessoa para o painel, a checagem normal de 10 em 10
  // segundos faz parecer que nada aconteceu. Enquanto ela está logando,
  // passamos a conferir de 2 em 2 segundos por até 2 minutos.
  let aguardandoLogin = false;
  let esperaLoginInterval = null;
  let esperaLoginTimeout = null;

  function iniciarEsperaDeLogin() {
    aguardandoLogin = true;
    updatePanelAuthStatus();

    if (esperaLoginInterval) clearInterval(esperaLoginInterval);
    if (esperaLoginTimeout) clearTimeout(esperaLoginTimeout);

    esperaLoginInterval = setInterval(checkAuth, 2000);
    esperaLoginTimeout = setTimeout(pararEsperaDeLogin, 120000);
  }

  function pararEsperaDeLogin() {
    aguardandoLogin = false;
    if (esperaLoginInterval) clearInterval(esperaLoginInterval);
    if (esperaLoginTimeout) clearTimeout(esperaLoginTimeout);
    esperaLoginInterval = null;
    esperaLoginTimeout = null;
  }

  function updatePanelAuthStatus() {
    const authBox = document.getElementById('minerai-auth-box');
    if (!authBox) return;

    // Conectou: encerra a espera acelerada.
    if (currentUser && aguardandoLogin) pararEsperaDeLogin();

    if (currentUser) {
      authBox.className = 'minerai-auth-badge online';
      const name = currentUser.name || currentUser.email?.split('@')[0] || 'Minerador';
      authBox.innerHTML = `<span>🟢 Conectado: <strong>${escapeHtml(name)}</strong></span>`;
    } else {
      authBox.className = 'minerai-auth-badge offline';
      authBox.innerHTML = `
        <span>${aguardandoLogin ? '🟡 Aguardando login...' : '🔴 Não conectado'}</span>
        <a id="minerai-login-link" target="_blank" href="${OFFICIAL_DASHBOARD_URL}">
          ${aguardandoLogin ? 'Reabrir painel' : 'Conectar conta'}
        </a>
      `;
      const loginLink = authBox.querySelector('#minerai-login-link');
      if (loginLink) {
        loginLink.addEventListener('click', (e) => {
          e.preventDefault();
          safeSendMessage({ type: 'OPEN_DASHBOARD', url: OFFICIAL_DASHBOARD_URL });
          iniciarEsperaDeLogin();
        });
      }
    }
  }

  function setupDraggable(panel) {
    const handle = panel.querySelector('#minerai-drag-handle');
    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('#minerai-toggle-min')) return;
      isDragging = true;
      panel.classList.add('dragging');
      startX = e.clientX;
      startY = e.clientY;

      const rect = panel.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      panel.style.right = 'auto';
      panel.style.left = `${initialLeft}px`;
      panel.style.top = `${initialTop}px`;

      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newLeft = initialLeft + dx;
      let newTop = initialTop + dy;

      newLeft = Math.max(10, Math.min(window.innerWidth - panel.offsetWidth - 10, newLeft));
      newTop = Math.max(10, Math.min(window.innerHeight - panel.offsetHeight - 10, newTop));

      panel.style.left = `${newLeft}px`;
      panel.style.top = `${newTop}px`;
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        panel.classList.remove('dragging');
      }
    });
  }

  function setupPanelEvents(panel) {
    const minBtn = panel.querySelector('#minerai-toggle-min');
    const applyBtn = panel.querySelector('#minerai-apply-filters');
    const minAdsInput = panel.querySelector('#minerai-min-ads');
    const minDaysInput = panel.querySelector('#minerai-min-days');
    const termInput = panel.querySelector('#minerai-term-search');
    const termPrevBtn = panel.querySelector('#minerai-term-prev');
    const termNextBtn = panel.querySelector('#minerai-term-next');
    const termClearBtn = panel.querySelector('#minerai-term-clear');

    minBtn.addEventListener('click', () => {
      panel.classList.toggle('minimized');
      minBtn.textContent = panel.classList.contains('minimized') ? '+' : '−';
    });

    // Pressionar Enter no campo de termo dispara o Garimpar / Navegação
    termInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const term = termInput.value.trim();
        if (term !== currentSearchTerm) {
          applyBtn.click();
        } else {
          if (e.shiftKey) prevMatch();
          else nextMatch();
        }
      }
    });

    termPrevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      prevMatch();
    });

    termNextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      nextMatch();
    });

    termClearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      termInput.value = '';
      clearHighlights();
      const navBox = document.getElementById('minerai-term-nav');
      const counterBox = document.getElementById('minerai-term-counter');
      if (navBox) navBox.style.display = 'none';
      if (counterBox) counterBox.style.display = 'none';
      showToast('Destaque de palavra-chave removido.');
    });

    // Botão Garimpar com Filtros (aplica filtros de criativos/dias e destaca termo)
    applyBtn.addEventListener('click', () => {
      applyBtn.classList.add('active-pulse');
      setTimeout(() => applyBtn.classList.remove('active-pulse'), 400);

      activeFilters.minAds = parseInt(minAdsInput.value, 10) || 0;
      activeFilters.minDays = parseInt(minDaysInput.value, 10) || 0;

      scanAndEnhanceCards();
      const count = applyAdFilters();

      const term = termInput.value.trim();
      if (term.length >= 2) {
        const matchesCount = highlightKeyword(term, true);
        if (matchesCount > 0) {
          showToast(`${matchesCount} ocorrência(s) de "${term}" destacadas em ouro!`);
        } else {
          showToast(`Nenhuma ocorrência de "${term}" encontrada nos anúncios visíveis.`);
        }
      } else {
        clearHighlights();
        const navBox = document.getElementById('minerai-term-nav');
        const counterBox = document.getElementById('minerai-term-counter');
        if (navBox) navBox.style.display = 'none';
        if (counterBox) counterBox.style.display = 'none';
        if (count > 0) {
          showToast(`${count} criativos encontrados!`);
        } else {
          showToast('Nenhum anúncio correspondeu aos filtros aplicados.');
        }
      }
    });
  }

  // ============================================================================
  // 2. MUTATION OBSERVER COM DEBOUNCE E CIRCUIT BREAKER
  // ============================================================================

  function handleMutationTrigger() {
    if (isCircuitBreakerOpen) return;

    const now = Date.now();
    mutationTimestamps = mutationTimestamps.filter(t => now - t < CIRCUIT_BREAKER_WINDOW_MS);
    mutationTimestamps.push(now);

    if (mutationTimestamps.length > CIRCUIT_BREAKER_MAX_TRIGGERS) {
      console.warn('[Mineraí Extensão] Circuit breaker acionado. Pausando observer temporariamente por 3s.');
      isCircuitBreakerOpen = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (observerInstance) observerInstance.disconnect();

      setTimeout(() => {
        isCircuitBreakerOpen = false;
        mutationTimestamps = [];
        startCardObserver();
        processMutationsBatch();
      }, CIRCUIT_BREAKER_PAUSE_MS);
      return;
    }

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      processMutationsBatch();
    }, DEBOUNCE_DELAY_MS);
  }

  function processMutationsBatch() {
    scanAndEnhanceCards();
    updateVisibleCount();
    if (currentSearchTerm && currentSearchTerm.length >= 2) {
      highlightKeyword(currentSearchTerm, false);
    }
  }

  function startCardObserver() {
    if (observerInstance) {
      observerInstance.disconnect();
    }

    observerInstance = new MutationObserver((mutations) => {
      const isInternal = mutations.every(m => {
        const target = m.target;
        if (!target) return false;
        return (
          target.id === 'minerai-floating-panel' ||
          target.closest?.('#minerai-floating-panel') ||
          target.classList?.contains('minerai-card-injected-bar') ||
          target.closest?.('.minerai-card-injected-bar') ||
          target.classList?.contains('minerai-toast')
        );
      });

      if (!isInternal) {
        handleMutationTrigger();
      }
    });

    const targetContainer =
      document.querySelector('div[role="main"]') ||
      document.querySelector('div[role="feed"]') ||
      document.body;

    observerInstance.observe(targetContainer, {
      childList: true,
      subtree: true
    });
  }

  // ============================================================================
  // DESTAQUE & NAVEGAÇÃO DE PALAVRAS-CHAVE (TIPO CTRL+F DOURADO)
  // ============================================================================

  let currentSearchTerm = '';
  let currentMatchIndex = 0;
  let highlightedMatches = [];

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function clearHighlights() {
    const marks = Array.from(document.querySelectorAll('mark.minerai-term-highlight'));
    marks.forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
        parent.normalize();
      }
    });
    highlightedMatches = [];
    currentMatchIndex = 0;
  }

  function highlightKeyword(term, scrollToFirst = false) {
    currentSearchTerm = (term || '').trim();
    const navBox = document.getElementById('minerai-term-nav');
    const counterBox = document.getElementById('minerai-term-counter');

    if (!currentSearchTerm || currentSearchTerm.length < 2) {
      clearHighlights();
      if (navBox) navBox.style.display = 'none';
      if (counterBox) counterBox.style.display = 'none';
      return 0;
    }

    clearHighlights();

    const escaped = escapeRegExp(currentSearchTerm);
    const regex = new RegExp(`(${escaped})`, 'gi');

    const cards = findAdCards();
    const createdMarks = [];

    cards.forEach((card) => {
      // Ignora cards ocultados por outros filtros
      if (card.classList.contains('minerai-card-filtered-out')) return;

      const walker = document.createTreeWalker(
        card,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            if (
              parent.closest('.minerai-card-injected-bar') ||
              parent.closest('#minerai-floating-panel') ||
              parent.tagName === 'SCRIPT' ||
              parent.tagName === 'STYLE' ||
              parent.tagName === 'MARK'
            ) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        },
        false
      );

      const matchingTextNodes = [];
      let n;
      while ((n = walker.nextNode())) {
        if (n.nodeValue && regex.test(n.nodeValue)) {
          matchingTextNodes.push(n);
        }
      }

      matchingTextNodes.forEach((node) => {
        const parent = node.parentNode;
        if (!parent) return;

        const val = node.nodeValue;
        const parts = val.split(regex);
        const fragment = document.createDocumentFragment();

        parts.forEach((part) => {
          if (part && part.toLowerCase() === currentSearchTerm.toLowerCase()) {
            const mark = document.createElement('mark');
            mark.className = 'minerai-term-highlight';
            mark.textContent = part;
            fragment.appendChild(mark);
            createdMarks.push(mark);
          } else if (part) {
            fragment.appendChild(document.createTextNode(part));
          }
        });

        parent.replaceChild(fragment, node);
      });
    });

    highlightedMatches = createdMarks;

    if (highlightedMatches.length > 0) {
      if (navBox) navBox.style.display = 'inline-flex';
      if (counterBox) {
        counterBox.style.display = 'inline-block';
        counterBox.textContent = `1 de ${highlightedMatches.length}`;
      }
      if (scrollToFirst) {
        currentMatchIndex = 0;
        focusMatch(0, true);
      }
    } else {
      if (navBox) navBox.style.display = 'none';
      if (counterBox) {
        counterBox.style.display = 'inline-block';
        counterBox.textContent = '0 de 0';
      }
    }

    return highlightedMatches.length;
  }

  function focusMatch(index, shouldScroll = true) {
    if (!highlightedMatches.length) return;
    currentMatchIndex = (index + highlightedMatches.length) % highlightedMatches.length;

    highlightedMatches.forEach((m, idx) => {
      if (idx === currentMatchIndex) {
        m.classList.add('minerai-term-active');
      } else {
        m.classList.remove('minerai-term-active');
      }
    });

    const currentEl = highlightedMatches[currentMatchIndex];
    if (currentEl && shouldScroll) {
      currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    const counterBox = document.getElementById('minerai-term-counter');
    if (counterBox) {
      counterBox.textContent = `${currentMatchIndex + 1} de ${highlightedMatches.length}`;
    }
  }

  function nextMatch() {
    if (!highlightedMatches.length) return;
    focusMatch(currentMatchIndex + 1, true);
  }

  function prevMatch() {
    if (!highlightedMatches.length) return;
    focusMatch(currentMatchIndex - 1, true);
  }

  // ============================================================================
  // 3. IDENTIFICAÇÃO PRECISA DOS CARDS DE ANÚNCIO (INDIVIDUAL AD CONTAINER)
  // ============================================================================

  function findAdCards() {
    // 1. Recupera todos os cards previamente marcados
    const knownCards = Array.from(document.querySelectorAll('[data-minerai-card="true"]'));
    const cardSet = new Set(knownCards);
    const allCards = [...knownCards];

    // 2. Busca novos cards no DOM
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue;
      if (
        text &&
        (text.includes('Identificação da biblioteca:') ||
         text.includes('Library ID:') ||
         text.includes('ID da biblioteca:') ||
         text.includes('Identificação do anúncio:') ||
         text.includes('Veiculação iniciada em') ||
         text.includes('Veiculacao iniciada em') ||
         text.includes('Começou a ser veiculado em') ||
         text.includes('Comecou a ser veiculado em') ||
         text.includes('Started running on'))
      ) {
        let current = node.parentElement;
        let candidate = null;

        while (current && current !== document.body) {
          if (current.getAttribute('data-minerai-card') === 'true') {
            candidate = current;
            break;
          }

          const currentText = current.innerText || '';
          // Se o container contiver mais de 1 anúncio, ele é um grid/feed pai! Paramos no candidato anterior.
          const idMatches = currentText.match(/(?:Identificação da biblioteca|Library ID|ID da biblioteca|Identificação do anúncio):/gi);
          if (idMatches && idMatches.length > 1) {
            break;
          }

          if (
            current.tagName === 'DIV' &&
            (currentText.includes('Identificação da biblioteca:') || currentText.includes('Library ID:') || currentText.includes('ID da biblioteca:') || currentText.includes('Veiculação iniciada em') || currentText.includes('Veiculacao iniciada em')) &&
            (currentText.includes('Ver detalhes') || currentText.includes('Ver resumo') || currentText.includes('See ad details') || currentText.includes('Plataformas') || currentText.includes('Platforms') || current.querySelector('img, video, a[role="link"]'))
          ) {
            candidate = current;
          }

          current = current.parentElement;
        }

        if (candidate && !cardSet.has(candidate)) {
          candidate.setAttribute('data-minerai-card', 'true');
          cardSet.add(candidate);
          allCards.push(candidate);
        }
      }
    }

    return allCards;
  }

  // ============================================================================
  // 4. EXTRAÇÃO DE METADADOS DO CARD
  // ============================================================================

  // Textos que a Biblioteca de Anúncios usa como rótulo/botão e que NUNCA são
  // o nome do anunciante. Sem esta lista o nome vinha como "Ativo",
  // "Identificação da biblioteca: ..." ou o texto do botão de CTA.
  const NON_NAME_PATTERNS = [
    /^ativo$/i, /^inativo$/i, /^active$/i, /^inactive$/i,
    /^patrocinad/i, /^sponsored$/i,
    /identifica(ç|c)(ã|a)o d[ao]/i, /^library id/i, /^id da biblioteca/i,
    /veicula(ç|c)(ã|a)o/i, /^started running/i, /^come(ç|c)ou a ser veiculado/i,
    /^plataformas?$/i, /^platforms?$/i,
    /^categorias?$/i, /^categor(y|ies)$/i,
    /ver detalhes/i, /ver resumo/i, /see ad details/i, /see summary/i,
    /^ver mais$/i, /^see more$/i, /^ver menos$/i, /^see less$/i,
    /an(ú|u)ncios? usam/i, /ads? use/i, /^este an(ú|u)ncio tem/i,
    /^saiba mais$/i, /^learn more$/i, /^comprar agora$/i, /^shop now$/i,
    /^cadastre-se$/i, /^sign up$/i, /^inscreva-se$/i, /^subscribe$/i,
    /^enviar mensagem$/i, /^send message$/i, /^baixar$/i, /^download$/i,
    /^assine j(á|a)$/i, /^candidatar-se$/i, /^apply now$/i, /^reservar$/i,
    /^abrir link$/i, /^open link$/i, /^contate-nos$/i, /^contact us$/i,
    /^abrir menu/i, /^open drop-down/i, /^minerar oferta$/i, /^baixar m(í|i)dia$/i,
    /^\d[\d.,\s]*$/,
    /^https?:\/\//i
  ];

  const MONTH_ISO = (m) => String(m + 1).padStart(2, '0');

  // Domínios da própria Meta: nunca são a página de vendas do produto.
  const META_HOSTS = /(^|\.)(facebook|fb|instagram|meta|threads|messenger)\.(com|net|me)$/i;

  // Caminhos do Facebook que não são página de anunciante.
  const RESERVED_FB_PATHS = /^(profile\.php|pages|ads|people|groups|watch|marketplace|events|photo|video|permalink|story\.php|sharer|login|help|business|gaming|reel)$/i;

  // ============================================================================
  // TEMA ESPECÍFICO DA OFERTA
  // ============================================================================
  // Muitos anúncios dizem o assunto com todas as letras ("mapas de engenharia
  // civil", "curso de confeitaria"). Quando isso acontece, guardamos o tema
  // exato E usamos ele como sinal forte para acertar a categoria — antes essas
  // ofertas caíam num nicho genérico porque nenhuma palavra da lista batia.
  const TOPIC_RULES = [
    // Formações técnicas e superiores
    ['Engenharia Civil', /\bengenharia civil\b|\bengenheiro civil\b/, 'Educação & Idiomas'],
    ['Engenharia Elétrica', /\bengenharia eletrica\b|\beletrotecnic\w*\b/, 'Educação & Idiomas'],
    ['Arquitetura', /\barquitetura\b|\barquiteto\b|\bautocad\b|\brevit\b|\bsketchup\b/, 'Educação & Idiomas'],
    ['Enfermagem', /\benfermagem\b|\btecnico em enfermagem\b/, 'Educação & Idiomas'],
    ['Medicina', /\bmedicina\b|\bresidencia medica\b|\brevalida\b/, 'Educação & Idiomas'],
    ['Direito', /\bdireito\b|\bconcurso da oab\b|\bexame de ordem\b/, 'Educação & Idiomas'],
    ['Contabilidade', /\bcontabilidade\b|\bcontador\b|\bciencias contabeis\b/, 'Educação & Idiomas'],
    ['Farmácia', /\bfarmacia\b|\bfarmaceutic\w*\b/, 'Educação & Idiomas'],
    ['Psicologia', /\bpsicologia\b|\bpsicanalise\b|\bpsicolog\w*\b/, 'Desenvolvimento Pessoal'],
    ['Nutrição', /\bnutricao\b|\bnutricionista\b/, 'Saúde & Beleza'],

    // Ofícios e profissões manuais
    ['Elétrica Residencial', /\beletricista\b|\beletrica residencial\b|\binstalacoes eletricas\b/, 'Educação & Idiomas'],
    ['Refrigeração', /\brefrigeracao\b|\bar condicionado\b|\bclimatizacao\b/, 'Educação & Idiomas'],
    ['Marcenaria', /\bmarcenaria\b|\bmarceneiro\b|\bmoveis planejados\b/, 'Educação & Idiomas'],
    ['Confeitaria', /\bconfeitaria\b|\bconfeiteir\w*\b|\bbolos? caseir\w*\b|\bdocinhos\b/, 'Educação & Idiomas'],
    ['Costura', /\bcostura\b|\bcosturei\w*\b|\bmodelagem de roupas\b/, 'Educação & Idiomas'],
    ['Barbearia', /\bbarbeir\w*\b|\bbarbearia\b/, 'Educação & Idiomas'],
    ['Manicure', /\bmanicure\b|\bnail design\b|\balongamento de unhas\b/, 'Educação & Idiomas'],
    ['Sobrancelhas & Cílios', /\bsobrancelh\w*\b|\bcilios\b|\bmicropigmentacao\b|\blash\b/, 'Saúde & Beleza'],
    ['Maquiagem', /\bmaquiagem\b|\bmaquiador\w*\b|\bautomaquiagem\b/, 'Saúde & Beleza'],
    ['Fotografia', /\bfotografia\b|\bfotograf\w*\b|\blightroom\b/, 'Educação & Idiomas'],
    ['Jardinagem', /\bjardinagem\b|\bpaisagismo\b|\bhorta caseira\b/, 'Casa, Decoração & Cozinha'],
    ['Soldagem', /\bsolda\b|\bsoldador\b|\bsoldagem\b/, 'Educação & Idiomas'],
    ['Mecânica', /\bmecanica automotiva\b|\bmecanico de\b|\binjecao eletronica\b/, 'Automotivo & Veículos'],

    // Música e artes
    ['Violão & Guitarra', /\bviolao\b|\bguitarra\b/, 'Educação & Idiomas'],
    ['Teclado & Piano', /\bteclado\b|\bpiano\b/, 'Educação & Idiomas'],
    ['Canto', /\bcanto\b|\bcantar\b|\btecnica vocal\b/, 'Educação & Idiomas'],
    ['Desenho', /\bdesenho\b|\bdesenhar\b|\bilustracao\b/, 'Educação & Idiomas'],
    ['Artesanato', /\bartesanato\b|\bcroche\b|\btrico\b|\bmacrame\b|\bbiscuit\b/, 'Educação & Idiomas'],

    // Tecnologia
    ['Programação', /\bprogramacao\b|\bprogramador\b|\bpython\b|\bjavascript\b|\bdesenvolvedor\b/, 'Educação & Idiomas'],
    ['Excel', /\bexcel\b|\bplanilhas? do excel\b|\bvba\b/, 'Educação & Idiomas'],
    ['Design Gráfico', /\bdesign grafico\b|\bphotoshop\b|\bcanva\b|\billustrator\b/, 'Educação & Idiomas'],
    ['Edição de Vídeo', /\bedicao de video\b|\bpremiere\b|\bafter effects\b|\bcapcut\b/, 'Educação & Idiomas'],

    // Saúde específica
    ['Fisioterapia', /\bfisioterap\w*\b/, 'Saúde & Beleza'],
    ['Odontologia', /\bodontolog\w*\b|\bdentista\b|\bimplante dentario\b|\bclareamento dental\b/, 'Saúde & Beleza'],
    ['Diabetes', /\bdiabet\w*\b|\bglicemia\b|\bglicose alta\b/, 'Saúde & Beleza'],
    ['Coluna & Articulações', /\bhernia de disco\b|\bdor na coluna\b|\bartrose\b|\bnervo ciatico\b|\blombar\b/, 'Saúde & Beleza'],
    ['Queda de Cabelo', /\bqueda de cabelo\b|\bcalvicie\b|\balopecia\b|\bimplante capilar\b/, 'Saúde & Beleza'],
    ['Visão', /\bvisao\b|\bcatarata\b|\bmiopia\b|\bvista cansada\b/, 'Saúde & Beleza'],
    ['Audição', /\baparelho auditivo\b|\bzumbido no ouvido\b|\bsurdez\b/, 'Saúde & Beleza'],

    // Concursos e provas
    ['ENEM', /\benem\b|\bvestibular\b/, 'Educação & Idiomas'],
    ['Concurso Público', /\bconcurso publico\b|\bconcursos publicos\b|\bedital\b/, 'Educação & Idiomas'],
    ['CNH', /\bcnh\b|\bcarteira de motorista\b|\bauto ?escola\b/, 'Automotivo & Veículos'],
    ['Inglês', /\bingles\b|\bfluencia em ingles\b/, 'Educação & Idiomas'],

    // Nichos de mercado
    ['Tarot', /\btaro\b|\btarot\b|\bbaralho cigano\b/, 'Espiritualidade & Astrologia'],
    ['Astrologia', /\bastrolog\w*\b|\bmapa astral\b|\bhoroscopo\b/, 'Espiritualidade & Astrologia'],
    ['Adestramento', /\badestrament\w*\b|\badestrador\b/, 'Pets & Animais de Estimação'],
    ['Apostas Esportivas', /\bapostas esportivas\b|\bbanca de apostas\b|\btrader esportivo\b/, 'iGaming & Apostas'],
    ['Day Trade', /\bday trade\b|\btrader\b|\bscalping\b/, 'Finanças & Investimentos'],
    ['Criptomoedas', /\bcriptomoedas?\b|\bbitcoin\b|\bcripto\b/, 'Finanças & Investimentos'],
    ['Limpar o Nome', /\bnome limpo\b|\blimpar o nome\b|\bserasa\b|\bscore do serasa\b/, 'Finanças & Investimentos'],
    ['Emagrecimento', /\bemagrec\w*\b|\bperder peso\b|\bsecar a barriga\b/, 'Emagrecimento & Suplementos'],
    ['Reconquista', /\breconquist\w*\b|\bex de volta\b/, 'Relacionamento & Conquista']
  ];

  /**
   * Procura o tema exato citado no anúncio.
   * Devolve `{ topic, niche }` ou null quando nada específico aparece.
   */
  function detectTopic(normalizedText) {
    for (const [topic, pattern, niche] of TOPIC_RULES) {
      if (pattern.test(normalizedText)) return { topic, niche };
    }
    return null;
  }

  // ============================================================================
  // CLASSIFICAÇÃO DE NICHO (POR PONTUAÇÃO)
  // ============================================================================
  // A versão anterior devolvia o PRIMEIRO nicho cujo regex casasse, e os regex
  // não tinham limite de palavra. Resultado: "avaliações" / "informações"
  // casavam com o "ações" de Finanças, e um anúncio de fisioterapia era
  // classificado como investimentos. Agora cada nicho soma pontos e vence o de
  // maior pontuação — e todo termo é ancorado em limite de palavra.

  /** Minúsculas e sem acento: deixa as regras abaixo em ASCII puro. */
  function normalizeForMatch(text) {
    return (text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }

  // `strong` = termo que praticamente define o nicho sozinho (3 pontos).
  // `weak`   = termo que só conta como reforço (1 ponto).
  const NICHE_RULES = [
    {
      niche: 'Saúde & Beleza',
      strong: /\b(fisioterap\w*|quiropraxia|acupuntura|ortopedi\w*|cardiolog\w*|dermatolog\w*|dentist\w*|odontolog\w*|clareador\w*|celulite|varizes|psoriase|dermatite|rugas|botox|melasma|manchas? na pele|queda de cabelo|calvicie|alopecia|micose|halitose|enxaqueca|labirintite|diabet\w*|pressao alta|colesterol|artrose|artrite|hernia de disco|nervo ciatico|dor(es)? (na|nas|no|nos) (coluna|joelho|costas|lombar|articulacoes))\b/,
      weak: /\b(saude|beleza|pele|cabelo|estetica|creme|serum|dente|dentes|clinica|tratamento|sintomas?|remedio|dor|inflamacao|postura)\b/
    },
    {
      niche: 'Emagrecimento & Suplementos',
      strong: /\b(emagrec\w*|perder peso|queima(r)? de gordura|gordura localizada|obesidad\w*|suplement\w*|whey|creatina|colageno|low carb|jejum intermitente|termogenico|secar a barriga|cha emagrecedor)\b/,
      weak: /\b(magr[ao]|barriga|dieta|calorias|metabolismo|balanca|quilos?|kg)\b/
    },
    {
      niche: 'Fitness & Musculação',
      strong: /\b(musculacao|hipertrofia|gluteos?|bumbum|personal trainer|crossfit|academia|treino em casa)\b/,
      weak: /\b(treino|fitness|shape|exercicios?|alongamento|abdomen)\b/
    },
    {
      niche: 'Finanças & Investimentos',
      strong: /\b(investimentos?|investir|bolsa de valores|day trade|renda fixa|renda variavel|acoes|tesouro direto|criptomoedas?|bitcoin|cripto|dividendos|juros compostos|nome limpo|limpar o nome|serasa|emprestimo|financiamento|consorcio|imposto de renda|previdencia)\b/,
      weak: /\b(financas|dolar|lucro|banco|dividas?|score|cartao de credito|renda)\b/
    },
    {
      niche: 'Renda Extra & Afiliados',
      strong: /\b(renda extra|ganhar dinheiro|trabalh(e|ar) em casa|afiliados?|marketing digital|dinheiro online|home office|primeira venda)\b/,
      weak: /\b(lucrar|faturamento|comissao|freelancer)\b/
    },
    {
      niche: 'Relacionamento & Conquista',
      strong: /\b(reconquist\w*|ex de volta|seducao|conquistar (mulheres|homens)|salvar (o|meu) casamento|traicao|termino)\b/,
      weak: /\b(relacionamento|namoro|casamento|amor|paquera|ciumes)\b/
    },
    {
      niche: 'Espiritualidade & Astrologia',
      strong: /\b(taro|tarot|astrolog\w*|horoscopo|mapa astral|buzios|umbanda|reiki|oracao|biblia|evangelic\w*|catolic\w*|baralho cigano|numerologia|salmo\w*|terco)\b/,
      weak: /\b(espiritual|destino|energia|universo|\bfe\b|signo|alma)\b/
    },
    {
      niche: 'Educação & Idiomas',
      strong: /\b(enem|vestibular|concurso publico|apostila|flashcards?|mapas? mentais?|redacao nota 1000|ingles|espanhol|alfabetizacao|aula particular|faculdade|\btcc\b|\boab\b)\b/,
      weak: /\b(curso|aula|aulas|professor|estudo|estudar|aprender|idioma|resumo|escola|prova)\b/
    },
    {
      niche: 'Maternidade, Bebês & Kids',
      strong: /\b(bebes?|gravidez|gestante|maternidade|amamenta\w*|fraldas?|enxoval|parto|berco|papinha)\b/,
      weak: /\b(criancas?|infantil|filhos?|mae|maes)\b/
    },
    {
      niche: 'Pets & Animais de Estimação',
      strong: /\b(cachorr\w*|caes|gatos?|felin\w*|adestrament\w*|veterinari\w*|racao|pet ?shop|coleira|filhotes?)\b/,
      weak: /\b(pet|pets|animal|animais)\b/
    },
    {
      niche: 'Moda, Vestuário & Calçados',
      strong: /\b(vestidos?|blusas?|calca jeans|tenis|sapatos?|sutia|lingerie|bolsa feminina|oculos de sol|semijoias?|biquini|moda (feminina|masculina))\b/,
      weak: /\b(moda|roupas?|look|estilo|relogio)\b/
    },
    {
      niche: 'Tecnologia & Gadgets',
      strong: /\b(smartwatch|fone bluetooth|caixa de som|drone|notebook|tablet|projetor|aspirador robo|gadgets?|carregador)\b/,
      weak: /\b(tecnologia|eletronico|celular|camera|\busb\b)\b/
    },
    {
      niche: 'Casa, Decoração & Cozinha',
      strong: /\b(decoracao|panelas?|air ?fryer|organizador|colchao|utensilios?|cortinas?|tapetes?|luminaria|churrasqueira|liquidificador)\b/,
      weak: /\b(cozinha|casa|limpeza|sofa|jardim|quarto)\b/
    },
    {
      niche: 'Automotivo & Veículos',
      strong: /\b(automovel|pneus?|veiculos?|\bcnh\b|mecanic\w*|oficina|seguro auto|caminhao|oleo do motor|bateria automotiva)\b/,
      weak: /\b(carro|moto|dirigir|transito|motorista)\b/
    },
    {
      niche: 'iGaming & Apostas',
      strong: /\b(apostas?|cassino|casino|tigrinho|fortune tiger|slots?|jogo do bicho|banca de apostas|\bbet\b|\bodds\b)\b/,
      weak: /\b(palpite|bilhete|roleta|ganhos)\b/
    },
    {
      niche: 'Software, Apps & SaaS',
      strong: /\b(software|saas|\bcrm\b|\berp\b|sistema de gestao|automacao|chatbot|dashboard|integracao|\bapi\b)\b/,
      weak: /\b(aplicativo|\bapp\b|sistema|plataforma|planilha)\b/
    },
    {
      niche: 'Desenvolvimento Pessoal',
      strong: /\b(desenvolvimento pessoal|autoestima|ansiedade|depressao|autoconhecimento|procrastinacao|inteligencia emocional)\b/,
      weak: /\b(produtividade|mentalidade|foco|habitos?|disciplina|proposito|terapia|coach)\b/
    },
    {
      niche: 'Infoprodutos & PLR',
      strong: /\b(e-?books?|infoprodutos?|\bplr\b|mentoria|masterclass|treinamento online|area de membros|curso online|hotmart|kiwify|eduzz|monetizze|braip)\b/,
      weak: /\b(modulos?|certificado|bonus|acesso vitalicio|aulas gravadas)\b/
    },
    {
      niche: 'Negócios Locais & Serviços',
      strong: /\b(orcamento (gratis|sem compromisso)|agende (sua|seu)|marcar horario|agendamento|nossa loja|atendemos|funcionamos)\b/,
      weak: /\b(whatsapp|atendimento|contato|endereco|delivery)\b/
    },
    {
      niche: 'Dropshipping & Físicos',
      strong: /\b(frete gratis|ultimas unidades|pague na entrega|estoque limitado|compre 1 leve 2|entrega rapida|12x sem juros)\b/,
      weak: /\b(compre agora|promocao|desconto|oferta|unidades)\b/
    }
  ];

  function countMatches(regex, text) {
    const global = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
    const found = text.match(global);
    return found ? new Set(found).size : 0;
  }

  /**
   * Descobre a categoria e, quando o anúncio diz o assunto com todas as
   * letras, também o tema específico.
   * Devolve `{ niche, topic }` — `topic` fica vazio se nada específico casar.
   */
  function classifyOffer(text) {
    const sample = normalizeForMatch(text).slice(0, 4000);
    const detected = detectTopic(sample);

    let best = null;

    for (const rule of NICHE_RULES) {
      const strongHits = countMatches(rule.strong, sample);
      const weakHits = countMatches(rule.weak, sample);

      // O tema citado explicitamente pesa mais do que qualquer palavra solta.
      const topicBonus = detected && detected.niche === rule.niche ? 6 : 0;
      const score = strongHits * 3 + weakHits + topicBonus;

      if (!score) continue;

      // Desempate: mais termos definitivos vence; depois, maior pontuação.
      const isBetter =
        !best ||
        score > best.score ||
        (score === best.score && strongHits > best.strongHits);

      if (isBetter) best = { niche: rule.niche, score, strongHits };
    }

    // Abaixo de 3 pontos é palpite fraco demais — melhor deixar o usuário
    // escolher do que gravar um nicho errado.
    const niche = best && best.score >= 3 ? best.niche : detected?.niche || 'Outros';

    return { niche, topic: detected?.topic || '' };
  }

  // ============================================================================
  // ESTÁGIO DA OFERTA (SOMENTE PELO TEMPO DE VEICULAÇÃO)
  // ============================================================================
  // A contagem de anúncios da Biblioteca não é confiável (a Meta mostra
  // "N anúncios usam este criativo", que não é o total de anúncios ativos da
  // oferta), então ela ficou de fora da conta de propósito.
  //
  // Para ajustar as faixas, mude só estes números:
  const STAGE_DAYS = {
    pre_scaling: 7,   // 1 a 6 dias  -> Teste
    scaling: 20,      // 7 a 19 dias -> Pré-escala
    winner: 70        // 20 a 69     -> Escalando | 70+ -> Vencedor
  };

  function classifyStage(daysRunning) {
    const days = Number(daysRunning) || 0;
    if (days >= STAGE_DAYS.winner) return 'winner';
    if (days >= STAGE_DAYS.scaling) return 'scaling';
    if (days >= STAGE_DAYS.pre_scaling) return 'pre_scaling';
    return 'testing';
  }

  // Cor da pílula de tempo, independente do estágio: quanto mais tempo no ar,
  // mais "quente" o sinal. Azul = novo, amarelo = firmando, verde = maduro.
  const DAYS_COLOR = {
    yellow: 20,  // abaixo disso -> azul
    green: 50    // 20 a 49 -> amarelo | 50+ -> verde
  };

  function daysColorClass(daysRunning) {
    const days = Number(daysRunning) || 0;
    if (days >= DAYS_COLOR.green) return 'days-green';
    if (days >= DAYS_COLOR.yellow) return 'days-yellow';
    return 'days-blue';
  }

  const STATUS_LABELS = {
    winner: 'Vencedor',
    scaling: 'Escalando',
    pre_scaling: 'Pré-escala',
    testing: 'Em teste'
  };

  function isLikelyPageName(text) {
    const value = (text || '').trim();
    if (value.length < 2 || value.length > 70) return false;
    if (value.includes('\n')) return false;
    return !NON_NAME_PATTERNS.some((re) => re.test(value));
  }

  /**
   * A) ID DESTE anúncio na Biblioteca (cada bloco tem o seu).
   * É o que gera o link para abrir exatamente o anúncio que foi importado.
   */
  function extractLibraryId(card, cardText) {
    // 1. Melhor fonte: o próprio permalink do anúncio, quando o card tem um.
    //    O regex exige `?id=` ou `&id=` para não confundir com view_all_page_id.
    for (const anchor of cardQueryAll(card, 'a[href*="/ads/library/"]')) {
      const match = (anchor.href || '').match(/[?&]id=(\d{6,})/);
      if (match) return match[1];
    }

    // 2. Caso normal: "Identificação da biblioteca: NNNNNNNN" no texto do card.
    const regex = /(?:Identifica(?:ç|c)(?:ã|a)o da biblioteca|Library ID|ID da biblioteca|Identifica(?:ç|c)(?:ã|a)o do an(?:ú|u)ncio)[:\s]*([0-9]{6,})/gi;
    const ids = [];
    let match;
    while ((match = regex.exec(cardText)) !== null) {
      if (!ids.includes(match[1])) ids.push(match[1]);
    }

    // Mais de um ID no mesmo card significa que o limite do card foi detectado
    // errado e estamos olhando para um grupo de anúncios, não para um.
    if (ids.length > 1) {
      console.warn(
        `[Mineraí Extensão] ${ids.length} IDs de biblioteca no mesmo card — usando o primeiro (${ids[0]}).`
      );
    }

    return ids[0] || '';
  }

  /**
   * Busca dentro do card IGNORANDO a barra que a extensão injeta.
   *
   * A barra é adicionada no topo do card, então os elementos dela vêm antes dos
   * do anúncio em ordem de DOM. Sem este filtro a extensão lia os próprios
   * links e textos: o nome da oferta virava o conteúdo da barra e piorava a
   * cada redesenho.
   */
  function cardQueryAll(card, selector) {
    return Array.from(card.querySelectorAll(selector)).filter(
      (el) => !el.closest('.minerai-card-injected-bar')
    );
  }

  /**
   * Texto do card sem a barra que a própria extensão injeta — senão os rótulos
   * dela ("Escalando", "Minerar oferta") entrariam na análise de nicho.
   */
  function getCardText(card) {
    const full = card.innerText || '';
    const bar = card.querySelector('.minerai-card-injected-bar');
    const barText = bar?.innerText || '';
    return barText ? full.split(barText).join('\n') : full;
  }

  /**
   * B) Data de início da veiculação.
   * Devolve a data em ISO (YYYY-MM-DD) para que o app recalcule os dias
   * sozinho todo dia, em vez de guardar um número congelado.
   */
  // `agora` só é passado nos testes, para conferir o comportamento de manhã e
  // de tarde sem depender da hora em que o teste roda.
  function extractStartDate(fullText, agora) {
    const now = agora ? new Date(agora) : new Date();

    // PT-BR: "Veiculação iniciada em 12 de jun. de 2025" (o ponto da abreviação
    // fazia o ano ser ignorado, o que estourava a contagem de dias).
    const pt = fullText.match(
      /(?:veicula(?:ç|c)(?:ã|a)o iniciada em|come(?:ç|c)ou a ser veiculado em|in(?:í|i)cio da veicula(?:ç|c)(?:ã|a)o em|veiculado em)\s*([0-9]{1,2})\s*de\s*([a-zA-ZçÇáéíóúâêôãõ]+)\.?(?:\s*de\s*([0-9]{4}))?/i
    );

    // EN: "Started running on Jun 12, 2025"
    const en = fullText.match(
      /(?:Started running on|Running since|Launched on)\s*([a-zA-Z]+)\.?\s*([0-9]{1,2}),?\s*([0-9]{4})?/i
    );

    let day;
    let month;
    let year;

    if (pt) {
      day = parseInt(pt[1], 10);
      const key = pt[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, 3);
      month = PT_MONTHS[key];
      year = pt[3] ? parseInt(pt[3], 10) : null;
    } else if (en) {
      const key = en[1].toLowerCase().slice(0, 3);
      const EN_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
      month = EN_MONTHS[key];
      day = parseInt(en[2], 10);
      year = en[3] ? parseInt(en[3], 10) : null;
    } else {
      return null;
    }

    if (month === undefined || month === null || isNaN(day)) return null;

    // As comparações são feitas em DIAS de calendário, com as duas pontas ao
    // meio-dia. Comparar com a hora exata fazia um anúncio começado hoje de
    // manhã parecer "data no futuro": ele era descartado e o card mostrava
    // "data n/d" até passar do meio-dia.
    const hoje = new Date(now);
    hoje.setHours(12, 0, 0, 0);

    // Sem ano explícito a Meta está falando do período recente: assumimos o ano
    // atual e voltamos um ano só se a data cair num dia realmente futuro.
    if (!year) {
      year = hoje.getFullYear();
      if (new Date(year, month, day, 12) > hoje) year -= 1;
    }

    const start = new Date(year, month, day, 12);
    if (isNaN(start.getTime()) || start > hoje) return null;

    return `${year}-${MONTH_ISO(month)}-${String(day).padStart(2, '0')}`;
  }

  function daysSince(isoDate) {
    if (!isoDate) return 0;
    const parts = isoDate.split('-');
    const start = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12);
    if (isNaN(start.getTime())) return 0;

    // Ambas as pontas ao meio-dia: conta em dias de calendário, sem depender da
    // hora em que a página foi aberta.
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    const diff = Math.round((today.getTime() - start.getTime()) / 86400000);
    return Math.max(1, diff + 1);
  }

  /** C) Quantidade de anúncios ativos usando o mesmo criativo. */
  function extractAdsCount(fullText) {
    // O número pode vir com separador de milhar ("1.284 anúncios usam...").
    // Importante: nada de `\s` aqui — antes o padrão atravessava a quebra de
    // linha e colava a data do anúncio na contagem.
    const match = fullText.match(
      /([0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]+)[ \t]*(?:an(?:ú|u)ncios?[ \t]+(?:usam|utilizam)|ads?[ \t]+use)/i
    );
    if (match) {
      const parsed = parseInt(match[1].replace(/[^\d]/g, ''), 10);
      if (parsed > 0) return parsed;
    }
    return 1;
  }

  /**
   * D) Anunciante: nome, ID da página, URL da página e avatar.
   * A busca antiga pegava o primeiro `span[dir="auto"]` do card, que na
   * Biblioteca é sempre um rótulo ("Ativo", "Identificação da biblioteca...").
   */
  /**
   * Foto do anunciante dentro do card.
   * Confirmado na Biblioteca real: é um <img> do scontent.*.fbcdn.net, com
   * cerca de 60px de lado, e NÃO fica dentro do link do anunciante.
   * Ícones da interface vêm de /rsrc.php/ e são descartados.
   */
  function findAdvertiserPhoto(card) {
    const candidatos = cardQueryAll(card, 'img').filter((img) => {
      const src = img.src || '';
      if (!src || src.startsWith('data:')) return false;
      if (src.includes('/rsrc.php/') || src.includes('/emoji')) return false;

      const w = img.naturalWidth || img.offsetWidth || 0;
      const h = img.naturalHeight || img.offsetHeight || 0;
      if (!w || !h) return false;

      // Avatar é pequeno e quadrado; o criativo do anúncio é grande.
      const maiorLado = Math.max(w, h);
      const proporcao = Math.abs(w - h) / maiorLado;
      return maiorLado <= 130 && proporcao <= 0.15;
    });

    // O avatar aparece antes do criativo no card, então o primeiro serve.
    return candidatos[0] || null;
  }

  function extractAdvertiser(card) {
    let pageId = '';
    let pageSlug = '';
    let pageUrl = '';
    let pageName = '';
    let avatarDomUrl = '';

    const anchors = cardQueryAll(card, 'a[href]');

    // 1. O link "ver todos os anúncios desta página" carrega o ID real.
    for (const anchor of anchors) {
      const href = anchor.href || '';
      const match = href.match(/view_all_page_id=(\d+)/i) || href.match(/[?&]page_id=(\d+)/i);
      if (match) {
        pageId = match[1];
        break;
      }
    }

    // 2. Link do perfil/página do anunciante: dá o nome e, muitas vezes, o ID.
    for (const anchor of anchors) {
      const href = anchor.href || '';
      if (!/facebook\.com|instagram\.com/i.test(href)) continue;
      if (/\/ads\/library/i.test(href)) continue;
      if (/l\.facebook\.com/i.test(href)) continue;

      const profileId = href.match(/profile\.php\?id=(\d+)/i);
      if (profileId && !pageId) pageId = profileId[1];

      const numericSlug = href.match(/facebook\.com\/(\d{6,})(?:[/?#]|$)/i);
      if (numericSlug && !pageId) pageId = numericSlug[1];

      // Páginas com apelido (facebook.com/lojaxyz) não expõem ID numérico no
      // link, mas o Graph aceita o apelido: /lojaxyz/picture devolve a foto
      // do mesmo jeito. Sem isso, essas páginas ficavam sem avatar nenhum.
      const vanity = href.match(/facebook\.com\/([A-Za-z][A-Za-z0-9._-]{2,})(?:[/?#]|$)/i);
      if (vanity && !pageSlug && !RESERVED_FB_PATHS.test(vanity[1])) {
        pageSlug = vanity[1];
      }

      const text = (anchor.innerText || '').trim();
      if (!pageName && isLikelyPageName(text)) {
        pageName = text;
        pageUrl = href.split('?')[0];
      }

      // O avatar costuma ficar dentro do próprio link do anunciante.
      const innerImg = anchor.querySelector('img');
      if (!avatarDomUrl && innerImg && innerImg.src && !innerImg.src.startsWith('data:')) {
        avatarDomUrl = innerImg.src;
      }
    }

    // 3. A foto do anunciante é procurada SEMPRE, não só quando falta o nome.
    //    Na Biblioteca real ela fica fora do link do anunciante, então o
    //    caminho do passo 2 não a encontra — e antes esta busca estava presa
    //    dentro do "if (!pageName)", que quase nunca era verdadeiro.
    const avatarImg = findAdvertiserPhoto(card);
    if (avatarImg && !avatarDomUrl) avatarDomUrl = avatarImg.src;

    // 4. Sem nome ainda: usamos o texto ao redor da foto.
    if (!pageName && avatarImg) {
      let node = avatarImg.parentElement;
      for (let depth = 0; node && depth < 5 && !pageName; depth += 1) {
        const candidate = cardQueryAll(node, 'span, div, strong, h3, h4')
          .map((el) => (el.childElementCount === 0 ? (el.textContent || '').trim() : ''))
          .find(isLikelyPageName);
        if (candidate) pageName = candidate;
        node = node.parentElement;
      }
    }

    // 4. Último recurso: varre os textos curtos do card procurando um nome.
    if (!pageName) {
      const candidate = cardQueryAll(card, 'span, strong, h3, h4')
        .filter((el) => el.childElementCount === 0)
        .map((el) => (el.textContent || '').trim())
        .find(isLikelyPageName);
      if (candidate) pageName = candidate;
    }

    // 5. Rede de segurança: varre o HTML bruto do card. O ID da página aparece
    //    em vários lugares que não são href (atributos de dados, JSON embutido,
    //    handlers), e páginas com apelido não expõem número em link nenhum.
    if (!pageId) {
      const html = card.outerHTML || '';

      // Dentro de atributos, o HTML serializado troca as aspas por &quot;, então
      // os padrões precisam aceitar as duas formas — foi o que fez o ID escapar
      // quando ele vinha num atributo de dados em vez de um href.
      const QUOTE = '(?:&quot;|&#34;|["\'])?';
      const patterns = [
        new RegExp(`view_all_page_id${QUOTE}\\s*[:=]\\s*${QUOTE}(\\d{6,})`, 'i'),
        new RegExp(`page_?id${QUOTE}\\s*[:=]\\s*${QUOTE}(\\d{6,})`, 'i'),
        /profile\.php\?id=(\d{6,})/i,
        /facebook\.com\\?\/(\d{9,})(?:[/?"'&]|$)/i
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) {
          pageId = match[1];
          break;
        }
      }
    }

    // A URL do Graph é permanente (ela redireciona para a foto atual a cada
    // acesso), enquanto o link direto do CDN que aparece no card é assinado e
    // expira em algumas horas. Por isso o Graph vem primeiro, pelo ID ou pelo
    // apelido da página; a imagem do card fica como retrato de reserva.
    const graphKey = pageId || pageSlug;
    const avatarUrl = graphKey
      ? `https://graph.facebook.com/${graphKey}/picture?type=large`
      : '';

    if (!pageUrl && graphKey) pageUrl = `https://www.facebook.com/${graphKey}`;

    return { pageName, pageId, pageSlug, pageUrl, avatarUrl, avatarDomUrl };
  }

  /**
   * E) Página de vendas: o destino real do anúncio.
   * A versão antiga pegava o primeiro link http do card, que quase sempre era
   * o perfil do anunciante no próprio Facebook.
   */
  function extractLandingPage(card) {
    const anchors = cardQueryAll(card, 'a[href]');

    for (const anchor of anchors) {
      const href = anchor.href || '';
      if (!/^https?:/i.test(href)) continue;

      let target = href;

      // Links de saída da Meta: o destino real vem no parâmetro `u`.
      try {
        const parsed = new URL(href);
        if (/l\.facebook\.com|lm\.facebook\.com|l\.instagram\.com/i.test(parsed.hostname)) {
          const encoded = parsed.searchParams.get('u');
          if (!encoded) continue;
          target = decodeURIComponent(encoded);
        }
      } catch (e) {
        continue;
      }

      try {
        const parsedTarget = new URL(target);
        if (META_HOSTS.test(parsedTarget.hostname)) continue;

        // Remove o rastreamento que a Meta anexa ao clique.
        parsedTarget.searchParams.delete('fbclid');
        parsedTarget.searchParams.delete('__cft__[0]');
        parsedTarget.searchParams.delete('__tn__');

        return parsedTarget.toString();
      } catch (e) {
        // URL malformada: ignora.
      }
    }

    return '';
  }

  /**
   * Imagem que representa a oferta no painel.
   * Em anúncio de vídeo, a Meta já entrega um quadro de capa no atributo
   * `poster` (ou numa imagem sobreposta antes do play) — é dele que sai a
   * "foto do início do vídeo", sem precisar baixar o vídeo.
   */
  function extractCreativeImage(card) {
    const video = cardQueryAll(card, 'video')[0];
    if (video) {
      if (video.poster && !video.poster.startsWith('data:')) return video.poster;

      // Sem poster no atributo: a capa costuma ser uma imagem grande empilhada
      // atrás do player, dentro do mesmo container.
      const wrapper = video.closest('div');
      const cover = wrapper && cardQueryAll(wrapper, 'img').find((img) => {
        const w = img.naturalWidth || img.offsetWidth || 0;
        return w >= 180 && img.src && !img.src.startsWith('data:');
      });
      if (cover) return cover.src;
    }

    // Anúncio de imagem: a maior imagem do card é o criativo.
    const images = cardQueryAll(card, 'img').filter((img) => {
      const src = img.src || '';
      if (!src || src.startsWith('data:') || src.includes('emoji')) return false;
      if (src.includes('/rsrc.php/') || src.includes('graph.facebook.com')) return false;
      // Descarta o avatar do anunciante (imagem pequena e quadrada).
      const w = img.naturalWidth || img.offsetWidth || 0;
      return w >= 180;
    });

    if (!images.length) return '';

    images.sort((a, b) => {
      const areaA = (a.naturalWidth || a.offsetWidth || 1) * (a.naturalHeight || a.offsetHeight || 1);
      const areaB = (b.naturalWidth || b.offsetWidth || 1) * (b.naturalHeight || b.offsetHeight || 1);
      return areaB - areaA;
    });

    return images[0].src || '';
  }

  function parseCardDetails(card) {
    const fullText = getCardText(card);

    const libraryId = extractLibraryId(card, fullText);
    const startDate = extractStartDate(fullText);
    const daysRunning = startDate ? daysSince(startDate) : 0;
    const adsCount = extractAdsCount(fullText);
    const advertiser = extractAdvertiser(card);
    const landingPage = extractLandingPage(card);

    // Link do ANÚNCIO deste bloco — é o que se quer abrir depois para rever a
    // oferta importada. A lista completa de anúncios do anunciante é outra
    // coisa e vai separada em `pageAdsUrl`.
    const adUrl = libraryId ? `https://www.facebook.com/ads/library/?id=${libraryId}` : '';
    const pageAdsUrl = advertiser.pageId
      ? `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=${advertiser.pageId}&media_type=all`
      : '';

    // Nome da oferta = nome da página do anunciante.
    // Já tentamos derivar do anúncio (headline / domínio da página de vendas),
    // mas no DOM real da Biblioteca a headline não é distinguível do resto:
    // vinha "0:00" (cronômetro do vídeo) ou frases soltas do texto do anúncio.
    const name = advertiser.pageName || 'Oferta Minerada';
    const { niche, topic } = classifyOffer(fullText);

    return {
      name,
      creativeUrl: extractCreativeImage(card),
      pageId: advertiser.pageId || '',
      pageSlug: advertiser.pageSlug || '',
      pageUrl: advertiser.pageUrl || '',
      libraryId: libraryId || '',
      adUrl,
      pageAdsUrl,
      libraryUrl: adUrl || pageAdsUrl || window.location.href,
      landingPage,
      avatarUrl: advertiser.avatarUrl || '',
      avatarDomUrl: advertiser.avatarDomUrl || '',
      startDate,
      daysRunning,
      adsCount,
      niche,
      topic,
      status: classifyStage(daysRunning),
      // Sinaliza o que não foi possível extrair, para avisar o usuário.
      missing: [
        advertiser.pageName ? null : 'nome',
        landingPage ? null : 'página de vendas',
        startDate ? null : 'data de início',
        libraryId ? null : 'ID do anúncio'
      ].filter(Boolean)
    };
  }

  // ============================================================================
  // 5. BARRA MINERAÍ INJETADA NO CARD
  // ============================================================================

  // Guarda os dados extraídos por card para o clique não reprocessar o DOM.
  const cardDataCache = new WeakMap();

  function scanAndEnhanceCards() {
    const cards = findAdCards();

    cards.forEach((card) => {
      const data = parseCardDetails(card);
      cardDataCache.set(card, data);

      card.dataset.mineraiDaysRunning = data.daysRunning;
      card.dataset.mineraiAdsCount = data.adsCount;
      card.dataset.mineraiLibraryId = data.libraryId;
      card.dataset.mineraiPageId = data.pageId;
      card.dataset.mineraiStatus = data.status;

      if (data.status === 'winner' || data.status === 'scaling') {
        card.classList.add('minerai-card-winner');
      } else {
        card.classList.remove('minerai-card-winner');
      }

      let bar = card.querySelector('.minerai-card-injected-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'minerai-card-injected-bar';
        card.prepend(bar);
      }

      // Só redesenha quando algo realmente mudou: evita piscar a barra a cada
      // mutação do React da Meta (e o botão perder o estado de "Minerado").
      const signature = [
        data.daysRunning,
        data.adsCount,
        data.status,
        data.libraryId,
        data.landingPage,
        data.name,
        data.niche,
        data.topic,
        data.creativeUrl
      ].join('|');

      if (bar.dataset.mineraiSignature === signature) return;
      bar.dataset.mineraiSignature = signature;

      const daysLabel = data.daysRunning
        ? `${data.daysRunning} ${data.daysRunning === 1 ? 'dia' : 'dias'}`
        : 'data n/d';
      const adsLabel = `${data.adsCount} ${data.adsCount === 1 ? 'anúncio' : 'anúncios'}`;
      const statusLabel = STATUS_LABELS[data.status] || 'Teste';

      let landingHost = '';
      if (data.landingPage) {
        try {
          landingHost = new URL(data.landingPage).hostname.replace(/^www\./, '');
        } catch (e) {
          landingHost = data.landingPage.slice(0, 30);
        }
      }

      bar.innerHTML = `
        <div class="minerai-bar-line minerai-bar-stats">
          <span class="minerai-pill running-days ${daysColorClass(data.daysRunning)}" title="Tempo de veiculação${data.startDate ? ` (início em ${escapeHtml(data.startDate)})` : ''} — azul até ${DAYS_COLOR.yellow - 1} dias, amarelo de ${DAYS_COLOR.yellow} a ${DAYS_COLOR.green - 1}, verde a partir de ${DAYS_COLOR.green}">
            <span class="minerai-pill-icon">⏳</span>${escapeHtml(daysLabel)}
          </span>
          <span class="minerai-pill creatives" title="Quantos anúncios a Meta diz que usam este criativo (não entra no cálculo do estágio)">
            <span class="minerai-pill-icon">📊</span>${escapeHtml(adsLabel)}
          </span>
          <span class="minerai-pill stage stage-${escapeHtml(data.status)}" title="Estágio pelo tempo de veiculação: até ${STAGE_DAYS.pre_scaling - 1} dias em teste, ${STAGE_DAYS.pre_scaling} a ${STAGE_DAYS.scaling - 1} pré-escala, ${STAGE_DAYS.scaling} a ${STAGE_DAYS.winner - 1} escalando, ${STAGE_DAYS.winner}+ vencedor">
            <span class="minerai-pill-icon">🏷️</span>${escapeHtml(statusLabel)}
          </span>
        </div>

        <div class="minerai-bar-line minerai-bar-target">
          <span class="minerai-advertiser" title="${escapeHtml(data.name)}">👤 ${escapeHtml(data.name)}</span>
          <span class="minerai-niche" title="Categoria: ${escapeHtml(data.niche)}${data.topic ? ` | Tema identificado no anúncio: ${escapeHtml(data.topic)}` : ""}">🗂️ ${escapeHtml(data.topic || data.niche)}</span>
        </div>

        <div class="minerai-bar-line minerai-bar-links">
          ${
            landingHost
              ? `<a class="minerai-landing-link" href="${escapeHtml(data.landingPage)}" target="_blank" rel="noreferrer" title="Abrir página de vendas: ${escapeHtml(data.landingPage)}">🔗 ${escapeHtml(landingHost)}</a>`
              : `<span class="minerai-landing-missing" title="Nenhum link de destino encontrado neste card">🔗 sem link de destino</span>`
          }
          ${
            data.adUrl
              ? `<a class="minerai-ad-link" href="${escapeHtml(data.adUrl)}" target="_blank" rel="noreferrer" title="Abrir este anúncio na Biblioteca (ID ${escapeHtml(data.libraryId)})">🧾 ver anúncio</a>`
              : `<span class="minerai-landing-missing" title="Não foi possível ler a identificação da biblioteca neste card">🧾 sem ID do anúncio</span>`
          }
        </div>

        <div class="minerai-bar-line minerai-card-actions">
          <button class="minerai-download-btn" type="button" title="Baixar o criativo (vídeo ou imagem)">
            <span class="minerai-btn-icon">⬇️</span><span class="minerai-btn-text">Baixar mídia</span>
          </button>
          <button class="minerai-capture-btn" type="button" data-lib-id="${escapeHtml(data.libraryId)}" title="Enviar esta oferta para o painel Mineraí">
            <span class="minerai-btn-icon">⛏️</span><span class="minerai-btn-text">Minerar oferta</span>
          </button>
        </div>
      `;

      const captureBtn = bar.querySelector('.minerai-capture-btn');
      if (captureBtn) {
        captureBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          // Relê o card no momento do clique: a foto do anunciante pode não
          // ter terminado de carregar na varredura que desenhou esta barra.
          handleCaptureOffer(parseCardDetails(card) || cardDataCache.get(card) || data, captureBtn);
        };
      }

      const downloadBtn = bar.querySelector('.minerai-download-btn');
      if (downloadBtn) {
        downloadBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleDownloadMedia(card, downloadBtn);
        };
      }

      // O link da página de vendas fica dentro do card da Meta, que intercepta
      // cliques: paramos a propagação para o card não abrir por baixo.
      // Os links ficam dentro do card da Meta, que intercepta cliques:
      // paramos a propagação para o card não abrir por baixo.
      bar.querySelectorAll('.minerai-landing-link, .minerai-ad-link').forEach((link) => {
        link.onclick = (e) => e.stopPropagation();
      });
    });
  }

  // Localiza mídia (vídeo ou imagem em alta resolução) no card de anúncio
  function findAdMedia(card) {
    // 1. Procura vídeo primeiro
    const video = cardQueryAll(card, 'video')[0];
    if (video) {
      const videoSrc = video.src || video.currentSrc || video.querySelector('source')?.src;
      if (videoSrc && !videoSrc.startsWith('data:') && !videoSrc.startsWith('blob:')) {
        return {
          type: 'video',
          url: videoSrc,
          filename: `minerai_video_${Date.now()}.mp4`
        };
      }
    }

    // 2. Procura imagem em alta resolução do criativo
    const images = cardQueryAll(card, 'img').filter((img) => {
      const src = img.src || '';
      if (!src || src.startsWith('data:') || src.includes('emoji')) return false;
      if (src.includes('/rsrc.php/') || src.includes('graph.facebook.com')) return false;
      return true;
    });

    if (images.length > 0) {
      images.sort((a, b) => {
        const areaA = (a.naturalWidth || a.offsetWidth || 1) * (a.naturalHeight || a.offsetHeight || 1);
        const areaB = (b.naturalWidth || b.offsetWidth || 1) * (b.naturalHeight || b.offsetHeight || 1);
        return areaB - areaA;
      });

      const best = images[0];
      if (best && best.src) {
        return {
          type: 'image',
          url: best.src,
          filename: `minerai_imagem_${Date.now()}.jpg`
        };
      }
    }

    return null;
  }

  async function triggerDirectDownload(url, filename) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
      return true;
    } catch (e) {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return true;
    }
  }

  function handleDownloadMedia(card, btn) {
    const media = findAdMedia(card);
    if (!media || !media.url) {
      showToast('Nenhuma mídia disponível para download neste anúncio.');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = `<span class="minerai-btn-icon">⏳</span><span class="minerai-btn-text">Baixando...</span>`;

    safeSendMessage(
      { type: 'DOWNLOAD_MEDIA', url: media.url, filename: media.filename },
      (response) => {
        btn.disabled = false;
        if (response && response.success) {
          btn.innerHTML = `<span class="minerai-btn-icon">✓</span><span class="minerai-btn-text">Baixado!</span>`;
          showToast(`Download de ${media.type === 'video' ? 'vídeo' : 'imagem'} iniciado!`);
          setTimeout(() => {
            btn.innerHTML = `<span class="minerai-btn-icon">⬇️</span><span class="minerai-btn-text">Baixar mídia</span>`;
          }, 2500);
        } else {
          triggerDirectDownload(media.url, media.filename).then(() => {
            btn.innerHTML = `<span class="minerai-btn-icon">✓</span><span class="minerai-btn-text">Baixado!</span>`;
            showToast(`Download de ${media.type === 'video' ? 'vídeo' : 'imagem'} iniciado!`);
            setTimeout(() => {
              btn.innerHTML = `<span class="minerai-btn-icon">⬇️</span><span class="minerai-btn-text">Baixar mídia</span>`;
            }, 2500);
          }).catch(() => {
            btn.innerHTML = `<span class="minerai-btn-icon">⬇️</span><span class="minerai-btn-text">Baixar mídia</span>`;
            showToast('Erro ao baixar arquivo de mídia.');
          });
        }
      }
    );
  }

  const CAPTURE_IDLE_HTML =
    '<span class="minerai-btn-icon">⛏️</span><span class="minerai-btn-text">Minerar oferta</span>';

  function handleCaptureOffer(data, btn) {
    if (!currentUser) {
      showToast('Faça login no Mineraí para salvar suas ofertas mineradas!');
      return;
    }

    if (btn.disabled) return;

    btn.disabled = true;
    btn.className = 'minerai-capture-btn';
    btn.innerHTML = '<span class="minerai-btn-icon">⏳</span><span class="minerai-btn-text">Salvando...</span>';

    safeSendMessage(
      { type: 'SAVE_OFFER', offer: data },
      (response) => {
        btn.disabled = false;

        if (response && response.success) {
          const updated = response.data?.updated;
          btn.className = 'minerai-capture-btn mined-success';
          btn.innerHTML = `<span class="minerai-btn-icon">✓</span><span class="minerai-btn-text">${updated ? 'Atualizado!' : 'Minerado!'}</span>`;

          // Avisa em qual campo a Meta não expôs o dado, para o usuário poder
          // completar à mão no painel em vez de descobrir depois.
          const warn = data.missing?.length ? ` (verifique: ${data.missing.join(', ')})` : '';
          showToast(
            updated
              ? `"${data.name}" atualizada: ${data.adsCount} anúncios registrados hoje.${warn}`
              : `"${data.name}" foi salva no Mineraí!${warn}`
          );

          setTimeout(() => {
            btn.className = 'minerai-capture-btn';
            btn.innerHTML = CAPTURE_IDLE_HTML;
          }, 2500);
        } else {
          btn.className = 'minerai-capture-btn mined-error';
          btn.innerHTML = '<span class="minerai-btn-icon">✕</span><span class="minerai-btn-text">Erro ao salvar</span>';
          showToast(response?.error || 'Erro ao conectar ao banco de dados.');
          setTimeout(() => {
            btn.className = 'minerai-capture-btn';
            btn.innerHTML = CAPTURE_IDLE_HTML;
          }, 3000);
        }
      }
    );
  }

  // ============================================================================
  // 6. FILTROS & CONTAGEM DE RESULTADOS COM CSS CLASS SEGURA
  // ============================================================================

  function applyAdFilters() {
    const cards = findAdCards();
    let visibleCount = 0;

    const minAds = activeFilters.minAds || 0;
    const minDays = activeFilters.minDays || 0;

    cards.forEach(card => {
      const adsCount = parseInt(card.dataset.mineraiAdsCount, 10) || 1;
      const daysRunning = parseInt(card.dataset.mineraiDaysRunning, 10) || 0;

      let matches = true;

      if (minAds > 0 && adsCount < minAds) {
        matches = false;
      }

      if (minDays > 0 && daysRunning < minDays) {
        matches = false;
      }

      if (matches) {
        card.classList.remove('minerai-card-filtered-out');
        card.style.removeProperty('display');
        visibleCount++;
      } else {
        card.classList.add('minerai-card-filtered-out');
      }
    });

    const counterDisplay = document.getElementById('minerai-counter-display');
    if (counterDisplay) {
      counterDisplay.textContent = `${visibleCount} de ${cards.length}`;
    }

    return visibleCount;
  }

  function updateVisibleCount() {
    const cards = findAdCards();
    const visibleCards = cards.filter(c => !c.classList.contains('minerai-card-filtered-out'));
    const counterDisplay = document.getElementById('minerai-counter-display');
    if (counterDisplay) {
      counterDisplay.textContent = `${visibleCards.length} de ${cards.length}`;
    }
  }

  // Toast de notificação na tela
  function showToast(msg) {
    const existing = document.querySelector('.minerai-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'minerai-toast';
    toast.innerHTML = `<span>${escapeHtml(msg)}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(100%)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Ponto de entrada (ver comentário em initExtension).
  initExtension();

})();
