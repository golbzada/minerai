// ==============================================================================
// MINERAÍ EXTENSÃO - CONTENT SCRIPT (MANIFEST V3)
// Biblioteca de Anúncios do Meta (Meta Ads Library)
// ==============================================================================

(function () {
  'use strict';

  let isAutoScrolling = false;
  let autoScrollInterval = null;
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

  // Inicialização
  initExtension();

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

        <label class="minerai-checkbox-label">
          <input type="checkbox" id="minerai-auto-scroll" />
          <span>Rolagem automática</span>
        </label>

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

        <button class="minerai-btn-secondary" id="minerai-stop-scroll">
          Parar Rolagem
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

  function updatePanelAuthStatus() {
    const authBox = document.getElementById('minerai-auth-box');
    if (!authBox) return;

    if (currentUser) {
      authBox.className = 'minerai-auth-badge online';
      const name = currentUser.name || currentUser.email?.split('@')[0] || 'Minerador';
      authBox.innerHTML = `<span>🟢 Conectado: <strong>${escapeHtml(name)}</strong></span>`;
    } else {
      authBox.className = 'minerai-auth-badge offline';
      authBox.innerHTML = `
        <span>🔴 Não conectado</span>
        <a id="minerai-login-link" target="_blank" href="http://localhost:5173">Fazer Login</a>
      `;
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
    const autoScrollCb = panel.querySelector('#minerai-auto-scroll');
    const stopScrollBtn = panel.querySelector('#minerai-stop-scroll');
    const applyBtn = panel.querySelector('#minerai-apply-filters');
    const minAdsInput = panel.querySelector('#minerai-min-ads');
    const minDaysInput = panel.querySelector('#minerai-min-days');

    minBtn.addEventListener('click', () => {
      panel.classList.toggle('minimized');
      minBtn.textContent = panel.classList.contains('minimized') ? '+' : '−';
    });

    autoScrollCb.addEventListener('change', (e) => {
      if (e.target.checked) startAutoScroll();
      else stopAutoScroll();
    });

    stopScrollBtn.addEventListener('click', () => {
      autoScrollCb.checked = false;
      stopAutoScroll();
    });

    // Botão Garimpar com Filtros
    applyBtn.addEventListener('click', () => {
      applyBtn.classList.add('active-pulse');
      setTimeout(() => applyBtn.classList.remove('active-pulse'), 400);

      activeFilters.minAds = parseInt(minAdsInput.value, 10) || 0;
      activeFilters.minDays = parseInt(minDaysInput.value, 10) || 0;

      scanAndEnhanceCards();
      const count = applyAdFilters();

      if (count > 0) {
        showToast(`${count} criativos encontrados!`);
      } else {
        showToast('Nenhum anúncio correspondeu aos filtros aplicados.');
      }
    });
  }

  function startAutoScroll() {
    if (isAutoScrolling) return;
    isAutoScrolling = true;
    showToast('Rolagem automática iniciada!');

    autoScrollInterval = setInterval(() => {
      window.scrollBy({ top: 850, behavior: 'smooth' });
    }, 1400);
  }

  function stopAutoScroll() {
    if (!isAutoScrolling) return;
    isAutoScrolling = false;
    if (autoScrollInterval) clearInterval(autoScrollInterval);
    showToast('Rolagem automática parada.');
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
  // 4. EXTRAÇÃO DE METADADOS & INJEÇÃO DE ELEMENTOS VISUAIS
  // ============================================================================

  function parseCardDetails(card) {
    const fullText = card.innerText || '';

    // A) ID da biblioteca
    let libraryId = '';
    const idMatch = fullText.match(/(?:Identificação da biblioteca|Library ID|ID da biblioteca|Identificação do anúncio):\s*([0-9]+)/i);
    if (idMatch) libraryId = idMatch[1];

    // B) Data de início e cálculo dos dias rodando
    let daysRunning = 0;
    const dateMatchPt = fullText.match(/(?:veiculação iniciada em|veiculacao iniciada em|veiculação iniciada|veiculacao iniciada|começou a ser veiculado em|comecou a ser veiculado em|veiculado em|início da veiculação|inicio da veiculacao)\s*([0-9]{1,2})\s+de\s+([a-zA-ZçÇ]+)(?:\s+de\s+([0-9]{4}))?/i);
    const dateMatchEn = fullText.match(/(?:Started running on|Running since|Launched on)\s*([a-zA-Z]+)\s+([0-9]{1,2}),?\s+([0-9]{4})?/i);

    const now = new Date();
    if (dateMatchPt) {
      const day = parseInt(dateMatchPt[1], 10);
      const rawMonth = dateMatchPt[2].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").slice(0, 3);
      const year = dateMatchPt[3] ? parseInt(dateMatchPt[3], 10) : now.getFullYear();
      const month = PT_MONTHS[rawMonth] !== undefined ? PT_MONTHS[rawMonth] : now.getMonth();
      const startDate = new Date(year, month, day);
      if (!isNaN(startDate.getTime())) {
        daysRunning = Math.max(0, Math.floor((now - startDate) / (1000 * 60 * 60 * 24)));
      }
    } else if (dateMatchEn) {
      const monthStr = dateMatchEn[1].toLowerCase().slice(0, 3);
      const day = parseInt(dateMatchEn[2], 10);
      const year = dateMatchEn[3] ? parseInt(dateMatchEn[3], 10) : now.getFullYear();
      const startDate = new Date(`${monthStr} ${day}, ${year}`);
      if (!isNaN(startDate.getTime())) {
        daysRunning = Math.max(0, Math.floor((now - startDate) / (1000 * 60 * 60 * 24)));
      }
    }

    // C) Quantidade de criativos
    let adsCount = 1;
    const adsCountMatch = fullText.match(/([0-9]+)\s+(?:anúncios usam este criativo e texto|anúncios usam esse criativo e esse texto|anúncios usam este criativo|anúncios usam esse criativo|ads use this creative and text|anúncios usam|ads use)/i);
    if (adsCountMatch) {
      adsCount = parseInt(adsCountMatch[1], 10);
    }

    // D) Nome do anunciante / Página
    let pageName = 'Oferta Minerada';
    const strongEl = card.querySelector('strong, h3, h4, span[dir="auto"], a[role="link"]');
    if (strongEl && strongEl.textContent.trim().length > 1) {
      pageName = strongEl.textContent.trim().slice(0, 60);
    }

    // E) Avatar do anunciante
    let avatarUrl = '';
    const imgEl = card.querySelector('img[src*="fbcdn"], img[src*="facebook"], img[alt]');
    if (imgEl && imgEl.src && !imgEl.src.includes('data:image')) {
      avatarUrl = imgEl.src;
    }

    // F) Link de destino (CTA / landing page)
    let landingPage = '';
    const linkEl = card.querySelector('a[href*="l.facebook.com"], a[href^="http"]:not([href*="facebook.com/ads/library"])');
    if (linkEl && linkEl.href) {
      try {
        const urlObj = new URL(linkEl.href);
        if (urlObj.hostname.includes('facebook.com') && urlObj.searchParams.has('u')) {
          landingPage = decodeURIComponent(urlObj.searchParams.get('u'));
        } else {
          landingPage = linkEl.href;
        }
      } catch (e) {
        landingPage = linkEl.href;
      }
    }

    return {
      name: pageName,
      libraryId: libraryId || `id_${Date.now()}`,
      daysRunning,
      adsCount,
      avatarUrl,
      landingPage,
      libraryUrl: window.location.href
    };
  }

  function scanAndEnhanceCards() {
    const cards = findAdCards();

    cards.forEach((card) => {
      const data = parseCardDetails(card);

      card.dataset.mineraiDaysRunning = data.daysRunning;
      card.dataset.mineraiAdsCount = data.adsCount;
      card.dataset.mineraiLibraryId = data.libraryId;

      // Destacar com contorno dourado se rodando há 30 dias ou mais OU se tiver múltiplos criativos (escala)
      if (data.daysRunning >= 30 || data.adsCount >= 2) {
        card.classList.add('minerai-card-winner');
      } else {
        card.classList.remove('minerai-card-winner');
      }

      // Evita reinjetar a barra se já existir
      let bar = card.querySelector('.minerai-card-injected-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'minerai-card-injected-bar';
        card.prepend(bar);
      }

      const daysLabel = data.daysRunning === 1 ? '1 dia' : `${data.daysRunning} dias`;
      const adsLabel = data.adsCount === 1 ? '1 criativo' : `${data.adsCount} criativos`;
      const isScaleHigh = data.daysRunning >= 30;

      bar.innerHTML = `
        <div class="minerai-badge-group">
          <span class="minerai-pill creatives">${escapeHtml(adsLabel)}</span>
          <span class="minerai-pill running-days ${isScaleHigh ? 'scale-high' : ''}">Rodando há ${escapeHtml(daysLabel)}</span>
        </div>
        <button class="minerai-capture-btn" data-lib-id="${escapeHtml(data.libraryId)}">
          <span>Minerar Oferta</span>
        </button>
      `;

      const captureBtn = bar.querySelector('.minerai-capture-btn');
      captureBtn.onclick = (e) => {
        e.stopPropagation();
        handleCaptureOffer(data, captureBtn);
      };
    });
  }

  function handleCaptureOffer(data, btn) {
    if (!currentUser) {
      showToast('Faça login no Mineraí para salvar suas ofertas mineradas!');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span>Salvando...</span>';

    safeSendMessage(
      { type: 'SAVE_OFFER', offer: data },
      (response) => {
        btn.disabled = false;
        if (response && response.success) {
          btn.className = 'minerai-capture-btn mined-success';
          btn.innerHTML = '<span>✓ Minerado!</span>';
          showToast(`"${data.name}" foi salva no Mineraí!`);
          setTimeout(() => {
            btn.className = 'minerai-capture-btn';
            btn.innerHTML = '<span>Minerar Oferta</span>';
          }, 2500);
        } else {
          btn.className = 'minerai-capture-btn mined-error';
          btn.innerHTML = '<span>Erro ao salvar</span>';
          showToast(response?.error || 'Erro ao conectar ao banco de dados.');
          setTimeout(() => {
            btn.className = 'minerai-capture-btn';
            btn.innerHTML = '<span>Minerar Oferta</span>';
          }, 3000);
        }
      }
    );
  }

  // ============================================================================
  // 5. FILTROS & CONTAGEM DE RESULTADOS COM CSS CLASS SEGURA
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

})();
