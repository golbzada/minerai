// Gringa x Brasil no painel (src/utils/gringa.js).
// Rodar: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { textoBrasil, brasilDaOferta, resumoCurtoBrasil } from '../src/utils/gringa.js';
import { encodeNotes, todayIso } from '../src/utils/offerMeta.js';

const HOJE = todayIso();
function diasAntes(n) {
  const d = new Date(`${HOJE}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

test('textoBrasil descreve a presença no Brasil', () => {
  assert.deepEqual(textoBrasil({ anunciante: 0, site: 0 }), { janela: true, texto: 'Ninguém roda no Brasil ainda' });
  assert.deepEqual(textoBrasil({ anunciante: 3, site: 9 }), { janela: false, texto: 'No Brasil: 3 anúncios do anunciante · 9 com o mesmo site' });
  assert.deepEqual(textoBrasil({ anunciante: 1, site: null }), { janela: false, texto: 'No Brasil: 1 anúncio do anunciante' });
  assert.deepEqual(textoBrasil({ anunciante: 0, site: null }), { janela: false, texto: 'Anunciante não roda no Brasil (site não conferido)' });
  assert.equal(textoBrasil({ anunciante: 'x', site: 0 }), null);
  assert.equal(textoBrasil(null), null);
});

test('brasilDaOferta lê o que o rastreio guardou para oferta de fora', () => {
  const gringa = { funnel_notes: encodeNotes('', { country: 'US', brasil_ads: 0, brasil_site: 0, brasil_at: diasAntes(3) }) };
  assert.deepEqual(brasilDaOferta(gringa), { anunciante: 0, site: 0, data: diasAntes(3) });
  const velha = { funnel_notes: encodeNotes('', { country: 'US', brasil_ads: 0, brasil_site: 0, brasil_at: diasAntes(20) }) };
  assert.equal(brasilDaOferta(velha), null);
  const morta = { funnel_notes: encodeNotes('', { country: 'US', brasil_ads: 0, brasil_site: 0, brasil_at: diasAntes(1), dead_since: diasAntes(2) }) };
  assert.equal(brasilDaOferta(morta), null);
  const nacional = { funnel_notes: encodeNotes('', { country: 'BR', brasil_ads: 3 }) };
  assert.equal(brasilDaOferta(nacional), null);
  const semChecagem = { funnel_notes: encodeNotes('', { country: 'US' }) };
  assert.equal(brasilDaOferta(semChecagem), null);
});

test('resumoCurtoBrasil para a ficha da oferta', () => {
  assert.equal(resumoCurtoBrasil({ anunciante: 0, site: 0 }), 'Janela aberta');
  assert.equal(resumoCurtoBrasil({ anunciante: 0, site: 3 }), '0 do anunciante · 3 com o site');
  assert.equal(resumoCurtoBrasil({ anunciante: 1, site: null }), '1 do anunciante');
  assert.equal(resumoCurtoBrasil(null), '');
});
