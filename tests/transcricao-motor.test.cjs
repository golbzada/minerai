// Transcrição do criativo no service worker (extension/background.js + transcricao.js).
// O documento oculto, a Biblioteca, os downloads e as abas são falsos; o resto é o código real.
// Rodar: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarScript, chromeFalso } = require('./carregar-script.cjs');

function ambiente({ corpoDoAnuncio = null } = {}) {
  const downloads = [];
  const enviadosOffscreen = [];
  const paraAbas = [];
  const ouvintes = [];
  const determinantes = [];
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
          return { success: true, naFila: false };
        }
        return undefined;
      }
    },
    downloads: {
      download: (opcoes, cb) => { downloads.push(opcoes); cb(downloads.length); },
      onDeterminingFilename: { addListener: (fn) => determinantes.push(fn) },
      onChanged: { addListener() {}, removeListener() {} }
    },
    tabs: { sendMessage: (tabId, msg) => { paraAbas.push(JSON.parse(JSON.stringify({ tabId, msg }))); return Promise.resolve(); } }
  });
  async function fetch(url) {
    const u = String(url);
    if (u.includes('facebook.com/ads/library/?id=')) {
      const id = u.match(/id=(\d+)/)[1];
      const corpo = corpoDoAnuncio === null ? '' : `{"ad_archive_id":"${id}","snapshot":{"body":{"text":${JSON.stringify(corpoDoAnuncio)}}}}`;
      return { ok: true, status: 200, text: async () => corpo };
    }
    throw new Error(`fetch inesperado: ${u}`);
  }
  const sw = carregarScript('extension/background.js', { chrome, fetch });

  function mensagem(msg, sender) {
    return new Promise((resolve) => {
      let respondeu = false;
      const responder = (r) => { respondeu = true; resolve(JSON.parse(JSON.stringify(r))); };
      ouvintes.forEach((fn) => fn(msg, sender, responder));
      setTimeout(() => { if (!respondeu) resolve(undefined); }, 100);
    });
  }
  return { sw, downloads, enviadosOffscreen, paraAbas, mensagem, determinantes };
}

const BIBLIOTECA = { id: 'ext', url: 'https://www.facebook.com/ads/library/?q=x', tab: { id: 7 } };
const OFFSCREEN = { id: 'ext', url: 'chrome-extension://ext/offscreen.html' };
const VIDEO = 'https://video.fbel6-1.fna.fbcdn.net/o1/v/t2/f2/m412/abc.mp4?x=1';
const pedido = (extra = {}) => ({
  type: 'TRANSCREVER',
  url: VIDEO,
  nomeVideo: 'minerai_video_123.mp4',
  libraryId: '987654321',
  pagina: 'Loja X',
  dias: 23,
  texto: 'Ativo Veiculação iniciada em Saiba mais',
  pais: 'ALL',
  ...extra
});
const dados = { duracao: 20, chunks: [
  { inicio: 0, fim: 2, texto: 'Gancho forte.' },
  { inicio: 2, fim: 12, texto: 'Meio da história.' },
  { inicio: 12, fim: 20, texto: 'Clique e compre.' }
] };

test('pedido aceito na hora; o idioma vem do texto do anúncio na Biblioteca', async () => {
  const amb = ambiente({ corpoDoAnuncio: 'Lose weight fast with our tea. Order now and get yours today.' });
  const r = await amb.mensagem(pedido(), BIBLIOTECA);
  assert.equal(r.success, true);
  assert.equal(r.aceito, true);
  const enviado = amb.enviadosOffscreen[0];
  assert.equal(enviado.idioma, 'english');
  assert.equal(enviado.url, VIDEO);
  assert.equal(enviado.meta.tabId, 7);
  assert.equal(enviado.meta.nomeVideo, 'minerai_video_123.mp4');
});

test('fim da transcrição: baixa o roteiro e avisa a aba', async () => {
  const amb = ambiente();
  await amb.mensagem(pedido(), BIBLIOTECA);
  const { id, meta } = amb.enviadosOffscreen[0];
  await amb.mensagem({ type: 'MINERAI_TRANSCRICAO_FIM', id, meta, data: dados }, OFFSCREEN);
  assert.equal(amb.downloads.length, 1);
  assert.equal(amb.downloads[0].filename, 'minerai_video_123_roteiro.txt');
  const texto = decodeURIComponent(amb.downloads[0].url.replace(/^data:text\/plain;charset=utf-8,/, ''));
  assert.equal(texto.charCodeAt(0), 0xfeff);
  assert.match(texto, /GANCHO \(0:00–0:02\)/);
  assert.deepEqual(amb.paraAbas.pop(), { tabId: 7, msg: { type: 'MINERAI_TRANSCRICAO_STATUS', etapa: 'pronto', nome: 'minerai_video_123_roteiro.txt', temFala: true } });
});

