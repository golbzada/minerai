// ==============================================================================
// MINERAÍ EXTENSÃO - TRANSCRITOR DE CRIATIVOS (documento oculto)
// ==============================================================================
// Transcreve a fala de um vídeo de anúncio com o Whisper, rodando no próprio
// navegador (transformers.js + onnxruntime em WebAssembly, ou na placa de
// vídeo pelo WebGPU). Nada vai para servidor: custo zero.
//
// O código do transformers.js fica em vendor/ (extensão não pode carregar
// código de fora) e só é carregado quando o primeiro vídeo é transcrito. O
// modelo de voz é baixado do Hugging Face na primeira vez (~80 MB) e fica no
// cache do navegador.
//
// Fluxo sem pedido longo pendurado no service worker: MINERAI_TRANSCREVER é
// aceito na hora e entra numa fila (um vídeo por vez: o motor não aguenta dois
// ao mesmo tempo); o andamento sai em MINERAI_TRANSCRICAO_PROGRESSO e o
// resultado em MINERAI_TRANSCRICAO_FIM. Quem monta o roteiro é o service
// worker (transcricao-regras.js).
// Design: docs/superpowers/specs/2026-10-13-transcricao-do-criativo-design.md
// ==============================================================================

const MODELO = 'onnx-community/whisper-base';
const REVISAO = '1846881b6b3a3024392c1eea3ad983695bc23925'; // versão fixa do modelo
const AMOSTRAGEM = 16000;           // o Whisper ouve em 16 kHz
const VIDEO_MAX_BYTES = 300 * 1024 * 1024;
const VIDEO_TEMPO_MAX_MS = 120000;
const OCIOSO_MS = 5 * 60 * 1000;    // sem uso: libera a memória do modelo
const VIDEO_DA_META_RE = /^https:\/\/[a-z0-9.-]+\.(fbcdn\.net|cdninstagram\.com)\//i;

const daExtensao = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL;
const pastaVendor = daExtensao ? chrome.runtime.getURL('vendor/') : new URL('./vendor/', import.meta.url).href;

let biblioteca = null; // transformers.js, carregado só quando precisa
let carregando = null; // Promise<{ asr, gpu }>
let ocioso = null;

async function transformers() {
  if (!biblioteca) {
    biblioteca = await import('./vendor/transformers.min.js');
    const { env } = biblioteca;
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    env.backends.onnx.wasm.wasmPaths = pastaVendor;
    env.backends.onnx.wasm.numThreads = 1; // sem isolamento entre origens não há threads
  }
  return biblioteca;
}

/** Progresso dos vários arquivos do modelo somado num percentual só, no máximo 1 por segundo. */
function medidorDeDownload(aoProgresso) {
  const arquivos = new Map();
  let ultimo = 0;
  let maior = 0;
  return (p) => {
    if (!p || !p.file || !p.total) return;
    arquivos.set(p.file, { loaded: p.loaded || 0, total: p.total });
    const agora = Date.now();
    if (agora - ultimo < 1000) return;
    let feito = 0;
    let total = 0;
    arquivos.forEach((a) => {
      feito += a.loaded;
      total += a.total;
    });
    // Os arquivos pequenos (configuração) chegam primeiro e dariam "99%"
    // falso: só mostra quando os grandes já entraram na conta, e nunca volta.
    if (total < 5 * 1024 * 1024) return;
    ultimo = agora;
    maior = Math.max(maior, Math.min(99, Math.round((feito / total) * 100)));
    aoProgresso?.({ etapa: 'modelo', pct: maior });
  };
}

/** Carrega o Whisper (placa de vídeo se tiver e se não falhou antes; senão processador). */
function transcritor(aoProgresso, { semGpu = false } = {}) {
  if (!carregando) {
    carregando = (async () => {
      const { pipeline } = await transformers();
      const opcoes = { revision: REVISAO, progress_callback: medidorDeDownload(aoProgresso) };
      if (!semGpu && typeof navigator !== 'undefined' && navigator.gpu) {
        try {
          const asr = await pipeline('automatic-speech-recognition', MODELO, {
            ...opcoes,
            device: 'webgpu',
            dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }
          });
          return { asr, gpu: true };
        } catch (e) {
          console.warn('[Mineraí] Placa de vídeo indisponível para o transcritor, usando o processador:', e.message);
        }
      }
      const asr = await pipeline('automatic-speech-recognition', MODELO, { ...opcoes, device: 'wasm', dtype: 'q8' });
      return { asr, gpu: false };
    })().catch((e) => {
      carregando = null;
      throw e;
    });
  }
  return carregando;
}

