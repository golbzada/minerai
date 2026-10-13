// Alertas do rastreio diário (src/utils/offerExtras.js).
// Rodar: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAlerts, ALERT_DEFAULTS, ALERT_LABELS } from '../src/utils/offerExtras.js';
import { encodeNotes, todayIso, daysToStartDate } from '../src/utils/offerMeta.js';

const HOJE = todayIso();

function diasAntes(n) {
  const d = new Date(`${HOJE}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

let seq = 0;
function oferta(meta = {}, history = [], status = 'testing') {
  seq += 1;
  return {
    id: `o${seq}`,
    name: `Oferta ${seq}`,
    status,
    history,
    funnel_notes: encodeNotes('', { start_date: daysToStartDate(5), ...meta })
  };
}

const tipos = (alerts, offer) => alerts.filter((a) => a.offer === offer).map((a) => a.type);

test('evento de escalou de hoje vira alerta com os números', () => {
  const o = oferta({ tracked_at: `${HOJE}T09:00`, track_events: [{ tipo: 'escalou', data: HOJE, de: 10, para: 16 }] });
  const alerta = computeAlerts([o], ALERT_DEFAULTS).find((a) => a.type === 'escalou');
  assert.ok(alerta);
  assert.equal(alerta.severity, 'alta');
  assert.match(alerta.text, /de 10 para 16/);
});

test('evento de 8 dias atrás não aparece mais', () => {
  const o = oferta({ tracked_at: `${HOJE}T09:00`, track_events: [{ tipo: 'morreu', data: diasAntes(8), de: 5, para: 0 }] });
  assert.ok(!tipos(computeAlerts([o], ALERT_DEFAULTS), o).includes('morreu'));
});

test('oferta medida pelo rastreio ontem não pede medição', () => {
  const o = oferta({ tracked_at: `${diasAntes(1)}T09:00` }, [{ date: diasAntes(5), count: 3 }]);
  assert.ok(!tipos(computeAlerts([o], ALERT_DEFAULTS), o).includes('medicao'));
});

test('queda antiga some quando há medições do anunciante', () => {
  const nova = oferta({ tracked_at: `${HOJE}T09:00` }, [
    { date: diasAntes(1), count: 20, kind: 'anunciante' },
    { date: HOJE, count: 8, kind: 'anunciante' }
  ]);
  const antiga = oferta({}, [
    { date: diasAntes(1), count: 20 },
    { date: HOJE, count: 8 }
  ]);
  const alerts = computeAlerts([nova, antiga], ALERT_DEFAULTS);
  assert.ok(!tipos(alerts, nova).includes('queda'));
  assert.ok(tipos(alerts, antiga).includes('queda'));
});

test('oferta morta não gera alerta de mudança de estágio', () => {
  const o = oferta({ start_date: '2026-01-01', dead_since: diasAntes(3) }, [], 'testing');
  assert.ok(!tipos(computeAlerts([o], ALERT_DEFAULTS), o).includes('estagio'));
});

test('rótulos dos tipos novos existem', () => {
  for (const tipo of ['morreu', 'escalou', 'decaindo', 'criativo_saiu', 'voltou']) {
    assert.ok(ALERT_LABELS[tipo]?.label, tipo);
  }
});

import { ultimoRastreioHoje } from '../src/utils/offerExtras.js';

test('ultimoRastreioHoje devolve a hora da medição automática mais recente de hoje', () => {
  const ofertas = [
    oferta({ tracked_at: `${HOJE}T08:05` }),
    oferta({ tracked_at: `${HOJE}T09:12` }),
    oferta({ tracked_at: `${diasAntes(1)}T23:50` })
  ];
  assert.equal(ultimoRastreioHoje(ofertas), '09:12');
  assert.equal(ultimoRastreioHoje([oferta({ tracked_at: `${diasAntes(1)}T10:00` })]), null);
  assert.equal(ultimoRastreioHoje([]), null);
});

import { cleanHistory as limpar } from '../src/utils/offerMeta.js';

test('oferta no formato do painel (histórico limpo) não repete queda e decaindo', () => {
  const crua = oferta({ tracked_at: `${HOJE}T09:00` }, [
    { date: diasAntes(1), count: 20, kind: 'anunciante' },
    { date: HOJE, count: 8, kind: 'anunciante' }
  ]);
  const formatada = { ...crua, history: limpar(crua.history, 3650) };
  assert.ok(!tipos(computeAlerts([formatada], ALERT_DEFAULTS), formatada).includes('queda'));
});
