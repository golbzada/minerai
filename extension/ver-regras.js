// ==============================================================================
// MINERAÍ EXTENSÃO - VER E COMPARAR A CAPTURA (funções puras)
// ==============================================================================
// O Modelar Página guarda cada captura no próprio computador (banco interno
// da extensão, capturas-locais.js). Para ver a página sem descompactar nada,
// ver.js remonta o index.html trocando cada caminho do pacote
// ("assets/img/foto-ab12.png") pelo endereço do arquivo guardado.
// Sem rede e sem chrome.*: usado por ver.js, pelo documento oculto e pelos
// testes. Fica em `self.MineraiVer`.
// ==============================================================================

(function () {
  'use strict';

  const TIPOS = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', ogv: 'video/ogg',
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', aac: 'audio/aac',
    woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
    css: 'text/css;charset=utf-8', js: 'text/javascript;charset=utf-8', html: 'text/html;charset=utf-8',
    md: 'text/markdown;charset=utf-8', txt: 'text/plain;charset=utf-8'
  };

  function tipoDoArquivo(nome) {
    const ext = String(nome || '').toLowerCase().split('.').pop();
    return TIPOS[ext] || 'application/octet-stream';
  }

  /**
   * Troca cada caminho do pacote pelo endereço guardado. Os caminhos maiores
   * primeiro: "a-10.png" nunca é trocado pela metade por causa de "a-1.png"
   * (e o separador exige que o caminho termine ali).
   */
  function trocarCaminhos(html, mapa) {
    let saida = String(html || '');
    Object.keys(mapa || {})
      .sort((a, b) => b.length - a.length)
      .forEach((caminho) => {
        const partes = saida.split(caminho);
        if (partes.length < 2) return;
        let montado = partes[0];
        for (let i = 1; i < partes.length; i += 1) {
          // Logo depois do caminho só pode vir aspas, parêntese, espaço ou "?#".
          const fimLimpo = /^($|["')\s?#,;>])/.test(partes[i]);
          montado += (fimLimpo ? mapa[caminho] : caminho) + partes[i];
        }
        saida = montado;
      });
    return saida;
  }

  /** Ids que passam do limite (as mais antigas saem primeiro). */
  function alemDoLimite(metas, maximo) {
    return (Array.isArray(metas) ? metas : [])
      .filter((m) => m && m.id)
      .sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')))
      .slice(maximo)
      .map((m) => m.id);
  }

  /** Só http(s); sem protocolo vira https. Vazio quando não serve. */
  function enderecoSeguro(valor) {
    const cru = String(valor || '').trim();
    if (!cru || cru.length > 2048) return '';
    try {
      const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(cru) ? cru : `https://${cru}`);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      if (!u.hostname.includes('.')) return '';
      return u.href;
    } catch (e) {
      return '';
    }
  }

  /** O nome que o empacotador dá à pasta: letras, números, ponto, hífen. */
  function idSeguro(valor) {
    const id = String(valor || '');
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(id) && !id.includes('..') ? id : '';
  }

  self.MineraiVer = { tipoDoArquivo, trocarCaminhos, alemDoLimite, enderecoSeguro, idSeguro };
})();