async function liberarModelo() {
  const atual = carregando;
  carregando = null;
  try {
    const { asr } = await atual;
    await asr.dispose();
  } catch (e) {}
}

function marcarUso() {
  clearTimeout(ocioso);
  ocioso = setTimeout(liberarModelo, OCIOSO_MS);
}

/** Áudio do vídeo em 16 kHz mono. `null` quando não dá para ouvir (sem som ou formato estranho). */
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
 * `task: 'transcribe'` e o idioma sempre: sem isso o Whisper traduzia para o inglês.
 */
export async function transcrever(dados, aoProgresso, extras = {}) {
  const som = await audioDoVideo(dados);
  if (!som) return { duracao: 0, chunks: [], texto: '', semAudio: true };

  const opcoes = { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, task: 'transcribe', ...extras };
  let { asr, gpu } = await transcritor(aoProgresso);
  aoProgresso?.({ etapa: 'ouvindo' });
  let saida;
  try {
    saida = await asr(som.audio, opcoes);
  } catch (e) {
    if (!gpu) throw e;
    // A placa de vídeo falhou no meio (driver, memória): volta para o processador.
    console.warn('[Mineraí] Placa de vídeo falhou ao transcrever, tentando no processador:', e.message);
    await liberarModelo();
    ({ asr } = await transcritor(aoProgresso, { semGpu: true }));
    saida = await asr(som.audio, opcoes);
  }
  marcarUso();
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

/** Baixa o vídeo com limite de tempo e de tamanho. */
async function baixarVideo(url) {
  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), VIDEO_TEMPO_MAX_MS);
  try {
    const res = await fetch(url, { credentials: 'omit', signal: controle.signal });
    if (!res.ok) throw new Error('Não deu para baixar o vídeo para transcrever.');
    const tamanho = Number(res.headers.get('content-length') || 0);
    if (tamanho > VIDEO_MAX_BYTES) throw new Error('Vídeo grande demais para transcrever.');
    const dados = await res.arrayBuffer();
    if (dados.byteLength > VIDEO_MAX_BYTES) throw new Error('Vídeo grande demais para transcrever.');
    return dados;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Não deu para baixar o vídeo para transcrever (demorou demais).');
    throw e;
  } finally {
    clearTimeout(limite);
  }
}

// Documento oculto da extensão: atende o service worker, um vídeo por vez.
if (daExtensao && chrome.runtime.onMessage) {
  let fila = Promise.resolve();
  let naFila = 0;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.alvo !== 'offscreen' || msg.type !== 'MINERAI_TRANSCREVER') return undefined;
    // Só o service worker da própria extensão (sem aba) pode pedir.
    if (sender.id !== chrome.runtime.id || sender.tab || !VIDEO_DA_META_RE.test(String(msg.url || ''))) {
      sendResponse({ success: false, error: 'Pedido não autorizado.' });
      return true;
    }

    const meta = msg.meta || {};
    const enviar = (tipo, extra) => {
      chrome.runtime.sendMessage({ type: tipo, id: msg.id, meta, ...extra }).catch(() => {});
    };
    // Sinal de vida a cada 10 s enquanto trabalha (mensagem acorda o service worker).
    let ultima = { etapa: 'baixando' };
    const avisar = (p) => {
      ultima = p;
      enviar('MINERAI_TRANSCRICAO_PROGRESSO', p);
    };
    const idioma = /^[a-z]{3,12}$/.test(String(msg.idioma || '')) ? msg.idioma : 'portuguese';

    const esperando = naFila > 0;
    naFila += 1;
    if (esperando) avisar({ etapa: 'fila' });
    sendResponse({ success: true, naFila: esperando });

    fila = fila.then(async () => {
      const vivo = setInterval(() => avisar(ultima), 10000);
      try {
        avisar({ etapa: 'baixando' });
        const dados = await baixarVideo(msg.url);
        const data = await transcrever(dados, avisar, { language: idioma });
        enviar('MINERAI_TRANSCRICAO_FIM', { data });
      } catch (e) {
        enviar('MINERAI_TRANSCRICAO_FIM', { error: (e && e.message) || 'Falha ao transcrever.' });
      } finally {
        clearInterval(vivo);
        naFila -= 1;
      }
    });
    return true;
  });
}
