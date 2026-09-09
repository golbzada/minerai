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
  // Desconectado, o botão principal vira "Conectar conta" — antes ele dizia
  // só "Abrir Painel" e não ficava claro que era ali que se entrava.
  function pintarEstado(conectado) {
    loadingEl.style.display = 'none';
    onlineEl.style.display = conectado ? 'flex' : 'none';
    offlineEl.style.display = conectado ? 'none' : 'flex';
    btnOpenDash.innerHTML = conectado
      ? '<span>🚀 Abrir Painel Mineraí</span>'
      : '<span>🔑 Conectar conta</span>';
  }

  function conferirLogin() {
    chrome.runtime.sendMessage({ type: 'CHECK_AUTH' }, (response) => {
      if (chrome.runtime.lastError) return;
      const conectado = Boolean(response && response.authenticated && response.user);
      if (conectado) {
        const user = response.user;
        nameEl.textContent = user.name || user.email?.split('@')[0] || 'Minerador';
        emailEl.textContent = user.email || '';
      }
      pintarEstado(conectado);
    });
  }

  conferirLogin();

  // Enquanto o popup está aberto, reconfere: se a pessoa acabou de logar
  // em outra aba, o estado aqui se corrige sozinho.
  setInterval(conferirLogin, 2500);

  // Nosso painel. Não trocar por minerarads.com.br — aquele domínio é de outro
  // produto e mandava o cliente logar na conta errada.
  const OFFICIAL_DASHBOARD_URL = 'https://mineraiofertas.vercel.app';

  // 2. Abrir Dashboard
  btnOpenDash.addEventListener('click', () => {
    chrome.tabs.create({ url: OFFICIAL_DASHBOARD_URL });
  });

  // 3. Abrir Biblioteca de Anúncios Meta
  btnOpenMeta.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.facebook.com/ads/library' });
  });

  // 4. Modelar página
  // O pedido de permissão precisa sair de uma página da extensão com clique
  // do usuário — por isso ele mora aqui no popup, e não no background.
  const inputUrl = document.getElementById('modelar-url');
  const btnModelar = document.getElementById('btn-modelar');
  const aviso = document.getElementById('modelar-aviso');

  function mostrar(texto, tipo) {
    aviso.textContent = texto;
    aviso.className = 'modelar-aviso' + (tipo ? ' ' + tipo : '');
  }

  function ocupado(estado, texto) {
    btnModelar.disabled = estado;
    btnModelar.innerHTML = `<span>${texto}</span>`;
  }

  async function modelar() {
    const url = inputUrl.value.trim();
    if (!url) {
      mostrar('Cole o endereço da página primeiro.', 'erro');
      return;
    }

    let origem;
    try {
      const alvo = new URL(url.startsWith('http') ? url : `https://${url}`);
      inputUrl.value = alvo.href;
      origem = `${alvo.origin}/*`;
    } catch (e) {
      mostrar('Endereço inválido. Exemplo: https://site.com.br/pagina', 'erro');
      return;
    }

    ocupado(true, '⏳ Abrindo a página...');
    mostrar('Carregando e capturando. Pode levar alguns segundos.');

    try {
      const jaTem = await chrome.permissions.contains({ origins: [origem] });
      if (!jaTem) {
        mostrar('O Chrome vai pedir autorização para ler esta página.');
        const concedida = await chrome.permissions.request({ origins: [origem] });
        if (!concedida) {
          mostrar('Sem a autorização não dá para ler a página.', 'erro');
          ocupado(false, '📐 Baixar estrutura');
          return;
        }
      }

      ocupado(true, '⏳ Capturando...');

      const resposta = await chrome.runtime.sendMessage({
        type: 'MODELAR_PAGINA',
        url: inputUrl.value
      });

      if (resposta && resposta.success) {
        const d = resposta.data;
        mostrar(
          `Pronto! Salvo em Downloads/${d.pasta} — página de ${d.tamanhoHtmlKb} KB, ` +
          `${d.folhasInternas + d.folhasExternas} folhas de estilo e ${d.cores} cores no design system.`,
          'ok'
        );
      } else {
        mostrar(resposta?.error || 'Não foi possível capturar a página.', 'erro');
      }
    } catch (e) {
      mostrar(e.message || 'Falha inesperada ao capturar.', 'erro');
    } finally {
      ocupado(false, '📐 Baixar estrutura');
    }
  }

  btnModelar.addEventListener('click', modelar);
  inputUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') modelar();
  });

  // Autorização geral. O painel do site não pode pedir permissão ao Chrome —
  // só uma página da extensão pode. Concedendo aqui uma vez, o botão Modelar
  // lá no painel passa a funcionar direto, em qualquer domínio.
  const btnAutorizar = document.getElementById('btn-autorizar');
  const TODOS_OS_SITES = { origins: ['http://*/*', 'https://*/*'] };

  async function revisarAutorizacao() {
    const liberado = await chrome.permissions.contains(TODOS_OS_SITES);
    btnAutorizar.style.display = liberado ? 'none' : 'flex';
    if (liberado && !aviso.textContent) {
      mostrar('Modelagem liberada — dá para usar direto pelo painel.', 'ok');
    }
  }

  btnAutorizar.addEventListener('click', async () => {
    try {
      const concedida = await chrome.permissions.request(TODOS_OS_SITES);
      if (concedida) {
        mostrar('Liberado! Agora o botão Modelar do painel funciona direto.', 'ok');
      } else {
        mostrar('Sem a autorização, dá para modelar só por aqui, um site por vez.');
      }
    } catch (e) {
      mostrar(e.message || 'Não foi possível pedir a autorização.', 'erro');
    }
    revisarAutorizacao();
  });

  revisarAutorizacao();
});
