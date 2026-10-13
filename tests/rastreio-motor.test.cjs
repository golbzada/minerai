// Motor do rastreio diário no service worker (extension/rastreio.js).
// Supabase, Biblioteca e chrome.* são falsos; o resto é o código real.
// Rodar: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarScript, chromeFalso } = require('./carregar-script.cjs');

const USER = { id: '02287553-9ef6-4803-a2d9-dfbbc2b31b64', name: 'Teste', email: 't@t.t' };
// JWT com exp no ano 2286: nunca vence durante o teste.
const TOKEN = `x.${Buffer.from(JSON.stringify({ exp: 9999999999 })).toString('base64url')}.y`;

function hojeLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function diasAntes(n) {
  const d = new Date(`${hojeLocal()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
const notas = (texto, meta) => `${texto}${texto ? '\n\n' : ''}[[minerai:${JSON.stringify({ v: 1, ...meta })}]]`;
const uuid = (n) => `00000000-0000-4000-8000-00000000000${n}`;

/**
 * Monta o ambiente: ofertas no "banco", respostas da Biblioteca por anúncio e
 * por página, e o que já está guardado no chrome.storage.
 */
function ambiente({ ofertas, anuncios = {}, paginas = {}, sites = {}, logado = true, estado = null, planoInativo = false, aoBuscarPagina = null, aoGravar = null }) {
  const storage = {};
  if (logado) {
    storage.minerai_user = USER;
    storage.minerai_session = { access_token: TOKEN, refresh_token: 'r', expires_at: 9999999999 };
  }
  if (estado) storage.minerai_rastreio = estado;

  const patches = [];
  const notificacoes = [];
  const alarmes = [];
  const buscasMeta = [];
  const credenciaisMeta = [];

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
    alarms: { create: (nome, info) => alarmes.push({ nome, info }), onAlarm: { addListener() {} } },
    notifications: { create: (id, info) => notificacoes.push(info), onClicked: { addListener() {} } }
  });

  const resposta = (corpo, status = 200) => ({
    ok: status < 400,
    status,
    text: async () => (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)),
    // Cópia, como na rede de verdade: mudar a linha depois não muda o que já foi lido.
    json: async () => JSON.parse(typeof corpo === 'string' ? corpo : JSON.stringify(corpo))
  });

  async function fetch(url, opcoes = {}) {
    const u = String(url);
    if (u.includes('/rest/v1/offers')) {
      if ((opcoes.method || 'GET') === 'PATCH') {
        if (planoInativo) return resposta('new row violates row-level security policy for table "offers"', 403);
        const id = u.match(/[?&]id=eq\.([0-9a-f-]+)/)[1];
        const corpo = JSON.parse(opcoes.body);
        patches.push({ id, corpo, auth: (opcoes.headers || {}).Authorization });
        if (aoGravar) aoGravar({ id, corpo, storage });
        const linha = ofertas.find((o) => o.id === id);
        Object.assign(linha, corpo);
        return resposta([linha]);
      }
      const um = u.match(/[?&]id=eq\.([0-9a-f-]+)/);
      if (um) return resposta(ofertas.filter((o) => o.id === um[1]));
      return resposta(ofertas.map((o) => ({ id: o.id, funnel_notes: o.funnel_notes })));
    }
    if (u.includes('facebook.com/ads/library/')) {
      buscasMeta.push(u);
      credenciaisMeta.push(opcoes.credentials);
      const id = (u.match(/[?&]id=(\d+)/) || [])[1];
      if (id) return resposta(anuncios[id] ?? '<html></html>');
      const site = (u.match(/[?&]q=([^&]*)/) || [])[1];
      if (site) {
        const valor = sites[decodeURIComponent(site)];
        if (valor === 'falha') return resposta('', 503);
        return resposta(`{"search_results_connection":{"count":${valor ?? 0},"edges":[]}}`);
      }
      const pagina = u.match(/view_all_page_id=(\d+)/)[1];
      if (aoBuscarPagina) aoBuscarPagina({ pagina, ofertas });
      const pais = u.match(/country=([A-Z]+)/)[1];
      const valor = paginas[`${pagina}:${pais}`] ?? paginas[pagina];
      return resposta(valor === undefined ? '<html></html>' : `{"search_results_connection":{"count":${valor},"edges":[]}}`);
    }
    throw new Error(`fetch inesperado: ${u}`);
  }

  const sw = carregarScript('extension/background.js', { chrome, fetch });
  return { sw, storage, patches, notificacoes, alarmes, buscasMeta, credenciaisMeta };
}

const anuncio = (libraryId, pageId, ativo = true) =>
  `{"ad_archive_id":"${libraryId}","is_active":${ativo},"page_id":"${pageId}"}`;

const semPausa = { pausa: async () => {} };

function tresOfertas() {
  return [1, 2, 3].map((n) => ({
    id: uuid(n),
    history: [],
    status: 'testing',
    page_id: '',
    funnel_notes: notas('', { library_id: `90000${n}00`, start_date: diasAntes(5) })
  }));
}
const anunciosTres = { '90000100': anuncio('90000100', '7000001'), '90000200': anuncio('90000200', '7000002'), '90000300': anuncio('90000300', '7000003') };
const paginasTres = { '7000001': 5, '7000002': 8, '7000003': 13 };

test('mede as 3 ofertas e guarda o total do anunciante', async () => {
  const amb = ambiente({ ofertas: tresOfertas(), anuncios: anunciosTres, paginas: paginasTres });
  await amb.sw.rastreioTick(semPausa);
  assert.equal(amb.patches.length, 3);
  assert.deepEqual(amb.patches.map((p) => p.corpo.ads_count).sort((a, b) => a - b), [5, 8, 13]);
  const h = amb.patches[0].corpo.history;
  assert.equal(h[h.length - 1].kind, 'anunciante');
  assert.equal(amb.storage.minerai_rastreio.feitas, 3);
  assert.equal(amb.storage.minerai_rastreio.fila.length, 0);
  assert.ok(amb.storage.minerai_rastreio.terminadoEm);
});

test('não mede de novo no mesmo dia', async () => {
  const amb = ambiente({ ofertas: tresOfertas(), anuncios: anunciosTres, paginas: paginasTres });
  await amb.sw.rastreioTick(semPausa);
  await amb.sw.rastreioTick(semPausa);
  assert.equal(amb.patches.length, 3);
});

test('captcha da Meta para a rodada sem gravar nada', async () => {
  const anuncios = { ...anunciosTres, '90000100': '"xfb_ad_library_is_captcha_required":true' };
  const amb = ambiente({ ofertas: tresOfertas(), anuncios, paginas: paginasTres });
  await amb.sw.rastreioTick(semPausa);
  assert.equal(amb.patches.length, 0);
  assert.equal(amb.storage.minerai_rastreio.parado, 'bloqueio');
});

test('desligado não roda', async () => {
  const amb = ambiente({ ofertas: tresOfertas(), anuncios: anunciosTres, paginas: paginasTres, estado: { ligado: false } });
  await amb.sw.rastreioTick(semPausa);
  assert.equal(amb.patches.length, 0);
  assert.equal(amb.buscasMeta.length, 0);
});

test('sem login não roda e não busca na Biblioteca', async () => {
  const amb = ambiente({ ofertas: tresOfertas(), anuncios: anunciosTres, paginas: paginasTres, logado: false });
  await amb.sw.rastreioTick(semPausa);
  assert.equal(amb.patches.length, 0);
  assert.equal(amb.buscasMeta.length, 0);
  assert.equal(amb.storage.minerai_rastreio.parado, 'sem_login');
});

test('relê a oferta antes de gravar e não apaga anotações novas', async () => {
  const ofertas = tresOfertas();
  ofertas[0].funnel_notes = notas('minhas notas de agora', { library_id: '90000100', start_date: diasAntes(5) });
  const amb = ambiente({ ofertas, anuncios: anunciosTres, paginas: paginasTres });
  await amb.sw.rastreioTick(semPausa);
  const p = amb.patches.find((x) => x.id === uuid(1));
  assert.ok(p.corpo.funnel_notes.startsWith('minhas notas de agora'));
  assert.match(p.corpo.funnel_notes, /"page_id_real":"7000001"/);
});

test('oferta antiga sem país tenta ALL quando o Brasil dá zero', async () => {
  const amb = ambiente({
    ofertas: tresOfertas().slice(0, 1),
    anuncios: anunciosTres,
    paginas: { '7000001:BR': 0, '7000001:ALL': 12 }
  });
  await amb.sw.rastreioTick(semPausa);
  assert.equal(amb.patches[0].corpo.ads_count, 12);
  assert.match(amb.patches[0].corpo.funnel_notes, /"country":"ALL"/);
  assert.doesNotMatch(amb.patches[0].corpo.funnel_notes, /dead_/);
});

test('escalou gera uma notificação no fim da rodada', async () => {
  const ofertas = tresOfertas();
  ofertas[0].history = [{ date: diasAntes(1), count: 10, kind: 'anunciante' }];
  ofertas[0].funnel_notes = notas('', { library_id: '90000100', start_date: diasAntes(5), page_active_ads: 10 });
  const amb = ambiente({ ofertas, anuncios: anunciosTres, paginas: { ...paginasTres, '7000001': 30 } });
  await amb.sw.rastreioTick(semPausa);
  assert.equal(amb.notificacoes.length, 1);
  assert.match(amb.notificacoes[0].message, /1 oferta escalou/);
  assert.equal(amb.storage.minerai_rastreio.eventos.escalou, 1);
});

test('rodada sem evento forte não notifica', async () => {
  const amb = ambiente({ ofertas: tresOfertas(), anuncios: anunciosTres, paginas: paginasTres });
  await amb.sw.rastreioTick(semPausa);
  assert.equal(amb.notificacoes.length, 0);
});

test('estágio usa os dias e o total do anunciante', async () => {
  const ofertas = tresOfertas().slice(0, 1);
  ofertas[0].funnel_notes = notas('', { library_id: '90000100', start_date: diasAntes(15) });
  const amb = ambiente({ ofertas, anuncios: anunciosTres, paginas: { '7000001': 12 } });
  await amb.sw.rastreioTick(semPausa);
  assert.equal(amb.patches[0].corpo.status, 'scaling');
});

test('estágio fixado à mão não muda', async () => {
  const ofertas = tresOfertas().slice(0, 1);
  ofertas[0].status = 'winner';
  ofertas[0].funnel_notes = notas('', { library_id: '90000100', start_date: diasAntes(15), status_manual: true });
  const amb = ambiente({ ofertas, anuncios: anunciosTres, paginas: { '7000001': 12 } });
  await amb.sw.rastreioTick(semPausa);
  assert.equal(amb.patches[0].corpo.status, undefined);
});

// ---- Correções da revisão final ----

function semId(n) {
  return { id: uuid(n), history: [], status: 'testing', page_id: '4', funnel_notes: notas('', { start_date: diasAntes(5) }) };
}

test('ofertas sem ID não param a rodada e vão para o fim da fila', async () => {
  const boa = tresOfertas()[0];
  const amb = ambiente({ ofertas: [semId(7), semId(8), semId(9), boa], anuncios: anunciosTres, paginas: paginasTres });
  await amb.sw.rastreioTick(semPausa);
  assert.equal(amb.storage.minerai_rastreio.parado, null);
  const medidas = amb.patches.filter((p) => p.corpo.ads_count !== undefined);
  assert.deepEqual(medidas.map((p) => p.id), [boa.id]);
  const tentadas = amb.patches.filter((p) => p.corpo.ads_count === undefined);
  assert.equal(tentadas.length, 3);
  assert.ok(tentadas.every((p) => /"track_tentativa":"\d{4}-\d{2}-\d{2}"/.test(p.corpo.funnel_notes)));
  assert.ok(amb.buscasMeta.every((u) => u.includes('90000100') || u.includes('7000001')));
});

test('gringa antiga com criativo parado tenta o mundo todo antes de dar zero', async () => {
  const amb = ambiente({
    ofertas: tresOfertas().slice(0, 1),
    anuncios: { '90000100': anuncio('90000100', '7000001', false) },
    paginas: { '7000001:BR': 0, '7000001:ALL': 12 }
  });
  await amb.sw.rastreioTick(semPausa);
  assert.equal(amb.patches[0].corpo.ads_count, 12);
  assert.match(amb.patches[0].corpo.funnel_notes, /"country":"ALL"/);
  assert.doesNotMatch(amb.patches[0].corpo.funnel_notes, /dead_check/);
});

test('zero de página não confirmada não vira medição', async () => {
  const oferta = { id: uuid(1), history: [], status: 'scaling', page_id: '123456789', funnel_notes: notas('', { start_date: diasAntes(40) }) };
  const amb = ambiente({ ofertas: [oferta], paginas: { '123456789': 0 } });
  await amb.sw.rastreioTick(semPausa);
  assert.equal(amb.patches.length, 1);
  assert.equal(amb.patches[0].corpo.ads_count, undefined);
  assert.equal(amb.patches[0].corpo.status, undefined);
  assert.match(amb.patches[0].corpo.funnel_notes, /track_tentativa/);
  assert.doesNotMatch(amb.patches[0].corpo.funnel_notes, /tracked_at/);
});

test('edição feita no painel durante a leitura não é apagada', async () => {
  const amb = ambiente({
    ofertas: tresOfertas().slice(0, 1),
    anuncios: anunciosTres,
    paginas: paginasTres,
    aoBuscarPagina: ({ ofertas }) => {
      ofertas[0].funnel_notes = notas('anotei agora', { library_id: '90000100', start_date: diasAntes(5), fav: true });
    }
  });
  await amb.sw.rastreioTick(semPausa);
  assert.ok(amb.patches[0].corpo.funnel_notes.startsWith('anotei agora'));
  assert.match(amb.patches[0].corpo.funnel_notes, /"fav":true/);
});

test('plano inativo para o dia inteiro, sem voltar à Biblioteca', async () => {
  const amb = ambiente({ ofertas: tresOfertas(), anuncios: anunciosTres, paginas: paginasTres, planoInativo: true });
  await amb.sw.rastreioTick(semPausa);
  assert.equal(amb.storage.minerai_rastreio.parado, 'plano');
  const antes = amb.buscasMeta.length;
  await amb.sw.rastreioTick(semPausa);
  assert.equal(amb.buscasMeta.length, antes);
});

test('desligar no meio da rodada para e continua desligado', async () => {
  const amb = ambiente({
    ofertas: tresOfertas(),
    anuncios: anunciosTres,
    paginas: paginasTres,
    aoGravar: ({ storage }) => { storage.minerai_rastreio = { ...storage.minerai_rastreio, ligado: false }; }
  });
  await amb.sw.rastreioTick(semPausa);
  assert.equal(amb.storage.minerai_rastreio.ligado, false);
  assert.equal(amb.patches.length, 1);
});

test('Rodar agora com o rastreio desligado termina a rodada nas continuações', async () => {
  const ofertas = tresOfertas();
  const hoje = hojeLocal();
  const amb = ambiente({
    ofertas,
    anuncios: anunciosTres,
    paginas: paginasTres,
    estado: { ligado: false, dia: hoje, fila: ofertas.map((o) => o.id), total: 3, feitas: 0, eventos: { escalou: 0, morreu: 0, decaindo: 0 }, forcado: hoje, terminadoEm: null, parado: null }
  });
  await amb.sw.rastreioTick(semPausa);
  assert.equal(amb.patches.length, 3);
  assert.ok(amb.storage.minerai_rastreio.terminadoEm);
});

test('leitura usa os cookies normais do navegador (sem eles a Meta manda desafio)', async () => {
  const amb = ambiente({ ofertas: tresOfertas(), anuncios: anunciosTres, paginas: paginasTres });
  await amb.sw.rastreioTick(semPausa);
  assert.ok(amb.credenciaisMeta.length > 0);
  assert.ok(amb.credenciaisMeta.every((c) => c === 'include'));
});

test('desafio anti-robô da Meta para a rodada (não tenta burlar)', async () => {
  const desafio = "<script>function executeChallenge(){fetch('/abc?challenge=3',{method:'POST'})}</script>";
  const anuncios = { ...anunciosTres, '90000100': desafio };
  const amb = ambiente({ ofertas: tresOfertas(), anuncios, paginas: paginasTres });
  await amb.sw.rastreioTick(semPausa);
  assert.equal(amb.storage.minerai_rastreio.parado, 'bloqueio');
  assert.equal(amb.patches.length, 0);
  assert.ok(!amb.buscasMeta.some((u) => u.includes('challenge')));
});

test('o estado separa ofertas medidas das só tentadas', async () => {
  const boa = tresOfertas()[0];
  const amb = ambiente({ ofertas: [semId(7), semId(8), semId(9), boa], anuncios: anunciosTres, paginas: paginasTres });
  await amb.sw.rastreioTick(semPausa);
  assert.equal(amb.storage.minerai_rastreio.feitas, 4);
  assert.equal(amb.storage.minerai_rastreio.medidas, 1);
});

test('acesso renovado no meio da rodada passa a ser usado nas próximas ofertas', async () => {
  const NOVO = `n.${Buffer.from(JSON.stringify({ exp: 9999999999 })).toString('base64url')}.z`;
  let trocou = false;
  const amb = ambiente({
    ofertas: tresOfertas(),
    anuncios: anunciosTres,
    paginas: paginasTres,
    aoGravar: ({ storage }) => {
      if (!trocou) {
        trocou = true;
        storage.minerai_session = { access_token: NOVO, refresh_token: 'r2', expires_at: 9999999999 };
      }
    }
  });
  await amb.sw.rastreioTick(semPausa);
  assert.equal(amb.patches[amb.patches.length - 1].auth, `Bearer ${NOVO}`);
});

// ---- Gringa x Brasil no acervo ----

function gringa(extra = {}) {
  return {
    id: uuid(1),
    history: [],
    status: 'testing',
    page_id: '',
    landing_page: 'https://www.shop.pipitea.com/oferta',
    funnel_notes: notas('', { library_id: '90000100', start_date: diasAntes(5), country: 'US', ...extra })
  };
}

test('oferta gringa: o rastreio confere o Brasil e guarda junto da medição', async () => {
  const amb = ambiente({
    ofertas: [gringa()],
    anuncios: anunciosTres,
    paginas: { '7000001:US': 40, '7000001:BR': 0 },
    sites: { '"pipitea"': 0 }
  });
  await amb.sw.rastreioTick(semPausa);
  const notas = amb.patches[0].corpo.funnel_notes;
  assert.equal(amb.patches[0].corpo.ads_count, 40);
  assert.match(notas, /"brasil_ads":0/);
  assert.match(notas, /"brasil_site":0/);
  assert.match(notas, /"brasil_at":"\d{4}-\d{2}-\d{2}"/);
});

test('oferta gringa já conferida nesta semana não confere de novo', async () => {
  const amb = ambiente({
    ofertas: [gringa({ brasil_ads: 2, brasil_site: 0, brasil_at: diasAntes(2) })],
    anuncios: anunciosTres,
    paginas: { '7000001:US': 40, '7000001:BR': 5 }
  });
  await amb.sw.rastreioTick(semPausa);
  assert.ok(!amb.buscasMeta.some((u) => u.includes('country=BR')));
  assert.match(amb.patches[0].corpo.funnel_notes, /"brasil_ads":2/);
});

test('oferta gringa: site que não respondeu não grava nada do Brasil', async () => {
  const amb = ambiente({
    ofertas: [gringa()],
    anuncios: anunciosTres,
    paginas: { '7000001:US': 40, '7000001:BR': 0 },
    sites: { '"pipitea"': 'falha' }
  });
  await amb.sw.rastreioTick(semPausa);
  assert.equal(amb.patches[0].corpo.ads_count, 40);
  assert.doesNotMatch(amb.patches[0].corpo.funnel_notes, /brasil_/);
});

test('oferta gringa: desafio na checagem do Brasil grava a medição e para', async () => {
  const desafio = "<script>function executeChallenge(){fetch('/x?challenge=3')}</script>";
  const ofertas = [gringa(), { ...gringa(), id: uuid(2), funnel_notes: notas('', { library_id: '90000200', start_date: diasAntes(5), country: 'US' }) }];
  const amb = ambiente({ ofertas, anuncios: anunciosTres, paginas: { '7000001:US': 40, '7000001:BR': desafio, '7000002:US': 5 } });
  await amb.sw.rastreioTick(semPausa);
  assert.equal(amb.patches.length, 1);
  assert.equal(amb.patches[0].corpo.ads_count, 40);
  assert.equal(amb.storage.minerai_rastreio.parado, 'bloqueio');
});

test('no máximo 30 checagens do Brasil por dia no rastreio', async () => {
  const ofertas = Array.from({ length: 33 }, (_, i) => ({
    ...gringa(),
    id: `00000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}`,
    funnel_notes: notas('', { library_id: '90000100', start_date: diasAntes(5), country: 'US' })
  }));
  const amb = ambiente({ ofertas, anuncios: anunciosTres, paginas: { '7000001:US': 40, '7000001:BR': 0 }, sites: { '"pipitea"': 0 } });
  await amb.sw.rastreioTick(semPausa);
  const checadas = amb.buscasMeta.filter((u) => u.includes('country=BR') && u.includes('view_all_page_id')).length;
  assert.equal(checadas, 30);
});
