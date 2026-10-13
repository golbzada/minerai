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

  // Oferta morta: os dias param na data em que ela saiu do ar.
  const start = isoToDate(info.start_date);
  const dead = isoToDate(info.dead_since);
  if (start && dead) {
    return Math.max(1, Math.round((dead - start) / DAY_MS) + 1);
  }

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
    const entry = { date, count: isNaN(count) ? 0 : count };
    // `kind: 'anunciante'` = total de anúncios do anunciante (rastreio diário).
    // Sem `kind` = medição antiga ("anúncios usam este criativo").
    if (typeof item.kind === 'string') entry.kind = item.kind;

    byDate.set(date, entry);
  });

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Grava a entrada com as duas nomenclaturas para continuar compatível com
 * qualquer parte do app (e com backups antigos) que ainda leia o formato velho.
 */
export function historyEntry(date, count, kind) {
  const n = Math.max(0, Number(count) || 0);
  const entry = { date, count: n, ads_count: n, result_date: date, results_count: n };
  if (kind) entry.kind = kind;
  return entry;
}

/** Histórico saneado para a interface/banco: últimas `limit` medições, com tipo. */
export function cleanHistory(history, limit = 3650) {
  return normalizeHistory(history)
    .slice(-limit)
    .map((h) => historyEntry(h.date, h.count, h.kind));
}

/**
 * Data de início a partir do "há quantos dias está rodando" do formulário.
 * Se a pessoa não mudou os dias, a data fica como está — senão editar o nome
 * de uma oferta morta (dias congelados) jogava o início para depois da morte.
 * Em oferta morta, os dias contam até a data da morte.
 */
export function startDateFromForm(typedDays, meta = {}) {
  if (typedDays == null || typedDays === '') return meta.start_date || null;
  const n = Math.max(1, parseInt(typedDays, 10) || 1);
  if (meta.start_date && n === resolveRunningDays({}, meta)) return meta.start_date;

  const dead = isoToDate(meta.dead_since);
  if (dead) {
    dead.setDate(dead.getDate() - (n - 1));
    const offset = dead.getTimezoneOffset() * 60000;
    return new Date(dead.getTime() - offset).toISOString().split('T')[0];
  }
  return daysToStartDate(n);
}

/** Insere ou atualiza a medição de um dia dentro do histórico. */
export function upsertHistory(history, date, count, kind) {
  const normalized = normalizeHistory(history).filter((h) => h.date !== date);
  normalized.push({ date, count: Math.max(0, Number(count) || 0), kind });
  return normalized
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((h) => historyEntry(h.date, h.count, h.kind));
}

/**
 * Faixas de tempo que definem o estágio da oferta.
 * Precisa ficar igual ao STAGE_DAYS de extension/content.js.
 *
 * O "N anúncios usam este criativo" do card NÃO entra aqui: ele não é o total
 * de anúncios ativos da oferta. O que entra é o total do ANUNCIANTE, lido na
 * hora de minerar (ver STAGE_BY_ADS).
 */
export const STAGE_DAYS = {
  pre_scaling: 10,  // 1 a 9 dias    -> Em teste
  scaling: 30,      // 10 a 29 dias  -> Pré-escala
  winner: 150       // 30 a 149 dias -> Escalando | 150+ -> Vencedor
};

/**
 * Exceção pela quantidade de anúncios ativos do anunciante: com tempo E
 * volume, a oferta já conta como Escalando antes dos 30 dias. Só sobe a
 * etiqueta, nunca rebaixa. Muitos anúncios em poucos dias pode ser só teste,
 * por isso toda regra exige um mínimo de dias.
 * Precisa ficar igual ao STAGE_BY_ADS de extension/content.js.
 */
export const STAGE_BY_ADS = [
  { days: 15, ads: 10 }, // 15+ dias e 10+ anúncios -> Escalando
  { days: 20, ads: 7 }   // 20+ dias e 7+ anúncios  -> Escalando
];

/** Data em que o rastreio viu a oferta morrer (anunciante sem anúncios), ou null. */
export function deadSince(offer) {
  const value = mergeMeta(offer).dead_since;
  return typeof value === 'string' && value ? value : null;
}

/** A oferta saiu do ar (o rastreio confirmou em duas leituras). */
export function isOfferDead(offer) {
  return deadSince(offer) !== null;
}

