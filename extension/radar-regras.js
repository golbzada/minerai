// ==============================================================================
// MINERAÍ EXTENSÃO - REGRAS DO RADAR DO NICHO (funções puras)
// ==============================================================================
// A pessoa salva buscas ("mapas mentais", "emagrecer"); uma vez por dia a
// extensão busca cada uma na Biblioteca (ordem padrão: mais vistos) e mostra
// os anunciantes que estão entre os mais vistos com 10 a 45 dias no ar —
// oferta nova escalando. Sem rede nem chrome.* aqui: só dados.
// Fica em `self.MineraiRadar`. Design: docs/superpowers/specs/2026-10-13-radar-do-nicho-design.md
// ==============================================================================

(function () {
  'use strict';

  const RADAR = {
    novaMin: 10,       // dias no ar para contar como "nova escalando"...
    novaMax: 45,       // ...até aqui
    vistosMax: 3000,   // anunciantes lembrados (para saber quem é novo)
    textoMax: 220      // trecho do texto do anúncio guardado
  };

  function diaUtc(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  }

  function diffDias(de, ate) {
    return Math.round((diaUtc(ate) - diaUtc(de)) / 86400000);
  }

  /** Query string da busca na Biblioteca (ordem padrão da Meta: mais vistos). */
  function urlDaBusca(termo, pais) {
    const p = String(pais || '').toUpperCase();
    const country = /^(ALL|[A-Z]{2})$/.test(p) ? p : 'BR';
    return (
      `active_status=active&ad_type=all&country=${country}` +
      `&q=${encodeURIComponent(String(termo || '').trim())}&search_type=keyword_unordered&media_type=all`
    );
  }

  /** Recorta o objeto JSON que começa no primeiro `{` depois de `inicio`. */
  function objetoEm(texto, inicio) {
    let i = texto.indexOf('{', inicio);
    if (i < 0) return null;
    const ini = i;
    let nivel = 0;
    let emTexto = false;
    let escape = false;
    for (; i < texto.length; i += 1) {
      const c = texto[i];
      if (emTexto) {
        if (escape) escape = false;
        else if (c === '\\') escape = true;
        else if (c === '"') emTexto = false;
        continue;
      }
      if (c === '"') emTexto = true;
      else if (c === '{') nivel += 1;
      else if (c === '}') {
        nivel -= 1;
        if (!nivel) return texto.slice(ini, i + 1);
      }
    }
    return null;
  }

  function dataDoUnix(segundos) {
    const n = Number(segundos);
    return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString().slice(0, 10) : '';
  }

  function primeiraImagem(s) {
    const img = (s.images || [])[0] || {};
    const video = (s.videos || [])[0] || {};
    const card = (s.cards || [])[0] || {};
    return img.resized_image_url || img.original_image_url || video.video_preview_image_url ||
      card.resized_image_url || card.video_preview_image_url || '';
  }

  /** Anúncios da página de busca, na ordem em que a Biblioteca mostra. */
  function extrairAnuncios(html) {
    const texto = String(html || '');
    const at = texto.indexOf('"search_results_connection":');
    if (at < 0) return { total: null, anuncios: [] };

    let conexao;
    try {
      conexao = JSON.parse(objetoEm(texto, at));
    } catch (e) {
      return { total: null, anuncios: [] };
    }
    // Página cortada no meio: objetoEm devolve null e JSON.parse(null) também.
    if (!conexao || typeof conexao !== 'object') return { total: null, anuncios: [] };

    const lista = (conexao.edges || []).flatMap((e) => (e && e.node && e.node.collated_results) || []);
    const anuncios = lista
      .filter((a) => a && a.ad_archive_id && a.page_id)
      .map((a, i) => {
        const s = a.snapshot || {};
        const corpo = (s.body && s.body.text) || (s.cards && s.cards[0] && s.cards[0].body) || '';
        return {
          libraryId: String(a.ad_archive_id),
          pageId: String(a.page_id),
          pageName: String(s.page_name || a.page_name || ''),
          startDate: dataDoUnix(a.start_date),
          copias: Number(a.collation_count) || 1,
          link: String(s.link_url || (s.cards && s.cards[0] && s.cards[0].link_url) || ''),
          texto: String(corpo).slice(0, RADAR.textoMax),
          imagem: String(primeiraImagem(s)),
          posicao: i + 1
        };
      });

    return { total: Number.isFinite(Number(conexao.count)) ? Number(conexao.count) : null, anuncios };
  }

  /**
   * Um achado por anunciante (o de melhor posição), com dias no ar e se é
   * novo no radar. Devolve também os "vistos" atualizados.
   */
  function montarAchados(anuncios, { hoje, vistos = {}, primeiraRodada = false }) {
    const porAnunciante = new Map();
    (anuncios || []).forEach((a) => {
      const atual = porAnunciante.get(a.pageId);
      if (!atual || a.posicao < atual.posicao) porAnunciante.set(a.pageId, a);
    });

    const novosVistos = { ...vistos };
    const achados = Array.from(porAnunciante.values())
      .sort((a, b) => a.posicao - b.posicao)
      .map((a) => {
        const dias = a.startDate ? Math.max(1, diffDias(a.startDate, hoje) + 1) : 0;
        // Novo = nunca visto nesta busca, ou visto pela primeira vez hoje (uma
        // segunda rodada no mesmo dia não pode apagar o "novo").
        const novo = !primeiraRodada && (!(a.pageId in vistos) || vistos[a.pageId] === hoje);
        if (!(a.pageId in novosVistos)) novosVistos[a.pageId] = hoje;
        return { ...a, dias, novaEscalando: dias >= RADAR.novaMin && dias <= RADAR.novaMax, novo };
      });

    // Esquece os vistos mais antigos para o chrome.storage não crescer sem fim.
    const chaves = Object.keys(novosVistos);
    if (chaves.length > RADAR.vistosMax) {
      chaves
        .sort((a, b) => String(novosVistos[a]).localeCompare(String(novosVistos[b])))
        .slice(0, chaves.length - RADAR.vistosMax)
        .forEach((k) => delete novosVistos[k]);
    }

    return { achados, vistos: novosVistos };
  }

  // ---------------------------------------------------------------------------
  // Gringa x Brasil: oferta escalando lá fora já roda aqui?
  // Dois sinais, lidos na Biblioteca do Brasil: anúncios ativos do MESMO
  // anunciante e anúncios que citam o MESMO site (frase exata).
  // ---------------------------------------------------------------------------
  const BRASIL_VALIDADE_DIAS = 7;
  const SITES_SEM_OFERTA = /(^|\.)(facebook\.com|fb\.me|fb\.com|instagram\.com|wa\.me|whatsapp\.com|m\.me|messenger\.com|linktr\.ee|youtube\.com|youtu\.be|tiktok\.com)$/i;

  /** Domínio do site de vendas (vazio para rede social, WhatsApp, encurtador). */
  function dominioDoLink(link) {
    try {
      const host = new URL(link).hostname.replace(/^www\./, '').toLowerCase();
      return host && !SITES_SEM_OFERTA.test(host) ? host : '';
    } catch (e) {
      return '';
    }
  }

  function paisValido(pais) {
    const p = String(pais || '').toUpperCase();
    return /^(ALL|[A-Z]{2})$/.test(p) ? p : 'BR';
  }

  function urlAnuncianteNoPais(pageId, pais) {
    return `active_status=active&ad_type=all&country=${paisValido(pais)}&view_all_page_id=${String(pageId).replace(/\D/g, '')}&media_type=all`;
  }

  function urlSiteNoPais(dominio, pais) {
    return (
      `active_status=active&ad_type=all&country=${paisValido(pais)}` +
      `&q=${encodeURIComponent(`"${dominio}"`)}&search_type=keyword_exact_phrase&media_type=all`
    );
  }

  /** Quem checar no Brasil hoje: sem checagem da última semana, novas escalando primeiro. */
  function escolherParaChecarBrasil(achados, cache, hoje, max = 8) {
    return (achados || [])
      .filter((a) => {
        const c = (cache || {})[a.pageId];
        return !(c && c.data && diffDias(c.data, hoje) < BRASIL_VALIDADE_DIAS);
      })
      .sort((a, b) => (Number(b.novaEscalando) - Number(a.novaEscalando)) || (a.posicao - b.posicao))
      .slice(0, max)
      .map((a) => a.pageId);
  }

  /** Junta o que se sabe do Brasil em cada achado. Janela aberta = ninguém roda aqui. */
  function aplicarBrasil(achados, cache) {
    return (achados || []).map((a) => {
      const c = (cache || {})[a.pageId];
      if (!c) return a;
      const anunciante = c.anunciante ?? null;
      const site = c.site ?? null;
      return { ...a, brasil: { anunciante, site, janela: anunciante === 0 && (site === 0 || site === null), data: c.data } };
    });
  }

  self.MineraiRadar = {
    RADAR,
    BRASIL_VALIDADE_DIAS,
    urlDaBusca,
    extrairAnuncios,
    montarAchados,
    diffDias,
    dominioDoLink,
    urlAnuncianteNoPais,
    urlSiteNoPais,
    escolherParaChecarBrasil,
    aplicarBrasil
  };
})();