test('erro no transcritor chega na aba em português, sem download', async () => {
  const amb = ambiente();
  await amb.mensagem(pedido(), BIBLIOTECA);
  const { id, meta } = amb.enviadosOffscreen[0];
  await amb.mensagem({ type: 'MINERAI_TRANSCRICAO_FIM', id, meta, error: 'The message port closed before a response was received.' }, OFFSCREEN);
  assert.equal(amb.downloads.length, 0);
  const aviso = amb.paraAbas.pop();
  assert.equal(aviso.msg.etapa, 'erro');
  assert.doesNotMatch(aviso.msg.erro, /message port/);
});

test('fim vindo de fora do documento oculto é ignorado', async () => {
  const amb = ambiente();
  await amb.mensagem({ type: 'MINERAI_TRANSCRICAO_FIM', id: 'x', meta: { tabId: 7, nomeVideo: 'a.mp4' }, data: dados }, BIBLIOTECA);
  assert.equal(amb.downloads.length, 0);
});

test('recusa vídeo que não é da Meta, nome estranho e pedido de fora da Biblioteca', async () => {
  const amb = ambiente();
  assert.equal((await amb.mensagem(pedido({ url: 'https://evil.example/video.mp4' }), BIBLIOTECA)).success, false);
  assert.equal((await amb.mensagem(pedido(), { id: 'ext', url: 'https://site.com/', tab: { id: 3 } })).success, false);
  const r = await amb.mensagem(pedido({ nomeVideo: '../../x.exe' }), BIBLIOTECA);
  assert.equal(r.success, true);
  assert.match(amb.enviadosOffscreen[0].meta.nomeVideo, /^minerai_video_\d+\.mp4$/);
});

test('progresso do documento oculto chega na aba que pediu', async () => {
  const amb = ambiente();
  await amb.mensagem({ type: 'MINERAI_TRANSCRICAO_PROGRESSO', id: 'x', meta: { tabId: 7 }, etapa: 'modelo', pct: 40 }, OFFSCREEN);
  assert.deepEqual(amb.paraAbas[0], { tabId: 7, msg: { type: 'MINERAI_TRANSCRICAO_STATUS', etapa: 'modelo', pct: 40 } });
});

test('cada download leva o próprio nome, mesmo com dois ao mesmo tempo', async () => {
  const amb = ambiente();
  await amb.mensagem(pedido(), BIBLIOTECA);
  await amb.mensagem(pedido({ nomeVideo: 'minerai_video_999.mp4' }), BIBLIOTECA);
  const [a, b] = amb.enviadosOffscreen;
  await amb.mensagem({ type: 'MINERAI_TRANSCRICAO_FIM', id: a.id, meta: a.meta, data: dados }, OFFSCREEN);
  await amb.mensagem({ type: 'MINERAI_TRANSCRICAO_FIM', id: b.id, meta: b.meta, data: { ...dados, chunks: dados.chunks.slice(0, 2) } }, OFFSCREEN);
  const nomes = [];
  // O Chrome pergunta o nome na ordem que quiser: aqui, o segundo primeiro.
  [amb.downloads[1], amb.downloads[0]].forEach((d) => {
    amb.determinantes.forEach((fn) => fn({ url: d.url }, (s) => nomes.push(s && s.filename)));
  });
  assert.deepEqual(nomes, ['minerai_video_999_roteiro.txt', 'minerai_video_123_roteiro.txt']);
});

test('texto do anúncio com acentos escapados e quebra de linha também serve para o idioma', async () => {
  const amb = ambiente({ corpoDoAnuncio: 'Você não sabe ainda?\nClique e veja: promoção de hoje com 50% de desconto.' });
  await amb.mensagem(pedido({ pais: 'US' }), BIBLIOTECA);
  assert.equal(amb.enviadosOffscreen[0].idioma, 'portuguese');
});
