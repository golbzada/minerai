// ==============================================================================
// MINERAÍ - EMPACOTADOR DO "MODELAR PÁGINA"
// ==============================================================================
// Roda no documento oculto da extensão (offscreen.html). Recebe o que a
// captura leu da página (captura.js) e devolve um .zip com a página PRONTA
// para modelar:
//
//   index.html              a página, com o CSS embutido e endereços locais
//   assets/img|video|fonts  imagens, vídeos e fontes baixados
//   assets/js/minerai-movimentos.js  carrossel, FAQ, abas e entrada animada
//   ESTRUTURA.md            mapa das seções (barato para a IA ler)
//   PROMPT.md               pedido pronto para a IA modelar o produto
//   design-system.css       cores, fontes e espaçamentos medidos
//   LEIA-ME.txt             o que veio e o que ficou de fora
//
// Por que fora do service worker: o worker não cria URL de Blob e pode ser
// encerrado no meio de um download grande. Este documento aguenta.
//
// O miolo (`montarPacote`) não depende do Chrome: recebe as funções de rede e
// de leitura de HTML por parâmetro. Assim dá para testar fora da extensão.
// ==============================================================================

/* eslint-disable no-unused-vars */

const MX_LIMITES = {
  totalBytes: 300 * 1024 * 1024,
  porTipo: {
    img: 25 * 1024 * 1024,
    video: 120 * 1024 * 1024,
    audio: 40 * 1024 * 1024,
    fonts: 8 * 1024 * 1024,
    outros: 10 * 1024 * 1024
  },
  tempoMs: { img: 45000, fonts: 45000, outros: 45000, audio: 120000, video: 240000 },
  simultaneos: 6,
  maxArquivos: 600
};

const MX_EXTENSOES = {
  img: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp'],
  video: ['mp4', 'webm', 'mov', 'm4v', 'ogv'],
  audio: ['mp3', 'wav', 'm4a', 'ogg', 'aac'],
  fonts: ['woff2', 'woff', 'ttf', 'otf', 'eot']
};

