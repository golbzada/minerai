// Transcrição do criativo no service worker (extension/background.js + transcricao-regras.js).
// O documento oculto, os downloads e as abas são falsos; o resto é o código real.
// Rodar: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarScript, chromeFalso } = require('./carregar-script.cjs');

function ambiente({ respostaOffscreen }) {
  const downloads = [];
  const enviadosOffscreen = [];
  const paraAbas = [];
  const ouvintes = [];
  const chrome = chromeFalso({
    runtime: {
      id: 'ext',
      lastError: undefined,
      getURL: (p) => `chrome-extension://ext/${p}`,
      getContexts: async () => [{ contextType: 'OFFSCREEN_DOCUMENT' }],
      onMessage: { addListener: (fn) => ouvintes.push(fn) },
      sendMessage: async (msg) => {
        if (msg.alvo === 'offscreen') {
          enviadosOffscreen.push(msg);
          return respostaOffscreen;
        }
        return undefined;
      }
    },
    downloads: {
      download: (opcoes, cb) => { downloads.push(opcoes); cb(1); },
      onDeterminingFilename: { addListener() {} },
      onChanged: { addListener() {}, removeListener() {} }
    },
    tabs: { sendMessage: (tabId, msg) => { paraAbas.push({ tabId, msg }); return Promise.resolve(); } }
  });
  const sw = carregarScript('extension/background.js', { chrome, fetch: async () => { throw new Error('sem rede'); } });

  function mensagem(msg, sender) {
    return new Promise((resolve) => {
      let respondeu = false;
      const responder = (r) => { respondeu = true; resolve(JSON.parse(JSON.stringify(r))); };
      ouvintes.forEach((fn) => fn(msg, sender, responder));
      setTimeout(() => { if (!respondeu) resolve(undefined); }, 200);
    });
  }
  return { sw, downloads, enviadosOffscreen, paraAbas, mensagem };
}

const BIBLIOTECA = { id: 'ext', url: 'https://www.facebook.com/ads/library/?q=x', tab: { id: 7 } };
const VIDEO = 'https://video.fbel6-1.fna.fbcdn.net/o1/v/t2/f2/m412/abc.mp4?x=1';
const pedido = (extra = {}) => ({
  type: 'TRANSCREVER',
  url: VIDEO,
  nomeVideo: 'minerai_video_123.mp4',
  libraryId: '987654321',
  pagina: 'Loja X',
  dias: 23,
  texto: 'Você ainda não sabe como estudar? Clique e veja.',
  pais: 'BR',
  ...extra
});

test('transcreve e baixa o roteiro junto do vídeo', async () => {
  const amb = ambiente({
    respostaOffscreen: { success: true, data: { duracao: 20, chunks: [
      { inicio: 0, fim: 2, texto: 'Gancho forte.' },
      { inicio: 2, fim: 12, texto: 'Meio da história.' },
      { inicio: 12, fim: 20, texto: 'Clique e compre.' }
    ] } }
  });
  const r = await amb.mensagem(pedido(), BIBLIOTECA);
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal(amb.enviadosOffscreen[0].idioma, 'portuguese');
  assert.equal(amb.enviadosOffscreen[0].url, VIDEO);
  assert.equal(amb.downloads.length, 1);
  assert.equal(amb.downloads[0].filename, 'minerai_video_123_roteiro.txt');
  const texto = decodeURIComponent(amb.downloads[0].url.replace(/^data:text\/plain;charset=utf-8,/, ''));
  assert.match(texto, /GANCHO \(0:00–0:02\)/);
  assert.match(texto, /Loja X \(23 dias no ar\)/);
});

test('recusa vídeo que não é da Meta e pedido de fora da Biblioteca', async () => {
  const amb = ambiente({ respostaOffscreen: { success: true, data: { duracao: 1, chunks: [] } } });
  const r1 = await amb.mensagem(pedido({ url: 'https://evil.example/video.mp4' }), BIBLIOTECA);
  assert.equal(r1.success, false);
  const r2 = await amb.mensagem(pedido(), { id: 'ext', url: 'https://site.com/', tab: { id: 3 } });
  assert.equal(r2.success, false);
  assert.equal(amb.enviadosOffscreen.length, 0);
});

test('erro do transcritor volta para a barra sem baixar nada', async () => {
  const amb = ambiente({ respostaOffscreen: { success: false, error: 'Não deu para baixar o vídeo para transcrever.' } });
  const r = await amb.mensagem(pedido(), BIBLIOTECA);
  assert.equal(r.success, false);
  assert.match(r.error, /baixar o vídeo/);
  assert.equal(amb.downloads.length, 0);
});

test('progresso do documento oculto chega na aba que pediu', async () => {
  let liberar;
  const amb = ambiente({ respostaOffscreen: new Promise((r) => { liberar = r; }) });
  const andamento = amb.mensagem(pedido(), BIBLIOTECA);
  await new Promise((r) => setTimeout(r, 20));
  const id = amb.enviadosOffscreen[0].id;
  await amb.mensagem({ type: 'MINERAI_TRANSCRICAO_PROGRESSO', id, etapa: 'modelo', pct: 40 }, { id: 'ext', url: 'chrome-extension://ext/offscreen.html' });
  assert.deepEqual(JSON.parse(JSON.stringify(amb.paraAbas[0])), { tabId: 7, msg: { type: 'MINERAI_TRANSCRICAO_STATUS', etapa: 'modelo', pct: 40 } });
  liberar({ success: true, data: { duracao: 5, chunks: [] } });
  await andamento;
});
