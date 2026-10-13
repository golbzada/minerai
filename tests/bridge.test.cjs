// bridge.js: a sessão renovada pela extensão chega ao painel antes do supabase-js usar.
// Rodar: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarScript, executarNoContexto } = require('./carregar-script.cjs');

const CHAVE = 'sb-vqqzpkdxyaowqxdfshex-auth-token';
const painelSessao = (expires_at, id = 'u1') => ({
  access_token: `a-painel-${expires_at}`, refresh_token: `r-painel-${expires_at}`, expires_at, expires_in: 3600, user: { id, email: 'x@y.z' }
});

function montar({ painel, extensao }) {
  const guardado = { [CHAVE]: JSON.stringify(painel) };
  const localStorage = {
    get length() { return Object.keys(guardado).length; },
    key: (i) => Object.keys(guardado)[i],
    getItem: (k) => (k in guardado ? guardado[k] : null),
    setItem: (k, v) => { guardado[k] = String(v); }
  };
  const ouvintes = [];
  const mudancas = [];
  const enviadas = [];
  const storageExt = { minerai_user: extensao?.user || null, minerai_session: extensao?.session || null };
  const chrome = {
    runtime: {
      id: 'ext',
      lastError: undefined,
      sendMessage: (msg, cb) => { enviadas.push(msg); if (cb) cb({ success: true }); },
      getManifest: () => ({ version: '0' })
    },
    storage: {
      local: { get: (keys, cb) => setTimeout(() => cb({ ...storageExt }), 5) },
      onChanged: { addListener: (fn) => mudancas.push(fn) }
    }
  };
  const window = {
    location: { origin: 'https://mineraiofertas.vercel.app' },
    addEventListener: (tipo, fn, captura) => ouvintes.push({ tipo, fn, captura }),
    postMessage() {}
  };
  const document = { documentElement: { dataset: {} } };
  const ctx = carregarScript('extension/sessao-regras.js', {
    chrome, window, document, localStorage, setInterval: () => 0
  });
  executarNoContexto(ctx, 'extension/bridge.js');
  const lerPainel = () => JSON.parse(guardado[CHAVE]);
  return { ctx, document, lerPainel, ouvintes, mudancas, enviadas };
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const ext = (expires_at, id = 'u1') => ({ user: { id }, session: { access_token: `a-ext-${expires_at}`, refresh_token: `r-ext-${expires_at}`, expires_at } });

test('na abertura, a sessão mais nova da extensão vai para o painel antes de liberar', async () => {
  const b = montar({ painel: painelSessao(100), extensao: ext(200) });
  assert.equal(b.document.documentElement.dataset.mineraiSessao, 'aguardando');
  await esperar(30);
  assert.equal(b.lerPainel().refresh_token, 'r-ext-200');
  assert.equal(b.lerPainel().user.email, 'x@y.z');
  assert.equal(b.document.documentElement.dataset.mineraiSessao, 'pronta');
});

test('aba esquecida: ao voltar a ficar visível, grava na hora a sessão renovada', async () => {
  const b = montar({ painel: painelSessao(100), extensao: ext(100) });
  await esperar(30);
  b.mudancas.forEach((fn) => fn({ minerai_session: { newValue: ext(300).session } }, 'local'));
  const visivel = b.ouvintes.find((o) => o.tipo === 'visibilitychange' && o.captura === true);
  assert.ok(visivel, 'precisa ouvir visibilitychange na captura');
  visivel.fn();
  assert.equal(b.lerPainel().refresh_token, 'r-ext-300');
});

test('sessão de outra pessoa nunca entra no painel', async () => {
  const b = montar({ painel: painelSessao(100), extensao: ext(900, 'outra') });
  await esperar(30);
  assert.equal(b.lerPainel().refresh_token, 'r-painel-100');
});

test('painel mais novo continua avisando a extensão', async () => {
  const b = montar({ painel: painelSessao(500), extensao: ext(200) });
  await esperar(30);
  assert.ok(b.enviadas.some((m) => m.type === 'SET_AUTH_USER' && m.session.refresh_token === 'r-painel-500'));
  assert.ok(!b.enviadas.some((m) => m.type === 'GET_PANEL_SESSION'));
});
