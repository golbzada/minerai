// Motor do Radar do nicho no service worker (extension/radar.js).
// Biblioteca, chrome.* e login são falsos; o resto é o código real.
// Rodar: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { carregarScript, chromeFalso } = require('./carregar-script.cjs');

const USER = { id: '02287553-9ef6-4803-a2d9-dfbbc2b31b64', name: 'Teste', email: 't@t.t' };
const TOKEN = `x.${Buffer.from(JSON.stringify({ exp: 9999999999 })).toString('base64url')}.y`;
const PAINEL = 'https://mineraiofertas.vercel.app/radar';

function hojeLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function diasAntes(n) {
  const d = new Date(`${hojeLocal()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
const unix = (iso) => Date.parse(`${iso}T07:00:00Z`) / 1000;

function anuncio(id, pageId, dias) {
  return {
    ad_archive_id: id,
    page_id: pageId,
    collation_count: 2,
    start_date: unix(diasAntes(dias - 1)),
    snapshot: { page_name: `Loja ${pageId}`, link_url: `https://loja${pageId}.com.br`, body: { text: 'texto' } }
  };
}
const buscaHtml = (lista, count = 500) =>
  `<script>{"search_results_connection":${JSON.stringify({ count, edges: [{ node: { collated_results: lista } }] })}}</script>`;

const CHAVE = `minerai_radar:${USER.id}`;

/** Rastreio das ofertas já terminado hoje (o Radar roda depois dele). */
const rastreioTerminado = () => ({ ligado: true, dia: hojeLocal(), fila: [], terminadoEm: `${hojeLocal()}T08:00`, parado: null });

function ambiente({ radar = null, respostas = {}, logado = true, rastreio = rastreioTerminado(), aoBuscar = null }) {
  const storage = {};
  if (logado) {
    storage.minerai_user = USER;
    storage.minerai_session = { access_token: TOKEN, refresh_token: 'r', expires_at: 9999999999 };
  }
  if (radar) storage[CHAVE] = radar;
  if (rastreio) storage.minerai_rastreio = rastreio;
  const alarmes = [];

  const notificacoes = [];
  const buscas = [];
  const ouvintes = [];
  const local = {
    get(keys, cb) {
      const lista = Array.isArray(keys) ? keys : [keys];
      const r = {};
      lista.forEach((k) => { if (k in storage) r[k] = JSON.parse(JSON.stringify(storage[k])); });
      if (cb) cb(r);
      return Promise.resolve(r);
    },
    set(obj, cb) {
      Object.assign(storage, JSON.parse(JSON.stringify(obj)));
      if (cb) cb();
      return Promise.resolve();
    }
  };
  const chrome = chromeFalso({
    storage: { local },
    runtime: { id: 'ext', onMessage: { addListener: (fn) => ouvintes.push(fn) } },
    notifications: { create: (id, info) => notificacoes.push({ id, ...info }) },
    alarms: { create: (nome, info) => alarmes.push({ nome, info }) }
  });

  async function fetch(url) {
    const u = String(url);
    if (u.includes('facebook.com/ads/library/')) {
      buscas.push(u);
      const termo = decodeURIComponent((u.match(/[?&]q=([^&]*)/) || [])[1] || '');
      if (aoBuscar) aoBuscar({ termo, storage });
      if (respostas[termo] === null) return { ok: false, status: 503, text: async () => '' };
      const corpo = respostas[termo] ?? '<html></html>';
      return { ok: true, status: 200, text: async () => corpo };
    }
    throw new Error(`fetch inesperado: ${u}`);
  }

  const sw = carregarScript('extension/background.js', { chrome, fetch });

  /** Manda uma mensagem como se viesse de `url` e devolve a resposta. */
  function mensagem(msg, url = PAINEL) {
    return new Promise((resolve) => {
      let respondeu = false;
      const responder = (r) => { respondeu = true; resolve(JSON.parse(JSON.stringify(r))); };
      ouvintes.forEach((fn) => fn(msg, { id: 'ext', url, tab: { id: 1 } }, responder));
      setTimeout(() => { if (!respondeu) resolve(undefined); }, 50);
    });
  }

  const radarGuardado = () => storage[CHAVE];
  const rodar = (codigo) => vm.runInContext(codigo, sw);
  return { sw, storage, notificacoes, buscas, mensagem, radarGuardado, rodar, alarmes };
}

