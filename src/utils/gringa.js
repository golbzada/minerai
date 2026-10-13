/**
 * Gringa x Brasil: oferta escalando lá fora já roda no Brasil?
 * A extensão lê dois sinais na Biblioteca do Brasil: anúncios ativos do mesmo
 * anunciante e anúncios que citam o mesmo site. Zero nos dois = janela aberta.
 */
import { decodeNotes } from './offerMeta.js';

/** { janela, texto } para mostrar, ou null se ainda não foi checado. */
export function textoBrasil(brasil) {
  if (!brasil || brasil.anunciante === null || brasil.anunciante === undefined) return null;
  const anunciante = Number(brasil.anunciante) || 0;
  const site = brasil.site === null || brasil.site === undefined ? null : Number(brasil.site) || 0;
  if (anunciante === 0 && (site === null || site === 0)) {
    return { janela: true, texto: 'Ninguém roda no Brasil ainda' };
  }
  const partes = [`${anunciante} ${anunciante === 1 ? 'anúncio' : 'anúncios'} do anunciante`];
  if (site !== null) partes.push(`${site} com o mesmo site`);
  return { janela: false, texto: `No Brasil: ${partes.join(' · ')}` };
}

/** O que o rastreio guardou sobre o Brasil para uma oferta minerada lá fora. */
export function brasilDaOferta(offer) {
  const meta = offer?.meta && typeof offer.meta === 'object' ? offer.meta : decodeNotes(offer?.funnel_notes ?? offer?.notes).meta;
  const pais = String(meta?.country || '');
  if (!/^[A-Z]{2}$/.test(pais) || pais === 'BR') return null;
  if (meta.brasil_ads === null || meta.brasil_ads === undefined) return null;
  return { anunciante: Number(meta.brasil_ads) || 0, site: meta.brasil_site ?? null, data: meta.brasil_at || null };
}
