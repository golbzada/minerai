// ==============================================================================
// MINERAÍ EXTENSÃO - MOTOR DO TRANSCRITOR (worker)
// ==============================================================================
// Roda o Whisper (transformers.js + onnxruntime) isolado num worker criado
// pelo documento oculto (transcritor.js). Isolado porque, quando a placa de
// vídeo falha ou some no meio, o motor inteiro fica estragado: nem o
// processador funciona mais nele. Quem manda descarta este worker e refaz num
// novo, só no processador. Encerrar o worker também devolve toda a memória.
//
// Conversa (só com o documento que o criou):
//   recebe  { tipo: 'ouvir', audio: Float32Array 16 kHz, opcoes, semGpu }
//   manda   { tipo: 'progresso', progresso: { etapa: 'modelo', pct } }
//           { tipo: 'ouvindo', gpu }       modelo pronto, começou a ouvir
//           { tipo: 'pronto', gpu, saida: { text, chunks: [{ timestamp, text }] } }
//           { tipo: 'erro', gpu, mensagem }
// Design: docs/superpowers/specs/2026-10-13-transcricao-do-criativo-design.md
// ==============================================================================

const MODELO = 'onnx-community/whisper-base';
const REVISAO = '1846881b6b3a3024392c1eea3ad983695bc23925'; // versão fixa do modelo
const PASTA_VENDOR = new URL('./vendor/', import.meta.url).href;

let biblioteca = null; // transformers.js, carregado só quando precisa
let carregando = null; // Promise<{ asr, gpu }>

async function transformers() {
  if (!biblioteca) {
    biblioteca = await import('./vendor/transformers.min.js');
    const { env } = biblioteca;
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    env.backends.onnx.wasm.wasmPaths = PASTA_VENDOR;
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
    aoProgresso({ etapa: 'modelo', pct: maior });
  };
}

const temPlaca = () => typeof navigator !== 'undefined' && Boolean(navigator.gpu);

/** Carrega o Whisper uma vez por worker: placa de vídeo se tiver e se puder; senão processador. */
function carregar(semGpu, aoProgresso) {
  if (!carregando) {
    carregando = (async () => {
      const { pipeline } = await transformers();
      const gpu = !semGpu && temPlaca();
      const opcoes = { revision: REVISAO, progress_callback: medidorDeDownload(aoProgresso) };
      const asr = gpu
        ? await pipeline('automatic-speech-recognition', MODELO, {
            ...opcoes,
            device: 'webgpu',
            dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }
          })
        : await pipeline('automatic-speech-recognition', MODELO, { ...opcoes, device: 'wasm', dtype: 'q8' });
      return { asr, gpu };
    })().catch((e) => {
      carregando = null; // falhou: o próximo pedido tenta carregar de novo
      throw e;
    });
  }
  return carregando;
}

self.onmessage = async (evento) => {
  const pedido = evento.data;
  if (!pedido || pedido.tipo !== 'ouvir') return;
  const avisar = (progresso) => self.postMessage({ tipo: 'progresso', progresso });
  // Até o modelo carregar, "na placa" é o que se pretendia usar.
  let gpu = !pedido.semGpu && temPlaca();
  try {
    const motor = await carregar(Boolean(pedido.semGpu), avisar);
    gpu = motor.gpu;
    self.postMessage({ tipo: 'ouvindo', gpu });
    const saida = await motor.asr(pedido.audio, pedido.opcoes);
    self.postMessage({
      tipo: 'pronto',
      gpu,
      saida: {
        text: String(saida.text || ''),
        chunks: (saida.chunks || []).map((c) => ({ timestamp: c.timestamp, text: c.text }))
      }
    });
  } catch (e) {
    self.postMessage({ tipo: 'erro', gpu, mensagem: (e && e.message) || String(e) });
  }
};
