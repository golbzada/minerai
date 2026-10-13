/**
 * Partes puras da página Radar do nicho.
 * Os achados chegam da extensão (extension/radar-regras.js → montarAchados).
 */
import { decodeNotes, classifyStatus } from './offerMeta.js';

/** Domínio sem "www." (ou vazio, se não for URL). */
export function dominioDe(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

function metaDe(offer) {
  if (offer?.meta && typeof offer.meta === 'object') return offer.meta;
  return decodeNotes(offer?.funnel_notes ?? offer?.notes).meta || {};
}

/** A oferta já está no acervo? (mesmo anúncio ou mesmo anunciante) */
export function jaNoAcervo(achado, offers) {
  return (offers || []).some((o) => {
    const m = metaDe(o);
    return (
      (achado.libraryId && String(m.library_id || '') === achado.libraryId) ||
      (achado.pageId && (String(m.page_id_real || '') === achado.pageId || String(o.page_id || '') === achado.pageId))
    );
  });
}

/** Aplica os filtros da página e marca quem já está no acervo. */
export function filtrarAchados(achados, offers, { soNovas = true, esconderAcervo = true } = {}) {
  return (achados || [])
    .map((a) => ({ ...a, noAcervo: jaNoAcervo(a, offers) }))
    .filter((a) => (!soNovas || a.novaEscalando) && (!esconderAcervo || !a.noAcervo));
}

/** Oferta pronta para `api.createOffer` a partir de um achado do Radar. */
export function ofertaDoAchado(achado, busca, tabId = null) {
  return {
    name: achado.pageName || dominioDe(achado.link) || 'Oferta do Radar',
    page_id: achado.pageId,
    library_url: `https://www.facebook.com/ads/library/?id=${achado.libraryId}`,
    landing_page: achado.link || '',
    niche: 'Outros',
    tab_id: tabId,
    status: classifyStatus(achado.dias),
    meta: {
      start_date: achado.startDate,
      library_id: achado.libraryId,
      page_id_real: achado.pageId,
      page_name: achado.pageName,
      country: busca?.pais,
      topic: busca?.termo,
      source: 'radar'
    }
  };
}

/** "+4% desde a última rodada" */
export function variacaoNicho(total, anterior) {
  if (!Number.isFinite(Number(total)) || anterior === null || anterior === undefined || !Number(anterior)) return '';
  const pct = Math.round(((Number(total) - Number(anterior)) / Number(anterior)) * 100);
  if (pct === 0) return 'igual à última rodada';
  return `${pct > 0 ? '+' : ''}${pct}% desde a última rodada`;
}
