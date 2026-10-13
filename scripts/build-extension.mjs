// ==============================================================================
// MINERAÍ — EMPACOTA A EXTENSÃO PARA DISTRIBUIÇÃO
// ==============================================================================
// Gera public/minerai-extensao.zip a partir da pasta extension/, que é o
// arquivo que o painel oferece em "Baixar extensão".
//
// Diferença para um zip feito à mão: o manifest distribuído NÃO carrega a
// entrada http://localhost:5173. Ela existe só para desenvolver o painel
// localmente; no computador de um cliente, qualquer servidor que subisse
// nessa porta receberia o bridge.js injetado. Para testar com o painel local,
// carregue a pasta extension/ direto em chrome://extensions, sem o zip.
//
// Uso: npm run build:extension
// ==============================================================================

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, crc32 } from 'node:zlib';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const origem = join(raiz, 'extension');
const destino = join(raiz, 'public', 'minerai-extensao.zip');

const DEV_ONLY_MATCHES = ['http://localhost:5173/*'];

// Nunca vão para o zip: pasta de teste local e mapas de depuração.
const FORA_DO_ZIP = (nome) => nome.startsWith('_') || nome.endsWith('.map');

/** Lista todos os arquivos da pasta, em ordem estável. */
function listar(dir) {
  const saida = [];
  for (const nome of readdirSync(dir).sort()) {
    if (FORA_DO_ZIP(nome)) continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...listar(caminho));
    else saida.push(caminho);
  }
  return saida;
}

/** Conteúdo final de cada arquivo (o manifest sai sem as entradas de dev). */
function conteudoDe(caminho) {
  const bytes = readFileSync(caminho);
  if (relative(origem, caminho) !== 'manifest.json') return bytes;

  const manifest = JSON.parse(bytes.toString('utf8'));
  manifest.content_scripts = (manifest.content_scripts || [])
    .map((cs) => ({ ...cs, matches: (cs.matches || []).filter((m) => !DEV_ONLY_MATCHES.includes(m)) }))
    .filter((cs) => cs.matches.length);
  return Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

/** Zip mínimo (deflate), sem dependência externa. */
function montarZip(entradas) {
  const locais = [];
  const central = [];
  let posicao = 0;

  for (const { nome, dados } of entradas) {
    const nomeBytes = Buffer.from(nome.replace(/\\/g, '/'), 'utf8');
    const comprimido = deflateRawSync(dados);
    const soma = crc32(dados);

    const cab = Buffer.alloc(30);
    cab.writeUInt32LE(0x04034b50, 0);
    cab.writeUInt16LE(20, 4);
    cab.writeUInt16LE(0x0800, 6);
    cab.writeUInt16LE(8, 8);
    cab.writeUInt32LE(soma, 14);
    cab.writeUInt32LE(comprimido.length, 18);
    cab.writeUInt32LE(dados.length, 22);
    cab.writeUInt16LE(nomeBytes.length, 26);
    locais.push(cab, nomeBytes, comprimido);

    const reg = Buffer.alloc(46);
    reg.writeUInt32LE(0x02014b50, 0);
    reg.writeUInt16LE(20, 4);
    reg.writeUInt16LE(20, 6);
    reg.writeUInt16LE(0x0800, 8);
    reg.writeUInt16LE(8, 10);
    reg.writeUInt32LE(soma, 16);
    reg.writeUInt32LE(comprimido.length, 20);
    reg.writeUInt32LE(dados.length, 24);
    reg.writeUInt16LE(nomeBytes.length, 28);
    reg.writeUInt32LE(posicao, 42);
    central.push(reg, nomeBytes);

    posicao += 30 + nomeBytes.length + comprimido.length;
  }

  const inicioCentral = posicao;
  const tamanhoCentral = central.reduce((n, b) => n + b.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(tamanhoCentral, 12);
  fim.writeUInt32LE(inicioCentral, 16);

  return Buffer.concat([...locais, ...central, fim]);
}

const arquivos = listar(origem).map((caminho) => ({
  nome: relative(origem, caminho),
  dados: conteudoDe(caminho)
}));

mkdirSync(dirname(destino), { recursive: true });
writeFileSync(destino, montarZip(arquivos));

const versao = JSON.parse(readFileSync(join(origem, 'manifest.json'), 'utf8')).version;
console.log(`minerai-extensao.zip v${versao}: ${arquivos.length} arquivos, ${Math.round(statSync(destino).size / 1024)} KB`);
