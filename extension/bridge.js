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

  syncSession();

  // 2. Ouvir eventos disparados pelo dashboard (mesma janela, mesma origem).
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (!event.data || event.data.type !== 'MINERAI_SYNC_AUTH') return;
    // O painel só manda o usuário; a sessão é lida do localStorage do domínio.
    lastSyncKey = '';
    syncSession();
  });

  // 3. O painel não consegue baixar página de terceiro (o navegador bloqueia
  //    por segurança). Ele pede aqui, e quem executa é a extensão.
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const dado = event.data;
    if (!dado || dado.type !== 'MINERAI_MODELAR') return;

    const responder = (payload) => {
      window.postMessage({ type: 'MINERAI_MODELAR_RESULTADO', id: dado.id, ...payload }, window.location.origin);
    };

    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
      responder({ success: false, error: 'EXTENSAO_AUSENTE' });
      return;
    }

    try {
      chrome.runtime.sendMessage({ type: 'MODELAR_PAGINA', url: String(dado.url || '') }, (resposta) => {
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
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (!event.data || event.data.type !== 'MINERAI_PING') return;
    window.postMessage(
      { type: 'MINERAI_PONG', versao: chrome?.runtime?.getManifest?.().version },
      window.location.origin
    );
  });

  // Re-sincronizar periodicamente enquanto o dashboard estiver aberto
  syncInterval = setInterval(syncSession, 6000);
})();