const semPausa = { pausa: async () => {} };
const duasBuscas = [{ id: 'b1', termo: 'mapas mentais', pais: 'BR' }, { id: 'b2', termo: 'emagrecer', pais: 'BR' }];

test('roda cada busca uma vez e guarda total e achados', async () => {
  const amb = ambiente({
    radar: { buscas: duasBuscas },
    respostas: {
      'mapas mentais': buscaHtml([anuncio('1', '111111', 20), anuncio('2', '222222', 300)], 6729),
      emagrecer: buscaHtml([anuncio('3', '333333', 12)], 900)
    }
  });
  await amb.sw.radarTick(semPausa);
  assert.equal(amb.buscas.length, 2);
  const r = amb.radarGuardado().resultados;
  assert.equal(r.b1.total, 6729);
  assert.deepEqual(r.b1.achados.map((a) => [a.pageId, a.novaEscalando, a.novo]), [['111111', true, false], ['222222', false, false]]);
  assert.equal(r.b2.achados[0].dias, 12);
  assert.equal(amb.notificacoes.length, 0);
});

test('no dia seguinte marca o anunciante novo e avisa uma vez', async () => {
  const ontem = diasAntes(1);
  const amb = ambiente({
    radar: {
      buscas: duasBuscas.slice(0, 1),
      resultados: { b1: { data: ontem, total: 6000, achados: [] } },
      vistos: { b1: { 111111: ontem } }
    },
    respostas: { 'mapas mentais': buscaHtml([anuncio('1', '111111', 20), anuncio('9', '999999', 15)], 6729) }
  });
  await amb.sw.radarTick(semPausa);
  const r = amb.radarGuardado().resultados.b1;
  assert.deepEqual(r.achados.map((a) => [a.pageId, a.novo]), [['111111', false], ['999999', true]]);
  assert.equal(r.totalAnterior, 6000);
  assert.equal(amb.notificacoes.length, 1);
  assert.match(amb.notificacoes[0].message, /1 oferta nova escalando/);
  await amb.sw.radarTick({ ...semPausa, forcar: true });
  assert.equal(amb.notificacoes.length, 1);
  assert.equal(amb.radarGuardado().resultados.b1.totalAnterior, 6000);
});

test('não busca de novo no mesmo dia', async () => {
  const amb = ambiente({ radar: { buscas: duasBuscas }, respostas: { 'mapas mentais': buscaHtml([]), emagrecer: buscaHtml([]) } });
  await amb.sw.radarTick(semPausa);
  await amb.sw.radarTick(semPausa);
  assert.equal(amb.buscas.length, 2);
});

test('desafio da Meta para o radar até amanhã', async () => {
  const desafio = "<script>function executeChallenge(){fetch('/x?challenge=3')}</script>";
  const amb = ambiente({ radar: { buscas: duasBuscas }, respostas: { 'mapas mentais': desafio, emagrecer: buscaHtml([]) } });
  await amb.sw.radarTick(semPausa);
  assert.equal(amb.buscas.length, 1);
  assert.equal(amb.radarGuardado().parado, 'bloqueio');
  await amb.sw.radarTick(semPausa);
  assert.equal(amb.buscas.length, 1);
});

test('sem buscas ou sem login não busca nada', async () => {
  const vazio = ambiente({ radar: { buscas: [] } });
  await vazio.sw.radarTick(semPausa);
  assert.equal(vazio.buscas.length, 0);
  const deslogado = ambiente({ radar: { buscas: duasBuscas }, logado: false });
  await deslogado.sw.radarTick(semPausa);
  assert.equal(deslogado.buscas.length, 0);
});

