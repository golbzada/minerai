/**
 * Gringa x Brasil: oferta escalando lá fora já roda no Brasil?
 * A extensão lê dois sinais na Biblioteca do Brasil: anúncios ativos do mesmo
 * anunciante e anúncios com o mesmo site. Zero nos dois = janela aberta.
 * Sem site para comparar (rede social, checkout compartilhado) não há janela.
 */
import { decodeNotes, todayIso } from './offerMeta.js';

const MOSTRA_DIAS = 14; // checagem mais velha que isso não aparece

const numero = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function diasDesde(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const h = String(todayIso()).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m || !h) return Infinity;
  return Math.round((Date.UTC(h[1], h[2] - 1, h[3]) - Date.UTC(m[1], m[2] - 1, m[3])) / 86400000);
}

/** { janela, texto } para mostrar, ou null se ainda não foi checado. */
export function textoBrasil(brasil) {
  if (!brasil) return null;
  const anunciante = numero(brasil.anunciante);
  if (anunciante === null) return null;
  const site = numero(brasil.site);
  if (anunciante === 0 && site === 0) return { janela: true, texto: 'Ninguém roda no Brasil ainda' };
  if (anunciante === 0 && site === null) return { janela: false, texto: 'Anunciante não roda no Brasil (site não conferido)' };
  const partes = [`${anunciante} ${anunciante === 1 ? 'anúncio' : 'anúncios'} do anunciante`];
  if (site !== null) partes.push(`${site} com o mesmo site`);
  return { janela: false, texto: `No Brasil: ${partes.join(' · ')}` };
}

/** Versão curta para a ficha da oferta. */
export function resumoCurtoBrasil(brasil) {
  const t = textoBrasil(brasil);
  if (!t) return '';
  if (t.janela) return 'Janela aberta';
  const anunciante = numero(brasil.anunciante);
  const site = numero(brasil.site);
  return site === null ? `${anunciante} do anunciante` : `${anunciante} do anunciante · ${site} com o site`;
}

/** O que o rastreio guardou sobre o Brasil para uma oferta minerada lá fora (recente e viva). */
export function brasilDaOferta(offer) {
  const meta = offer?.meta && typeof offer.meta === 'object' ? offer.meta : decodeNotes(offer?.funnel_notes ?? offer?.notes).meta;
  const pais = String(meta?.country || '');
  if (!/^[A-Z]{2}$/.test(pais) || pais === 'BR') return null;
  if (meta.dead_since) return null;
  if (numero(meta.brasil_ads) === null) return null;
  if (diasDesde(meta.brasil_at) > MOSTRA_DIAS) return null;
  return { anunciante: numero(meta.brasil_ads), site: numero(meta.brasil_site), data: meta.brasil_at || null };
}
