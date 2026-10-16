// Modelar: capturas guardadas no computador (extension/ver-regras.js).
// Pré-visualizar e comparar sem nuvem: a página é remontada dentro da extensão
// trocando cada caminho do pacote pelo arquivo guardado.
// Rodar: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarScript } = require('./carregar-script.cjs');

const V = carregarScript('extension/ver-regras.js').MineraiVer;
const plain = (x) => JSON.parse(JSON.stringify(x));

test('troca cada caminho do pacote pelo endereço guardado (HTML e CSS)', () => {
  const html = '<img src="assets/img/a-1.png"><style>.x{background:url(assets/img/a-1.png)}@font-face{src:url("assets/fonts/f-2.woff2")}</style>';
  const saida = V.trocarCaminhos(html, { 'assets/img/a-1.png': 'blob:x/1', 'assets/fonts/f-2.woff2': 'blob:x/2' });
  assert.equal(saida, '<img src="blob:x/1"><style>.x{background:url(blob:x/1)}@font-face{src:url("blob:x/2")}</style>');
});

test('caminho que é pedaço de outro não é trocado pela metade', () => {
  const saida = V.trocarCaminhos('<img src="assets/img/a-10.png"><img src="assets/img/a-1.png">', {
    'assets/img/a-1.png': 'blob:1',
    'assets/img/a-10.png': 'blob:10'
  });
  assert.equal(saida, '<img src="blob:10"><img src="blob:1">');
});

test('tipo do arquivo pela extensão', () => {
  assert.equal(V.tipoDoArquivo('assets/img/x.webp'), 'image/webp');
  assert.equal(V.tipoDoArquivo('assets/video/v.mp4'), 'video/mp4');
  assert.equal(V.tipoDoArquivo('assets/fonts/f.woff2'), 'font/woff2');
  assert.equal(V.tipoDoArquivo('assets/img/x.svg'), 'image/svg+xml');
  assert.equal(V.tipoDoArquivo('LEIA-ME.txt'), 'text/plain;charset=utf-8');
});

test('guarda as 8 mais novas: devolve as que saem', () => {
  const metas = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, criadoEm: `2026-10-${String(i + 1).padStart(2, '0')}T10:00:00Z` }));
  assert.deepEqual(plain(V.alemDoLimite(metas, 8)), ['c1', 'c0']);
  assert.deepEqual(plain(V.alemDoLimite(metas.slice(0, 3), 8)), []);
});

test('endereço para comparar: só http(s)', () => {
  assert.equal(V.enderecoSeguro('https://minhapagina.com/oferta'), 'https://minhapagina.com/oferta');
  assert.equal(V.enderecoSeguro('minhapagina.com'), 'https://minhapagina.com/');
  assert.equal(V.enderecoSeguro('javascript:alert(1)'), '');
  assert.equal(V.enderecoSeguro('file:///C:/x.html'), '');
});

test('id da captura: só o formato que o empacotador gera', () => {
  assert.equal(V.idSeguro('pagina-de-vendas-1792104227017'), 'pagina-de-vendas-1792104227017');
  assert.equal(V.idSeguro('../x'), '');
  assert.equal(V.idSeguro('a b'), '');
});
