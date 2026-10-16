// Roteiros guardados na extensão e "ver/comparar captura" (extension/background.js
// + transcricao.js). Rodar: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarScript, chromeFalso } = require('./carregar-script.cjs');

const PAINEL = { id: 'ext', url: 'https://mineraiofertas.vercel.app/modelar' };
const ESTRANHO = { id: 'ext', url: 'https://site-qualquer.com/', tab: { id: 9 } };
const OFFSCREEN = { id: 'ext', url: 'chrome-extension://ext/offscreen.html' };

function ambiente() {
  const guardado = {};
  const abas = [];
  const ouvintes = [];
  const chrome = chromeFalso({
    runtime: {
      id: 'ext',
      lastError: undefined,
      getURL: (p) => `chrome-extension://ext/${p}`,
      onMessage: { addListener: (fn) => ouvintes.push(fn) },
      sendMessage: async () => undefined
    },
    storage: {
      local: {
        get: (k, cb) => {
          const r = typeof k === 'string' ? { [k]: guardado[k] } : { ...guardado };
          if (cb) cb(r);
          return Promise.resolve(r);
        },
        set: (o, cb) => {
          Object.assign(guardado, JSON.parse(JSON.stringify(o)));
          if (cb) cb();
          return Promise.resolve();
        }
      }
    },
    downloads: { download: (o, cb) => cb(1), onDeterminingFilename: { addListener() {} }, onChanged: { addListener() {}, removeListener() {} } },
    tabs: { create: async (o) => { abas.push(o.url); return { id: 1 }; }, sendMessage: () => Promise.resolve() }
  });
  carregarScript('extension/background.js', { chrome, fetch: async () => { throw new Error('sem rede'); } });
  const mensagem = (msg, sender) => new Promise((resolve) => {
    let respondeu = false;
    ouvintes.forEach((fn) => fn(msg, sender, (r) => { respondeu = true; resolve(JSON.parse(JSON.stringify(r))); }));
    setTimeout(() => { if (!respondeu) resolve(undefined); }, 150);
  });
  return { mensagem, guardado, abas };
}

const FIM = {
  type: 'MINERAI_TRANSCRICAO_FIM',
  id: 't1',
  meta: { tabId: 7, nomeVideo: 'minerai_loja_1.mp4', pagina: 'Loja', libraryId: '123', dias: 9 },
  data: { duracao: 12, chunks: [{ inicio: 0, fim: 3, texto: 'Gancho.' }, { inicio: 3, fim: 12, texto: 'Clique no link.' }] }
};

test('roteiro transcrito fica guardado e o painel lista e apaga', async () => {
  const amb = ambiente();
  await amb.mensagem(FIM, OFFSCREEN);
  await new Promise((r) => setTimeout(r, 50));
  const lista = await amb.mensagem({ type: 'ROTEIROS_LISTAR' }, PAINEL);
  assert.equal(lista.success, true);
  assert.equal(lista.roteiros.length, 1);
  assert.equal(lista.roteiros[0].pagina, 'Loja');
  assert.equal(lista.roteiros[0].gancho, 'Gancho.');
  assert.match(lista.roteiros[0].texto, /GANCHO/);
  const depois = await amb.mensagem({ type: 'ROTEIROS_APAGAR', id: lista.roteiros[0].id }, PAINEL);
  assert.equal(depois.roteiros.length, 0);
});

test('roteiros: pedido de fora do painel é recusado', async () => {
  const amb = ambiente();
  const r = await amb.mensagem({ type: 'ROTEIROS_LISTAR' }, ESTRANHO);
  assert.equal(r.success, false);
});

test('ver captura: abre a tela da extensão com id e link de comparar saneados', async () => {
  const amb = ambiente();
  const r = await amb.mensagem({ type: 'MODELAR_VER', id: 'pagina-123', comparar: 'minhapagina.com' }, PAINEL);
  assert.equal(r.success, true);
  assert.equal(amb.abas[0], 'chrome-extension://ext/ver.html?id=pagina-123&comparar=https%3A%2F%2Fminhapagina.com%2F');
});

test('ver captura: id estranho ou origem estranha não abre nada', async () => {
  const amb = ambiente();
  assert.equal((await amb.mensagem({ type: 'MODELAR_VER', id: '../x' }, PAINEL)).success, false);
  assert.equal((await amb.mensagem({ type: 'MODELAR_VER', id: 'pagina-123' }, ESTRANHO)).success, false);
  assert.equal(amb.abas.length, 0);
});
