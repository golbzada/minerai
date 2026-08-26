// ==============================================================================
// MINERAÍ EXTENSÃO - BRIDGE DE AUTENTICAÇÃO COM O DASHBOARD
// Sincroniza a sessão do Mineraí com a extensão automaticamente
// ==============================================================================

(function () {
  'use strict';

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
        chrome.runtime.sendMessage({
          type: 'SET_AUTH_USER',
          user: user,
          session: session
        });
      }
    } catch (err) {
      console.warn('[Mineraí Bridge] Erro ao sincronizar sessão:', err);
    }
  }

  // 2. Ouvir eventos disparados pelo dashboard
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'MINERAI_SYNC_AUTH') {
      const user = event.data.user;
      chrome.runtime.sendMessage({
        type: 'SET_AUTH_USER',
        user: user,
        session: event.data.session || null
      });
    }
  });

  // Re-sincronizar periodicamente enquanto o dashboard estiver aberto
  setInterval(syncSession, 5000);
})();
