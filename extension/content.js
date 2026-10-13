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

  // Ícones de linha, os mesmos do painel Mineraí. Substituem os emojis da
  // barra: emoji muda de cara em cada sistema e destoa da identidade.
  const ICON_PATHS = {
    relogio: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
    camadas: 'M12 4l8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4',
    etiqueta: 'M20 12l-8 8-9-9V4h7l10 8zM7.5 7.5h.01',
    baixar: 'M12 4v11M7 10l5 5 5-5M5 20h14',
    picareta: 'M3 21l8.5-8.5M14 4l6 6M14 4c-2.5-1-6 0-8 2 3-.5 5.5.5 7 2l2 2c1.5 1.5 2.5 4 2 7 2-2 3-5.5 2-8l-1-1',
    externo: 'M14 4h6v6M20 4l-9 9M19 13v6H5V5h6',
    link: 'M10 14a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 0 0-5.66-5.66L11.5 6.8M14 10a4 4 0 0 0-5.66 0l-2.83 2.83a4 4 0 0 0 5.66 5.66l1.33-1.3',
    check: 'M5 12l4 4L19 6',
    x: 'M6 6l12 12M18 6L6 18',
    cima: 'M6 15l6-6 6 6',
    baixo: 'M6 9l6 6 6-6',
    menos: 'M6 12h12',
    mais: 'M12 6v12M6 12h12',
    filtro: 'M4 5h16l-6 7v6l-4 2v-8z'
  };

  function icon(name, size = 13) {
    const d = ICON_PATHS[name] || ICON_PATHS.etiqueta;
    return `<svg class="minerai-ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
  }

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
            <span class="minerai-header-title">Minera<span class="minerai-header-i">í</span></span>
            <span class="minerai-header-sub">Filtros · arraste para mover</span>
          </div>
        </div>
        <button class="minerai-min-btn" id="minerai-toggle-min" title="Minimizar">${icon('menos', 14)}</button>
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
            <div class="minerai-term-nav-btns">
              <button type="button" id="minerai-term-clear" title="Limpar destaque">${icon('x', 12)}</button>
            </div>
          </div>
          <span class="minerai-field-helper">Digite a palavra e clique em Garimpar. Depois role a página: ela aparece destacada em ouro.</span>
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
          ${icon('filtro', 15)}<span>Garimpar com filtros</span>
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
      authBox.innerHTML = `<span><span class="minerai-dot on"></span>Conectado: <strong>${escapeHtml(name)}</strong></span>`;
    } else {
      authBox.className = 'minerai-auth-badge offline';
      authBox.innerHTML = `
        <span><span class="minerai-dot ${aguardandoLogin ? 'wait' : 'off'}"></span>${aguardandoLogin ? 'Aguardando login...' : 'Não conectado'}</span>
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
    const termClearBtn = panel.querySelector('#minerai-term-clear');

    minBtn.addEventListener('click', () => {
      const minimized = panel.classList.toggle('minimized');
      minBtn.innerHTML = icon(minimized ? 'mais' : 'menos', 14);
      minBtn.title = minimized ? 'Expandir' : 'Minimizar';
    });

    // Pressionar Enter no campo de termo dispara o Garimpar / Navegação
    termInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyBtn.click();
      }
    });

    termClearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      termInput.value = '';
      clearHighlights();
      const counterBox = document.getElementById('minerai-term-counter');
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
        const matchesCount = highlightKeyword(term);
        if (matchesCount > 0) {
          showToast(`${matchesCount} ocorrência(s) de "${term}" destacadas em ouro!`);
        } else {
          showToast(`Nenhuma ocorrência de "${term}" encontrada nos anúncios visíveis.`);
        }
      } else {
        clearHighlights();
        const counterBox = document.getElementById('minerai-term-counter');
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
      highlightKeyword(currentSearchTerm);
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
          target.classList?.contains('minerai-injected') ||
          target.closest?.('.minerai-injected') ||
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
  let highlightedMatches = [];

  // Teto para o termo digitado: acima disso ninguém está procurando palavra.
  const TERM_MAX_LENGTH = 200;

  /**
   * Divide o texto em pedaços alternando "fora do termo" e "termo", com busca
   * literal e insensível a maiúsculas. Sem expressão regular montada a partir
   * do que a pessoa digitou: não há padrão custoso possível (ReDoS), e a
   * comparação não depende de estado interno como o `lastIndex` do RegExp.
   */
  function splitByTerm(text, term) {
    const parts = [];
    if (!text || !term) {
      if (text) parts.push({ text, match: false });
      return parts;
    }

    let haystack = text.toLowerCase();
    let needle = term.toLowerCase();
    // Raros caracteres mudam de tamanho ao virar minúscula; nesse caso a
    // busca segue no texto original para os índices continuarem batendo.
    if (haystack.length !== text.length || needle.length !== term.length) {
      haystack = text;
      needle = term;
    }

    let from = 0;
    let idx = haystack.indexOf(needle, from);
    while (idx !== -1) {
      if (idx > from) parts.push({ text: text.slice(from, idx), match: false });
      parts.push({ text: text.slice(idx, idx + needle.length), match: true });
      from = idx + needle.length;
      idx = haystack.indexOf(needle, from);
    }
    if (from < text.length) parts.push({ text: text.slice(from), match: false });
    return parts;
  }

  /** Verdadeiro quando o texto contém o termo (literal, sem diferenciar caixa). */
  function containsTerm(text, term) {
    return splitByTerm(text, term).some((p) => p.match);
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
  }

  function highlightKeyword(term) {
    currentSearchTerm = (term || '').trim().slice(0, TERM_MAX_LENGTH);
    const counterBox = document.getElementById('minerai-term-counter');

    if (!currentSearchTerm || currentSearchTerm.length < 2) {
      clearHighlights();
      if (counterBox) counterBox.style.display = 'none';
      return 0;
    }

    clearHighlights();

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
              parent.closest('.minerai-injected') ||
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
        if (n.nodeValue && containsTerm(n.nodeValue, currentSearchTerm)) {
          matchingTextNodes.push(n);
        }
      }

      matchingTextNodes.forEach((node) => {
        const parent = node.parentNode;
        if (!parent) return;

        const parts = splitByTerm(node.nodeValue, currentSearchTerm);
        const fragment = document.createDocumentFragment();

        parts.forEach((part) => {
          if (part.match) {
            const mark = document.createElement('mark');
            mark.className = 'minerai-term-highlight';
            mark.textContent = part.text;
            fragment.appendChild(mark);
            createdMarks.push(mark);
          } else if (part.text) {
            fragment.appendChild(document.createTextNode(part.text));
          }
        });

        parent.replaceChild(fragment, node);
      });
    });

    highlightedMatches = createdMarks;

    if (counterBox) {
      counterBox.style.display = 'inline-block';
      counterBox.textContent = highlightedMatches.length === 1 ? '1 na página' : `${highlightedMatches.length} na página`;
    }

    return highlightedMatches.length;
  }

  // ============================================================================
  // 3. IDENTIFICAÇÃO PRECISA DOS CARDS DE ANÚNCIO (INDIVIDUAL AD CONTAINER)
  // ============================================================================

  // Textos que só existem FORA de um card (cabeçalho de resultados, filtros).
  // Quando a página tem um único anúncio, nenhum container tem "mais de um
  // ID" para interromper a subida — e a barra acabava no topo da página,
  // acima da busca. Estes marcadores param a subida no lugar certo.
  const PAGE_CHROME_TEXT = /^~?\s*\d[\d.,]*\s+(results?|resultados?)\b|^(filters?|filtros?)(\s*\(\d+\))?$|^(sort by|classificar por)$|^(link para o an(ú|u)ncio|link to ad)$/im;
  // Pop-ups da Biblioteca: "Link para o anúncio" e "Ver detalhes do anúncio".
  // Dentro deles o anúncio aparece repetido (cabeçalho e corpo separados) e a
  // barra ficava solta no topo — então pop-up não recebe barra nenhuma.
  const DIALOG_SELECTOR = '[role="dialog"], [aria-modal="true"]';
  const PAGE_CHROME_SELECTOR = 'input, textarea, select, form, [role="search"], [role="navigation"], [role="banner"], #minerai-floating-panel';
  const CARD_ID_TEXT = /Identifica(?:ç|c)(?:ã|a)o da biblioteca:|Library ID:|ID da biblioteca:|Identifica(?:ç|c)(?:ã|a)o do an(?:ú|u)ncio:|Veicula(?:ç|c)(?:ã|a)o iniciada em|Come(?:ç|c)ou a ser veiculado em|Started running on/;
  const CARD_DETAIL_TEXT = /Ver detalhes|Ver resumo|See ad details|See summary details|Plataformas|Platforms/;
  const CARD_ID_COUNT = /(?:Identificação da biblioteca|Library ID|ID da biblioteca|Identificação do anúncio):/gi;

  /**
   * Sobe a partir do texto "Identificação da biblioteca" até o card inteiro.
   * Para de subir ao encontrar (a) outro anúncio no mesmo container, (b) o
   * cabeçalho de resultados/filtros ou (c) qualquer campo de formulário —
   * coisas que um card nunca tem. Entre os invólucros com o mesmo conteúdo,
   * fica com o mais estreito: é o card, não a linha da grade.
   */
  function resolveCardFromText(textNode) {
    let current = textNode.parentElement;
    const matches = [];

    while (current && current !== document.body) {
      if (current.getAttribute('data-minerai-card') === 'true') return current;
      if (current.matches(DIALOG_SELECTOR)) break;
      if (current.querySelector(PAGE_CHROME_SELECTOR)) break;

      const text = current.innerText || '';
      if (PAGE_CHROME_TEXT.test(text)) break;

      const idMatches = text.match(CARD_ID_COUNT);
      if (idMatches && idMatches.length > 1) break;

      if (
        current.tagName === 'DIV' &&
        CARD_ID_TEXT.test(text) &&
        (CARD_DETAIL_TEXT.test(text) || current.querySelector('img, video, a[role="link"]'))
      ) {
        matches.push({ el: current, len: text.length });
      }

      current = current.parentElement;
    }

    if (!matches.length) return null;

    const fullLen = matches[matches.length - 1].len;
    const full = matches
      .filter((m) => m.len === fullLen)
      .map((m) => ({ el: m.el, width: m.el.getBoundingClientRect().width }));
    const minWidth = Math.min(...full.map((m) => m.width));
    const tight = full.filter((m) => m.width === minWidth);
    return tight[tight.length - 1].el;
  }

  function findAdCards() {
    // 1. Recupera todos os cards previamente marcados
    const knownCards = Array.from(document.querySelectorAll('[data-minerai-card="true"]'));
    const cardSet = new Set(knownCards);
    const allCards = [...knownCards];

    // 2. Busca novos cards no DOM
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);

    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue;
      if (!text || !CARD_ID_TEXT.test(text)) continue;
      const parent = node.parentElement;
      if (!parent || parent.closest('.minerai-injected') || parent.closest(DIALOG_SELECTOR)) continue;

      const candidate = resolveCardFromText(node);
      if (candidate && !cardSet.has(candidate)) {
        candidate.setAttribute('data-minerai-card', 'true');
        cardSet.add(candidate);
        allCards.push(candidate);
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
    ['Reconquista', /\breconquist\w*\b|\bex de volta\b/, 'Relacionamento & Conquista'],

    // Aplicativos: o destino é uma loja de apps ou o botão manda instalar.
    ['Aplicativo', /\bplay\.google\.com\b|\bapps\.apple\.com\b|\bgoogle play\b|\bapp store\b|\binstall now\b|\binstalar agora\b|\bbaixe o app\b|\bapp gratis\b|\bbaixar o app\b/, 'Software, Apps & SaaS'],
    // Livros impressos (produto físico, não e-book).
    ['Livros', /\bbox de livros\b|\blivros? fisicos?\b|\bcapa dura\b|\beditora\b|\blombadas?\b|\bexemplar(es)?\b|\bharpercollins\b/, 'Dropshipping & Físicos']
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
      strong: /\b(fisioterap\w*|quiropraxia|acupuntura|ortopedi\w*|cardiolog\w*|dermatolog\w*|dentist\w*|odontolog\w*|clareador\w*|celulite|varizes|psoriase|dermatite|rugas|botox|melasma|manchas? na pele|queda de cabelo|calvicie|alopecia|micose|halitose|enxaqueca|labirintite|diabet\w*|pressao alta|colesterol|artrose|artrite|hernia de disco|nervo ciatico|dor(es)? (na|nas|no|nos) (coluna|joelho|costas|lombar|articulacoes))\bb/g,
      weak: /\b(saude|beleza|pele|cabelo|estetica|creme|serum|dente|dentes|clinica|tratamento|sintomas?|remedio|dor|inflamacao|postura)\bb/g
    },
    {
      niche: 'Emagrecimento & Suplementos',
      strong: /\b(emagrec\w*|perder peso|queima(r)? de gordura|gordura localizada|obesidad\w*|suplement\w*|whey|creatina|colageno|low carb|jejum intermitente|termogenico|secar a barriga|cha emagrecedor)\bb/g,
      weak: /\b(magr[ao]|barriga|dieta|calorias|metabolismo|balanca|quilos?|kg)\bb/g
    },
    {
      niche: 'Fitness & Musculação',
      strong: /\b(musculacao|hipertrofia|gluteos?|bumbum|personal trainer|crossfit|academia|treino em casa)\bb/g,
      weak: /\b(treino|fitness|shape|exercicios?|alongamento|abdomen)\bb/g
    },
    {
      niche: 'Finanças & Investimentos',
      strong: /\b(investimentos?|investir|bolsa de valores|day trade|renda fixa|renda variavel|acoes|tesouro direto|criptomoedas?|bitcoin|cripto|dividendos|juros compostos|nome limpo|limpar o nome|serasa|emprestimo|financiamento|consorcio|imposto de renda|previdencia)\bb/g,
      weak: /\b(financas|dolar|lucro|banco|dividas?|score|cartao de credito|renda)\bb/g
    },
    {
      niche: 'Renda Extra & Afiliados',
      strong: /\b(renda extra|ganhar dinheiro|trabalh(e|ar) em casa|afiliados?|marketing digital|dinheiro online|home office|primeira venda)\bb/g,
      weak: /\b(lucrar|faturamento|comissao|freelancer)\bb/g
    },
    {
      niche: 'Relacionamento & Conquista',
      strong: /\b(reconquist\w*|ex de volta|seducao|conquistar (mulheres|homens)|salvar (o|meu) casamento|traicao|termino)\bb/g,
      weak: /\b(relacionamento|namoro|casamento|amor|paquera|ciumes)\bb/g
    },
    {
      niche: 'Espiritualidade & Astrologia',
      strong: /\b(taro|tarot|astrolog\w*|horoscopo|mapa astral|buzios|umbanda|reiki|oracao|biblia|evangelic\w*|catolic\w*|baralho cigano|numerologia|salmo\w*|terco)\bb/g,
      weak: /\b(espiritual|destino|energia|universo|\bfe\b|signo|alma)\bb/g
    },
    {
      niche: 'Educação & Idiomas',
      strong: /\b(enem|vestibular|concurso publico|apostila|flashcards?|mapas? mentais?|redacao nota 1000|ingles|espanhol|alfabetizacao|aula particular|faculdade|\btcc\b|\boab\b)\bb/g,
      weak: /\b(curso|aula|aulas|professor|estudo|estudar|aprender|idioma|resumo|escola|prova)\bb/g
    },
    {
      niche: 'Maternidade, Bebês & Kids',
      strong: /\b(bebes?|gravidez|gestante|maternidade|amamenta\w*|fraldas?|enxoval|parto|berco|papinha)\bb/g,
      weak: /\b(criancas?|infantil|filhos?|mae|maes)\bb/g
    },
    {
      niche: 'Pets & Animais de Estimação',
      strong: /\b(cachorr\w*|caes|gatos?|felin\w*|adestrament\w*|veterinari\w*|racao|pet ?shop|coleira|filhotes?)\bb/g,
      weak: /\b(pet|pets|animal|animais)\bb/g
    },
    {
      niche: 'Moda, Vestuário & Calçados',
      strong: /\b(vestidos?|blusas?|calca jeans|tenis|sapatos?|sutia|lingerie|bolsa feminina|oculos de sol|semijoias?|biquini|moda (feminina|masculina))\bb/g,
      weak: /\b(moda|roupas?|look|estilo|relogio)\bb/g
    },
    {
      niche: 'Tecnologia & Gadgets',
      strong: /\b(smartwatch|fone bluetooth|caixa de som|drone|notebook|tablet|projetor|aspirador robo|gadgets?|carregador)\bb/g,
      weak: /\b(tecnologia|eletronico|celular|camera|\busb\b)\bb/g
    },
    {
      niche: 'Casa, Decoração & Cozinha',
      strong: /\b(decoracao|panelas?|air ?fryer|organizador|colchao|utensilios?|cortinas?|tapetes?|luminaria|churrasqueira|liquidificador)\bb/g,
      weak: /\b(cozinha|casa|limpeza|sofa|jardim|quarto)\bb/g
    },
    {
      niche: 'Automotivo & Veículos',
      strong: /\b(automovel|pneus?|veiculos?|\bcnh\b|mecanic\w*|oficina|seguro auto|caminhao|oleo do motor|bateria automotiva)\bb/g,
      weak: /\b(carro|moto|dirigir|transito|motorista)\bb/g
    },
    {
      niche: 'iGaming & Apostas',
      strong: /\b(apostas?|cassino|casino|tigrinho|fortune tiger|slots?|jogo do bicho|banca de apostas|\bbet\b|\bodds\b)\bb/g,
      weak: /\b(palpite|bilhete|roleta|ganhos)\bb/g
    },
    {
      niche: 'Software, Apps & SaaS',
      strong: /\b(software|saas|\bcrm\b|\berp\b|sistema de gestao|automacao|chatbot|dashboard|integracao|\bapi\b)\bb/g,
      weak: /\b(aplicativo|\bapp\b|sistema|plataforma|planilha)\bb/g
    },
    {
      niche: 'Desenvolvimento Pessoal',
      strong: /\b(desenvolvimento pessoal|autoestima|ansiedade|depressao|autoconhecimento|procrastinacao|inteligencia emocional)\bb/g,
      weak: /\b(produtividade|mentalidade|foco|habitos?|disciplina|proposito|terapia|coach)\bb/g
    },
    {
      niche: 'Infoprodutos & PLR',
      strong: /\b(e-?books?|infoprodutos?|\bplr\b|mentoria|masterclass|treinamento online|area de membros|curso online|hotmart|kiwify|eduzz|monetizze|braip)\bb/g,
      weak: /\b(modulos?|certificado|bonus|acesso vitalicio|aulas gravadas)\bb/g
    },
    {
      niche: 'Negócios Locais & Serviços',
      strong: /\b(orcamento (gratis|sem compromisso)|agende (sua|seu)|marcar horario|agendamento|nossa loja|atendemos|funcionamos)\bb/g,
      weak: /\b(whatsapp|atendimento|contato|endereco|delivery)\bb/g
    },
    {
      niche: 'Dropshipping & Físicos',
      strong: /\b(frete gratis|ultimas unidades|pague na entrega|estoque limitado|compre 1 leve 2|entrega rapida|12x sem juros)\bb/g,
      weak: /\b(compre agora|promocao|desconto|oferta|unidades)\bb/g
    }
  ];

  // As regex de NICHE_RULES já nascem com a flag `g`: `String.prototype.match`
  // devolve todas as ocorrências e não guarda estado entre chamadas.
  function countMatches(regex, text) {
    const found = text.match(regex);
    return found ? new Set(found).size : 0;
  }

  /**
   * Descobre a categoria e, quando o anúncio diz o assunto com todas as
   * letras, também o tema específico.
   * Devolve `{ niche, topic }` — `topic` fica vazio se nada específico casar.
   */
  function classifyOffer(text, landingPage = '') {
    // O domínio da página de vendas entra na análise: play.google.com diz
    // "aplicativo" mesmo quando o texto do anúncio não diz.
    let host = '';
    try {
      if (landingPage) host = new URL(landingPage).hostname;
    } catch (e) {
      host = '';
    }
    const sample = normalizeForMatch(`${text}\n${host}`).slice(0, 4000);
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
  // NOME DO PRODUTO (SEPARADO DO NOME DA PÁGINA)
  // ============================================================================
  // O nome da página do Facebook é quem anuncia ("Fernanda Rocha"); o produto
  // é o que se vende ("Receitas Italianas"). O texto do anúncio não marca o
  // nome do produto de forma confiável (já foi testado e reprovado), mas o
  // endereço da página de vendas quase sempre carrega: 120receitasitalianas
  // .netlify.app, metodo-ingles-fluente.com.br, apps.apple.com/br/app/meshot.
  // Sai um palpite curto; a pessoa corrige no painel quando errar.

  // Hospedagens onde o produto está no SUBDOMÍNIO (nome.netlify.app).
  const SUBDOMAIN_HOSTS = /(^|\.)(netlify\.app|vercel\.app|github\.io|pages\.dev|web\.app|firebaseapp\.com|herokuapp\.com|onrender\.com|wixsite\.com|webflow\.io|carrd\.co|myshopify\.com|blogspot\.com|wordpress\.com|squarespace\.com|godaddysites\.com|weebly\.com|site\.com\.br|lojaintegrada\.com\.br|nuvemshop\.com\.br|mercadoshops\.com\.br|hotmart\.host|kpages\.online|kiwify\.app|lpages\.co|leadpages\.co|systeme\.io|greatpages\.com\.br|klickpages\.com\.br|builderall\.net)$/i;

  // Destinos que não dizem nada sobre o produto (checkout, link curto, chat).
  const NO_PRODUCT_HOSTS = /(^|\.)(hotmart\.com|kiwify\.com\.br|kiwify\.com|eduzz\.com|monetizze\.com\.br|braip\.com|perfectpay\.com\.br|ticto\.com\.br|pay\.hotmart\.com|wa\.me|whatsapp\.com|api\.whatsapp\.com|bit\.ly|linktr\.ee|linkbio\.co|beacons\.ai|t\.me|telegram\.me|youtube\.com|youtu\.be|google\.com|forms\.gle|typeform\.com|mercadolivre\.com\.br|shopee\.com\.br|amazon\.com\.br|magazineluiza\.com\.br|tiktok\.com)$/i;

  // Pedaços de endereço que nunca são o produto.
  const URL_NOISE = new Set([
    'www', 'lp', 'lp2', 'vsl', 'pv', 'site', 'pagina', 'page', 'home', 'index', 'html', 'php', 'oferta', 'ofertas',
    'checkout', 'obrigado', 'go', 'link', 'app', 'apps', 'br', 'pt', 'en', 'es', 'store', 'loja', 'oficial', 'official',
    'online', 'digital', 'promo', 'promocao', 'desconto', 'compra', 'comprar', 'pay', 'pagamento', 'v1', 'v2', 'v3', 'p', 'c', 'ref',
    'assinatura', 'assine', 'cadastro', 'inscricao', 'matricula', 'seguro', 'secure', 'acesso', 'membros', 'produto', 'produtos', 'vendas', 'utm',
    'products', 'product', 'shop', 'collections', 'collection', 'categoria', 'categorias', 'category', 'item', 'items', 'pages', 'join', 'materiais'
  ]);

  // Palavras ligadas que não começam nem terminam um nome.
  const NAME_STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'para', 'pra', 'com', 'sem', 'em', 'no', 'na', 'seu', 'sua', 'meu', 'minha', 'the', 'of', 'and', 'my', 'your']);

  // Dicionário para separar endereços colados ("receitasitalianas").
  // Não precisa conter tudo: o que não for reconhecido fica como está.
  const URL_WORDS = new Set((
    'receita receitas italiana italianas italiano italianos cozinha culinaria doce doces bolo bolos confeitaria brigadeiro ' +
    'pao paes massa massas pizza pizzas salgado salgados marmita marmitas fit low carb zero acucar gluten lactose vegano vegana ' +
    'jejum dieta dietas emagrecer emagrecimento seca secar barriga gordura queima detox cha chas suplemento natural naturais ' +
    'metodo metodos curso cursos aula aulas treino treinos treinamento mentoria formacao escola academia ' +
    'mapa mapas mental mentais resumo resumos questoes questao apostila apostilas flashcard flashcards caderno ' +
    'enem concurso concursos vestibular oab lei leis seca direito medicina enfermagem pedagogia ' +
    'ingles espanhol frances italiano idioma idiomas fluente fluencia conversacao ' +
    'livro livros ebook ebooks guia guias manual manuais kit kits box planilha planilhas modelo modelos template templates ' +
    'pack packs combo pacote colecao biblioteca ' +
    'desafio dias semanas mes meses segredo segredos protocolo formula sistema codigo plano projeto programa ' +
    'saude corpo mente vida bem estar beleza pele cabelo cabelos unha unhas cilios sobrancelha sobrancelhas maquiagem ' +
    'croche trico costura bordado artesanato pintura desenho desenhar ilustracao lettering caligrafia ' +
    'musica violao guitarra piano teclado canto ' +
    'renda extra dinheiro ganhar vender vendas negocio negocios marketing afiliado afiliados trafego ' +
    'fe oracao oracoes biblia salmo salmos tarot taro signo signos ' +
    'cachorro cachorros gato gatos pet pets adestramento ' +
    'bebe bebes mae maes maternidade gestante filhos crianca criancas infantil kids ' +
    'casa jardim horta plantas decoracao organizacao limpeza ' +
    'carro carros moto motos mecanica cnh ' +
    'clima radar camera gps foto fotos video videos editor edicao ' +
    'super mega max pro master premium plus top elite gold vip club clube ' +
    'minha meu seu sua nossa nosso facil rapido rapida simples pratico pratica completo completa total novo nova'
  ).split(/\s+/));

  // Para separar palavras coladas também valem as palavras de ruído e as de
  // ligação em português ("minhaloja" = "minha" + "loja").
  const GLUE_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'para', 'pra', 'com', 'sem', 'em', 'no', 'na', 'seu', 'sua', 'meu', 'minha']);
  const isKnownWord = (w) => URL_WORDS.has(w) || URL_NOISE.has(w) || GLUE_WORDS.has(w);

  // Subdomínios que são infraestrutura, não produto (seguro.loja.com).
  const GENERIC_SUBDOMAINS = new Set(['www', 'm', 'app', 'pay', 'pagamento', 'seguro', 'checkout', 'go', 'lp', 'pages', 'page', 'site', 'loja', 'store', 'shop', 'br', 'link', 'links', 'vendas', 'oferta', 'promo', 'secure', 'members', 'membros', 'area', 'acesso', 'blog', 'info', 'sales', 'ir', 'click', 'join', 'materiais', 'conteudo', 'conteudos']);

  /** Separa "receitasitalianas" em ["receitas", "italianas"] quando der. */
  function splitGlued(chunk) {
    const n = chunk.length;
    if (n <= 4 || isKnownWord(chunk)) return [chunk];
    // best[i] = melhor jeito de cobrir chunk[0..i): pedaço desconhecido custa caro.
    const best = new Array(n + 1).fill(null);
    best[0] = { cost: 0, parts: [] };
    for (let i = 1; i <= n; i += 1) {
      for (let j = Math.max(0, i - 16); j < i; j += 1) {
        if (!best[j]) continue;
        const piece = chunk.slice(j, i);
        const known = isKnownWord(piece);
        const cost = best[j].cost + (known ? 1 : 10 + piece.length);
        if (!best[i] || cost < best[i].cost) best[i] = { cost, parts: [...best[j].parts, { piece, known }] };
      }
    }
    const parts = best[n].parts;
    const knownChars = parts.filter((p) => p.known).reduce((sum, p) => sum + p.piece.length, 0);
    // Só aceita a separação se reconheceu quase tudo e não sobrou caco curto
    // ("de" + "cor" + "and" em "decorandoaleiseca" é separação errada).
    const shortUnknown = parts.some((p) => !p.known && p.piece.length < 5);
    return knownChars >= n * 0.75 && !shortUnknown ? parts.map((p) => p.piece) : [chunk];
  }

  function titleCase(words) {
    return words
      .map((w, i) => (i > 0 && NAME_STOPWORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ');
  }

  /**
   * Transforma um pedaço de endereço em palavras limpas.
   * `confident` fica falso quando sobra um bloco comprido que não deu para
   * separar ("prfadmsublime") — aí é melhor não chutar nome nenhum.
   */
  function wordsFromSlug(slug) {
    let text = '';
    try {
      text = decodeURIComponent(slug || '');
    } catch (e) {
      text = slug || '';
    }
    const raw = normalizeForMatch(text)
      .replace(/\.(html?|php|aspx?)$/i, '')
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    const words = [];
    let confident = true;
    raw.forEach((token) => {
      // Número colado em palavra: "120receitas" -> "120" + "receitas"
      token.split(/(?<=\d)(?=[a-z])|(?<=[a-z])(?=\d)/).forEach((part) => {
        if (/^\d+$/.test(part)) return; // números soltos ficam de fora do nome
        splitGlued(part).forEach((w) => {
          // Endereço com hífens já vem separado em palavras de verdade; só
          // desconfiamos de bloco colado que não deu para separar.
          if (raw.length === 1 && w.length >= 9 && !isKnownWord(w)) confident = false;
          words.push(w);
        });
      });
    });
    let clean = words.filter((w) => w.length > 1 && !URL_NOISE.has(w));
    while (clean.length && NAME_STOPWORDS.has(clean[0])) clean.shift();
    clean = clean.slice(0, 4);
    while (clean.length && NAME_STOPWORDS.has(clean[clean.length - 1])) clean.pop();
    return { words: clean, confident };
  }

  /**
   * Palpite do nome do produto a partir da página de vendas.
   * Devolve '' quando o endereço não diz nada (checkout, WhatsApp, link curto)
   * ou só repete o nome da página do Facebook.
   */
  function guessProductName(landingPage, pageName) {
    if (!landingPage) return '';
    let url;
    try {
      url = new URL(landingPage);
    } catch (e) {
      return '';
    }

    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    if (NO_PRODUCT_HOSTS.test(host) || /(^|\.)play\.google\.com$/.test(host)) return '';

    // Candidatos, do mais provável ao menos provável.
    const candidates = [];
    const appStore = /(^|\.)apps\.apple\.com$/.test(host) && url.pathname.match(/\/app\/([^/]+)\/id\d+/i);
    if (appStore) {
      candidates.push(appStore[1]);
    } else {
      const labels = host.split('.');
      if (SUBDOMAIN_HOSTS.test(host)) {
        candidates.push(labels[0]);
      } else {
        const twoPartTld = /\.(com|net|org|gov|edu|art|blog|tec|eco)\.[a-z]{2}$/.test(host);
        const sldIndex = labels.length - (twoPartTld ? 3 : 2);
        // Subdomínio próprio (unoemotions.omapa.online) costuma ser o produto;
        // nesse caso o domínio é a plataforma e não entra como palpite.
        const subs = labels.slice(0, Math.max(0, sldIndex)).filter((sub) => !GENERIC_SUBDOMAINS.has(sub));
        candidates.push(...subs);
        if (!subs.length && labels[sldIndex]) candidates.push(labels[sldIndex]);
      }
      // No caminho, o pedaço mais específico é o último (/cozinha/air-fryer).
      url.pathname
        .split('/')
        .filter((seg) => seg.length > 3 && !/^\d+$/.test(seg))
        .reverse()
        .slice(0, 3)
        .forEach((seg) => candidates.push(seg));
    }

    const pageKey = normalizeForMatch(pageName || '').replace(/[^a-z0-9]/g, '');

    for (const candidate of candidates) {
      const { words, confident } = wordsFromSlug(candidate);
      if (!words.length || !confident) continue;
      const key = words.join('');
      if (key.length < 4) continue;
      // Só repete o nome da página do Facebook: não acrescenta nada.
      if (pageKey && pageKey.includes(key)) continue;
      return titleCase(words).slice(0, 60);
    }
    return '';
  }

  // ============================================================================
  // ESTÁGIO DA OFERTA (TEMPO DE VEICULAÇÃO + ANÚNCIOS DO ANUNCIANTE)
  // ============================================================================
  // O "N anúncios usam este criativo" do card não entra na conta: não é o
  // total de anúncios ativos da oferta. O que entra é o total do ANUNCIANTE,
  // lido só na hora de minerar (ver fetchPageActiveAds).
  //
  // As faixas e a regra vivem em rastreio-regras.js (carregado antes deste
  // arquivo pelo manifest) e precisam bater com src/utils/offerMeta.js.
  const { STAGE_DAYS, STAGE_BY_ADS, classifyStage } = self.MineraiRastreio;

  // Explicação das etiquetas para quem está começando (tooltip da pílula).
  const STAGE_TIP =
    `Em teste: 1 a ${STAGE_DAYS.pre_scaling - 1} dias no ar, o anunciante ainda está testando.\n` +
    `Pré-escala: ${STAGE_DAYS.pre_scaling} a ${STAGE_DAYS.scaling - 1} dias, passou do teste e segue rodando.\n` +
    `Escalando: ${STAGE_DAYS.scaling} a ${STAGE_DAYS.winner - 1} dias pagando anúncio todo dia.\n` +
    `Vencedor: ${STAGE_DAYS.winner}+ dias, oferta validada.\n` +
    `Exceção: ${STAGE_BY_ADS.map((r) => `${r.days}+ dias com ${r.ads}+ anúncios ativos do anunciante`).join(' ou ')} já conta como Escalando (lido ao minerar).`;

  /** HTML de uma página da Biblioteca (mesma origem), com limite de tempo. */
  async function fetchLibraryHtml(query) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${location.origin}/ads/library/?${query}`, {
        credentials: 'include',
        signal: controller.signal
      });
      return res.ok ? await res.text() : '';
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * ID REAL da página do anunciante e se o anúncio ainda está no ar, lidos do
   * próprio anúncio (`?id=<anúncio>`). O ID que sai do card muitas vezes é o
   * do perfil (ou nem existe, quando a página tem apelido) e a Biblioteca
   * devolve zero anúncios para ele.
   */
  async function fetchAnuncio(libraryId) {
    if (!/^\d{6,}$/.test(String(libraryId || ''))) return { pageId: '', ativo: null };
    const html = await fetchLibraryHtml(`id=${libraryId}`);
    return self.MineraiRastreio.lerAnuncio(html, libraryId);
  }

  /**
   * Total de anúncios ATIVOS do anunciante (o "~27 resultados" da página dele
   * na Biblioteca). Roda só no clique de Minerar, uma leitura por oferta, para
   * não travar a Biblioteca. Mesma origem: não precisa de aba nem permissão.
   *
   * Devolve também o ID real da página, se o anúncio salvo está ativo e o país
   * usado — o rastreio diário reaproveita os três. `total` null = não deu para
   * ler; a mineração segue sem o número.
   */
  async function fetchPageActiveAds(libraryId, cardPageId) {
    // Mesmo país da busca atual: na tab "Gringa" o total do Brasil daria zero.
    const country =
      (new URLSearchParams(location.search).get('country') || 'ALL').replace(/[^A-Z]/gi, '').toUpperCase() || 'ALL';
    const vazio = { total: null, pageId: '', ativo: null, country };
    try {
      const anuncio = await fetchAnuncio(libraryId);
      const pageId = anuncio.pageId || cardPageId;
      if (!/^\d{6,}$/.test(String(pageId || ''))) return { ...vazio, ativo: anuncio.ativo };

      const html = await fetchLibraryHtml(
        `active_status=active&ad_type=all&country=${encodeURIComponent(country)}` +
          `&view_all_page_id=${pageId}&media_type=all`
      );
      const n = self.MineraiRastreio.lerTotal(html) || 0;
      // Zero com um anúncio ativo na tela = ID de página errado. Melhor sem número.
      return {
        total: n > 0 ? n : null,
        pageId: anuncio.pageId,
        ativo: anuncio.ativo,
        country
      };
    } catch (e) {
      console.warn('[Mineraí Extensão] Não deu para ler os anúncios do anunciante:', e.message);
      return vazio;
    }
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
      (el) => !el.closest('.minerai-injected')
    );
  }

  /**
   * Texto do card sem a barra que a própria extensão injeta — senão os rótulos
   * dela ("Escalando", "Minerar oferta") entrariam na análise de nicho.
   */
  function getCardText(card) {
    let full = card.innerText || '';
    card.querySelectorAll('.minerai-injected').forEach((el) => {
      const text = el.innerText || '';
      if (text) full = full.split(text).join('\n');
    });
    return full;
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
        // O parâmetro `u` do redirecionador da Meta vem do anunciante: só
        // http(s) vira link na barra e no painel (nunca `javascript:`).
        if (!/^https?:$/.test(parsedTarget.protocol)) continue;
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

    // Duas coisas diferentes: a PÁGINA do Facebook (quem anuncia, ex.
    // "Fernanda Rocha") e o PRODUTO (o que se vende, ex. "Receitas
    // Italianas"). O produto sai do endereço da página de vendas; a headline
    // do anúncio não serve (no DOM real ela vem como "0:00" ou frase solta).
    // Sem palpite confiável, a oferta leva o nome da página e a pessoa
    // corrige no painel.
    const pageName = advertiser.pageName || '';
    const productName = guessProductName(landingPage, pageName);
    const name = productName || pageName || 'Oferta Minerada';
    const { niche, topic } = classifyOffer(fullText, landingPage);

    return {
      name,
      pageName,
      productName,
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
        libraryId ? null : 'ID do anúncio',
        niche === 'Outros' ? 'categoria' : null
      ].filter(Boolean)
    };
  }

  // ============================================================================
  // 5. BARRA MINERAÍ INJETADA NO CARD
  // ============================================================================

  // Guarda os dados extraídos por card para o clique não reprocessar o DOM.
  const cardDataCache = new WeakMap();

  const DOWNLOAD_IDLE_HTML = `${icon('baixar')}<span class="minerai-btn-text">Baixar mídia</span>`;
  const CAPTURE_IDLE_HTML = `${icon('picareta')}<span class="minerai-btn-text">Minerar oferta</span>`;

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

      // Dois blocos: a barra de ações no topo e os números logo abaixo do
      // botão do anúncio, onde a pessoa já está olhando.
      let created = false;
      let bar = card.querySelector(':scope > .minerai-card-injected-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'minerai-card-injected-bar minerai-injected';
        card.prepend(bar);
        created = true;
      }
      let foot = card.querySelector(':scope > .minerai-card-foot');
      if (!foot) {
        foot = document.createElement('div');
        foot.className = 'minerai-card-foot minerai-injected';
        card.append(foot);
        created = true;
      }

      // Só redesenha quando algo realmente mudou: evita piscar a barra a cada
      // mutação do React da Meta (e o botão perder o estado de "Minerado").
      const signature = [
        data.daysRunning,
        data.adsCount,
        data.status,
        data.libraryId,
        data.landingPage,
        data.creativeUrl
      ].join('|');

      if (!created && bar.dataset.mineraiSignature === signature) return;
      bar.dataset.mineraiSignature = signature;

      const daysLabel = data.daysRunning
        ? `${data.daysRunning} ${data.daysRunning === 1 ? 'dia no ar' : 'dias no ar'}`
        : 'sem data';
      const adsLabel = `${data.adsCount} ${data.adsCount === 1 ? 'anúncio' : 'anúncios'}`;
      const statusLabel = STATUS_LABELS[data.status] || 'Em teste';

      let landingHost = '';
      if (data.landingPage) {
        try {
          landingHost = new URL(data.landingPage).hostname.replace(/^www\./, '');
        } catch (e) {
          landingHost = data.landingPage.slice(0, 30);
        }
      }

      bar.innerHTML = `
        <div class="minerai-bar-line minerai-card-actions">
          <button class="minerai-download-btn" type="button" title="Baixar o vídeo ou a imagem deste anúncio">${DOWNLOAD_IDLE_HTML}</button>
          <button class="minerai-capture-btn" type="button" data-lib-id="${escapeHtml(data.libraryId)}" title="Salvar esta oferta no painel Mineraí">${CAPTURE_IDLE_HTML}</button>
        </div>
        <div class="minerai-bar-line minerai-bar-links">
          ${
            landingHost
              ? `<a class="minerai-link" href="${escapeHtml(data.landingPage)}" target="_blank" rel="noreferrer" title="Abrir a página de vendas: ${escapeHtml(data.landingPage)}">${icon('link', 12)}<span>${escapeHtml(landingHost)}</span></a>`
              : `<span class="minerai-link-missing" title="Este anúncio não tem link de página de vendas">${icon('link', 12)}<span>sem página de vendas</span></span>`
          }
          ${
            data.adUrl
              ? `<a class="minerai-link" href="${escapeHtml(data.adUrl)}" target="_blank" rel="noreferrer" title="Abrir só este anúncio na Biblioteca (ID ${escapeHtml(data.libraryId)})">${icon('externo', 12)}<span>ver anúncio</span></a>`
              : `<span class="minerai-link-missing" title="A Biblioteca não mostrou a identificação deste anúncio">${icon('externo', 12)}<span>sem ID do anúncio</span></span>`
          }
        </div>
      `;

      foot.innerHTML = `
        <span class="minerai-pill running-days ${daysColorClass(data.daysRunning)}" title="Há quanto tempo o anúncio está no ar${data.startDate ? ` (começou em ${escapeHtml(data.startDate)})` : ''}. Azul até ${DAYS_COLOR.yellow - 1} dias, amarelo de ${DAYS_COLOR.yellow} a ${DAYS_COLOR.green - 1}, verde a partir de ${DAYS_COLOR.green}.">${icon('relogio')}<span>${escapeHtml(daysLabel)}</span></span>
        <span class="minerai-pill creatives" title="Quantos anúncios a Meta diz que usam este criativo">${icon('camadas')}<span>${escapeHtml(adsLabel)}</span></span>
        <span class="minerai-pill stage stage-${escapeHtml(data.status)}" title="${escapeHtml(STAGE_TIP)}">${icon('etiqueta')}<span>${escapeHtml(statusLabel)}</span></span>
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

      // Os links ficam dentro do card da Meta, que intercepta cliques:
      // paramos a propagação para o card não abrir por baixo.
      bar.querySelectorAll('.minerai-link').forEach((link) => {
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
      if (!/^https?:/i.test(src) || src.includes('emoji')) return false;
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
    // Só mídia servida por http(s) chega aqui; qualquer outro esquema é recusado.
    if (!/^https?:/i.test(url || '')) throw new Error('Endereço de mídia inválido.');
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
    btn.innerHTML = `${icon('relogio')}<span class="minerai-btn-text">Baixando...</span>`;

    safeSendMessage(
      { type: 'DOWNLOAD_MEDIA', url: media.url, filename: media.filename },
      (response) => {
        btn.disabled = false;
        if (response && response.success) {
          btn.innerHTML = `${icon('check')}<span class="minerai-btn-text">Baixado!</span>`;
          showToast(`Download de ${media.type === 'video' ? 'vídeo' : 'imagem'} iniciado!`);
          if (media.type === 'video') iniciarTranscricao(card, media);
          setTimeout(() => {
            btn.innerHTML = DOWNLOAD_IDLE_HTML;
          }, 2500);
        } else {
          triggerDirectDownload(media.url, media.filename).then(() => {
            btn.innerHTML = `${icon('check')}<span class="minerai-btn-text">Baixado!</span>`;
            showToast(`Download de ${media.type === 'video' ? 'vídeo' : 'imagem'} iniciado!`);
            if (media.type === 'video') iniciarTranscricao(card, media);
            setTimeout(() => {
              btn.innerHTML = DOWNLOAD_IDLE_HTML;
            }, 2500);
          }).catch(() => {
            btn.innerHTML = DOWNLOAD_IDLE_HTML;
            showToast('Erro ao baixar arquivo de mídia.');
          });
        }
      }
    );
  }

  async function handleCaptureOffer(cardData, btn) {
    if (!currentUser) {
      showToast('Faça login no Mineraí para salvar suas ofertas mineradas!');
      return;
    }

    if (btn.disabled) return;

    btn.disabled = true;
    btn.className = 'minerai-capture-btn';
    btn.innerHTML = `${icon('relogio')}<span class="minerai-btn-text">Contando anúncios...</span>`;

    // Total de anúncios do anunciante: entra no estágio (regra de exceção) e
    // fica guardado na oferta. Se falhar, salva do mesmo jeito.
    const leitura = await fetchPageActiveAds(cardData.libraryId, cardData.pageId);
    const data = {
      ...cardData,
      pageActiveAds: leitura.total || 0,
      pageIdReal: leitura.pageId || '',
      country: leitura.country || '',
      adActive: typeof leitura.ativo === 'boolean' ? leitura.ativo : null,
      status: classifyStage(cardData.daysRunning, leitura.total)
    };

    btn.innerHTML = `${icon('relogio')}<span class="minerai-btn-text">Salvando...</span>`;

    safeSendMessage(
      { type: 'SAVE_OFFER', offer: data },
      (response) => {
        btn.disabled = false;

        if (response && response.success) {
          const updated = response.data?.updated;
          btn.className = 'minerai-capture-btn mined-success';
          btn.innerHTML = `${icon('check')}<span class="minerai-btn-text">${updated ? 'Atualizado!' : 'Minerado!'}</span>`;

          // Avisa em qual campo a Meta não expôs o dado, para o usuário poder
          // completar à mão no painel em vez de descobrir depois.
          const warn = data.missing?.length ? ` (verifique: ${data.missing.join(', ')})` : '';
          const pageAds = data.pageActiveAds
            ? ` O anunciante tem ${data.pageActiveAds} ${data.pageActiveAds === 1 ? 'anúncio ativo' : 'anúncios ativos'}.`
            : '';
          showToast(
            updated
              ? `"${data.name}" atualizada: ${data.adsCount} anúncios registrados hoje.${pageAds}${warn}`
              : `"${data.name}" foi salva no Mineraí!${pageAds}${warn}`
          );

          setTimeout(() => {
            btn.className = 'minerai-capture-btn';
            btn.innerHTML = CAPTURE_IDLE_HTML;
          }, 2500);
        } else {
          btn.className = 'minerai-capture-btn mined-error';
          btn.innerHTML = `${icon('x')}<span class="minerai-btn-text">Erro ao salvar</span>`;
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
  function showToast(msg, duracaoMs = 3000) {
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
    }, duracaoMs);
  }

  // ============================================================================
  // TRANSCRIÇÃO DO CRIATIVO: depois de baixar um vídeo, sai o roteiro em .txt
  // (gancho, desenvolvimento, chamada final e prompt para a IA).
  // ============================================================================
  let transcrevendo = false;

  function iniciarTranscricao(card, media) {
    if (transcrevendo) {
      showToast('Já tem um vídeo sendo transcrito. Espere terminar para pedir outro.');
      return;
    }
    transcrevendo = true;
    const dados = cardDataCache.get(card) || parseCardDetails(card) || {};
    const pais = (new URLSearchParams(location.search).get('country') || '').toUpperCase();
    showToast('Transcrevendo a fala do vídeo...', 8000);
    safeSendMessage(
      {
        type: 'TRANSCREVER',
        url: media.url,
        nomeVideo: media.filename,
        libraryId: dados.libraryId || '',
        pagina: dados.pageName || dados.name || '',
        dias: dados.daysRunning || 0,
        texto: getCardText(card).slice(0, 1500),
        pais
      },
      (resposta) => {
        transcrevendo = false;
        if (resposta && resposta.success) {
          showToast(
            resposta.temFala
              ? `Roteiro do vídeo baixado: ${resposta.nome}`
              : 'Esse vídeo não tem fala. O arquivo do roteiro avisa isso.',
            6000
          );
        } else {
          showToast(`Não deu para transcrever: ${(resposta && resposta.error) || 'tente de novo.'}`, 6000);
        }
      }
    );
  }

  const TEXTO_DA_ETAPA = {
    baixando: () => 'Transcrevendo: pegando o vídeo...',
    modelo: (pct) => `Preparando o transcritor (só na primeira vez): ${pct || 0}%`,
    ouvindo: () => 'Transcrevendo a fala do vídeo...'
  };

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== 'MINERAI_TRANSCRICAO_STATUS') return undefined;
      const texto = TEXTO_DA_ETAPA[msg.etapa];
      if (texto) showToast(texto(msg.pct), 12000);
      return undefined;
    });
  } catch (e) {}

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
