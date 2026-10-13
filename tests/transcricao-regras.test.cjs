// Regras do roteiro transcrito (extension/transcricao-regras.js).
// Rodar: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarScript } = require('./carregar-script.cjs');

const bruto = carregarScript('extension/transcricao-regras.js').MineraiTranscricao;
const plain = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const T = Object.fromEntries(
  Object.entries(bruto).map(([k, v]) => [k, typeof v === 'function' ? (...a) => plain(v(...a)) : v])
);

const trecho = (inicio, fim, texto) => ({ inicio, fim, texto });

test('formatarTempo mostra minutos e segundos', () => {
  assert.equal(T.formatarTempo(0), '0:00');
  assert.equal(T.formatarTempo(7.6), '0:07');
  assert.equal(T.formatarTempo(65), '1:05');
});

test('montarRoteiro separa gancho, desenvolvimento e chamada final', () => {
  const r = T.montarRoteiro({
    duracao: 40,
    chunks: [
      trecho(0, 2.5, ' Você ainda perde dinheiro com isso?'),
      trecho(2.5, 10, ' Eu também perdia, até descobrir um método simples.'),
      trecho(10, 30, ' Em 7 dias eu mudei tudo e hoje ensino o passo a passo.'),
      trecho(30, 36, ' Clique no link abaixo e garanta sua vaga.'),
      trecho(36, 40, ' As vagas acabam hoje.')
    ]
  });
  assert.equal(r.gancho.texto, 'Você ainda perde dinheiro com isso?');
  assert.deepEqual(r.desenvolvimento.map((t) => t.texto), [
    'Eu também perdia, até descobrir um método simples.',
    'Em 7 dias eu mudei tudo e hoje ensino o passo a passo.'
  ]);
  assert.equal(r.cta.texto, 'Clique no link abaixo e garanta sua vaga. As vagas acabam hoje.');
  assert.equal(r.cta.inicio, 30);
  assert.equal(r.temFala, true);
});

test('sem frase de ação, a chamada final são os últimos 8 segundos', () => {
  const r = T.montarRoteiro({
    duracao: 30,
    chunks: [trecho(0, 3, 'Olha isso.'), trecho(3, 20, 'Tudo começou assim.'), trecho(20, 30, 'E foi aí que mudou.')]
  });
  assert.equal(r.cta.texto, 'E foi aí que mudou.');
  assert.deepEqual(r.desenvolvimento.map((t) => t.texto), ['Tudo começou assim.']);
});

test('primeiro trecho longo: o gancho é a primeira frase dele', () => {
  const r = T.montarRoteiro({
    duracao: 20,
    chunks: [trecho(0, 9, 'Pare de rolar a tela. Isso aqui vai mudar sua rotina de estudos.'), trecho(9, 20, 'Saiba mais no link.')]
  });
  assert.equal(r.gancho.texto, 'Pare de rolar a tela.');
  assert.equal(r.desenvolvimento[0].texto, 'Isso aqui vai mudar sua rotina de estudos.');
});

test('vídeo sem fala', () => {
  const r = T.montarRoteiro({ duracao: 15, chunks: [trecho(0, 15, ' [Música] ')] });
  assert.equal(r.temFala, false);
});

test('roteiroEmTexto monta o arquivo com cabeçalho, partes e prompt', () => {
  const r = T.montarRoteiro({
    duracao: 20,
    chunks: [trecho(0, 2, 'Gancho forte.'), trecho(2, 12, 'Meio da história.'), trecho(12, 20, 'Clique e compre.')]
  });
  const txt = T.roteiroEmTexto(r, { pagina: 'Loja X', dias: 23, libraryId: '123456789' });
  assert.match(txt, /ROTEIRO DO CRIATIVO — Loja X \(23 dias no ar\)/);
  assert.match(txt, /https:\/\/www\.facebook\.com\/ads\/library\/\?id=123456789/);
  assert.match(txt, /GANCHO \(0:00–0:02\)\n"Gancho forte\."/);
  assert.match(txt, /\[0:02\] Meio da história\./);
  assert.match(txt, /CHAMADA FINAL \(0:12–0:20\)\n"Clique e compre\."/);
  assert.match(txt, /PROMPT PARA A IA/);
  assert.match(txt, /português do Brasil/);
});

test('roteiroEmTexto de vídeo sem fala avisa e não traz prompt', () => {
  const r = T.montarRoteiro({ duracao: 15, chunks: [] });
  const txt = T.roteiroEmTexto(r, { pagina: 'Loja X', dias: 5, libraryId: '1' });
  assert.match(txt, /não tem fala/);
  assert.doesNotMatch(txt, /PROMPT PARA A IA/);
});

test('nomeDoRoteiro segue o nome do vídeo', () => {
  assert.equal(T.nomeDoRoteiro('minerai_video_1760000000000.mp4'), 'minerai_video_1760000000000_roteiro.txt');
  assert.equal(T.nomeDoRoteiro('x'), 'minerai_roteiro.txt');
});

test('idiomaProvavel pelo texto do anúncio', () => {
  assert.equal(T.idiomaProvavel('Você ainda não sabe como estudar para o concurso? Clique e veja o método.', 'US'), 'portuguese');
  assert.equal(T.idiomaProvavel('Are you still struggling with your weight? Click the link and get yours today.', 'BR'), 'english');
  assert.equal(T.idiomaProvavel('¿Todavía no sabes cómo bajar de peso? Haz clic y descubre el método para ti.', 'BR'), 'spanish');
});

test('idiomaProvavel sem texto usa o país da busca', () => {
  assert.equal(T.idiomaProvavel('', 'BR'), 'portuguese');
  assert.equal(T.idiomaProvavel('', 'MX'), 'spanish');
  assert.equal(T.idiomaProvavel('', 'US'), 'english');
  assert.equal(T.idiomaProvavel('', 'ALL'), 'portuguese');
  assert.equal(T.idiomaProvavel('🔥🔥 50% OFF', 'FR'), 'french');
});

test('a oferta no fim do vídeo já faz parte da chamada final', () => {
  const r = T.montarRoteiro({
    duracao: 27.5,
    chunks: [
      trecho(0, 3.6, 'Será que vale a pena?'),
      trecho(3.6, 21.5, 'Meu filho aprendeu rápido.'),
      trecho(21.5, 25, 'Tem uma oferta especial pra você economizar.'),
      trecho(25, 27.5, 'Clique aqui no link.')
    ]
  });
  assert.equal(r.cta.inicio, 21.5);
  assert.equal(r.cta.texto, 'Tem uma oferta especial pra você economizar. Clique aqui no link.');
});
