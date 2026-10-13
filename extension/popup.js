// ==============================================================================
// MINERAÍ EXTENSÃO - POPUP CONTROLLER
// ==============================================================================

// Ícones de linha, os mesmos do painel e da barra na Biblioteca. Substituem
// os emojis: emoji muda de cara em cada sistema e destoa da identidade.
const ICON_PATHS = {
  painel: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  biblioteca: 'M4 5h16v14H4zM8 9h8M8 13h5',
  externo: 'M14 4h6v6M20 4l-9 9M19 13v6H5V5h6',
  modelar: 'M4 5h16v14H4zM4 10h16M9 10v9',
  link: 'M10 14a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 0 0-5.66-5.66L11.5 6.8M14 10a4 4 0 0 0-5.66 0l-2.83 2.83a4 4 0 0 0 5.66 5.66l1.33-1.3',
  baixar: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  chave: 'M15 7a4 4 0 1 1-3.5 6L5 19.5V22h2.5v-2H10v-2.5l1.5-1.5A4 4 0 0 1 15 7zM16 8h.01',
  cadeado: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  entrar: 'M10 17l5-5-5-5M15 12H3M14 4h6v16h-6',
  relogio: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  check: 'M5 12l4 4L19 6',
  refazer: 'M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5',
  radar: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12l6-6'
};

function icon(name, size = 16) {
  const d = ICON_PATHS[name] || ICON_PATHS.painel;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
}

/** Conteúdo padrão de botão: ícone + texto. */
function rotulo(nomeIcone, texto) {
  return `<span class="btn-ico">${icon(nomeIcone)}</span><span class="btn-label">${texto}</span>`;
}

document.addEventListener('DOMContentLoaded', () => {
  // Desenha os ícones marcados no HTML com data-icon.
  document.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 16);
  });

  const versao = document.getElementById('versao');
  try {
    versao.textContent = `v${chrome.runtime.getManifest().version}`;
  } catch (e) {
    versao.style.display = 'none';
  }

  const loadingEl = document.getElementById('status-loading');
  const onlineEl = document.getElementById('status-online');
  const offlineEl = document.getElementById('status-offline');
  const nameEl = document.getElementById('user-display-name');
  const btnOpenDash = document.getElementById('btn-open-dash');
  const btnOpenMeta = document.getElementById('btn-open-meta');

  // 1. Checar status do usuário
  // Desconectado, o botão principal vira "Conectar conta" — antes ele dizia
  // só "Abrir Painel" e não ficava claro que era ali que se entrava.
  function pintarEstado(conectado) {
    loadingEl.style.display = 'none';
    document.getElementById('user-status-card').dataset.estado = conectado ? 'on' : 'off';
    rastreioEl.style.display = conectado ? 'flex' : 'none';
    if (conectado) conferirRastreio();
    onlineEl.style.display = conectado ? 'flex' : 'none';
    offlineEl.style.display = conectado ? 'none' : 'flex';
    btnOpenDash.innerHTML = conectado ? rotulo('painel', 'Abrir painel') : rotulo('entrar', 'Conectar conta');
  }

  function conferirLogin() {
    chrome.runtime.sendMessage({ type: 'CHECK_AUTH' }, (response) => {
      if (chrome.runtime.lastError) return;
      const conectado = Boolean(response && response.authenticated && response.user);
      if (conectado) {
        const user = response.user;
        const nome = user.name || user.email?.split('@')[0] || 'Minerador';
        nameEl.textContent = nome;
        // O e-mail fica no passar do mouse: na tela, só o nome.
        onlineEl.title = user.email || '';
      }
      pintarEstado(conectado);
    });
  }

  // Rastreio diário: estado, "Rodar agora" e liga/desliga.
  const rastreioEl = document.getElementById('rastreio');
  const rastreioTexto = document.getElementById('rastreio-texto');
  const rastreioRodar = document.getElementById('rastreio-rodar');
  const rastreioLigado = document.getElementById('rastreio-ligado');

  function hojeLocal() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function conferirRastreio() {
    chrome.runtime.sendMessage({ type: 'RASTREIO_STATUS' }, (resposta) => {
      if (chrome.runtime.lastError || !resposta?.success) return;
      const estado = resposta.estado || {};
      rastreioLigado.checked = estado.ligado !== false;
      rastreioTexto.textContent = self.MineraiRastreio.resumoDoRastreio(estado, resposta.rodando, hojeLocal());
      rastreioRodar.disabled = self.MineraiRastreio.estaMedindo(estado, resposta.rodando, hojeLocal());
    });
  }

  rastreioRodar.addEventListener('click', () => {
    rastreioRodar.disabled = true;
    rastreioTexto.textContent = 'Começando...';
    chrome.runtime.sendMessage({ type: 'RASTREIO_RODAR' }, () => setTimeout(conferirRastreio, 800));
  });

  rastreioLigado.addEventListener('change', () => {
    chrome.runtime.sendMessage({ type: 'RASTREIO_LIGAR', ligado: rastreioLigado.checked }, conferirRastreio);
  });

  conferirLogin();

  // Enquanto o popup está aberto, reconfere: se a pessoa acabou de logar
  // em outra aba, o estado aqui se corrige sozinho.
  setInterval(() => {
    conferirLogin();
    conferirRastreio();
  }, 2500);

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

  function ocupado(estado, texto, nomeIcone) {
    btnModelar.disabled = estado;
    btnModelar.innerHTML = rotulo(nomeIcone || (estado ? 'relogio' : 'baixar'), texto);
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

    ocupado(true, 'Abrindo a página...');
    mostrar('Carregando e capturando. Pode levar alguns segundos.');

    try {
      const jaTem = await chrome.permissions.contains({ origins: [origem] });
      if (!jaTem) {
        mostrar('O Chrome vai pedir autorização para ler esta página.');
        const concedida = await chrome.permissions.request({ origins: [origem] });
        if (!concedida) {
          mostrar('Sem a autorização não dá para ler a página.', 'erro');
          ocupado(false, 'Baixar página');
          return;
        }
      }

      ocupado(true, 'Capturando...');

      const resposta = await chrome.runtime.sendMessage({
        type: 'MODELAR_PAGINA',
        url: inputUrl.value
      });

      if (resposta && resposta.success) {
        const d = resposta.data;
        mostrar(
          `Pronto! Salvo em Downloads/${d.pasta}: ${d.secoes || 0} seções, ${d.imagens || 0} imagens, ` +
          `${d.videos || 0} vídeos e ${d.fontes || 0} fontes. Abra o PROMPT.md para modelar.`,
          'ok'
        );
      } else {
        mostrar(resposta?.error || 'Não foi possível capturar a página.', 'erro');
      }
    } catch (e) {
      mostrar(e.message || 'Falha inesperada ao capturar.', 'erro');
    } finally {
      ocupado(false, 'Baixar página');
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
      mostrar('Modelagem liberada: dá para usar direto pelo painel.', 'ok');
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
