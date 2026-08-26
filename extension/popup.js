// ==============================================================================
// MINERAÍ EXTENSÃO - POPUP CONTROLLER
// ==============================================================================

document.addEventListener('DOMContentLoaded', () => {
  const loadingEl = document.getElementById('status-loading');
  const onlineEl = document.getElementById('status-online');
  const offlineEl = document.getElementById('status-offline');
  const nameEl = document.getElementById('user-display-name');
  const emailEl = document.getElementById('user-display-email');
  const btnOpenDash = document.getElementById('btn-open-dash');
  const btnOpenMeta = document.getElementById('btn-open-meta');

  // 1. Checar status do usuário
  chrome.runtime.sendMessage({ type: 'CHECK_AUTH' }, (response) => {
    loadingEl.style.display = 'none';
    if (response && response.authenticated && response.user) {
      const user = response.user;
      nameEl.textContent = user.name || user.email?.split('@')[0] || 'Minerador';
      emailEl.textContent = user.email || '';
      onlineEl.style.display = 'flex';
      offlineEl.style.display = 'none';
    } else {
      onlineEl.style.display = 'none';
      offlineEl.style.display = 'flex';
    }
  });

  // 2. Abrir Dashboard
  btnOpenDash.addEventListener('click', () => {
    chrome.tabs.create({ url: 'http://localhost:5173' });
  });

  // 3. Abrir Biblioteca de Anúncios Meta
  btnOpenMeta.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.facebook.com/ads/library' });
  });
});