test('painel salva buscas limpas (até 10, sem repetir) e lista o radar', async () => {
  const amb = ambiente({ radar: { buscas: [{ id: 'b1', termo: 'mapas mentais', pais: 'BR' }], resultados: { b1: { data: 'x', achados: [] } } } });
  const pedidas = [{ termo: '  Mapas   Mentais ', pais: 'br' }, { termo: 'mapas mentais', pais: 'BR' }, { termo: '', pais: 'BR' }]
    .concat(Array.from({ length: 12 }, (_, i) => ({ termo: `nicho ${i}`, pais: 'US' })));
  const resp = await amb.mensagem({ type: 'RADAR_SALVAR_BUSCAS', buscas: pedidas });
  assert.equal(resp.success, true);
  const salvas = amb.radarGuardado().buscas;
  assert.equal(salvas.length, 10);
  assert.deepEqual(salvas[0], { id: 'b1', termo: 'mapas mentais', pais: 'BR' });
  assert.equal(salvas[1].pais, 'US');
  const lista = await amb.mensagem({ type: 'RADAR_LISTAR' });
  assert.equal(lista.buscas.length, 10);
  assert.ok(lista.resultados.b1);
});

test('mensagem do radar de fora do painel é recusada', async () => {
  const amb = ambiente({ radar: { buscas: [] } });
  const resp = await amb.mensagem({ type: 'RADAR_SALVAR_BUSCAS', buscas: [{ termo: 'x', pais: 'BR' }] }, 'https://site-qualquer.com/');
  assert.equal(resp.success, false);
  assert.deepEqual(amb.radarGuardado().buscas, []);
});

// ---- Correções da revisão final do Radar ----

test('rodar de novo no mesmo dia mantém o "Novo no radar"', async () => {
  const ontem = diasAntes(1);
  const amb = ambiente({
    radar: { buscas: duasBuscas.slice(0, 1), resultados: { b1: { data: ontem, total: 6000, achados: [] } }, vistos: { b1: { 111111: ontem } } },
    respostas: { 'mapas mentais': buscaHtml([anuncio('1', '111111', 20), anuncio('9', '999999', 15)]) }
  });
  await amb.sw.radarTick(semPausa);
  await amb.sw.radarTick({ ...semPausa, forcar: true });
  assert.deepEqual(amb.radarGuardado().resultados.b1.achados.map((a) => [a.pageId, a.novo]), [['111111', false], ['999999', true]]);
});

test('primeira rodada de uma busca, repetida no mesmo dia, continua sem "novo"', async () => {
  const amb = ambiente({ radar: { buscas: duasBuscas.slice(0, 1) }, respostas: { 'mapas mentais': buscaHtml([anuncio('1', '111111', 20)]) } });
  await amb.sw.radarTick(semPausa);
  await amb.sw.radarTick({ ...semPausa, forcar: true });
  assert.equal(amb.radarGuardado().resultados.b1.achados[0].novo, false);
});

test('o Radar só roda sozinho depois que o rastreio das ofertas terminou hoje', async () => {
  const meio = { ligado: true, dia: hojeLocal(), fila: ['x'], terminadoEm: null, parado: null };
  const amb = ambiente({ radar: { buscas: duasBuscas }, rastreio: meio, respostas: { 'mapas mentais': buscaHtml([]), emagrecer: buscaHtml([]) } });
  await amb.sw.radarTick(semPausa);
  assert.equal(amb.buscas.length, 0);
});

