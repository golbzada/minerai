// Regras puras do Radar do nicho (extension/radar-regras.js).
// Rodar: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarScript } = require('./carregar-script.cjs');

const bruto = carregarScript('extension/radar-regras.js').MineraiRadar;
const plain = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const R = Object.fromEntries(
  Object.entries(bruto).map(([k, v]) => [k, typeof v === 'function' ? (...a) => plain(v(...a)) : v])
);

const HOJE = '2026-10-13';
const unix = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)), 7) / 1000;

function anuncio(id, pageId, inicio, extra = {}) {
  return {
    ad_archive_id: id,
    page_id: pageId,
    collation_count: extra.copias ?? 1,
    start_date: unix(inicio),
    is_active: true,
    snapshot: {
      page_name: extra.nome ?? `Página ${pageId}`,
      link_url: extra.link ?? `https://loja${pageId}.com.br/oferta`,
      body: { text: extra.texto ?? 'Texto com "aspas" e {chaves} no meio' },
      images: [{ resized_image_url: `https://scontent.example/${id}.jpg` }]
    }
  };
}

function html(grupos, count = 6729) {
  const conexao = { count, edges: grupos.map((g) => ({ node: { collated_results: g } })) };
  return `<html><script>{"x":1,"search_results_connection":${JSON.stringify(conexao)},"y":"}"}</script></html>`;
}

test('urlDaBusca monta a busca dos mais vistos com o país', () => {
  assert.equal(
    R.urlDaBusca('mapas mentais', 'br'),
    'active_status=active&ad_type=all&country=BR&q=mapas%20mentais&search_type=keyword_unordered&media_type=all'
  );
  assert.match(R.urlDaBusca('x', 'BR"&'), /country=BR&/);
});

test('extrairAnuncios lê total e anúncios em ordem, mesmo com chaves e aspas no texto', () => {
  const r = R.extrairAnuncios(html([[anuncio('1', '111111', '2026-10-01')], [anuncio('2', '222222', '2026-06-01'), anuncio('3', '333333', '2026-09-20')]]));
  assert.equal(r.total, 6729);
  assert.deepEqual(r.anuncios.map((a) => a.libraryId), ['1', '2', '3']);
  assert.deepEqual(r.anuncios.map((a) => a.posicao), [1, 2, 3]);
  const a = r.anuncios[0];
  assert.equal(a.pageId, '111111');
  assert.equal(a.pageName, 'Página 111111');
  assert.equal(a.startDate, '2026-10-01');
  assert.equal(a.link, 'https://loja111111.com.br/oferta');
  assert.equal(a.texto, 'Texto com "aspas" e {chaves} no meio');
  assert.equal(a.imagem, 'https://scontent.example/1.jpg');
});

test('extrairAnuncios sem dados devolve vazio', () => {
  assert.deepEqual(R.extrairAnuncios('<html>desafio</html>'), { total: null, anuncios: [] });
});

test('montarAchados: um por anunciante, dias no ar e oferta nova escalando', () => {
  const { anuncios } = R.extrairAnuncios(html([[
    anuncio('1', '111111', '2026-10-01', { copias: 4 }),
    anuncio('2', '222222', '2026-06-01'),
    anuncio('3', '111111', '2026-08-01'),
    anuncio('4', '333333', '2026-09-20')
  ]]));
  const { achados } = R.montarAchados(anuncios, { hoje: HOJE, vistos: {}, primeiraRodada: true });
  assert.deepEqual(achados.map((a) => a.libraryId), ['1', '2', '4']);
  assert.equal(achados[0].dias, 13);
  assert.equal(achados[0].novaEscalando, true);
  assert.equal(achados[0].copias, 4);
  assert.equal(achados[1].novaEscalando, false);
  assert.equal(achados[2].dias, 24);
  assert.equal(achados[2].novaEscalando, true);
});

test('montarAchados: na primeira rodada nada é novo; depois, só quem não foi visto', () => {
  const { anuncios } = R.extrairAnuncios(html([[anuncio('1', '111111', '2026-10-01'), anuncio('2', '222222', '2026-10-01')]]));
  const r1 = R.montarAchados(anuncios, { hoje: '2026-10-12', vistos: {}, primeiraRodada: true });
  assert.ok(r1.achados.every((a) => a.novo === false));
  assert.deepEqual(Object.keys(r1.vistos).sort(), ['111111', '222222']);

  const segunda = R.extrairAnuncios(html([[anuncio('1', '111111', '2026-10-01'), anuncio('9', '999999', '2026-10-02')]])).anuncios;
  const r2 = R.montarAchados(segunda, { hoje: HOJE, vistos: r1.vistos, primeiraRodada: false });
  assert.deepEqual(r2.achados.map((a) => [a.pageId, a.novo]), [['111111', false], ['999999', true]]);
  assert.equal(r2.vistos['999999'], HOJE);
  assert.equal(r2.vistos['111111'], '2026-10-12');
});

test('montarAchados: vistos não cresce sem limite', () => {
  const vistos = {};
  for (let i = 0; i < 3005; i += 1) vistos[`9${String(i).padStart(6, '0')}`] = '2026-01-01';
  const { anuncios } = R.extrairAnuncios(html([[anuncio('1', '111111', '2026-10-01')]]));
  const r = R.montarAchados(anuncios, { hoje: HOJE, vistos, primeiraRodada: false });
  assert.ok(Object.keys(r.vistos).length <= 3000);
  assert.equal(r.vistos['111111'], HOJE);
});
