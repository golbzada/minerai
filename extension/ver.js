// ==============================================================================
// MINERAÍ EXTENSÃO - VER E COMPARAR A CAPTURA (ver.html)
// ==============================================================================
// Abre a captura guardada neste computador (capturas-locais.js) e remonta a
// página com os próprios arquivos dela (ver-regras.js). "Lado a lado" põe a
// página pronta da pessoa à direita, pelo link.
//
// A página capturada já vem sem os scripts originais (captura.js tira todos);
// a CSP da extensão também bloquearia qualquer script que sobrasse. Só roda o
// minerai-movimentos (carrossel, perguntas, abas), que é nosso.
// ==============================================================================

(async function () {
  'use strict';

  const V = self.MineraiVer;
  const $ = (id) => document.getElementById(id);
  const parametros = new URLSearchParams(location.search);
  const id = V.idSeguro(parametros.get('id'));
  const CHAVE_COMPARAR = `minerai_ver_comparar_${id}`;

  function aviso(texto) {
    $('aviso').textContent = texto;
    $('aviso').hidden = !texto;
  }

  function dominio(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  // ---------------------------------------------------------------------------
  // Modo (só a captura / lado a lado) e largura (computador / celular)
  // ---------------------------------------------------------------------------
  function marcar(atributo, valor) {
    document.querySelectorAll(`[data-${atributo}]`).forEach((b) => b.classList.toggle('ativo', b.dataset[atributo] === valor));
  }

  function modo(valor) {
    document.body.dataset.modo = valor;
    marcar('modo', valor);
  }

  function largura(valor) {
    document.body.dataset.largura = valor;
    marcar('largura', valor);
  }

  document.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => {
    modo(b.dataset.modo);
    if (b.dataset.modo === 'lado' && !$('frame-sua').getAttribute('src')) $('sua-url').focus();
  }));
  document.querySelectorAll('[data-largura]').forEach((b) => b.addEventListener('click', () => largura(b.dataset.largura)));
  largura('pc');

  // ---------------------------------------------------------------------------
  // Sua página (lado direito)
  // ---------------------------------------------------------------------------
  function comparar(valor) {
    const url = V.enderecoSeguro(valor);
    if (!url) {
      aviso('Cole o link completo da sua página (começando com https://).');
      return;
    }
    aviso('');
    $('sua-url').value = url;
    $('frame-sua').src = url;
    $('abrir-sua').href = url;
    $('abrir-sua').hidden = false;
    try {
      localStorage.setItem(CHAVE_COMPARAR, url);
    } catch (e) {}
    const novos = new URLSearchParams(location.search);
    novos.set('comparar', url);
    history.replaceState(null, '', `?${novos.toString()}`);
    modo('lado');
  }

  $('form-comparar').addEventListener('submit', (e) => {
    e.preventDefault();
    comparar($('sua-url').value);
  });

  // ---------------------------------------------------------------------------
  // A captura (lado esquerdo)
  // ---------------------------------------------------------------------------
  if (!id) {
    $('titulo').textContent = 'Captura não encontrada';
    aviso('O endereço desta tela está incompleto. Abra a captura pelo botão "Ver" na aba Modelar do painel.');
    modo('so');
    return;
  }

  let captura = null;
  try {
    captura = await self.MineraiCapturas.ler(id);
  } catch (e) {
    aviso(`Não deu para ler as capturas guardadas neste computador (${(e && e.message) || 'erro desconhecido'}).`);
  }

  if (!captura) {
    $('titulo').textContent = 'Esta captura não está mais guardada aqui';
    aviso(`Este computador guarda só as ${self.MineraiCapturas.GUARDAR_NO_MAXIMO} capturas mais novas. O .zip dela continua na sua pasta Downloads; ou clique em "Capturar de novo" no painel.`);
    modo('so');
    return;
  }

  const { meta, arquivos } = captura;
  $('titulo').textContent = meta.titulo || dominio(meta.url) || 'Captura';
  document.title = `Mineraí - ${meta.titulo || dominio(meta.url)}`;
  $('original').textContent = `${dominio(meta.url)} ↗`;
  $('original').href = V.enderecoSeguro(meta.url) || '#';
  $('rotulo-captura').textContent = `de ${dominio(meta.url)}`;

  const mapa = {};
  let html = '';
  arquivos.forEach((a) => {
    if (!a || typeof a.nome !== 'string') return;
    if (a.nome === 'index.html') {
      html = typeof a.dados === 'string' ? a.dados : new TextDecoder().decode(a.dados);
      return;
    }
    if (!a.nome.startsWith('assets/')) return;
    mapa[a.nome] = URL.createObjectURL(new Blob([a.dados], { type: V.tipoDoArquivo(a.nome) }));
  });
  // Script de blob não passa na CSP da extensão: o de movimentos vem do pacote dela.
  mapa['assets/js/minerai-movimentos.js'] = chrome.runtime.getURL('movimentos-pagina.js');

  // srcdoc (e não blob:) para a página contar como "da extensão": só assim o
  // script de movimentos do pacote passa na CSP.
  $('frame-captura').srcdoc = V.trocarCaminhos(html, mapa);

  // Abriu pelo "Comparar" do painel, ou já comparou antes esta captura.
  let lembrada = '';
  try {
    lembrada = localStorage.getItem(CHAVE_COMPARAR) || '';
  } catch (e) {}
  const pedida = parametros.get('comparar') || lembrada;
  if (pedida) comparar(pedida);
  else modo(parametros.get('modo') === 'lado' ? 'lado' : 'so');
})();
