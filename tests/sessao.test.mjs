// Sessão nos dois sentidos entre painel e extensão.
// Rodar: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { aguardarSessaoDaExtensao } from '../src/utils/extensaoSessao.js';

const require = createRequire(import.meta.url);
const { carregarScript } = require('./carregar-script.cjs');
const S = carregarScript('extension/sessao-regras.js').MineraiSessao;
const plain = (x) => JSON.parse(JSON.stringify(x));

const painel = (expires_at, id = 'u1') => ({
  access_token: 'a-painel', refresh_token: 'r-painel', expires_at, expires_in: 3600, token_type: 'bearer', user: { id, email: 'x@y.z' }
});
const extensao = (expires_at, id = 'u1') => ({
  user: { id }, session: { access_token: 'a-ext', refresh_token: 'r-ext', expires_at }
});

test('extensão mais nova do mesmo usuário vence', () => {
  assert.equal(S.compararSessoes(painel(100), extensao(200)), 'extensao');
});

test('painel mais novo vence', () => {
  assert.equal(S.compararSessoes(painel(300), extensao(200)), 'painel');
});

test('usuário diferente nunca sobrescreve o painel', () => {
  assert.equal(S.compararSessoes(painel(100), extensao(200, 'outro')), 'painel');
});

test('sem sessão de um dos lados não troca nada', () => {
  assert.equal(S.compararSessoes(null, extensao(200)), 'igual');
  assert.equal(S.compararSessoes(painel(100), { user: { id: 'u1' }, session: null }), 'painel');
});

test('mesclarSessao troca só os tokens e mantém o resto', () => {
  const r = plain(S.mesclarSessao(painel(100), extensao(4600).session, 1000));
  assert.equal(r.access_token, 'a-ext');
  assert.equal(r.refresh_token, 'r-ext');
  assert.equal(r.expires_at, 4600);
  assert.equal(r.expires_in, 3600);
  assert.equal(r.token_type, 'bearer');
  assert.equal(r.user.email, 'x@y.z');
});

test('sessão mais antiga vinda do painel não substitui a da extensão', () => {
  const guardada = { user: { id: 'u1' }, session: { access_token: 'a', refresh_token: 'r', expires_at: 500 } };
  assert.equal(S.aceitarDoPainel(guardada, { id: 'u1' }, { access_token: 'b', refresh_token: 's', expires_at: 400 }), false);
  assert.equal(S.aceitarDoPainel(guardada, { id: 'u1' }, { access_token: 'b', refresh_token: 's', expires_at: 600 }), true);
  assert.equal(S.aceitarDoPainel(guardada, { id: 'u2' }, { access_token: 'b', refresh_token: 's', expires_at: 1 }), true);
  assert.equal(S.aceitarDoPainel({ user: null, session: null }, { id: 'u1' }, { access_token: 'b', expires_at: 1 }), true);
});

test('painel não espera quando a extensão não está instalada', async () => {
  const inicio = Date.now();
  await aguardarSessaoDaExtensao({ raiz: { dataset: {} }, limiteMs: 600 });
  assert.ok(Date.now() - inicio < 100);
});

test('painel espera a extensão terminar de sincronizar', async () => {
  const raiz = { dataset: { mineraiSessao: 'aguardando' } };
  setTimeout(() => { raiz.dataset.mineraiSessao = 'pronta'; }, 120);
  const inicio = Date.now();
  await aguardarSessaoDaExtensao({ raiz, limiteMs: 2000 });
  const tempo = Date.now() - inicio;
  assert.ok(tempo >= 100 && tempo < 600, `esperou ${tempo} ms`);
});

test('painel desiste depois do limite', async () => {
  const inicio = Date.now();
  await aguardarSessaoDaExtensao({ raiz: { dataset: { mineraiSessao: 'aguardando' } }, limiteMs: 200 });
  const tempo = Date.now() - inicio;
  assert.ok(tempo >= 180 && tempo < 600, `esperou ${tempo} ms`);
});
