// Regras puras do rastreio diário (extension/rastreio-regras.js).
// Rodar: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarScript } = require('./carregar-script.cjs');

// O arquivo é um script clássico (como o Chrome carrega): roda num contexto
// isolado com `self` e devolve o que ele pendura ali.
const bruto = carregarScript('extension/rastreio-regras.js').MineraiRastreio;

// Objetos criados no outro contexto têm outro protótipo: viram JSON simples
// antes de comparar.
const plain = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const R = Object.fromEntries(
  Object.entries(bruto).map(([k, v]) => [k, typeof v === 'function' ? (...a) => plain(v(...a)) : v])
);

const HOJE = '2026-10-13';

function diasAntes(n, base = HOJE) {
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function anunciante(pares) {
  return pares.map(([dias, count]) => ({ date: diasAntes(dias), count, kind: 'anunciante' }));
}

test('lerAnuncio acha page_id e is_active perto do anúncio', () => {
  const html = 'xx"page_id":"111111111"' + 'a'.repeat(5000) +
    '"ad_archive_id":"123","foo":1,"is_active":false,"page_id":"999999999"zz';
  assert.deepEqual(R.lerAnuncio(html, '123'), { pageId: '999999999', ativo: false });
});

test('lerAnuncio sem o anúncio devolve vazio', () => {
  assert.deepEqual(R.lerAnuncio('<html></html>', '123'), { pageId: '', ativo: null });
});

test('lerAnuncio usa o page_id anterior quando não há depois', () => {
  const html = '"page_id":"555555555","is_active":true,"ad_archive_id":"77"';
  assert.deepEqual(R.lerAnuncio(html, '77'), { pageId: '555555555', ativo: true });
});

test('lerTotal lê o count e devolve null sem marcador', () => {
  assert.equal(R.lerTotal('...{"search_results_connection":{"count":27,"edges":[]}'), 27);
  assert.equal(R.lerTotal('<html>nada</html>'), null);
});

test('pareceBloqueio detecta captcha', () => {
  assert.equal(R.pareceBloqueio('"xfb_ad_library_is_captcha_required":true'), true);
  assert.equal(R.pareceBloqueio('"xfb_ad_library_is_captcha_required":false'), false);
});

test('upsertHistory grava kind só na entrada nova e preserva os antigos', () => {
  const h = R.upsertHistory([{ date: '2026-10-01', count: 3 }], '2026-10-02', 12, 'anunciante');
  assert.equal(h.length, 2);
  assert.equal(h[0].kind, undefined);
  assert.equal(h[1].kind, 'anunciante');
  assert.equal(h[1].count, 12);
  const h2 = R.upsertHistory(h, '2026-10-03', 5);
  assert.equal(h2[1].kind, 'anunciante');
});

test('diasNoAr congela na data da morte', () => {
  assert.equal(R.diasNoAr('2026-09-01', '2026-09-11', HOJE), 11);
  assert.equal(R.diasNoAr('2026-09-01', null, HOJE), 43);
});

test('classifyStage segue tempo e exceção por anúncios', () => {
  assert.equal(R.classifyStage(16, 10), 'scaling');
  assert.equal(R.classifyStage(16, 9), 'pre_scaling');
  assert.equal(R.classifyStage(160, 0), 'winner');
});

const leitura = (total, extra = {}) => ({ date: HOJE, total, ativo: true, pageIdConfirmado: true, ...extra });

test('primeira leitura só cria base', () => {
  const r = R.avaliarLeitura({ meta: {}, history: [] }, leitura(40));
  assert.deepEqual(r.eventos, []);
  assert.equal(r.meta.page_active_ads, 40);
  assert.equal(r.meta.tracked_at.slice(0, 10), HOJE);
});

test('escalou compara com a menor leitura dos últimos 7 dias', () => {
  const base = { meta: { page_active_ads: 12 }, history: anunciante([[6, 10], [3, 12], [1, 12]]) };
  const sim = R.avaliarLeitura(base, leitura(16));
  assert.equal(sim.eventos.length, 1);
  assert.deepEqual(
    { tipo: sim.eventos[0].tipo, de: sim.eventos[0].de, para: sim.eventos[0].para },
    { tipo: 'escalou', de: 10, para: 16 }
  );
  assert.deepEqual(R.avaliarLeitura(base, leitura(14)).eventos, []);
});

test('escalou ignora números antigos sem kind', () => {
  const base = { meta: { page_active_ads: 12 }, history: [{ date: diasAntes(2), count: 1 }] };
  assert.deepEqual(R.avaliarLeitura(base, leitura(16)).eventos, []);
});

test('decaindo usa a maior leitura dos 7 dias', () => {
  const base = { meta: { page_active_ads: 18 }, history: anunciante([[5, 20], [2, 18]]) };
  assert.equal(R.avaliarLeitura(base, leitura(10)).eventos[0].tipo, 'decaindo');
  const pequeno = { meta: { page_active_ads: 3 }, history: anunciante([[2, 3]]) };
  assert.deepEqual(R.avaliarLeitura(pequeno, leitura(1)).eventos, []);
});

test('morreu só na segunda leitura em outro dia', () => {
  const base = { meta: { page_active_ads: 8, ad_active: true }, history: anunciante([[1, 8]]) };
  const morto = { total: 0, ativo: false };
  const r1 = R.avaliarLeitura(base, leitura(0, { ...morto, date: diasAntes(1) }));
  assert.deepEqual(r1.eventos.filter((e) => e.tipo === 'morreu'), []);
  assert.equal(r1.meta.dead_check, diasAntes(1));
  const r2 = R.avaliarLeitura({ meta: r1.meta, history: base.history }, leitura(0, morto));
  assert.equal(r2.eventos.filter((e) => e.tipo === 'morreu').length, 1);
  assert.equal(r2.meta.dead_since, diasAntes(1));
  assert.equal(r2.meta.dead_check, undefined);
});

test('morreu nunca sem page_id confirmado', () => {
  const meta = { page_active_ads: 8, dead_check: diasAntes(1) };
  const r = R.avaliarLeitura({ meta, history: [] }, leitura(0, { ativo: false, pageIdConfirmado: false }));
  assert.equal(r.meta.dead_since, undefined);
  assert.deepEqual(r.eventos, []);
});

test('voltou ao ar limpa dead_since', () => {
  const meta = { page_active_ads: 0, dead_since: '2026-10-01', ad_active: false };
  const r = R.avaliarLeitura({ meta, history: [] }, leitura(5));
  assert.equal(r.eventos[0].tipo, 'voltou');
  assert.equal(r.meta.dead_since, undefined);
});

test('criativo saiu do ar com anunciante ativo', () => {
  const meta = { page_active_ads: 8, ad_active: true };
  const r = R.avaliarLeitura({ meta, history: anunciante([[1, 8]]) }, leitura(8, { ativo: false }));
  assert.equal(r.eventos[0].tipo, 'criativo_saiu');
  assert.equal(r.meta.ad_active, false);
});

test('track_events guarda no máximo 5 e esquece os de mais de 7 dias', () => {
  const antigos = [
    { tipo: 'escalou', data: diasAntes(8), de: 1, para: 9 },
    ...[1, 2, 3, 4, 5].map((n) => ({ tipo: 'decaindo', data: diasAntes(n), de: 9, para: 1 }))
  ];
  const base = { meta: { page_active_ads: 8, ad_active: true, track_events: antigos }, history: anunciante([[1, 8]]) };
  const r = R.avaliarLeitura(base, leitura(8, { ativo: false }));
  assert.equal(r.meta.track_events.length, 5);
  assert.ok(r.meta.track_events.every((e) => e.data >= diasAntes(7)));
  assert.equal(r.meta.track_events[r.meta.track_events.length - 1].tipo, 'criativo_saiu');
});

test('não repete o mesmo evento dentro da janela', () => {
  const meta = { page_active_ads: 16, track_events: [{ tipo: 'escalou', data: diasAntes(1), de: 10, para: 16 }] };
  const r = R.avaliarLeitura({ meta, history: anunciante([[6, 10], [1, 16]]) }, leitura(18));
  assert.deepEqual(r.eventos, []);
});

test('montarFila: favoritas primeiro, teto 200, pula descartada e já medida', () => {
  const offers = Array.from({ length: 250 }, (_, i) => ({ id: `o${i}`, meta: {} }));
  offers[247].meta.fav = true;
  offers[248].meta.fav = true;
  offers[249].meta.fav = true;
  offers[0].meta.stage = 'descartada';
  offers[1].meta.tracked_at = `${HOJE}T08:00`;
  const fila = R.montarFila(offers, HOJE);
  assert.equal(fila.length, 200);
  assert.deepEqual(fila.slice(0, 3).sort(), ['o247', 'o248', 'o249']);
  assert.ok(!fila.includes('o0'));
  assert.ok(!fila.includes('o1'));
});

test('montarFila: medidas há mais tempo entram antes', () => {
  const offers = [
    { id: 'a', meta: { tracked_at: '2026-10-12T09:00' } },
    { id: 'b', meta: { tracked_at: '2026-10-10T09:00' } },
    { id: 'c', meta: {} }
  ];
  assert.deepEqual(R.montarFila(offers, HOJE), ['c', 'b', 'a']);
});

test('resumoDoRastreio descreve cada estado em português simples', () => {
  const base = { ligado: true, dia: HOJE, fila: [], total: 109, feitas: 109, eventos: { escalou: 3, morreu: 1 }, terminadoEm: `${HOJE}T09:12`, parado: null };
  assert.equal(R.resumoDoRastreio(base, false, HOJE), 'Hoje às 09:12 · 109 ofertas · 3 escalaram, 1 morreu');
  assert.equal(R.resumoDoRastreio({ ...base, eventos: {} }, false, HOJE), 'Hoje às 09:12 · 109 ofertas');
  assert.equal(R.resumoDoRastreio({ ...base, fila: ['a'], feitas: 40, terminadoEm: null }, true, HOJE), 'Medindo: 40 de 109');
  assert.equal(R.resumoDoRastreio({ ...base, ligado: false }, false, HOJE), 'Desligado');
  assert.equal(R.resumoDoRastreio({ ...base, parado: 'bloqueio', terminadoEm: null }, false, HOJE), 'A Meta pediu uma pausa. Tenta de novo amanhã.');
  assert.equal(R.resumoDoRastreio({ ...base, parado: 'sem_login' }, false, HOJE), 'Conecte a conta para medir.');
  assert.equal(R.resumoDoRastreio({ ...base, parado: 'plano' }, false, HOJE), 'Plano inativo: rastreio pausado.');
  assert.equal(R.resumoDoRastreio({ ligado: true }, false, HOJE), 'Ainda não rodou hoje.');
  assert.equal(R.resumoDoRastreio({ ...base, dia: '2026-10-12' }, false, HOJE), 'Ainda não rodou hoje.');
});