const MX_TIPO_POR_MIME = [
  [/^image\/svg/, 'img', 'svg'],
  [/^image\/png/, 'img', 'png'],
  [/^image\/jpe?g/, 'img', 'jpg'],
  [/^image\/gif/, 'img', 'gif'],
  [/^image\/webp/, 'img', 'webp'],
  [/^image\/avif/, 'img', 'avif'],
  [/^image\/(x-icon|vnd\.microsoft\.icon)/, 'img', 'ico'],
  [/^video\/mp4/, 'video', 'mp4'],
  [/^video\/webm/, 'video', 'webm'],
  [/^video\/quicktime/, 'video', 'mov'],
  [/^audio\/mpeg/, 'audio', 'mp3'],
  [/^audio\//, 'audio', 'mp3'],
  [/^font\/woff2|application\/font-woff2/, 'fonts', 'woff2'],
  [/^font\/woff|application\/font-woff/, 'fonts', 'woff'],
  [/^font\/ttf|application\/x-font-ttf|font\/sfnt/, 'fonts', 'ttf'],
  [/^font\/otf/, 'fonts', 'otf']
];

// Tipos que já vêm comprimidos: guardar sem comprimir de novo poupa tempo.
const MX_SEM_COMPRESSAO = /\.(png|jpe?g|gif|webp|avif|ico|mp4|webm|mov|m4v|ogv|mp3|m4a|ogg|aac|woff2?|eot)$/i;

// ------------------------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------------------------

const MX_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function mxCrc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = MX_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function mxBytes(texto) {
  return new TextEncoder().encode(String(texto));
}

function mxHash(texto) {
  return mxCrc32(mxBytes(texto)).toString(16).padStart(8, '0').slice(0, 6);
}

function mxAbsoluta(u, origem) {
  try {
    return new URL(u, origem).href;
  } catch (e) {
    return '';
  }
}

/** Texto que vai dentro de um <style>: um "</style" do site fecharia a tag cedo. */
function mxCssSeguro(css) {
  return String(css || '').replace(/<\/(style)/gi, '<\\/$1');
}

/** Texto que vai dentro de um comentário CSS não pode fechar o comentário. */
function mxSemFimDeComentario(texto) {
  return String(texto || '').replace(/\*\//g, '* /');
}

/** Texto do site dentro do Markdown: sem quebrar linha nem virar código. */
function mxMd(texto) {
  return String(texto || '').replace(/[\r\n]+/g, ' ').replace(/[`<>]/g, '').trim();
}

function mxNomeDoSite(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '_');
  } catch (e) {
    return 'pagina';
  }
}

function mxNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

/** Política de segurança do index.html: só o nosso script (pelo nonce) roda. */
function mxCsp(nonce) {
  const politica = [
    "default-src * data: blob: 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ');
  return politica;
}

/** Tipo e extensão pelo endereço (antes de baixar). */
function mxTipoPelaUrl(url, dica) {
  let caminho = '';
  try {
    caminho = new URL(url).pathname.toLowerCase();
  } catch (e) {
    return { tipo: dica || 'outros', ext: '' };
  }
  const ext = (caminho.match(/\.([a-z0-9]{2,5})$/) || [])[1] || '';
  for (const tipo of Object.keys(MX_EXTENSOES)) {
    if (MX_EXTENSOES[tipo].includes(ext)) return { tipo, ext: ext === 'jpeg' ? 'jpg' : ext };
  }
  return { tipo: dica || 'outros', ext: '' };
}

/** Nome de arquivo limpo, curto e único para cada endereço. */
function mxCaminhoLocal(url, tipo, ext) {
  let base = 'arquivo';
  try {
    const ultimo = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
    base = ultimo.replace(/\.[a-z0-9]{2,5}$/i, '');
  } catch (e) { /* mantém "arquivo" */ }
  base = base.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || tipo;
  return `assets/${tipo}/${base}-${mxHash(url)}${ext ? `.${ext}` : ''}`;
}

/**
 * Tira as variações de fonte de alfabetos que uma página em português não
 * usa (cirílico, grego, etc.). O Google Fonts manda uma variação por
 * alfabeto; sem este filtro o pacote baixava dezenas de arquivos à toa.
 * Fica o que cobre o latim básico (U+0000-00FF), onde estão todos os
 * acentos do português; latim estendido e vietnamita também saem.
 */
function mxSoFontesLatinas(css) {
  const cobreLatim = (faixas) => faixas.split(',').some((faixa) => {
    const m = faixa.trim().match(/^u\+([0-9a-f?]+)(?:-([0-9a-f]+))?$/i);
    if (!m) return true; // formato que não entendemos: mantém
    const inicio = parseInt(m[1].replace(/\?/g, '0'), 16);
    const fim = m[2] ? parseInt(m[2], 16) : parseInt(m[1].replace(/\?/g, 'f'), 16);
    const sobrepoe = (a, b) => inicio <= b && fim >= a;
    return sobrepoe(0x0000, 0x00ff);
  });
  return String(css).replace(/@font-face\s*{[^}]*}/gi, (bloco) => {
    const faixa = bloco.match(/unicode-range\s*:\s*([^;}]+)/i);
    return !faixa || cobreLatim(faixa[1]) ? bloco : '';
  });
}

/**
 * Tira as @font-face de famílias que a página não usa em lugar nenhum.
 * Sem a lista (captura antiga), não mexe em nada.
 */
function mxSoFontesUsadas(css, usadas) {
  if (!Array.isArray(usadas) || !usadas.length) return css;
  const conjunto = new Set(usadas.map((f) => String(f).toLowerCase()));
  return String(css).replace(/@font-face\s*{[^}]*}/gi, (bloco) => {
    const m = bloco.match(/font-family\s*:\s*([^;}]+)/i);
    if (!m) return bloco;
    const familia = m[1].trim().replace(/^["']|["']$/g, '').toLowerCase();
    return conjunto.has(familia) ? bloco : '';
  });
}

/** Todos os url(...) de um CSS, separando os que são fonte (@font-face). */
function mxUrlsDoCss(css) {
  const fontes = new Set();
  const blocosFonte = String(css).match(/@font-face\s*{[^}]*}/gi) || [];
  blocosFonte.forEach((bloco) => {
    (bloco.match(/url\((['"]?)([^'")]+)\1\)/g) || []).forEach((m) => {
      const u = m.replace(/^url\((['"]?)/, '').replace(/(['"]?)\)$/, '');
      fontes.add(u);
    });
  });
  const todas = [];
  String(css).replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) => {
    todas.push(u);
    return m;
  });
  return todas.map((u) => ({ url: u, dica: fontes.has(u) ? 'fonts' : 'img' }));
}

function mxTrocarUrlsCss(css, mapa) {
  return String(css).replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) => {
    const local = mapa.get(u);
    return local ? `url("${local}")` : m;
  });
}

// ------------------------------------------------------------------------------
// ZIP (deflate nativo do navegador; mídia vai guardada sem recomprimir)
// ------------------------------------------------------------------------------

async function mxDeflate(bytes) {
  const fluxo = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(fluxo).arrayBuffer());
}

/** [{ nome, dados: string | Uint8Array }] -> Blob .zip */
async function mxMontarZip(arquivos) {
  const nomeBytes = (n) => mxBytes(n);
  const partes = [];
  const central = [];
  let posicao = 0;

  for (const arquivo of arquivos) {
    const nome = nomeBytes(arquivo.nome);
    const dados = typeof arquivo.dados === 'string' ? mxBytes(arquivo.dados) : arquivo.dados;
    const soma = mxCrc32(dados);
    const guardar = MX_SEM_COMPRESSAO.test(arquivo.nome);
    const corpo = guardar ? dados : await mxDeflate(dados);
    const metodo = guardar ? 0 : 8;

    const cab = new DataView(new ArrayBuffer(30));
    cab.setUint32(0, 0x04034b50, true);
    cab.setUint16(4, 20, true);
    cab.setUint16(6, 0x0800, true); // nomes em UTF-8
    cab.setUint16(8, metodo, true);
    cab.setUint32(14, soma, true);
    cab.setUint32(18, corpo.length, true);
    cab.setUint32(22, dados.length, true);
    cab.setUint16(26, nome.length, true);
    partes.push(new Uint8Array(cab.buffer), nome, corpo);

    const reg = new DataView(new ArrayBuffer(46));
    reg.setUint32(0, 0x02014b50, true);
    reg.setUint16(4, 20, true);
    reg.setUint16(6, 20, true);
    reg.setUint16(8, 0x0800, true);
    reg.setUint16(10, metodo, true);
    reg.setUint32(16, soma, true);
    reg.setUint32(20, corpo.length, true);
    reg.setUint32(24, dados.length, true);
    reg.setUint16(28, nome.length, true);
    reg.setUint32(42, posicao, true);
    central.push({ reg: new Uint8Array(reg.buffer), nome });

    posicao += 30 + nome.length + corpo.length;
  }

  const inicioCentral = posicao;
  let tamanhoCentral = 0;
  central.forEach((item) => {
    partes.push(item.reg, item.nome);
    tamanhoCentral += 46 + item.nome.length;
  });

  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, central.length, true);
  fim.setUint16(10, central.length, true);
  fim.setUint32(12, tamanhoCentral, true);
  fim.setUint32(16, inicioCentral, true);
  partes.push(new Uint8Array(fim.buffer));

  return new Blob(partes, { type: 'application/zip' });
}

// ------------------------------------------------------------------------------
// Documentos do pacote
// ------------------------------------------------------------------------------

function mxDesignSystem(tokens, url) {
  const bloco = (titulo, itens, prefixo) => {
    if (!itens || !itens.length) return '';
    // Valores vêm do getComputedStyle da página: sem ';', '{', '}' nem '*/'.
    const seguro = (v) => mxSemFimDeComentario(String(v || '').replace(/[;{}]/g, ' ')).slice(0, 300);
    const linhas = itens.map((t, i) => `  --${prefixo}-${i + 1}: ${seguro(t.valor)}; /* usado ${Number(t.vezes) || 0}x */`).join('\n');
    return `\n  /* ${titulo} */\n${linhas}\n`;
  };
  return `/* ==========================================================================
   DESIGN SYSTEM EXTRAÍDO
   Origem: ${mxSemFimDeComentario(url)}
   Gerado pelo Mineraí em ${new Date().toLocaleString('pt-BR')}

   Valores que a página realmente aplica na tela, por frequência de uso.
   ========================================================================== */

:root {
${bloco('Cores de texto', tokens.cores, 'cor')}${bloco('Cores de fundo', tokens.fundos, 'fundo')}${bloco('Tipografia', tokens.fontes, 'fonte')}${bloco('Tamanhos de fonte', tokens.tamanhos, 'texto')}${bloco('Arredondamento', tokens.raios, 'raio')}${bloco('Espaçamentos', tokens.espacos, 'espaco')}}
`;
}

function mxEstrutura(dados, url, contagem) {
  const linhas = [];
  linhas.push('# Estrutura da página');
  linhas.push('');
  linhas.push(`Origem: ${mxMd(url)}`);
  linhas.push(`Capturada em ${new Date().toLocaleString('pt-BR')}, com a tela em ${Number(dados.larguraCaptura) || 0}px de largura.`);
  linhas.push('');
  linhas.push('Cada seção tem um número. No `index.html` ela é o elemento com `data-mx-secao="N"`.');
  linhas.push('Para mudar uma parte, cite o número: "na seção 4, troque os depoimentos pelos meus".');
  linhas.push('');
  linhas.push(`Resumo: ${(dados.secoes || []).length} seções · ${contagem.img} imagens · ${contagem.video} vídeos · ${contagem.fonts} fontes · ${dados.carrosseis || 0} carrossel(éis) · ${dados.sanfonas || 0} pergunta(s) que abrem · ${dados.abas || 0} aba(s)`);
  linhas.push('');

  (dados.secoes || []).forEach((s) => {
    linhas.push(`## Seção ${s.n}${s.tipo ? ` — ${mxMd(s.tipo)}` : ''}`);
    if (s.titulos && s.titulos.length) linhas.push(`- Títulos: ${s.titulos.map((t) => `"${mxMd(t)}"`).join(' / ')}`);
    if (s.paragrafos && s.paragrafos.length) linhas.push(`- Texto: ${s.paragrafos.map((t) => `"${mxMd(t)}"`).join(' / ')}`);
    if (s.botoes && s.botoes.length) {
      linhas.push(`- Botões: ${s.botoes.map((b) => `"${mxMd(b.texto)}"${b.destino ? ` → ${mxMd(b.destino)}` : ''}`).join(' · ')}`);
    }
    const layout = [];
    layout.push(s.colunas > 1 ? `${s.colunas} colunas` : '1 coluna');
    if (s.imagens) layout.push(`${s.imagens} imagem(ns)`);
    if (s.videos) layout.push(`${s.videos} vídeo(s)`);
    if (s.fundo) layout.push(`fundo ${mxMd(s.fundo)}`);
    layout.push(`altura ~${s.altura}px`);
    linhas.push(`- Layout: ${layout.join(' · ')}`);
    const movimento = [];
    if (s.carrossel) movimento.push('carrossel');
    if (s.sanfona) movimento.push(`${s.sanfona} pergunta(s) que abrem`);
    if (s.abas) movimento.push(`${s.abas} aba(s)`);
    if (movimento.length) linhas.push(`- Movimento: ${movimento.join(' · ')}`);
    linhas.push('');
  });

  const t = dados.tokens || {};
  const lista = (itens, n) => (itens || []).slice(0, n).map((x) => mxMd(x.valor)).join(' · ');
  linhas.push('## Design system (resumo)');
  if (t.cores && t.cores.length) linhas.push(`- Cores de texto: ${lista(t.cores, 5)}`);
  if (t.fundos && t.fundos.length) linhas.push(`- Fundos: ${lista(t.fundos, 5)}`);
  if (t.fontes && t.fontes.length) linhas.push(`- Fontes: ${lista(t.fontes, 3)}`);
  linhas.push('- Lista completa em `design-system.css`.');
  linhas.push('');
  return linhas.join('\n');
}

function mxPrompt(url) {
  return `# Prompt para modelar esta página

Abra a IA que você usa para criar páginas (Claude, ChatGPT, Cursor, Lovable,
Bolt...), envie esta pasta inteira e cole o texto abaixo, preenchendo os dados
do seu produto no final.

---

Esta pasta é uma página de vendas completa e funcionando: \`index.html\` (com o
CSS embutido), imagens, vídeos e fontes em \`assets/\`, e os movimentos
(carrossel, perguntas que abrem, abas e animação de entrada) em
\`assets/js/minerai-movimentos.js\`. Ela já abre certinha no navegador.

Quero que você MODELE o meu produto em cima dela. Regras:

1. Não recrie do zero e não reorganize o layout: a estrutura está pronta.
   Edite o \`index.html\` no lugar.
2. Use o \`ESTRUTURA.md\` como mapa. Ele lista cada seção (pelo atributo
   \`data-mx-secao\`) com títulos, textos, botões e o que tem de movimento.
   Leia o HTML só da seção que for alterar.
3. Mantenha ordem das seções, espaçamentos, cores e fontes
   (\`design-system.css\`) e os atributos \`data-mx-*\` e
   \`data-minerai-anima\`: são eles que fazem os movimentos funcionarem.
4. Troque textos, preços, depoimentos, perguntas, imagens e marca pelos do
   meu produto. Imagem nova vai em \`assets/img/\`, trocando o \`src\`.
5. Aponte todos os botões de compra para o meu link.
6. No fim, me diga em uma lista curta o que mudou em cada seção.

Meu produto:
- Nome:
- O que é e para quem é:
- Promessa principal:
- Preço e condições:
- Bônus:
- Garantia:
- Link do botão de compra:
- Depoimentos (se tiver):

---

Página de origem (referência de estrutura): ${url}
O conteúdo original (textos, imagens, marca) é de quem publicou a página.
Use como molde de estrutura e troque tudo pelo que é seu.
`;
}

function mxLeiaMe(url, dados, info) {
  const linhasRemotas = info.remotos.slice(0, 25).map((r) => `  - ${r.url}  (${r.motivo})`).join('\n');
  return `MODELAR PÁGINA — Mineraí
=========================

Origem: ${url}
Capturado em: ${new Date().toLocaleString('pt-BR')}

O QUE TEM AQUI
--------------
index.html                      A página pronta. Abra direto no navegador.
assets/img, video, fonts        ${info.contagem.img} imagem(ns), ${info.contagem.video} vídeo(s), ${info.contagem.fonts} fonte(s)
assets/js/minerai-movimentos.js Carrossel, perguntas que abrem, abas e
                                animação de entrada, refeitos sem o
                                código original do site.
ESTRUTURA.md                    Mapa das seções. Mande para a IA junto.
PROMPT.md                       O pedido pronto para a IA modelar o seu
                                produto em cima desta página.
design-system.css               Cores, fontes, tamanhos e espaçamentos.

COMO FOI FEITO
--------------
A página foi aberta no seu próprio navegador, rolada até o fim e copiada
depois que tudo terminou de carregar. Imagens, vídeos e fontes foram
baixados para dentro da pasta, então ela abre mesmo sem internet.

Os scripts originais do site foram removidos de propósito: eles carregam
pixel, rastreador e redirecionamento. No lugar, o minerai-movimentos.js
devolve os movimentos mais comuns:
  - ${dados.carrosseis || 0} carrossel(éis)
  - ${dados.sanfonas || 0} pergunta(s) que abrem e fecham
  - ${dados.abas || 0} aba(s)
  - ${dados.animaveis || 0} bloco(s) com animação de entrada
${dados.players ? `
PLAYER DE VÍDEO
---------------
A página usa ${dados.players} player de plataforma (Vturb, Panda, Converte.ai).
Ele depende do código da plataforma e fica parado aqui. Troque pelo seu
vídeo na hora de modelar.
` : ''}${info.remotos.length ? `
O QUE CONTINUA VINDO DA INTERNET (${info.remotos.length})
------------------------------------
Estes arquivos não puderam ser baixados (grandes demais, protegidos pelo
site ou fora do ar). A página continua mostrando enquanto o site original
estiver no ar:
${linhasRemotas}${info.remotos.length > 25 ? `\n  ... e mais ${info.remotos.length - 25}` : ''}

Dica: se aparecerem muitos, libere a modelagem em "todos os sites" no
popup da extensão Mineraí e capture de novo.
` : ''}
PARA QUE SERVE
--------------
Referência de estrutura: blocos, proporções, espaçamentos, movimentos e
paleta, para você construir a sua página em cima. O conteúdo (textos,
imagens, marca) é de quem publicou a página original.
`;
}

// ------------------------------------------------------------------------------
// Miolo
// ------------------------------------------------------------------------------

/**
 * Monta os arquivos do pacote.
 * `amb` traz o que depende do ambiente:
 *   - baixar(url, { tipo, limite, tempoMs }) -> { bytes: Uint8Array, mime } | null
 *   - baixarTexto(url) -> string | null
 *   - lerHtml(html) -> Document
 *   - movimentos() -> string (conteúdo do minerai-movimentos.js)
 *   - progresso(texto) (opcional)
 */
async function montarPacote(dados, url, amb) {
  const avisar = amb.progresso || (() => {});
  const nonce = mxNonce();

  // 1. CSS: folhas de outro domínio entram no lugar em que apareciam.
  const externosBaixados = new Map();
  const listaExternos = Array.from(new Set(dados.cssExterno || [])).slice(0, 40);
  avisar(`Baixando ${listaExternos.length} folha(s) de estilo`);

  async function cssDe(href, profundidade) {
    const txt = await amb.baixarTexto(href);
    if (txt == null) return null;
    // url() relativo é relativo à folha, não à página.
    let css = txt.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) => {
      if (/^(data:|#)/i.test(u)) return m;
      const abs = mxAbsoluta(u, href);
      return abs ? `url("${abs}")` : m;
    });
    // @import dentro da folha baixada (Google Fonts faz isso).
    const imports = [];
    css = css.replace(/@import\s+(?:url\()?\s*(['"]?)([^'")\s;]+)\1\s*\)?[^;]*;/gi, (m, q, u) => {
      imports.push(mxAbsoluta(u, href));
      return '';
    });
    if (profundidade < 2) {
      for (const imp of imports) {
        const dentro = imp ? await cssDe(imp, profundidade + 1) : null;
        if (dentro) css = `${dentro}\n${css}`;
      }
    }
    return css;
  }

  for (const href of listaExternos) {
    const css = await cssDe(href, 0);
    if (css != null) externosBaixados.set(href, css);
  }

  // Folha que não deu para baixar continua carregando do site (<link> fica).
  const naoBaixadas = new Set();
  let css = (dados.cssInterno || []).join('\n\n');
  css = css.replace(/\/\*@mx-externo ([^*]+)\*\//g, (m, href) => {
    const h = href.trim();
    const conteudo = externosBaixados.get(h);
    if (conteudo == null) {
      naoBaixadas.add(h);
      return `/* não foi possível baixar: ${mxSemFimDeComentario(h)} */`;
    }
    externosBaixados.delete(h);
    return `/* ${mxSemFimDeComentario(h)} */\n${conteudo}`;
  });
  // O que sobrou (folha que não tinha lugar marcado) vai no fim.
  externosBaixados.forEach((conteudo, href) => {
    css += `\n\n/* ${mxSemFimDeComentario(href)} */\n${conteudo}`;
  });
  css = mxSoFontesLatinas(css);
  css = mxSoFontesUsadas(css, dados.fontesUsadas);

  // 2. Documento.
  const doc = amb.lerHtml(String(dados.html || ''));
  const head = doc.head || doc.documentElement;

  // Folhas que já estão embutidas não precisam (nem devem) carregar de novo.
  doc.querySelectorAll('link[rel]').forEach((link) => {
    const rel = (link.getAttribute('rel') || '').toLowerCase();
    if (/preload|prefetch|preconnect|dns-prefetch|modulepreload|manifest|alternate|canonical|pingback|shortlink/.test(rel)) {
      link.remove();
      return;
    }
    if (rel.includes('stylesheet') && !naoBaixadas.has(link.getAttribute('href') || '')) link.remove();
  });
  // <style> originais já estão dentro do CSS embutido (vieram de document.styleSheets).
  doc.querySelectorAll('style').forEach((s) => s.remove());

  // 3. Lista de arquivos a baixar.
  const pedidos = new Map(); // url absoluta -> dica de tipo
  const pedir = (u, dica) => {
    if (!u || !/^https?:\/\//i.test(u) || pedidos.size >= MX_LIMITES.maxArquivos) return;
    if (!pedidos.has(u)) pedidos.set(u, dica);
  };
  doc.querySelectorAll('img[src]').forEach((el) => pedir(el.getAttribute('src'), 'img'));
  doc.querySelectorAll('[poster]').forEach((el) => pedir(el.getAttribute('poster'), 'img'));
  doc.querySelectorAll('video[src], video source[src]').forEach((el) => pedir(el.getAttribute('src'), 'video'));
  doc.querySelectorAll('audio[src], audio source[src]').forEach((el) => pedir(el.getAttribute('src'), 'audio'));
  doc.querySelectorAll('link[rel~="icon"][href], link[rel="apple-touch-icon"][href], link[rel="shortcut icon"][href]').forEach((el) => pedir(el.getAttribute('href'), 'img'));
  doc.querySelectorAll('image[href], image[xlink\\:href], input[type="image"][src]').forEach((el) => pedir(el.getAttribute('href') || el.getAttribute('xlink:href') || el.getAttribute('src'), 'img'));
  doc.querySelectorAll('[style*="url("]').forEach((el) => mxUrlsDoCss(el.getAttribute('style')).forEach((x) => pedir(x.url, 'img')));
  doc.querySelectorAll('[srcset]').forEach((el) => {
    (el.getAttribute('srcset') || '').split(',').forEach((parte) => pedir(parte.trim().split(/\s+/)[0], 'img'));
  });
  mxUrlsDoCss(css).forEach((x) => pedir(x.url, x.dica));

  // 4. Baixar, com teto por arquivo, no total e em paralelo.
  const mapa = new Map(); // url -> caminho local
  const arquivos = [];
  const remotos = [];
  const contagem = { img: 0, video: 0, audio: 0, fonts: 0, outros: 0 };
  let totalBytes = 0;
  let feitos = 0;
  const fila = Array.from(pedidos.entries());

  avisar(`Baixando ${fila.length} arquivo(s)`);

  async function trabalhador() {
    while (fila.length) {
      const [u, dica] = fila.shift();
      const previsto = mxTipoPelaUrl(u, dica);
      const tipoPrevisto = previsto.tipo === 'outros' ? dica || 'outros' : previsto.tipo;
      const limite = MX_LIMITES.porTipo[tipoPrevisto] || MX_LIMITES.porTipo.outros;
      let res = null;
      try {
        res = await amb.baixar(u, {
          tipo: tipoPrevisto,
          limite: Math.min(limite, MX_LIMITES.totalBytes - totalBytes),
          tempoMs: MX_LIMITES.tempoMs[tipoPrevisto] || 45000
        });
      } catch (e) {
        res = { erro: e && e.message ? e.message : 'falha' };
      }
      feitos += 1;
      if (feitos % 10 === 0) avisar(`Baixados ${feitos} de ${pedidos.size}`);

      if (!res || res.erro || !res.bytes) {
        remotos.push({ url: u, motivo: (res && res.erro) || 'não respondeu' });
        continue;
      }
      if (totalBytes + res.bytes.length > MX_LIMITES.totalBytes) {
        remotos.push({ url: u, motivo: 'pacote passaria de 300 MB' });
        continue;
      }

      // O tipo real manda: confere pelo cabeçalho quando o endereço não diz.
      let { tipo, ext } = previsto;
      const pelaMime = MX_TIPO_POR_MIME.find(([rx]) => rx.test(res.mime || ''));
      if (!ext && pelaMime) {
        tipo = pelaMime[1];
        ext = pelaMime[2];
      }
      if (tipo === 'outros' && dica) tipo = dica;
      // HTML no lugar de imagem é página de erro ou de login: não serve.
      if (/text\/html/i.test(res.mime || '')) {
        remotos.push({ url: u, motivo: 'o site devolveu uma página no lugar do arquivo' });
        continue;
      }

      const caminho = mxCaminhoLocal(u, tipo, ext);
      totalBytes += res.bytes.length;
      contagem[tipo] = (contagem[tipo] || 0) + 1;
      mapa.set(u, caminho);
      arquivos.push({ nome: caminho, dados: res.bytes });
    }
  }

  await Promise.all(Array.from({ length: MX_LIMITES.simultaneos }, trabalhador));

  // 5. Trocar os endereços pelos locais.
  const local = (u) => mapa.get(u) || null;
  doc.querySelectorAll('[src]').forEach((el) => {
    const l = local(el.getAttribute('src'));
    if (l) el.setAttribute('src', l);
  });
  doc.querySelectorAll('[poster]').forEach((el) => {
    const l = local(el.getAttribute('poster'));
    if (l) el.setAttribute('poster', l);
  });
  doc.querySelectorAll('link[href]').forEach((el) => {
    const l = local(el.getAttribute('href'));
    if (l) el.setAttribute('href', l);
  });
  doc.querySelectorAll('image[href]').forEach((el) => {
    const l = local(el.getAttribute('href'));
    if (l) el.setAttribute('href', l);
  });
  doc.querySelectorAll('[srcset]').forEach((el) => {
    el.setAttribute('srcset', (el.getAttribute('srcset') || '').split(',').map((parte) => {
      const [u, d] = parte.trim().split(/\s+/);
      const l = local(u);
      return l ? `${l}${d ? ` ${d}` : ''}` : parte.trim();
    }).join(', '));
  });
  doc.querySelectorAll('[style*="url("]').forEach((el) => {
    el.setAttribute('style', mxTrocarUrlsCss(el.getAttribute('style'), mapa));
  });
  css = mxTrocarUrlsCss(css, mapa);

  // 6. Cabeçalho: CSP primeiro, depois o CSS embutido; script no fim do body.
  const meta = doc.createElement('meta');
  meta.setAttribute('http-equiv', 'Content-Security-Policy');
  meta.setAttribute('content', mxCsp(nonce));
  head.insertBefore(meta, head.firstChild);
  if (!doc.querySelector('meta[charset]')) {
    const charset = doc.createElement('meta');
    charset.setAttribute('charset', 'utf-8');
    head.insertBefore(charset, head.firstChild);
  }
  const estilo = doc.createElement('style');
  estilo.setAttribute('data-minerai', 'css-capturado');
  estilo.textContent = '__MX_CSS__';
  head.appendChild(estilo);

  const script = doc.createElement('script');
  script.setAttribute('src', 'assets/js/minerai-movimentos.js');
  script.setAttribute('nonce', nonce);
  script.setAttribute('defer', '');
  (doc.body || doc.documentElement).appendChild(script);

  // O CSS entra por texto no fim: pelo DOM ele seria escapado.
  const html = '<!doctype html>\n' + doc.documentElement.outerHTML.replace('__MX_CSS__', () => `\n${mxCssSeguro(css)}\n`);

  // 7. Arquivos de texto.
  const pasta = `${mxNomeDoSite(url)}-${Date.now()}`;
  const info = { contagem, remotos };
  const textos = [
    { nome: 'index.html', dados: html },
    { nome: 'assets/js/minerai-movimentos.js', dados: amb.movimentos() },
    { nome: 'ESTRUTURA.md', dados: mxEstrutura(dados, url, contagem) },
    { nome: 'PROMPT.md', dados: mxPrompt(url) },
    { nome: 'design-system.css', dados: mxDesignSystem(dados.tokens || {}, url) },
    { nome: 'LEIA-ME.txt', dados: mxLeiaMe(url, dados, info) }
  ];

  return {
    pasta,
    arquivos: [...textos, ...arquivos],
    resumo: {
      titulo: dados.titulo,
      imagens: contagem.img,
      videos: contagem.video,
      fontes: contagem.fonts,
      outros: contagem.audio + contagem.outros,
      remotos: remotos.length,
      carrosseis: dados.carrosseis || 0,
      sanfonas: dados.sanfonas || 0,
      abas: dados.abas || 0,
      secoes: (dados.secoes || []).length,
      players: dados.players || 0,
      cores: (dados.tokens && dados.tokens.cores ? dados.tokens.cores.length : 0),
      tamanhoHtmlKb: Math.round(html.length / 1024),
      folhasInternas: (dados.cssInterno || []).length,
      folhasExternas: listaExternos.length,
      bytesBaixados: totalBytes
    }
  };
}

// ------------------------------------------------------------------------------
// Ambiente real: documento oculto da extensão
// ------------------------------------------------------------------------------

async function mxBaixarNoNavegador(url, { limite, tempoMs }) {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), tempoMs);
  try {
    const res = await fetch(url, { signal: controle.signal, credentials: 'omit', redirect: 'follow' });
    if (!res.ok) return { erro: `o site respondeu ${res.status}` };
    const tamanho = Number(res.headers.get('content-length')) || 0;
    if (tamanho && tamanho > limite) {
      controle.abort();
      return { erro: `grande demais (${Math.round(tamanho / 1048576)} MB)` };
    }
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > limite) return { erro: `grande demais (${Math.round(buffer.byteLength / 1048576)} MB)` };
    return { bytes: new Uint8Array(buffer), mime: res.headers.get('content-type') || '' };
  } catch (e) {
    return { erro: controle.signal.aborted ? 'demorou demais' : 'bloqueado ou fora do ar' };
  } finally {
    clearTimeout(relogio);
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage && typeof document !== 'undefined') {
  const urlsAbertas = new Set();

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.alvo !== 'offscreen') return undefined;
    // Só o service worker da própria extensão conversa com este documento.
    // Content script (que roda dentro de sites) chega com `sender.tab`.
    if (sender.id !== chrome.runtime.id || sender.tab) return undefined;

    if (msg.type === 'MINERAI_EMPACOTAR') {
      let ultimoAviso = 0;
      let mxMovimentosTexto = '';
      const amb = {
        baixar: mxBaixarNoNavegador,
        baixarTexto: async (href) => {
          const r = await mxBaixarNoNavegador(href, { limite: 5 * 1024 * 1024, tempoMs: 30000 });
          return r && r.bytes ? new TextDecoder().decode(r.bytes) : null;
        },
        lerHtml: (html) => new DOMParser().parseFromString(html, 'text/html'),
        movimentos: () => mxMovimentosTexto,
        progresso: (texto) => {
          // Cada aviso também mantém o service worker acordado.
          const agora = Date.now();
          if (agora - ultimoAviso < 2000) return;
          ultimoAviso = agora;
          chrome.runtime.sendMessage({ type: 'MINERAI_EMPACOTANDO', texto }).catch(() => {});
        }
      };

      // Um vídeo grande pode levar minutos sem nenhum aviso de progresso; este
      // sinal periódico impede o Chrome de dar o service worker por parado.
      const acordado = setInterval(() => {
        chrome.runtime.sendMessage({ type: 'MINERAI_EMPACOTANDO', texto: 'baixando' }).catch(() => {});
      }, 15000);

      fetch(chrome.runtime.getURL('movimentos-pagina.js'))
        .then((r) => r.text())
        .then((t) => { mxMovimentosTexto = t; })
        .then(() => montarPacote(msg.dados, msg.url, amb))
        .then(async (pacote) => {
          // O zip mora numa pasta própria lá dentro, para não espalhar ao abrir.
          const arquivos = pacote.arquivos.map((a) => ({ nome: `${pacote.pasta}/${a.nome}`, dados: a.dados }));
          const zip = await mxMontarZip(arquivos);
          const blobUrl = URL.createObjectURL(zip);
          urlsAbertas.add(blobUrl);
          sendResponse({
            success: true,
            data: { blobUrl, pasta: `${pacote.pasta}.zip`, tamanhoZipKb: Math.round(zip.size / 1024), ...pacote.resumo }
          });
        })
        .catch((e) => sendResponse({ success: false, error: (e && e.message) || 'Falha ao montar o pacote.' }))
        .finally(() => clearInterval(acordado));
      return true;
    }

    if (msg.type === 'MINERAI_LIBERAR') {
      if (urlsAbertas.has(msg.blobUrl)) {
        URL.revokeObjectURL(msg.blobUrl);
        urlsAbertas.delete(msg.blobUrl);
      }
      sendResponse({ ok: true, abertas: urlsAbertas.size });
      return undefined;
    }
    return undefined;
  });
}
