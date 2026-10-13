// Minerar oferta grava o total de anúncios do anunciante (extension/background.js).
// Rodar: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarScript, chromeFalso } = require('./carregar-script.cjs');

const bg = carregarScript('extension/background.js', { chrome: chromeFalso() });
const plain = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

test('saneamento guarda ID real da página, país e se o anúncio está ativo', () => {
  const o = plain(bg.sanitizeOfferData({ pageIdReal: '1197892590289167', country: 'BR', adActive: true, pageActiveAds: 11 }));
  assert.equal(o.pageIdReal, '1197892590289167');
  assert.equal(o.country, 'BR');
  assert.equal(o.adActive, true);
  assert.equal(o.pageActiveAds, 11);
});

test('saneamento descarta país e ID estranhos', () => {
  const o = plain(bg.sanitizeOfferData({ pageIdReal: '12<script>', country: 'B"R', adActive: 'sim' }));
  assert.equal(o.pageIdReal, '');
  assert.equal(o.country, '');
  assert.equal(o.adActive, null);
});

test('metadado da mineração leva page_id_real, país e anúncio ativo', () => {
  const dados = bg.sanitizeOfferData({ pageIdReal: '1197892590289167', country: 'ALL', adActive: false, pageActiveAds: 11 });
  const meta = plain(bg.buildMeta(dados, null));
  assert.equal(meta.page_id_real, '1197892590289167');
  assert.equal(meta.country, 'ALL');
  assert.equal(meta.ad_active, false);
  assert.equal(meta.page_active_ads, 11);
});

test('sem leitura nova, o metadado guardado continua', () => {
  const existente = { funnel_notes: '[[minerai:{"v":1,"page_id_real":"999999","country":"BR","ad_active":true}]]' };
  const meta = plain(bg.buildMeta(bg.sanitizeOfferData({}), existente));
  assert.equal(meta.page_id_real, '999999');
  assert.equal(meta.country, 'BR');
  assert.equal(meta.ad_active, true);
});

test('com total do anunciante, a mineração vira medição do dia', () => {
  const r = plain(bg.medicaoDaMineracao([{ date: '2026-10-01', count: 3 }], { pageActiveAds: 27 }, '2026-10-13'));
  assert.equal(r.ads_count, 27);
  assert.equal(r.history.length, 2);
  assert.deepEqual({ date: r.history[1].date, count: r.history[1].count, kind: r.history[1].kind },
    { date: '2026-10-13', count: 27, kind: 'anunciante' });
});

test('sem total do anunciante, a mineração não mexe no histórico', () => {
  assert.deepEqual(plain(bg.medicaoDaMineracao([{ date: '2026-10-01', count: 3 }], { pageActiveAds: 0 }, '2026-10-13')), {});
});

test('anotações enormes não cortam os dados escondidos da oferta', () => {
  const meta = { start_date: '2026-09-01', library_id: '123456789', fav: true, page_id_real: '999999999' };
  const texto = bg.notasComMeta('x'.repeat(9990), meta, 10000);
  assert.ok(texto.length <= 10000);
  const lido = plain(bg.decodeNotes(texto).meta);
  assert.equal(lido.fav, true);
  assert.equal(lido.page_id_real, '999999999');
});
