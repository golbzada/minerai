// "Minerar oferta" não pode ficar em "Salvando..." para sempre (extension/background.js).
// Visto em 15/10/2026: com a rede pendurada, o pedido SAVE_OFFER nunca respondia.
// Rodar: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarScript, chromeFalso } = require('./carregar-script.cjs');

// Token com validade longa (só o `exp` é lido).
const token = `a.${Buffer.from(JSON.stringify({ exp: 4102444800 })).toString('base64url')}.c`;
const sessao = { minerai_user: { id: '0c8a6d1e-1111-4222-8333-444444444444', name: 'T', email: 't@t.com' }, minerai_session: { access_token: token, refresh_token: 'r' } };

function ambiente(fetch, prazos) {
  const respostas = [];
  const ouvintes = [];
  const chrome = chromeFalso({
    runtime: { id: 'ext', onMessage: { addListener: (fn) => ouvintes.push(fn) }, getURL: (p) => `chrome-extension://ext/${p}` },
    storage: { local: { get: (k, cb) => cb({ ...sessao }), set: (o, cb) => cb && cb() } }
  });
  const sw = carregarScript('extension/background.js', { chrome, fetch });
  sw.MINERAI_PRAZOS = prazos;
  const salvar = (offer) => new Promise((resolve) => {
    ouvintes.forEach((fn) => fn({ type: 'SAVE_OFFER', offer }, { id: 'ext', url: 'https://www.facebook.com/ads/library/?q=x', tab: { id: 1 } }, (r) => { respostas.push(r); resolve(r); }));
  });
  return { sw, salvar, respostas };
}

const oferta = { name: 'Oferta X', libraryId: '123456789', pageId: '987654321', adsCount: 3, pageActiveAds: 12, status: 'testing', niche: 'Outros' };

test('rede pendurada: o pedido responde com erro dentro do prazo, não fica infinito', async () => {
  const pendurado = (url, o) => new Promise((_, rej) => {
    o?.signal?.addEventListener('abort', () => { const e = new Error('abortado'); e.name = 'AbortError'; rej(e); });
  });
  const amb = ambiente(pendurado, { rede: 60, salvar: 2000 });
  const inicio = Date.now();
  const r = await amb.salvar(oferta);
  assert.equal(r.success, false);
  assert.match(r.error, /demorou/i);
  assert.ok(Date.now() - inicio < 1500, `levou ${Date.now() - inicio} ms`);
});

test('rede lenta demais no total: desiste com aviso claro', async () => {
  const lento = () => new Promise((ok) => setTimeout(() => ok({ ok: true, status: 200, json: async () => [], text: async () => '[]' }), 120));
  const amb = ambiente(lento, { rede: 1000, salvar: 150 });
  const r = await amb.salvar(oferta);
  assert.equal(r.success, false);
  assert.match(r.error, /demorou/i);
});

test('rede normal: a oferta é salva', async () => {
  const fetch = async (url, o = {}) => {
    const u = String(url);
    const corpo = o.method === 'POST' && u.includes('/rest/v1/offers') ? [{ id: 'o1', name: 'Oferta X' }]
      : u.includes('/rest/v1/tabs') ? [{ id: 't1' }]
      : [];
    return { ok: true, status: 200, json: async () => corpo, text: async () => JSON.stringify(corpo) };
  };
  const amb = ambiente(fetch, { rede: 1000, salvar: 2000 });
  const r = await amb.salvar(oferta);
  assert.equal(r.success, true);
  assert.equal(r.data.updated, false);
});
