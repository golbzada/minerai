// ==============================================================================
// MINERAÍ EXTENSÃO - BRIDGE DE AUTENTICAÇÃO COM O DASHBOARD
// Sincroniza a sessão do Mineraí com a extensão automaticamente.
//
// Segurança: este script roda SÓ no domínio do painel (ver manifest.json).
// Toda mensagem aceita precisa vir da própria janela (event.source === window):
// um iframe ou uma aba aberta por terceiro não consegue plantar sessão aqui.
// ==============================================================================

(function () {
  'use strict';

  let syncInterval = null;
  let lastSyncKey = '';

  // O painel espera este sinal antes de ligar o Supabase (ver
  // src/utils/extensaoSessao.js): assim ele já nasce com a sessão mais nova.
  const raiz = document.documentElement;
  if (raiz) raiz.dataset.mineraiSessao = 'aguardando';

  function chaveDaSessao() {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) return key;
    }
    return null;
  }

  // Cópia da sessão da extensão, lida direto do chrome.storage (sem acordar o
  // service worker) e mantida em dia pelo onChanged.
  let sessaoExtensao = null;

  /**
   * Se a extensão renovou o login enquanto o painel estava fechado (ou parado
   * numa aba esquecida), a sessão dela é a válida: grava no localStorage do
   * painel, que o supabase-js lê a cada uso. Sem isso o painel tentaria o
   * refresh_token antigo e o Supabase deslogaria os dois. Síncrono de
   * propósito: roda dentro do visibilitychange, antes do supabase-js.
   */
  function entregarSessaoAoPainel() {
    try {
      if (!sessaoExtensao || !self.MineraiSessao) return;
      const key = chaveDaSessao();
      const painel = key ? JSON.parse(localStorage.getItem(key)) : null;
      if (self.MineraiSessao.compararSessoes(painel, sessaoExtensao) === 'extensao') {
        const nova = self.MineraiSessao.mesclarSessao(painel, sessaoExtensao.session, Date.now() / 1000);
        localStorage.setItem(key, JSON.stringify(nova));
      }
    } catch (e) {}
  }

  function lerSessaoDaExtensao(depois) {
    try {
      chrome.storage.local.get(['minerai_user', 'minerai_session'], (r) => {
        sessaoExtensao = { user: (r && r.minerai_user) || null, session: (r && r.minerai_session) || null };
        depois();
      });
    } catch (e) {
      depois();
    }
  }

  try {
    chrome.storage.onChanged.addListener((mudancas, area) => {
      if (area !== 'local' || !sessaoExtensao) return;
      if (mudancas.minerai_user) sessaoExtensao.user = mudancas.minerai_user.newValue || null;
      if (mudancas.minerai_session) sessaoExtensao.session = mudancas.minerai_session.newValue || null;
      entregarSessaoAoPainel();
    });
  } catch (e) {}

  // Aba que estava escondida voltando: o supabase-js renova a sessão nesse
  // instante. Na captura, este ouvinte roda antes e entrega a sessão nova.
  window.addEventListener('visibilitychange', entregarSessaoAoPainel, true);

  function safeSendMessage(payload) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
      if (syncInterval) clearInterval(syncInterval);
      return;
    }
    try {
      chrome.runtime.sendMessage(payload, () => {
        if (chrome.runtime?.lastError) {
          // Extension context might be reloaded
        }
      });
    } catch (e) {
      if (syncInterval) clearInterval(syncInterval);
    }
  }

  /** Só o que a extensão precisa saber sobre a pessoa logada. */
  function publicUser(source) {
    if (!source || typeof source !== 'object' || !source.id) return null;
    return {
      id: String(source.id),
      name: typeof source.name === 'string' ? source.name.slice(0, 120) : '',
      email: typeof source.email === 'string' ? source.email.slice(0, 254) : ''
    };
  }

  // 1. Sincronizar a sessão do Supabase guardada pelo painel neste domínio.
  //    O refresh_token vai junto de propósito: o access_token vence em 1 hora
  //    e a extensão precisa renová-lo para continuar salvando ofertas.
  function syncSession() {
    try {
      let user = null;
      const storedUser = localStorage.getItem('minerai_user');
      if (storedUser) {
        try { user = publicUser(JSON.parse(storedUser)); } catch (e) {}
      }

      let session = null;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
          try {
            const parsed = JSON.parse(localStorage.getItem(key));
            if (parsed && parsed.access_token) {
              session = {
                access_token: parsed.access_token,
                refresh_token: parsed.refresh_token || null,
                expires_at: parsed.expires_at || null
              };
              if (!user && parsed.user) {
                user = publicUser({
                  id: parsed.user.id,
                  name: parsed.user.user_metadata?.name || parsed.user.email?.split('@')[0],
                  email: parsed.user.email
                });
              }
            }
          } catch (e) {}
        }
      }

      // Sem sessão no painel = pessoa saiu. Avisa a extensão para esquecer também.
      if (!session) {
        if (lastSyncKey !== 'logged-out') {
          lastSyncKey = 'logged-out';
          safeSendMessage({ type: 'CLEAR_AUTH_USER' });
        }
        return;
      }

      if (user) {
        // Só reenvia quando algo mudou (token renovado, outra conta).
        const syncKey = `${user.id}:${session.access_token.slice(-16)}`;
        if (syncKey === lastSyncKey) return;
        lastSyncKey = syncKey;
        safeSendMessage({ type: 'SET_AUTH_USER', user, session });
      }
    } catch (err) {
      // Ignorar erros de parse se contexto fechado
    }
  }

  // Primeiro recebe a sessão da extensão (se for mais nova), depois avisa a
  // extensão do que ficou no painel.
  lerSessaoDaExtensao(() => {
    entregarSessaoAoPainel();
    if (raiz) raiz.dataset.mineraiSessao = 'pronta';
    syncSession();
  });

  /**
   * Toda mensagem aceita precisa ter sido postada por esta mesma janela, nesta
   * mesma origem. Um iframe embutido, uma aba aberta por terceiro ou um site
   * qualquer não passam daqui. A checagem de origem fica repetida em cada
   * ouvinte de propósito, para ser visível (e auditável) no próprio handler.
   */
  function mensagemDoPainel(event) {
    if (event.origin !== window.location.origin) return false;
    if (event.source !== window) return false;
    return Boolean(event.data && typeof event.data === 'object');
  }

  // 2. Ouvir eventos disparados pelo dashboard (mesma janela, mesma origem).
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || !mensagemDoPainel(event)) return;
    if (event.data.type !== 'MINERAI_SYNC_AUTH') return;
    // O painel só manda o usuário; a sessão é lida do localStorage do domínio.
    lastSyncKey = '';
    syncSession();
  });

  // 3. O painel não consegue baixar página de terceiro (o navegador bloqueia
  //    por segurança). Ele pede aqui, e quem executa é a extensão.
  /** Devolve ao painel o resultado da captura, sempre na origem do painel. */
  function responderModelar(id, payload) {
    window.postMessage(
      { type: 'MINERAI_MODELAR_RESULTADO', id, ...payload },
      window.location.origin
    );
  }

  /** Repassa o pedido ao background e traduz "extensão sumiu" para o painel. */
  function encaminharModelar(id, url) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
      responderModelar(id, { success: false, error: 'EXTENSAO_AUSENTE' });
      return;
    }

    function aoResponder(resposta) {
      if (chrome.runtime?.lastError) {
        responderModelar(id, { success: false, error: 'EXTENSAO_AUSENTE' });
        return;
      }
      responderModelar(id, resposta || { success: false, error: 'Sem resposta da extensão.' });
    }

    try {
      chrome.runtime.sendMessage({ type: 'MODELAR_PAGINA', url }, aoResponder);
    } catch (e) {
      responderModelar(id, { success: false, error: 'EXTENSAO_AUSENTE' });
    }
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (!mensagemDoPainel(event)) return;
    const dado = event.data;
    if (dado.type !== 'MINERAI_MODELAR') return;
    encaminharModelar(dado.id, String(dado.url || ''));
  });

  // 4. Deixa o painel saber que a extensão está instalada.
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || !mensagemDoPainel(event)) return;
    if (event.data.type !== 'MINERAI_PING') return;
    window.postMessage(
      { type: 'MINERAI_PONG', versao: chrome?.runtime?.getManifest?.().version },
      window.location.origin
    );
  });

  // 4. Radar do nicho: o painel lista/salva buscas e pede "rodar agora".
  //    Só passam tipos RADAR_*; qualquer outro pedido é recusado aqui.
  const RADAR_PERMITIDOS = ['RADAR_LISTAR', 'RADAR_SALVAR_BUSCAS', 'RADAR_RODAR'];

  function responderRadar(id, resposta) {
    window.postMessage({ type: 'MINERAI_RADAR_RESPOSTA', id, resposta }, window.location.origin);
  }

  /** Repassa ao background só pedidos RADAR_* e devolve a resposta ao painel. */
  function encaminharRadar(id, pedidoBruto) {
    const pedido = pedidoBruto && typeof pedidoBruto === 'object' ? pedidoBruto : {};
    if (!RADAR_PERMITIDOS.includes(pedido.type)) {
      responderRadar(id, { success: false, error: 'Pedido não permitido.' });
      return;
    }
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
      responderRadar(id, { success: false, error: 'EXTENSAO_AUSENTE' });
      return;
    }
    const mensagem = pedido.type === 'RADAR_SALVAR_BUSCAS'
      ? { type: pedido.type, buscas: Array.isArray(pedido.buscas) ? pedido.buscas.slice(0, 20) : [] }
      : { type: pedido.type };
    try {
      chrome.runtime.sendMessage(mensagem, (resposta) => {
        if (chrome.runtime?.lastError) {
          responderRadar(id, { success: false, error: 'EXTENSAO_AUSENTE' });
          return;
        }
        responderRadar(id, resposta || { success: false });
      });
    } catch (e) {
      responderRadar(id, { success: false, error: 'EXTENSAO_AUSENTE' });
    }
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (!mensagemDoPainel(event)) return;
    const dado = event.data;
    if (dado.type !== 'MINERAI_RADAR') return;
    encaminharRadar(dado.id, dado.pedido);
  });

  // Re-sincronizar periodicamente enquanto o dashboard estiver aberto
  syncInterval = setInterval(syncSession, 6000);
})();
