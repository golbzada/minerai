/**
 * ==============================================================================
 * MINERAÍ - RESUMO DA EVOLUÇÃO DA OFERTA
 * ==============================================================================
 * O card mostra só o começo e o hoje, com uma frase que qualquer um entende
 * ("Caiu de 42 para 29 anúncios ativos desde 13/10"). O dia a dia fica no
 * histórico (HistoryModal), que usa `linhasDoHistorico`.
 *
 * Duas réguas convivem no histórico:
 *   - `kind: 'anunciante'`: total de anúncios ativos do anunciante (rastreio
 *     diário e mineração desde 13/10/2026);
 *   - sem `kind`: contagem antiga, só dos anúncios daquele criativo.
 * Comparar uma com a outra dava "+75500%". Quando já existe medição do
 * anunciante, as antigas saem da conta (e aparecem marcadas no histórico).
 */
import { normalizeHistory } from './offerMeta.js';

const ANUNCIANTE = 'anunciante';

function diaMes(iso) {
  const m = String(iso || '').match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : '';
}

function anuncios(n) {
  return `${n} ${n === 1 ? 'anúncio ativo' : 'anúncios ativos'}`;
}

/** Medições comparáveis entre si (mesma régua), em ordem de data. */
function serieComparavel(lista) {
  const temAnunciante = lista.some((h) => h.kind === ANUNCIANTE);
  return temAnunciante ? lista.filter((h) => h.kind === ANUNCIANTE) : lista;
}

/**
 * { direcao: 'vazia'|'unica'|'subiu'|'caiu'|'estavel', inicio, fim, diff, pct, frase, serie }
 */
export function resumoDaEvolucao(history) {
  const serie = serieComparavel(normalizeHistory(history));
  if (!serie.length) {
    return { direcao: 'vazia', serie, inicio: null, fim: null, diff: 0, pct: 0, frase: 'Ainda sem medição. A extensão mede uma vez por dia.' };
  }

  const inicio = serie[0];
  const fim = serie[serie.length - 1];
  if (serie.length === 1) {
    return {
      direcao: 'unica',
      serie,
      inicio,
      fim,
      diff: 0,
      pct: 0,
      frase: `Primeira medição: ${anuncios(fim.count)} em ${diaMes(fim.date)}. A extensão mede de novo amanhã.`
    };
  }

  const diff = fim.count - inicio.count;
  const pct = inicio.count > 0 ? Math.round((diff / inicio.count) * 100) : 0;
  const desde = diaMes(inicio.date);
  let direcao = 'estavel';
  let frase = `Estável em ${anuncios(fim.count)} desde ${desde}.`;
  if (diff > 0) {
    direcao = 'subiu';
    frase = `Subiu de ${inicio.count} para ${anuncios(fim.count)} desde ${desde}${inicio.count > 0 ? ` (+${pct}%)` : ''}.`;
  } else if (diff < 0) {
    direcao = 'caiu';
    frase = `Caiu de ${inicio.count} para ${anuncios(fim.count)} desde ${desde} (${pct}%).`;
  }
  return { direcao, serie, inicio, fim, diff, pct, frase };
}

/**
 * Linhas do histórico detalhado:
 * { date, count, antiga, primeira, diff, pct } — `diff`/`pct` em relação à
 * medição anterior da MESMA régua; null na primeira e nas antigas.
 */
export function linhasDoHistorico(history) {
  const lista = normalizeHistory(history);
  const comparaveis = new Set(serieComparavel(lista));
  let anterior = null;
  return lista.map((h) => {
    if (!comparaveis.has(h)) return { ...h, antiga: true, primeira: false, diff: null, pct: null };
    const linha = { ...h, antiga: false, primeira: !anterior, diff: null, pct: null };
    if (anterior) {
      linha.diff = h.count - anterior.count;
      linha.pct = anterior.count > 0 ? Math.round((linha.diff / anterior.count) * 100) : null;
    }
    anterior = h;
    return linha;
  });
}
