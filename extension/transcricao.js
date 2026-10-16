// ==============================================================================
// MINERAÍ EXTENSÃO - TRANSCRIÇÃO DO CRIATIVO (service worker)
// ==============================================================================
// O "Baixar mídia" de um vídeo na Biblioteca pede TRANSCREVER. O service
// worker não segura nenhum pedido longo (o Chrome encerra pedidos de mais de
// 5 minutos e a primeira vez baixa o modelo):
//   1. TRANSCREVER: valida, descobre o idioma, entrega o trabalho ao
//      documento oculto (transcritor.js) e responde "aceito" na hora;
//   2. o documento oculto manda PROGRESSO (repassado para a aba) e, no fim,
//      MINERAI_TRANSCRICAO_FIM com o resultado;
//   3. FIM: monta o roteiro (transcricao-regras.js), baixa o .txt e avisa a
//      aba. Tudo que é preciso viaja na própria mensagem (`meta`).
//
// Usa de background.js: garantirEmpacotador, reservarNome, buscarBiblioteca.
// Design: docs/superpowers/specs/2026-10-13-transcricao-do-criativo-design.md
// ==============================================================================

const BIBLIOTECA_RE = /^https:\/\/((www|web)\.)?facebook\.com\/ads\/library|^https:\/\/ads\.meta\.com\/ads\/library/i;
const VIDEO_DA_META_RE = /^https:\/\/[a-z0-9.-]+\.(fbcdn\.net|cdninstagram\.com)\//i;
const NOME_DE_VIDEO_RE = /^[A-Za-z0-9_.-]{1,120}\.mp4$/;
const BOM = '\uFEFF'; // para o Bloco de Notas abrir os acentos certos

let transcricaoSeq = 0;

/**
 * Erros técnicos (em inglês, do Chrome ou do motor) viram uma frase simples.
 * Erro desconhecido leva um pedaço da mensagem original entre parênteses:
 * sem ele, o print do cliente não diz o que aconteceu.
 */
function erroLegivel(mensagem) {
  const m = String(mensagem || '');
  // Frases que o próprio transcritor já escreve em português.
  if (/baixar o vídeo|grande demais|demorou demais|motor do transcritor parou|falha ao transcrever/i.test(m)) return m;
  if (/memory|out of memory|allocation/i.test(m)) return 'faltou memória no computador. Feche algumas abas e tente de novo.';
  if (/message port closed|receiving end does not exist|could not establish connection/i.test(m)) {
    return 'o transcritor não respondeu. Atualize a página e tente de novo.';
  }
  if (/network|fetch|failed to fetch|load/i.test(m)) return 'a internet falhou ao baixar o transcritor. Tente de novo.';
  const detalhe = m
    .replace(/[a-z-]+:\/\/\S+/gi, '') // endereços (vídeo, arquivos da extensão) só ocupam espaço
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)
    .replace(/[\s.]+$/, '');
  return `algo deu errado no transcritor${detalhe ? ` (${detalhe})` : ''}. Tente de novo.`;
}

/** Texto do anúncio direto da Biblioteca (o do card vem misturado com os rótulos da página). */
async function textoDoAnuncio(libraryId) {
  if (!/^\d{6,}$/.test(String(libraryId || ''))) return '';
  try {
    const html = await buscarBiblioteca(`id=${libraryId}`);
    if (!html) return '';
    const at = html.indexOf(`"ad_archive_id":"${libraryId}"`);
    if (at < 0) return '';
    const m = html.slice(at, at + 20000).match(/"body":\{"text":("(?:[^"\\]|\\.)*")/);
    return m ? String(JSON.parse(m[1])).slice(0, 2000) : '';
  } catch (e) {
    return '';
  }
}

/** Baixa o roteiro como .txt pelo endereço data: (com o nome reservado). */
function baixarTexto(texto, nome) {
  const url = `data:text/plain;charset=utf-8,${encodeURIComponent(BOM + texto)}`;
  reservarNome(url, nome);
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename: nome, saveAs: false }, (id) => {
      if (chrome.runtime.lastError || id === undefined) {
        reject(new Error(chrome.runtime.lastError?.message || 'O Chrome recusou o download do roteiro.'));
        return;
      }
      resolve(id);
    });
  });
}

function avisarAba(tabId, status) {
  if (!Number.isInteger(tabId)) return;
  chrome.tabs.sendMessage(tabId, { type: 'MINERAI_TRANSCRICAO_STATUS', ...status }).catch(() => {});
}

async function concluirTranscricao(message) {
  const meta = message.meta || {};
  if (message.error || !message.data) {
    avisarAba(meta.tabId, { etapa: 'erro', erro: erroLegivel(message.error) });
    return;
  }
  const T = self.MineraiTranscricao;
  const roteiro = T.montarRoteiro(message.data);
  const texto = T.roteiroEmTexto(roteiro, { pagina: meta.pagina, dias: meta.dias, libraryId: meta.libraryId });
  const nome = T.nomeDoRoteiro(meta.nomeVideo);
  await baixarTexto(texto, nome);
  await guardarRoteiro({ nome, texto, pagina: meta.pagina, libraryId: meta.libraryId, dias: meta.dias, duracao: roteiro.duracao, temFala: roteiro.temFala, gancho: roteiro.gancho?.texto || '' });
  avisarAba(meta.tabId, { etapa: 'pronto', nome, temFala: roteiro.temFala });
}

