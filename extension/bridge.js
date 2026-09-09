// ==============================================================================
// MINERAÍ EXTENSÃO - BRIDGE DE AUTENTICAÇÃO COM O DASHBOARD
// Sincroniza a sessão do Mineraí com a extensão automaticamente
// ==============================================================================

(function () {
  'use strict';

  let syncInterval = null;

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

  // 1. Sincronizar sessão atual do localStorage
  syncSession();

  function syncSession() {
    try {
      // Procura dados do usuário no localStorage do Mineraí / Supabase
      const storedUser = localStorage.getItem('minerai_user');
      let user = null;
      if (storedUser) {
        try { user = JSON.parse(storedUser); } catch (e) {}
      }

      // Procura token do Supabase no localStorage
      let session = null;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('sb-') && key.endsWith('-auth-token'))) {
          try {
            const parsed = JSON.parse(localStorage.getItem(key));
            if (parsed && (parsed.access_token || parsed.user)) {
              session = parsed;
              if (!user && parsed.user) {
                user = {
                  id: parsed.user.id,
                  name: parsed.user.user_metadata?.name || parsed.user.email?.split('@')[0],
                  email: parsed.user.email
                };
              }
            }
          } catch (e) {}
        }
      }

      if (user) {
        safeSendMessage({
          type: 'SET_AUTH_USER',
          user: user,
          session: session
        });
      }
    } catch (err) {
      // Ignorar erros de parse se contexto fechado
    }
  }

  // 2. Ouvir eventos disparados pelo dashboard
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'MINERAI_SYNC_AUTH') {
      const user = event.data.user;
      safeSendMessage({
        type: 'SET_AUTH_USER',
        user: user,
        session: event.data.session || null
      });
    }
  });

  // 3. O painel não consegue baixar página de terceiro (o navegador bloqueia
  //    por segurança). Ele pede aqui, e quem executa é a extensão.
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const dado = event.data;
    if (!dado || dado.type !== 'MINERAI_MODELAR') return;

    const responder = (payload) => {
      window.postMessage({ type: 'MINERAI_MODELAR_RESULTADO', id: dado.id, ...payload }, '*');
    };

    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
      responder({ success: false, error: 'EXTENSAO_AUSENTE' });
      return;
    }

    try {
      chrome.runtime.sendMessage({ type: 'MODELAR_PAGINA', url: dado.url }, (resposta) => {
        if (chrome.runtime?.lastError) {
          responder({ success: false, error: 'EXTENSAO_AUSENTE' });
          return;
        }
        responder(resposta || { success: false, error: 'Sem resposta da extensão.' });
      });
    } catch (e) {
      responder({ success: false, error: 'EXTENSAO_AUSENTE' });
    }
  });

  // 4. Deixa o painel saber que a extensão está instalada.
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== 'MINERAI_PING') return;
    window.postMessage({ type: 'MINERAI_PONG', versao: chrome?.runtime?.getManifest?.().version }, '*');
  });

  // Re-sincronizar periodicamente enquanto o dashboard estiver aberto
  syncInterval = setInterval(syncSession, 6000);
})();
