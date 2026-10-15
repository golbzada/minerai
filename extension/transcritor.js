// ==============================================================================
// MINERAÍ EXTENSÃO - TRANSCRITOR DE CRIATIVOS (documento oculto)
// ==============================================================================
// Transcreve a fala de um vídeo de anúncio com o Whisper, rodando no próprio
// navegador (transformers.js + onnxruntime em WebAssembly, ou na placa de
// vídeo pelo WebGPU). Nada vai para servidor: custo zero.
//
// O código do transformers.js fica em vendor/ (extensão não pode carregar
// código de fora). O modelo de voz é baixado do Hugging Face na primeira vez
// (~80 MB) e fica no cache do navegador.
//
// O Whisper roda num worker à parte (transcritor-motor.js), não aqui: placa
// de vídeo que falha ou some no meio estraga o motor inteiro (nem o
// processador funciona mais nele) e pode deixar a transcrição pendurada. A
// orquestra descarta o worker e refaz o vídeo num worker novo, só no
// processador (visto em 13/10/2026).
//
// Fluxo sem pedido longo pendurado no service worker: MINERAI_TRANSCREVER é
// aceito na hora e entra numa fila (um vídeo por vez: o motor não aguenta dois
// ao mesmo tempo); o andamento sai em MINERAI_TRANSCRICAO_PROGRESSO e o
// resultado em MINERAI_TRANSCRICAO_FIM. Quem monta o roteiro é o service
// worker (transcricao-regras.js).
// Design: docs/superpowers/specs/2026-10-13-transcricao-do-criativo-design.md
// ==============================================================================

const AMOSTRAGEM = 16000;           // o Whisper ouve em 16 kHz
const VIDEO_MAX_BYTES = 300 * 1024 * 1024;
const VIDEO_TEMPO_MAX_MS = 120000;
const VIDEO_DA_META_RE = /^https:\/\/[a-z0-9.-]+\.(fbcdn\.net|cdninstagram\.com)\//i;
const DEMOROU = 'O transcritor demorou demais neste vídeo. Tente de novo.';

const LIMITES = {
  // Depois que o modelo carregou e começou a ouvir: placa de vídeo é rápida
  // (vídeo de 7 min em menos de 1 min); passou disso, ela travou.
  vigiaMs: (gpu, duracao) => (gpu ? 60 + duracao : 120 + 4 * duracao) * 1000,
  // Prazo do vídeo inteiro (as duas tentativas), contando o download do
  // modelo na primeira vez. Com os até 2 min para baixar o vídeo, fica abaixo
  // dos 15 min em que a aba desiste de esperar.
  tetoMs: 12 * 60 * 1000,
  ociosoMs: 5 * 60 * 1000 // sem uso: encerra o motor e devolve a memória
};

const daExtensao = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL;

function motorPadrao() {
  return new Worker(new URL('./transcritor-motor.js', import.meta.url), { type: 'module' });
}

/**
 * Quem conversa com o motor (worker) do Whisper. Placa de vídeo que dá erro,
 * trava ou derruba o worker: o motor é descartado e o mesmo áudio é ouvido
 * de novo num motor novo, só no processador. Se lá deu certo (ou se a placa
 * travou até o prazo acabar), os próximos vídeos já vão direto para o
 * processador.
 */
export function criarOrquestra({ criarMotor = motorPadrao, limites = LIMITES } = {}) {
  let motor = null;
  let semGpu = false;
  let ocioso = null;

  function encerrar() {
    clearTimeout(ocioso);
    if (motor) motor.terminate();
    motor = null;
  }

  function tentar(som, opcoes, aoProgresso, soProcessador, prazoMs) {
    if (!motor) motor = criarMotor();
    const atual = motor;
    return new Promise((resolve, reject) => {
      let naPlaca = !soProcessador;
      let vigia = null;
      let acabou = false;
      const terminar = (erro, saida, { refazer = true } = {}) => {
        if (acabou) return;
        acabou = true;
        clearTimeout(vigia);
        clearTimeout(teto);
        atual.onmessage = null;
        atual.onerror = null;
        if (!erro) {
          resolve(saida);
          return;
        }
        // Motor que falhou não é reaproveitado: pode ter ficado estragado.
        atual.terminate();
        if (motor === atual) motor = null;
        erro.naPlaca = naPlaca && refazer;
        reject(erro);
      };
      // Acabou o prazo: não há tempo para outra tentativa. Se estava na placa,
      // ela travou (ainda carregando, antes do vigia existir).
      const armarVigia = () => {
        clearTimeout(vigia);
        vigia = setTimeout(() => terminar(new Error(DEMOROU)), limites.vigiaMs(naPlaca, som.duracao));
      };
      const teto = setTimeout(() => {
        const erro = new Error(DEMOROU);
        erro.placaTravou = naPlaca;
        terminar(erro, null, { refazer: false });
      }, prazoMs);
      atual.onerror = (e) => terminar(new Error((e && e.message) || 'O motor do transcritor parou. Tente de novo.'));
      atual.onmessage = (evento) => {
        const m = evento.data || {};
        if (m.tipo === 'progresso') {
          aoProgresso?.(m.progresso);
          // Andamento Ã© sinal de vida: o vigia recomeÃ§a a contar.
          if (vigia) armarVigia();
        } else if (m.tipo === 'ouvindo') {
          naPlaca = Boolean(m.gpu);
          aoProgresso?.({ etapa: 'ouvindo' });
          armarVigia();
        } else if (m.tipo === 'pronto') terminar(null, m.saida);
        else if (m.tipo === 'erro') {
          if (typeof m.gpu === 'boolean') naPlaca = m.gpu;
          terminar(new Error(m.mensagem || 'Falha ao transcrever. Tente de novo.'));
        }
      };
      atual.postMessage({ tipo: 'ouvir', audio: som.audio, opcoes, semGpu: soProcessador });
    });
  }

  async function ouvir(som, opcoes, aoProgresso) {
    clearTimeout(ocioso);
    // Um prazo só para o vídeo: a segunda tentativa usa o que sobrou.
    const prazo = Date.now() + limites.tetoMs;
    try {
      try {
        return await tentar(som, opcoes, aoProgresso, semGpu, limites.tetoMs);
      } catch (e) {
        if (e.placaTravou) semGpu = true;
        if (!e.naPlaca) throw e;
        const resta = prazo - Date.now();
        if (resta <= 0) throw new Error(DEMOROU);
        console.warn('[Mineraí] Placa de vídeo falhou no transcritor; refazendo no processador:', e.message);
        const saida = await tentar(som, opcoes, aoProgresso, true, resta);
        // Só fica no processador se lá deu certo: falha dos dois (a internet
        // caiu no download do modelo, por exemplo) não é culpa da placa.
        semGpu = true;
        return saida;
      }
    } finally {
      clearTimeout(ocioso);
      if (motor) ocioso = setTimeout(encerrar, limites.ociosoMs);
    }
  }

  return { ouvir, encerrar };
}

let orquestra = null; // a do documento oculto, criada no primeiro vídeo

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
  if (!orquestra) orquestra = criarOrquestra();
  const saida = await orquestra.ouvir(som, opcoes, aoProgresso);
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