// Roteiros guardados neste computador (aba "Roteiros" do Modelar no painel).
// Só os vídeos que a pessoa baixou; nunca vai para o banco.
const ROTEIROS_CHAVE = 'minerai_roteiros';

async function lerRoteiros() {
  const r = await chrome.storage.local.get(ROTEIROS_CHAVE);
  return Array.isArray(r[ROTEIROS_CHAVE]) ? r[ROTEIROS_CHAVE] : [];
}

async function guardarRoteiro(dados) {
  try {
    transcricaoSeq += 1;
    const novo = { ...dados, id: `r${Date.now().toString(36)}${transcricaoSeq}`, criadoEm: new Date().toISOString() };
    const lista = self.MineraiTranscricao.juntarRoteiro(await lerRoteiros(), novo);
    await chrome.storage.local.set({ [ROTEIROS_CHAVE]: lista });
  } catch (e) {
    // O .txt já foi baixado: não guardar a cópia não é motivo para falhar.
    console.warn('[Mineraí] Não deu para guardar o roteiro:', e && e.message);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return undefined;
  const doOffscreen = String(sender?.url || '') === chrome.runtime.getURL('offscreen.html');

  if (message.type === 'TRANSCREVER') {
    const daBiblioteca = Boolean(sender?.tab && BIBLIOTECA_RE.test(String(sender.url || '')));
    const url = String(message.url || '');
    if (!daBiblioteca || !VIDEO_DA_META_RE.test(url) || url.length > 4096) {
      sendResponse({ success: false, error: 'Pedido de transcrição não autorizado.' });
      return true;
    }
    transcricaoSeq += 1;
    const id = `t${Date.now().toString(36)}${transcricaoSeq}`;
    const nomeVideo = String(message.nomeVideo || '');
    const meta = {
      tabId: sender.tab.id,
      nomeVideo: NOME_DE_VIDEO_RE.test(nomeVideo) && !nomeVideo.includes('..') ? nomeVideo : `minerai_video_${Date.now()}.mp4`,
      libraryId: /^\d{1,30}$/.test(String(message.libraryId || '')) ? String(message.libraryId) : '',
      pagina: String(message.pagina || '').slice(0, 120),
      dias: Math.max(0, Math.min(100000, Number(message.dias) || 0))
    };
    (async () => {
      // Texto do anúncio pela Biblioteca + o do card (anúncio de catálogo vem
      // só com "{{product.brand}}"; os rótulos da página são ignorados).
      const texto = `${await textoDoAnuncio(meta.libraryId)} ${String(message.texto || '').slice(0, 2000)}`;
      const idioma = self.MineraiTranscricao.idiomaProvavel(texto, String(message.pais || '').slice(0, 3));
      await garantirEmpacotador();
      const resposta = await chrome.runtime.sendMessage({ alvo: 'offscreen', type: 'MINERAI_TRANSCREVER', id, url, idioma, meta });
      if (!resposta || !resposta.success) throw new Error((resposta && resposta.error) || 'não deu para começar.');
      return { success: true, aceito: true, naFila: Boolean(resposta.naFila) };
    })()
      .then(sendResponse)
      .catch((e) => sendResponse({ success: false, error: erroLegivel(e.message) }));
    return true;
  }

  // Painel: listar e apagar os roteiros guardados. Só do NOSSO painel.
  if (message.type === 'ROTEIROS_LISTAR' || message.type === 'ROTEIROS_APAGAR') {
    const doPainel = Boolean(sender?.url && DASHBOARD_URLS.some((base) => sender.url.startsWith(`${base}/`)));
    if (!doPainel) {
      sendResponse({ success: false, error: 'Origem não autorizada.' });
      return true;
    }
    (async () => {
      let lista = await lerRoteiros();
      if (message.type === 'ROTEIROS_APAGAR') {
        lista = lista.filter((r) => r && r.id !== String(message.id || ''));
        await chrome.storage.local.set({ [ROTEIROS_CHAVE]: lista });
      }
      return { success: true, roteiros: lista };
    })()
      .then(sendResponse)
      .catch((e) => sendResponse({ success: false, error: e.message }));
    return true;
  }

  // Andamento vindo do documento oculto: repassa para a aba da Biblioteca.
  if (message.type === 'MINERAI_TRANSCRICAO_PROGRESSO') {
    if (doOffscreen) {
      avisarAba(message.meta && message.meta.tabId, {
        etapa: String(message.etapa || ''),
        ...(Number.isFinite(message.pct) ? { pct: message.pct } : {})
      });
    }
    return undefined;
  }

  // Fim do trabalho: roteiro, download e aviso para a aba.
  if (message.type === 'MINERAI_TRANSCRICAO_FIM') {
    if (doOffscreen) {
      concluirTranscricao(message).catch((e) => {
        avisarAba(message.meta && message.meta.tabId, { etapa: 'erro', erro: erroLegivel(e.message) });
      });
    }
    return undefined;
  }

  return undefined;
});