/** Total de anúncios ativos do anunciante lido na mineração, ou null. */
export function resolvePageActiveAds(offer, meta) {
  const n = Number(mergeMeta(offer, meta).page_active_ads);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Regra de anúncios que a oferta cumpre, ou null. */
function adsRuleHit(days, pageAds) {
  if (!pageAds) return null;
  return STAGE_BY_ADS.find((r) => days >= r.days && pageAds >= r.ads) || null;
}

/** Estágio da oferta pelo tempo de veiculação (e anúncios do anunciante). */
export function classifyStatus(runningDays, pageActiveAds) {
  const days = Number(runningDays) || 0;

  if (days >= STAGE_DAYS.winner) return 'winner';
  if (days >= STAGE_DAYS.scaling) return 'scaling';
  if (adsRuleHit(days, Number(pageActiveAds) || 0)) return 'scaling';
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

  return classifyStatus(resolveRunningDays(offer, meta), resolvePageActiveAds(offer, meta));
}

/**
 * Legenda das etiquetas, para quem está começando. A ordem é a da evolução
 * de uma oferta; os textos usam as faixas acima, então mudam junto com elas.
 */
export const STAGE_GUIDE = [
  {
    key: 'testing',
    range: `1 a ${STAGE_DAYS.pre_scaling - 1} dias`,
    text: 'Acabou de entrar no ar. O anunciante ainda está testando se vende.'
  },
  {
    key: 'pre_scaling',
    range: `${STAGE_DAYS.pre_scaling} a ${STAGE_DAYS.scaling - 1} dias`,
    text: 'Passou do teste e continua rodando. Sinal de que está dando algum retorno.'
  },
  {
    key: 'scaling',
    range: `${STAGE_DAYS.scaling} a ${STAGE_DAYS.winner - 1} dias`,
    text: 'Está há mais de um mês pagando anúncio todo dia. Se não vendesse, já teria parado.'
  },
  {
    key: 'winner',
    range: `${STAGE_DAYS.winner}+ dias`,
    text: 'Meses no ar sem parar. Oferta validada, das que mais vale estudar.'
  }
];

/** "15+ dias com 10+ anúncios ativos do anunciante, ou 20+ dias com 7+". */
export const STAGE_ADS_RULE_TEXT = STAGE_BY_ADS.map(
  (r, i) => `${r.days}+ dias com ${r.ads}+ anúncios${i === 0 ? ' ativos do anunciante' : ''}`
).join(', ou ');

/**
 * Explicação curta do estágio desta oferta, para o tooltip da etiqueta:
 * diz POR QUE ela recebeu essa etiqueta, com os dois números juntos para a
 * pessoa poder tirar a própria conclusão.
 */
export function stageReason(offer) {
  const meta = mergeMeta(offer);
  const days = resolveRunningDays(offer, meta);
  const pageAds = resolvePageActiveAds(offer, meta);
  const status = resolveStatus(offer);
  const daysTxt = `${days} ${days === 1 ? 'dia' : 'dias'} no ar`;
  const adsTxt = pageAds ? `${pageAds} ${pageAds === 1 ? 'anúncio ativo' : 'anúncios ativos'} do anunciante` : '';

  if (meta.status_manual && offer?.status) {
    return `Etiqueta escolhida à mão. ${daysTxt}${adsTxt ? ` e ${adsTxt}` : ''}.`;
  }

  // Oferta que o rastreio diário viu morrer: os dias pararam na data da morte.
  const morte = String(meta.dead_since || '').match(/^\d{4}-(\d{2})-(\d{2})/);
  if (morte) {
    return `Saiu do ar em ${morte[2]}/${morte[1]}, depois de ${days} ${days === 1 ? 'dia' : 'dias'} no ar. A etiqueta mostra até onde ela chegou.`;
  }

  if (status === 'scaling' && days < STAGE_DAYS.scaling) {
    return `${daysTxt} e ${adsTxt}. Com tempo e muitos anúncios ao mesmo tempo, já conta como escalando.`;
  }

  const guide = STAGE_GUIDE.find((g) => g.key === status);
  const facts = adsTxt ? `${daysTxt} e ${adsTxt}` : daysTxt;
  return guide ? `${facts} (${guide.range}). ${guide.text}` : facts;
}
