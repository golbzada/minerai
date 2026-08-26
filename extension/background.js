// ==============================================================================
// MINERAÍ EXTENSÃO - BACKGROUND SERVICE WORKER (MANIFEST V3)
// ==============================================================================

const SUPABASE_URL = 'https://vqqzpkdxyaowqxdfshex.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6uR1O7oSEjl_6Zyh_pHoUQ_uY5LnN7_';

// Obter usuário e sessão armazenados
async function getCurrentUser() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['minerai_user', 'minerai_session'], (result) => {
      resolve({
        user: result.minerai_user || null,
        session: result.minerai_session || null
      });
    });
  });
}

// Salvar dados do usuário e sessão na extensão
async function setStoredUser(user, session) {
  return new Promise((resolve) => {
    chrome.storage.local.set({
      minerai_user: user,
      minerai_session: session
    }, () => resolve());
  });
}

// Verificar status de autenticação (exige access_token válido)
async function checkAuthStatus() {
  const { user, session } = await getCurrentUser();
  if (user && session?.access_token) {
    return { authenticated: true, user };
  }

  // Tenta verificar se há sessão salva em cookies (localhost ou produção)
  try {
    const origins = [
      'http://localhost:5173',
      'https://app.minerarads.com.br',
      'https://minerarads.com.br'
    ];

    for (const origin of origins) {
      const cookies = await chrome.cookies.getAll({ url: origin });
      const authCookie = cookies.find(c => c.name.includes('supabase') || c.name.includes('auth') || c.name === 'minerai_user');
      if (authCookie) {
        try {
          const parsed = JSON.parse(decodeURIComponent(authCookie.value));
          if (parsed && (parsed.access_token || parsed.currentSession?.access_token)) {
            const token = parsed.access_token || parsed.currentSession?.access_token;
            const userData = parsed.user || parsed;
            const sessionData = { access_token: token };
            await setStoredUser(userData, sessionData);
            return { authenticated: true, user: userData };
          }
        } catch (e) {}
      }
    }
  } catch (err) {
    console.error('Erro ao verificar autenticação:', err);
  }

  return { authenticated: false, user: null };
}

// Salvar oferta capturada no Supabase com validação estrita de token RLS
async function saveCapturedOffer(offerData) {
  const { user, session } = await getCurrentUser();
  
  // Validação de segurança: Bloqueia sem access_token de sessão válido
  if (!user || !user.id || !session?.access_token) {
    throw new Error('Sessão expirada. Faça login novamente no Mineraí para minerar.');
  }

  const userId = user.id;
  const token = session.access_token;

  // 1. Obter a aba "Geral" do usuário autenticado
  let tabId = null;
  try {
    const tabsRes = await fetch(`${SUPABASE_URL}/rest/v1/tabs?user_id=eq.${userId}&name=eq.Geral&select=id`, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    if (tabsRes.ok) {
      const tabs = await tabsRes.json();
      if (tabs && tabs.length > 0) {
        tabId = tabs[0].id;
      }
    }
  } catch (e) {
    console.warn('Não foi possível obter tab_id padrão:', e);
  }

  // Se não encontrou a aba "Geral", busca a primeira aba do usuário
  if (!tabId) {
    try {
      const tabsRes = await fetch(`${SUPABASE_URL}/rest/v1/tabs?user_id=eq.${userId}&select=id&limit=1`, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${token}`
        }
      });
      if (tabsRes.ok) {
        const tabs = await tabsRes.json();
        if (tabs && tabs.length > 0) tabId = tabs[0].id;
      }
    } catch (e) {}
  }

  // 2. Montar objeto da oferta compatível com o schema do Mineraí
  const payload = {
    user_id: userId,
    tab_id: tabId,
    name: offerData.name || 'Oferta Minerada',
    page_id: String(offerData.pageId || offerData.libraryId || `page_${Date.now()}`),
    ads_count: parseInt(offerData.adsCount, 10) || 1,
    library_url: offerData.libraryUrl || '',
    landing_page: offerData.landingPage || '',
    affiliate_link: '',
    funnel_notes: offerData.notes || `Capturado via Mineraí Extensão. Dias rodando: ${offerData.daysRunning || 'N/A'}. Plataformas: ${offerData.platforms?.join(', ') || 'Todas'}.`,
    status: 'testing',
    niche: 'Geral',
    avatar_url: offerData.avatarUrl || null,
    history: [
      {
        date: new Date().toISOString(),
        ads_count: parseInt(offerData.adsCount, 10) || 1
      }
    ],
    updated_at: new Date().toISOString()
  };

  // 3. Inserir no Supabase via REST API autenticada com RLS
  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/offers`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(payload)
  });

  if (!insertRes.ok) {
    const errorText = await insertRes.text();
    console.error('Erro ao inserir oferta no Supabase:', errorText);
    if (insertRes.status === 401 || insertRes.status === 403) {
      throw new Error('Sessão expirada. Faça login novamente no Mineraí.');
    }
    throw new Error('Falha ao salvar no banco de dados Mineraí.');
  }

  const saved = await insertRes.json();
  return { success: true, offer: saved[0] || payload };
}

// Ouvir mensagens dos content scripts e popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECK_AUTH') {
    checkAuthStatus().then(sendResponse);
    return true;
  }

  if (message.type === 'SET_AUTH_USER') {
    setStoredUser(message.user, message.session).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'SAVE_OFFER') {
    saveCapturedOffer(message.offer)
      .then(res => sendResponse({ success: true, data: res }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'OPEN_DASHBOARD') {
    chrome.tabs.create({ url: message.url || 'http://localhost:5173' });
    sendResponse({ success: true });
    return true;
  }
});
