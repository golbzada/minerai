// Resumo da evolução da oferta: o que o card mostra e como o histórico lê
// cada medição (src/utils/evolucao.js).
// Pedido do dono (16/10/2026): o gráfico só com o começo e o hoje, numa frase
// que qualquer um entenda; o dia a dia fica no histórico.
// Rodar: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { resumoDaEvolucao, linhasDoHistorico } from '../src/utils/evolucao.js';

const A = (date, count) => ({ date, count, kind: 'anunciante' });

test('caiu: começo e fim da série, diferença e frase', () => {
  const r = resumoDaEvolucao([A('2026-10-13', 42), A('2026-10-14', 46), A('2026-10-15', 29)]);
  assert.equal(r.direcao, 'caiu');
  assert.deepEqual([r.inicio.count, r.fim.count], [42, 29]);
  assert.equal(r.diff, -13);
  assert.equal(r.pct, -31);
  assert.equal(r.frase, 'Caiu de 42 para 29 anúncios ativos desde 13/10 (-31%).');
});

test('subiu e estável', () => {
  assert.equal(resumoDaEvolucao([A('2026-10-13', 10), A('2026-10-16', 15)]).frase, 'Subiu de 10 para 15 anúncios ativos desde 13/10 (+50%).');
  assert.equal(resumoDaEvolucao([A('2026-10-13', 7), A('2026-10-16', 7)]).frase, 'Estável em 7 anúncios ativos desde 13/10.');
});

test('uma medição só: diz quando foi e que amanhã tem outra', () => {
  const r = resumoDaEvolucao([A('2026-10-16', 27)]);
  assert.equal(r.direcao, 'unica');
  assert.equal(r.frase, 'Primeira medição: 27 anúncios ativos em 16/10. A extensão mede de novo amanhã.');
});

test('sem medição', () => {
  assert.equal(resumoDaEvolucao([]).direcao, 'vazia');
});

test('contagem antiga do criativo (sem kind) não entra quando já há medição do anunciante', () => {
  // O caso da Concurseira: 1 (criativo) e depois 756, 765, 740 (anunciante).
  const r = resumoDaEvolucao([{ date: '2026-10-12', count: 1 }, A('2026-10-13', 756), A('2026-10-14', 765), A('2026-10-15', 740)]);
  assert.deepEqual([r.inicio.date, r.inicio.count, r.fim.count], ['2026-10-13', 756, 740]);
  assert.equal(r.pct, -2);
});

test('oferta só com medições à mão (sem kind) usa todas', () => {
  const r = resumoDaEvolucao([{ date: '2026-10-01', count: 4 }, { date: '2026-10-05', count: 8 }]);
  assert.equal(r.direcao, 'subiu');
});

test('histórico: medição antiga marcada, sem variação absurda (+75500%)', () => {
  const linhas = linhasDoHistorico([{ date: '2026-10-12', count: 1 }, A('2026-10-13', 756), A('2026-10-14', 765)]);
  assert.equal(linhas[0].antiga, true);
  assert.equal(linhas[1].primeira, true);
  assert.equal(linhas[1].diff, null);
  assert.deepEqual([linhas[2].diff, linhas[2].pct], [9, 1]);
});
