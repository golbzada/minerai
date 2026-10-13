// Histórico com tipo de medição e oferta morta (src/utils/offerMeta.js).
// Rodar: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  historyEntry,
  upsertHistory,
  normalizeHistory,
  resolveRunningDays,
  encodeNotes,
  daysToStartDate,
  isOfferDead,
  deadSince
} from '../src/utils/offerMeta.js';

test('historyEntry grava o tipo quando informado', () => {
  assert.equal(historyEntry('2026-10-13', 7, 'anunciante').kind, 'anunciante');
  assert.equal(historyEntry('2026-10-13', 7).kind, undefined);
});

test('upsertHistory preserva o tipo das medições', () => {
  const h1 = upsertHistory([{ date: '2026-10-01', count: 3 }], '2026-10-02', 12, 'anunciante');
  assert.equal(h1[0].kind, undefined);
  assert.equal(h1[1].kind, 'anunciante');
  const h2 = upsertHistory(h1, '2026-10-03', 4);
  assert.equal(h2[1].kind, 'anunciante');
  assert.equal(h2[2].kind, undefined);
});

test('normalizeHistory mantém o tipo', () => {
  const h = normalizeHistory([{ date: '2026-10-02', count: 12, kind: 'anunciante' }]);
  assert.deepEqual(h, [{ date: '2026-10-02', count: 12, kind: 'anunciante' }]);
});

test('dias no ar congelam na data em que a oferta morreu', () => {
  const offer = { funnel_notes: encodeNotes('', { start_date: '2026-09-01', dead_since: '2026-09-11' }) };
  assert.equal(resolveRunningDays(offer), 11);
});

test('oferta viva continua contando os dias', () => {
  const offer = { funnel_notes: encodeNotes('', { start_date: daysToStartDate(20) }) };
  assert.equal(resolveRunningDays(offer), 20);
});

test('isOfferDead e deadSince leem o metadado', () => {
  const morta = { funnel_notes: encodeNotes('', { dead_since: '2026-10-01' }) };
  const viva = { funnel_notes: encodeNotes('', { start_date: '2026-09-01' }) };
  assert.equal(isOfferDead(morta), true);
  assert.equal(deadSince(morta), '2026-10-01');
  assert.equal(isOfferDead(viva), false);
  assert.equal(deadSince(viva), null);
});

import { stageReason } from '../src/utils/offerMeta.js';

test('explicação da etiqueta conta que a oferta saiu do ar', () => {
  const morta = { funnel_notes: encodeNotes('', { start_date: '2026-09-01', dead_since: '2026-09-11' }) };
  assert.match(stageReason(morta), /^Saiu do ar em 11\/09, depois de 11 dias no ar\./);
});

import { cleanHistory, startDateFromForm } from '../src/utils/offerMeta.js';

test('cleanHistory mantém o tipo e o limite', () => {
  const h = cleanHistory([
    { date: '2026-10-01', count: 3 },
    { date: '2026-10-02', count: 9, kind: 'anunciante' },
    { date: '2026-10-03', count: 10, kind: 'anunciante' }
  ], 2);
  assert.equal(h.length, 2);
  assert.equal(h[0].kind, 'anunciante');
  assert.equal(h[1].count, 10);
});

test('editar oferta morta sem mexer nos dias mantém a data de início', () => {
  const meta = { start_date: '2026-09-01', dead_since: '2026-09-11' };
  assert.equal(startDateFromForm(11, meta), '2026-09-01');
});

test('mudar os dias de oferta morta conta a partir da morte', () => {
  const meta = { start_date: '2026-09-01', dead_since: '2026-09-11' };
  assert.equal(startDateFromForm(20, meta), '2026-08-23');
});

test('oferta viva: mesmos dias mantêm a data; dias novos recalculam', () => {
  const meta = { start_date: daysToStartDate(30) };
  assert.equal(startDateFromForm(30, meta), meta.start_date);
  assert.equal(startDateFromForm(10, meta), daysToStartDate(10));
  assert.equal(startDateFromForm('', meta), meta.start_date);
});
