// ==============================================================================
// MINERAÍ EXTENSÃO - TRANSCRITOR DE CRIATIVOS (documento oculto)
// ==============================================================================
// Transcreve a fala de um vídeo de anúncio com o Whisper, rodando no próprio
// navegador (transformers.js + onnxruntime em WebAssembly, ou na placa de
// vídeo pelo WebGPU). Nada vai para servidor: custo zero.
//
// O código do transformers.js fica em vendor/ (extensão não pode carregar
// código de fora). O modelo de voz é baixado do Hugging Face só na primeira
// vez (~80 MB) e fica guardado no cache do navegador.
//
// Recebe MINERAI_TRANSCREVER do service worker e devolve os trechos com tempo;
// quem monta o roteiro é transcricao-regras.js.
// Design: docs/superpowers/specs/2026-10-13-transcricao-do-criativo-design.md
// ==============================================================================

import { pipeline, env } from './vendor/transformers.min.js';

const MODELO = 'onnx-community/whisper-base';
const AMOSTRAGEM = 16000; // o Whisper ouve em 16 kHz

const daExtensao = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL;
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = daExtensao ? chrome.runtime.getURL('vendor/') : new URL('./vendor/', import.meta.url).href;
env.backends.onnx.wasm.numThreads = 1; // sem isolamento entre origens não há threads

let carregando = null;

/** Carrega o Whisper uma vez (placa de vídeo se tiver, senão processador). */
function transcritor(aoProgresso) {
  if (!carregando) {
    const opcoes = {
      progress_callback: (p) => {
        if (p && p.status === 'progress' && p.total) {
          aoProgresso?.({ etapa: 'modelo', pct: Math.round((p.loaded / p.total) * 100) });
        }
      }
    };
    carregando = (async () => {
      if (typeof navigator !== 'undefined' && navigator.gpu) {
        try {
          return await pipeline('automatic-speech-recognition', MODELO, {
            ...opcoes,
            device: 'webgpu',
            dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }
          });
        } catch (e) {
          console.warn('[Mineraí] Placa de vídeo indisponível para o transcritor, usando o processador:', e.message);
        }
      }
      return pipeline('automatic-speech-recognition', MODELO, { ...opcoes, device: 'wasm', dtype: 'q8' });
    })().catch((e) => {
      carregando = null;
      throw e;
    });
  }
  return carregando;
}

/** Áudio do vídeo em 16 kHz mono. `null` quando o vídeo não tem som. */
export async function audioDoVideo(dados) {
  let decodificado;
  try {
    decodificado = await new OfflineAudioContext(1, AMOSTRAGEM, AMOSTRAGEM).decodeAudioData(dados.slice(0));
  } catch (e) {
    return null;
  }
  const amostras = Math.max(1, Math.ceil(decodificado.duration * AMOSTRAGEM));
  const contexto = new OfflineAudioContext(1, amostras, AMOSTRAGEM);
  const fonte = contexto.createBufferSource();
  fonte.buffer = decodificado;
  fonte.connect(contexto.destination);
  fonte.start();
  const pronto = await contexto.startRendering();
  return { audio: pronto.getChannelData(0), duracao: decodificado.duration };
}

/**
 * ArrayBuffer do vídeo -> { duracao, chunks: [{inicio, fim, texto}], texto }
 * `task: 'transcribe'` sempre: sem isso o Whisper traduzia para o inglês.
 */
export async function transcrever(dados, aoProgresso, extras = {}) {
  const som = await audioDoVideo(dados);
  if (!som) return { duracao: 0, chunks: [], texto: '' };

  const asr = await transcritor(aoProgresso);
  aoProgresso?.({ etapa: 'ouvindo' });
  const saida = await asr(som.audio, {
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
    task: 'transcribe',
    ...extras
  });
  return {
    duracao: som.duracao,
    texto: String(saida.text || '').trim(),
    chunks: (saida.chunks || []).map((c) => ({
      inicio: Array.isArray(c.timestamp) ? c.timestamp[0] : 0,
      fim: Array.isArray(c.timestamp) ? c.timestamp[1] : null,
      texto: c.text
    }))
  };
}

// Documento oculto da extensão: atende o service worker.
if (daExtensao && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.alvo !== 'offscreen' || msg.type !== 'MINERAI_TRANSCREVER') return undefined;
    const avisar = (p) => {
      chrome.runtime.sendMessage({ type: 'MINERAI_TRANSCRICAO_PROGRESSO', id: msg.id, ...p }).catch(() => {});
    };
    // Sinal de vida a cada 10 s: mensagem para o service worker o mantém
    // acordado enquanto o Whisper ouve (pode levar mais de 30 s sem placa de vídeo).
    let ultima = { etapa: 'baixando' };
    const vivo = setInterval(() => avisar(ultima), 10000);
    const avisarGuardando = (p) => {
      ultima = p;
      avisar(p);
    };
    const idioma = /^[a-z]{3,12}$/.test(String(msg.idioma || '')) ? msg.idioma : 'portuguese';
    (async () => {
      avisarGuardando({ etapa: 'baixando' });
      const res = await fetch(msg.url);
      if (!res.ok) throw new Error('Não deu para baixar o vídeo para transcrever.');
      return transcrever(await res.arrayBuffer(), avisarGuardando, { language: idioma });
    })()
      .then((data) => sendResponse({ success: true, data }))
      .catch((e) => sendResponse({ success: false, error: e.message || 'Falha ao transcrever.' }))
      .finally(() => clearInterval(vivo));
    return true;
  });
}
