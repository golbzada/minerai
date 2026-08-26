// ==============================================================================
// MINERAÍ EXTENSÃO - CONTENT SCRIPT (MANIFEST V3)
// Biblioteca de Anúncios do Meta (Meta Ads Library)
// ==============================================================================

(function () {
  'use strict';

  let isAutoScrolling = false;
  let autoScrollInterval = null;
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
    setInterval(checkAuth, 10000);
  }

  // Verificar status de autenticação via Background
  function checkAuth() {
    chrome.runtime.sendMessage({ type: 'CHECK_AUTH' }, (response) => {
      if (chrome.runtime.lastError) return;
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
          <span class="minerai-field-helper">Use 0 para não limitar</span>
        </div>

        <div class="minerai-field-group">
          <label>Tempo mínimo rodando (dias)</label>
          <input type="number" id="minerai-min-days" min="0" value="0" placeholder="Ex: 30 (ou 0 para todos)" />
          <span class="minerai-field-helper">Use 0 para não limitar</span>
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

    applyBtn.addEventListener('click', () => {
      activeFilters.minAds = parseInt(minAdsInput.value, 10) || 0;
      activeFilters.minDays = parseInt(minDaysInput.value, 10) || 0;
      applyAdFilters();
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

      if (isInternal) return;
      handleMutationTrigger();
    });

    observerInstance.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // ============================================================================
  // 3. IDENTIFICAÇÃO INFALÍVEL DOS CARDS DA BIBLIOTECA META
  // ============================================================================

  function findAdCards() {
    const cards = new Set();

    // 1. Busca nós de texto com "Identificação da biblioteca" ou "Library ID"
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    const matchedElements = [];
    let node;
    while ((node = walker.nextNode())) {
      const val = node.nodeValue || '';
      if (
        val.includes('Identificação da biblioteca') ||
        val.includes('Library ID') ||
        val.includes('ID da biblioteca')
      ) {
        if (node.parentElement) {
          matchedElements.push(node.parentElement);
        }
      }
    }

    // 2. Para cada elemento, sobe nos pais até achar o container único do card de anúncio
    matchedElements.forEach(el => {
      let current = el;
      let cardContainer = null;

      for (let i = 0; i < 14 && current && current !== document.body; i++) {
        const tc = current.textContent || '';
        const occurrences = (tc.match(/(?:Identificação da biblioteca|Library ID|ID da biblioteca)/g) || []).length;

        if (occurrences === 1) {
          if (
            tc.includes('Veiculação iniciada') ||
            tc.includes('Started running') ||
            tc.includes('Plataformas') ||
            tc.includes('Platforms') ||
            tc.includes('Ver detalhes do anúncio') ||
            tc.includes('See ad details') ||
            tc.includes('Ver resumo')
          ) {
            cardContainer = current;
          }
        } else if (occurrences > 1) {
          break;
        }

        current = current.parentElement;
      }

      if (cardContainer) {
        cards.add(cardContainer);
      }
    });

    return Array.from(cards);
  }

  function scanAndEnhanceCards() {
    const cards = findAdCards();
    let hasNewCards = false;

    cards.forEach(card => {
      if (card.dataset.mineraiEnhanced === 'true' || card.querySelector('.minerai-card-injected-bar')) {
        return;
      }

      card.dataset.mineraiEnhanced = 'true';
      hasNewCards = true;

      const data = extractCardData(card);
      card.dataset.mineraiAdsCount = data.adsCount;
      card.dataset.mineraiDaysRunning = data.daysRunning;

      injectCardBar(card, data);
    });

    applyAdFilters();
  }

  function extractCardData(card) {
    const text = card.textContent || '';

    // 1. Quantidade de anúncios com o mesmo criativo
    let adsCount = 1;
    const adsMatch = text.match(/(\d+)\s+(?:anúncios|anúncio|ads|ad)\s+usam\s+esse\s+criativo/i) ||
                     text.match(/(\d+)\s+(?:anúncios|anúncio|ads|ad)/i);
    if (adsMatch) {
      adsCount = parseInt(adsMatch[1], 10) || 1;
    }

    // 2. Data de início e cálculo de dias rodando
    let daysRunning = 0;
    let dateStr = '';
    const dateMatch = text.match(/(?:Veiculação iniciada em|Started running on|Started running)\s+([^\n\r]+)/i);
    if (dateMatch) {
      dateStr = dateMatch[1].trim();
      const parsedDate = parseMetaDate(dateStr);
      if (parsedDate) {
        const diffTime = Math.abs(Date.now() - parsedDate.getTime());
        daysRunning = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      }
    }

    // 3. ID da Biblioteca e Nome da Página
    let libraryId = '';
    const libMatch = text.match(/(?:Identificação da biblioteca|ID da biblioteca|Library ID):\s*(\d+)/i);
    if (libMatch) libraryId = libMatch[1];

    let pageName = 'Oferta Minerada';
    const linkHeaders = card.querySelectorAll('a[href*="facebook.com/"], a[role="link"], h4, h3, span[class*="x193iq5w"]');
    for (const h of linkHeaders) {
      const hText = (h.textContent || '').trim();
      if (hText && !hText.includes('Identificação') && !hText.includes('Veiculação') && !hText.includes('ID da') && hText.length > 2 && hText.length < 50) {
        pageName = hText;
        break;
      }
    }

    // 4. Link da Página de Vendas (CTA)
    let landingPage = '';
    const allLinks = card.querySelectorAll('a[href^="http"]');
    for (const l of allLinks) {
      const href = l.getAttribute('href') || '';
      if (!href.includes('facebook.com') && !href.includes('instagram.com') && !href.includes('meta.com')) {
        landingPage = href;
        break;
      }
    }

    // 5. Plataformas
    const platforms = [];
    const lowerText = text.toLowerCase();
    if (lowerText.includes('facebook')) platforms.push('Facebook');
    if (lowerText.includes('instagram')) platforms.push('Instagram');
    if (lowerText.includes('messenger')) platforms.push('Messenger');
    if (lowerText.includes('audience network')) platforms.push('Audience Network');

    return {
      name: pageName,
      libraryId: libraryId,
      pageId: libraryId || `meta_${Date.now()}`,
      adsCount: adsCount,
      daysRunning: daysRunning,
      dateStr: dateStr,
      landingPage: landingPage,
      libraryUrl: libraryId ? `https://www.facebook.com/ads/library/?id=${libraryId}` : window.location.href,
      platforms: platforms
    };
  }

  function parseMetaDate(dateStr) {
    if (!dateStr) return null;
    try {
      const matchPt = dateStr.match(/(\d+)\s+(?:de\s+)?([a-zA-ZçÇ]+)\.?\s+(?:de\s+)?(\d{4})/i);
      if (matchPt) {
        const day = parseInt(matchPt[1], 10);
        const monthKey = matchPt[2].toLowerCase().replace('.', '');
        const year = parseInt(matchPt[3], 10);
        if (PT_MONTHS[monthKey] !== undefined) {
          return new Date(year, PT_MONTHS[monthKey], day);
        }
      }

      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) return parsed;
    } catch (e) {}
    return null;
  }

  function injectCardBar(card, data) {
    if (card.querySelector('.minerai-card-injected-bar')) return;

    // Regra da borda dourada: apenas ofertas que estão há mais tempo rodando (>= 30 dias)
    const isWinner = data.daysRunning >= 30;
    if (isWinner) {
      card.classList.add('minerai-card-winner');
    } else {
      card.classList.remove('minerai-card-winner');
    }

    const bar = document.createElement('div');
    bar.className = 'minerai-card-injected-bar';

    // Rótulos limpos SEM EMOJIS conforme solicitado
    const daysLabel = data.daysRunning > 0 ? `Rodando há ${data.daysRunning} dias` : 'Recente';
    const adsLabel = `${data.adsCount} ${data.adsCount > 1 ? 'criativos' : 'criativo'}`;

    bar.innerHTML = `
      <div class="minerai-card-badges">
        <span class="minerai-badge neutral">
          <strong>${escapeHtml(adsLabel)}</strong>
        </span>
        <span class="minerai-badge ${isWinner ? 'gold-hot' : 'neutral'}">
          <strong>${escapeHtml(daysLabel)}</strong>
        </span>
      </div>
      <button class="minerai-capture-btn" title="Salvar oferta diretamente no Mineraí">
        <span>Minerar Oferta</span>
      </button>
    `;

    const captureBtn = bar.querySelector('.minerai-capture-btn');
    captureBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleMineOffer(captureBtn, data);
    });

    card.insertBefore(bar, card.firstChild);
  }

  // ============================================================================
  // 4. CAPTURA EM 1 CLIQUE & ENVIO PRO DASHBOARD / SUPABASE
  // ============================================================================

  async function handleMineOffer(btn, data) {
    if (!currentUser) {
      btn.className = 'minerai-capture-btn mined-error';
      btn.innerHTML = '<span>Faça login no Mineraí</span>';
      showToast('Por favor, faça login no Mineraí para salvar a oferta.');
      setTimeout(() => {
        btn.className = 'minerai-capture-btn';
        btn.innerHTML = '<span>Minerar Oferta</span>';
      }, 3000);
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span>Minerando...</span>';

    chrome.runtime.sendMessage(
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
  // 5. FILTROS & CONTAGEM DE RESULTADOS
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

      // Filtro por quantidade mínima de criativos (se > 0)
      if (minAds > 0 && adsCount < minAds) {
        matches = false;
      }

      // Filtro por tempo mínimo rodando em dias (se > 0)
      if (minDays > 0 && daysRunning < minDays) {
        matches = false;
      }

      // Se passou nos filtros, mantém visível; se não passou, esconde o card
      if (matches) {
        card.style.display = '';
        visibleCount++;
      } else {
        card.style.display = 'none';
      }
    });

    const counterDisplay = document.getElementById('minerai-counter-display');
    if (counterDisplay) {
      counterDisplay.textContent = `${visibleCount} de ${cards.length}`;
    }
  }

  function updateVisibleCount() {
    const cards = findAdCards();
    const visibleCards = cards.filter(c => c.style.display !== 'none');
    const counterDisplay = document.getElementById('minerai-counter-display');
    if (counterDisplay) {
      counterDisplay.textContent = `${visibleCards.length} de ${cards.length}`;
    }
  }

  // Toast de notificação na tela (sem emojis)
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
