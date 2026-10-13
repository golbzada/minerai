// ==============================================================================
// MINERAÍ EXTENSÃO - TRANSCRIÇÃO DO CRIATIVO (service worker)
// ==============================================================================
// O "Baixar mídia" de um vídeo na Biblioteca pede TRANSCREVER. Aqui: escolhe o
// idioma, manda o documento oculto (transcritor.js) ouvir o vídeo, monta o
// roteiro (transcricao-regras.js) e baixa o .txt ao lado do vídeo. O
// andamento vai para a aba que pediu (a barra mostra "preparando...").
//
// Usa de background.js: garantirEmpacotador e nomePendente.
// Design: docs/superpowers/specs/2026-10-13-transcricao-do-criativo-design.md
// ==============================================================================

const BIBLIOTECA_RE = /^https:\/\/((www|web)\.)?facebook\.com\/ads\/library|^https:\/\/ads\.meta\.com\/ads\/library/i;
const VIDEO_DA_META_RE = /^https:\/\/[a-z0-9.-]+\.(fbcdn\.net|cdninstagram\.com)\//i;

let transcricaoSeq = 0;
const transcricoesAbertas = new Map(); // id -> aba que pediu

/** Baixa o roteiro como .txt (com BOM, para o Bloco de Notas abrir os acentos). */
function baixarTexto(texto, nome) {
  nomePendente = nome;
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url: `data:text/plain;charset=utf-8,${encodeURIComponent(`﻿${texto}`)}`, filename: nome, saveAs: false },
      (id) => {
        if (chrome.runtime.lastError || id === undefined) {
          nomePendente = null;
          reject(new Error(chrome.runtime.lastError?.message || 'O Chrome recusou o download do roteiro.'));
          return;
        }
        resolve(id);
      }
    );
  });
}

async function transcreverCriativo(id, pedido) {
  const T = self.MineraiTranscricao;
  await garantirEmpacotador();
  const idioma = T.idiomaProvavel(pedido.texto, pedido.pais);
  const resposta = await chrome.runtime.sendMessage({ alvo: 'offscreen', type: 'MINERAI_TRANSCREVER', id, url: pedido.url, idioma });
  if (!resposta || !resposta.success) {
    throw new Error((resposta && resposta.error) || 'Não deu para transcrever o vídeo.');
  }
  const roteiro = T.montarRoteiro(resposta.data || {});
  const texto = T.roteiroEmTexto(roteiro, { pagina: pedido.pagina, dias: pedido.dias, libraryId: pedido.libraryId });
  const nome = T.nomeDoRoteiro(pedido.nomeVideo);
  await baixarTexto(texto, nome);
  return { success: true, temFala: roteiro.temFala, nome };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return undefined;

  if (message.type === 'TRANSCREVER') {
    const daBiblioteca = Boolean(sender?.tab && BIBLIOTECA_RE.test(String(sender.url || '')));
    const url = String(message.url || '');
    if (!daBiblioteca || !VIDEO_DA_META_RE.test(url) || url.length > 4096) {
      sendResponse({ success: false, error: 'Pedido de transcrição não autorizado.' });
      return true;
    }
    transcricaoSeq += 1;
    const id = `t${Date.now().toString(36)}${transcricaoSeq}`;
    transcricoesAbertas.set(id, sender.tab.id);
    const pedido = {
      url,
      nomeVideo: String(message.nomeVideo || '').slice(0, 120),
      libraryId: /^\d{1,30}$/.test(String(message.libraryId || '')) ? String(message.libraryId) : '',
      pagina: String(message.pagina || '').slice(0, 120),
      dias: Math.max(0, Math.min(100000, Number(message.dias) || 0)),
      texto: String(message.texto || '').slice(0, 2000),
      pais: String(message.pais || '').slice(0, 3)
    };
    transcreverCriativo(id, pedido)
      .then(sendResponse)
      .catch((e) => sendResponse({ success: false, error: e.message || 'Não deu para transcrever o vídeo.' }))
      .finally(() => transcricoesAbertas.delete(id));
    return true;
  }

  // Andamento vindo do documento oculto: repassa para a aba da Biblioteca.
  if (message.type === 'MINERAI_TRANSCRICAO_PROGRESSO') {
    const doOffscreen = String(sender?.url || '') === chrome.runtime.getURL('offscreen.html');
    const tabId = transcricoesAbertas.get(message.id);
    if (doOffscreen && tabId !== undefined) {
      chrome.tabs
        .sendMessage(tabId, {
          type: 'MINERAI_TRANSCRICAO_STATUS',
          etapa: String(message.etapa || ''),
          ...(Number.isFinite(message.pct) ? { pct: message.pct } : {})
        })
        .catch(() => {});
    }
    return undefined;
  }

  return undefined;
});
