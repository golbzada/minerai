/**
 * ==============================================================================
 * MINERAÍ - METADADOS ESTRUTURADOS DA OFERTA
 * ==============================================================================
 * A tabela `offers` do Supabase não tem colunas para data de início da
 * veiculação, ID da biblioteca, ID da página etc. Em vez de exigir uma migração
 * no banco (que quebraria contas já existentes), guardamos esses campos em um
 * bloco JSON escondido no final de `funnel_notes` e o removemos na exibição.
 *
 * Formato gravado:
 *   Minhas anotações livres...
 *   [[minerai:{"v":1,"start_date":"2026-06-01","library_id":"123"}]]
 *
 * Benefício principal: guardando `start_date` em vez de um número fixo de dias,
 * o "há quantos dias está rodando" se atualiza sozinho todo dia, sem edição
 * manual.
 */

const META_RE = /\s*\[\[minerai:(\{[\s\S]*?\})\]\]\s*/;
const LEGACY_DAYS_RE = /Dias rodando:\s*(\d+)\s*(?:\|\s*)?/i;
const LEGACY_CAPTURE_RE = /Capturado via Mineraí Extensão\.?\s*/i;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Data de hoje no formato YYYY-MM-DD (fuso local, não UTC). */
export function todayIso() {
  const d = new Date();
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().split('T')[0];
}

/** Converte 'YYYY-MM-DD' em Date ao meio-dia local (evita drift de fuso). */
export function isoToDate(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    const parsed = new Date(iso);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

/** Quantos dias se passaram desde a data de início da veiculação. */
export function startDateToDays(startDate) {
  const start = isoToDate(startDate);
  if (!start) return null;

  // Ambas as pontas ao meio-dia: a conta fica em dias de calendário e não muda
  // conforme a hora em que o usuário abre o painel (nem no horário de verão).
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const diff = Math.round((today - start) / DAY_MS);
  return Math.max(1, diff + 1);
}

/** Caminho inverso: o usuário digita "600 dias" e derivamos a data de início. */
export function daysToStartDate(days) {
  const n = Math.max(1, parseInt(days, 10) || 1);
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - (n - 1));
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().split('T')[0];
}

/**
 * Separa as anotações do usuário dos metadados técnicos.
 * Também limpa os formatos legados ("Dias rodando: 5 | ...").
 */
export function decodeNotes(rawNotes) {
  const raw = typeof rawNotes === 'string' ? rawNotes : '';
  let meta = {};

  const metaMatch = raw.match(META_RE);
  if (metaMatch) {
    try {
      meta = JSON.parse(metaMatch[1]) || {};
    } catch (e) {
      meta = {};
    }
  }

  let notes = raw.replace(META_RE, '');

  // Formato legado: os dias rodando eram prefixados no texto das anotações.
  const legacyDays = notes.match(LEGACY_DAYS_RE);
  if (legacyDays && !meta.start_date) {
    meta.legacy_days = parseInt(legacyDays[1], 10) || 1;
  }
  notes = notes.replace(LEGACY_DAYS_RE, '').replace(LEGACY_CAPTURE_RE, '');

  return { notes: notes.trim(), meta };
}

/** Regrava as anotações do usuário com o bloco de metadados no final. */
export function encodeNotes(notes, meta) {
  const cleanNotes = decodeNotes(notes).notes;
  const payload = {};

  // Só grava chaves com valor real, para o bloco não virar lixo.
  Object.keys(meta || {}).forEach((key) => {
    const value = meta[key];
    if (value !== null && value !== undefined && value !== '') {
      payload[key] = value;
    }
  });

  if (!Object.keys(payload).length) return cleanNotes;

  payload.v = 1;
  const block = `[[minerai:${JSON.stringify(payload)}]]`;
  return cleanNotes ? `${cleanNotes}\n\n${block}` : block;
}

/**
 * Junta os metadados já decodificados (`offer.meta`) com os que ainda estão
 * dentro de `funnel_notes`. Um `meta` parcial vindo de fora não pode apagar o
 * que está gravado nas anotações — era o que fazia os dias rodando e o estágio
 * discordarem entre si.
 */
function mergeMeta(offer, extra) {
  const fromNotes = decodeNotes(offer?.funnel_notes ?? offer?.notes).meta;
  return { ...fromNotes, ...(offer?.meta || {}), ...(extra || {}) };
}

/**
 * Dias rodando de uma oferta, sempre recalculados a partir da data de início
 * quando ela existe (por isso o número anda sozinho a cada dia).
 */
export function resolveRunningDays(offer, meta) {
  const info = mergeMeta(offer, meta);

  const fromStart = startDateToDays(info.start_date);
  if (fromStart) return fromStart;

  if (info.legacy_days) return info.legacy_days;
  if (offer?.running_days) return Math.max(1, Number(offer.running_days) || 1);

  return 1;
}

/**
 * Normaliza o histórico para `{ date, count }`, aceitando os dois formatos que
 * já circulam na base (`date`/`count` do Supabase e `result_date`/`results_count`
 * do armazenamento local antigo).
 */
export function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];

  const byDate = new Map();

  history.forEach((item) => {
    if (!item || typeof item !== 'object') return;

    const rawDate = item.date || item.result_date || item.created_at;
    const date = typeof rawDate === 'string' ? rawDate.slice(0, 10) : todayIso();
    const count = Number(item.count ?? item.ads_count ?? item.results_count ?? 0);

    byDate.set(date, { date, count: isNaN(count) ? 0 : count });
  });

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Grava a entrada com as duas nomenclaturas para continuar compatível com
 * qualquer parte do app (e com backups antigos) que ainda leia o formato velho.
 */
export function historyEntry(date, count) {
  const n = Math.max(0, Number(count) || 0);
  return { date, count: n, ads_count: n, result_date: date, results_count: n };
}

/** Insere ou atualiza a medição de um dia dentro do histórico. */
export function upsertHistory(history, date, count) {
  const normalized = normalizeHistory(history).filter((h) => h.date !== date);
  normalized.push({ date, count: Math.max(0, Number(count) || 0) });
  return normalized
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((h) => historyEntry(h.date, h.count));
}

/**
 * Faixas de tempo que definem o estágio da oferta.
 * Precisa ficar igual ao STAGE_DAYS de extension/content.js.
 *
 * A quantidade de anúncios ficou de fora de propósito: o que a Biblioteca
 * mostra é "N anúncios usam este criativo", que não é o total de anúncios
 * ativos da oferta, então não dá para classificar escala por ali.
 */
export const STAGE_DAYS = {
  pre_scaling: 7,   // 1 a 6 dias   -> Em teste
  scaling: 20,      // 7 a 19 dias  -> Pré-escala
  winner: 70        // 20 a 69 dias -> Escalando | 70+ -> Vencedor
};

/** Estágio da oferta pelo tempo de veiculação. */
export function classifyStatus(runningDays) {
  const days = Number(runningDays) || 0;

  if (days >= STAGE_DAYS.winner) return 'winner';
  if (days >= STAGE_DAYS.scaling) return 'scaling';
  if (days >= STAGE_DAYS.pre_scaling) return 'pre_scaling';
  return 'testing';
}

/**
 * Estágio a exibir: o que o usuário fixou à mão, se ele fixou; senão o
 * automático, recalculado a cada render — assim a tag avança sozinha conforme
 * os dias passam, sem precisar reminerar a oferta.
 */
export function resolveStatus(offer) {
  if (!offer) return 'testing';

  const meta = mergeMeta(offer);
  if (meta.status_manual && offer.status) return offer.status;

  return classifyStatus(resolveRunningDays(offer, meta));
}