test('com a Meta freando o rastreio hoje, o Radar não insiste', async () => {
  const freado = { ligado: true, dia: hojeLocal(), fila: ['x'], terminadoEm: null, parado: 'bloqueio' };
  const amb = ambiente({ radar: { buscas: duasBuscas }, rastreio: freado, respostas: { 'mapas mentais': buscaHtml([]), emagrecer: buscaHtml([]) } });
  await amb.sw.radarTick(semPausa);
  assert.equal(amb.buscas.length, 0);
});

test('rastreio desligado no popup desliga o Radar automático; Rodar agora continua valendo', async () => {
  const desligado = { ...rastreioTerminado(), ligado: false };
  const amb = ambiente({ radar: { buscas: duasBuscas }, rastreio: desligado, respostas: { 'mapas mentais': buscaHtml([]), emagrecer: buscaHtml([]) } });
  await amb.sw.radarTick(semPausa);
  assert.equal(amb.buscas.length, 0);
  await amb.sw.radarTick({ ...semPausa, forcar: true });
  assert.equal(amb.buscas.length, 2);
});

test('Rodar agora com o rastreio no meio espera e agenda para logo depois', async () => {
  const amb = ambiente({ radar: { buscas: duasBuscas }, respostas: { 'mapas mentais': buscaHtml([]), emagrecer: buscaHtml([]) } });
  amb.rodar('rastreioRodando = true;');
  await amb.sw.radarTick({ ...semPausa, forcar: true });
  assert.equal(amb.buscas.length, 0);
  assert.ok(amb.alarmes.some((a) => a.nome === 'radar-agora'));
});

test('uma leitura que falhou pula só aquela busca, sem dizer que a Meta freou', async () => {
  const amb = ambiente({ radar: { buscas: duasBuscas }, respostas: { 'mapas mentais': null, emagrecer: buscaHtml([anuncio('3', '333333', 12)]) } });
  await amb.sw.radarTick(semPausa);
  const r = amb.radarGuardado();
  assert.equal(r.resultados.b1, undefined);
  assert.equal(r.resultados.b2.achados.length, 1);
  assert.notEqual(r.parado, 'bloqueio');
});

test('busca removida no painel durante a rodada não volta e não é buscada', async () => {
  const amb = ambiente({
    radar: { buscas: duasBuscas },
    respostas: { 'mapas mentais': buscaHtml([]), emagrecer: buscaHtml([]) },
    aoBuscar: ({ termo, storage }) => {
      if (termo === 'mapas mentais') storage[CHAVE] = { ...storage[CHAVE], buscas: [{ id: 'b1', termo: 'mapas mentais', pais: 'BR' }, { id: 'b3', termo: 'receitas', pais: 'BR' }] };
    }
  });
  await amb.sw.radarTick(semPausa);
  const r = amb.radarGuardado();
  assert.deepEqual(r.buscas.map((b) => b.id), ['b1', 'b3']);
  assert.equal(r.resultados.b2, undefined);
  assert.ok(!amb.buscas.some((u) => u.includes('emagrecer')));
});

test('com desafio da Meta, as buscas salvas no meio não se perdem', async () => {
  const desafio = "<script>function executeChallenge(){fetch('/x?challenge=3')}</script>";
  const amb = ambiente({
    radar: { buscas: duasBuscas },
    respostas: { 'mapas mentais': desafio },
    aoBuscar: ({ storage }) => { storage[CHAVE] = { ...storage[CHAVE], buscas: [...storage[CHAVE].buscas, { id: 'b9', termo: 'nova', pais: 'BR' }] }; }
  });
  await amb.sw.radarTick(semPausa);
  assert.deepEqual(amb.radarGuardado().buscas.map((b) => b.id), ['b1', 'b2', 'b9']);
});

test('cada conta tem o próprio Radar', async () => {
  const amb = ambiente({ radar: { buscas: duasBuscas } });
  amb.storage.minerai_user = { ...USER, id: '11111111-2222-4333-8444-555555555555' };
  const lista = await amb.mensagem({ type: 'RADAR_LISTAR' });
  assert.deepEqual(lista.buscas, []);
});
