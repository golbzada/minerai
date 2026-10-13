// Partes puras da página Radar (src/utils/radar.js).
// Rodar: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { jaNoAcervo, filtrarAchados, ofertaDoAchado, variacaoNicho, dominioDe } from '../src/utils/radar.js';
import { encodeNotes } from '../src/utils/offerMeta.js';

const achado = (extra = {}) => ({
  libraryId: '1127745372614763',
  pageId: '104722245700959',
  pageName: 'Receitas da Vó',
  startDate: '2026-09-30',
  dias: 14,
  copias: 3,
  link: 'https://www.receitasdavo.com.br/oferta?utm=1',
  texto: 'Aprenda 100 receitas',
  novaEscalando: true,
  novo: true,
  ...extra
});

test('jaNoAcervo reconhece pelo anúncio ou pelo anunciante', () => {
  const porAnuncio = { page_id: '', funnel_notes: encodeNotes('', { library_id: '1127745372614763' }) };
  const porPagina = { page_id: '', funnel_notes: encodeNotes('', { page_id_real: '104722245700959' }) };
  const porColuna = { page_id: '104722245700959', funnel_notes: '' };
  const outra = { page_id: '999', funnel_notes: encodeNotes('', { library_id: '5' }) };
  assert.equal(jaNoAcervo(achado(), [porAnuncio]), true);
  assert.equal(jaNoAcervo(achado(), [porPagina]), true);
  assert.equal(jaNoAcervo(achado(), [porColuna]), true);
  assert.equal(jaNoAcervo(achado(), [outra]), false);
});

test('filtrarAchados: só novas e escondendo o acervo', () => {
  const lista = [achado(), achado({ pageId: '2', libraryId: '2', novaEscalando: false }), achado({ pageId: '3', libraryId: '3' })];
  const acervo = [{ page_id: '3', funnel_notes: '' }];
  assert.deepEqual(filtrarAchados(lista, acervo, { soNovas: true, esconderAcervo: true }).map((a) => a.pageId), ['104722245700959']);
  assert.equal(filtrarAchados(lista, acervo, { soNovas: false, esconderAcervo: false }).length, 3);
  const marcados = filtrarAchados(lista, acervo, { soNovas: false, esconderAcervo: false });
  assert.equal(marcados[2].noAcervo, true);
});

test('ofertaDoAchado monta a oferta para o acervo', () => {
  const o = ofertaDoAchado(achado(), { termo: 'receitas', pais: 'BR' }, 'tab-1');
  assert.equal(o.name, 'Receitas da Vó');
  assert.equal(o.page_id, '104722245700959');
  assert.equal(o.library_url, 'https://www.facebook.com/ads/library/?id=1127745372614763');
  assert.equal(o.landing_page, 'https://www.receitasdavo.com.br/oferta?utm=1');
  assert.equal(o.tab_id, 'tab-1');
  assert.equal(o.status, 'pre_scaling');
  assert.deepEqual(
    { ...o.meta },
    { start_date: '2026-09-30', library_id: '1127745372614763', page_id_real: '104722245700959', page_name: 'Receitas da Vó', country: 'BR', topic: 'receitas', source: 'radar' }
  );
});

test('ofertaDoAchado sem nome do anunciante usa o domínio', () => {
  assert.equal(ofertaDoAchado(achado({ pageName: '' }), { termo: 'x', pais: 'BR' }).name, 'receitasdavo.com.br');
});

test('variacaoNicho descreve a mudança do total', () => {
  assert.equal(variacaoNicho(6729, 6500), '+4% desde a última rodada');
  assert.equal(variacaoNicho(6000, 6500), '-8% desde a última rodada');
  assert.equal(variacaoNicho(6500, 6500), 'igual à última rodada');
  assert.equal(variacaoNicho(6500, null), '');
});

test('dominioDe tira o www', () => {
  assert.equal(dominioDe('https://www.loja.com.br/x'), 'loja.com.br');
  assert.equal(dominioDe('lixo'), '');
});

import { avisoDoRadar } from '../src/utils/radar.js';

test('avisoDoRadar só mostra a pausa da Meta se for de hoje', () => {
  assert.equal(avisoDoRadar({ parado: 'bloqueio', paradoEm: '2026-10-13' }, '2026-10-13'), 'A Meta pediu uma pausa. O Radar tenta de novo amanhã sozinho.');
  assert.equal(avisoDoRadar({ parado: 'bloqueio', paradoEm: '2026-10-12' }, '2026-10-13'), '');
  assert.equal(avisoDoRadar({ parado: 'falha', paradoEm: '2026-10-13' }, '2026-10-13'), 'A Biblioteca não respondeu agora. O Radar tenta de novo mais tarde.');
  assert.equal(avisoDoRadar({}, '2026-10-13'), '');
});
