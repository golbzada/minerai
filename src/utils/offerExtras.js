/**
 * ==============================================================================
 * MINERAÍ - ATRIBUTOS EXTRAS DA OFERTA (favorito, nota, etiquetas, esteira...)
 * ==============================================================================
 * Nada disso tem coluna no banco: tudo vive no bloco [[minerai:{...}]] dentro
 * de funnel_notes, o mesmo lugar de start_date e library_id. Assim o painel
 * ganha as funções novas sem migração no Supabase.
 */
import { decodeNotes, normalizeHistory, resolveRunningDays, resolveStatus, todayIso } from './offerMeta.js';

export const STAGES = [
  { key: 'radar', label: 'Radar', hint: 'Acabou de ser garimpada' },
  { key: 'analisando', label: 'Analisando', hint: 'Estudando criativo, página e funil' },
  { key: 'modelando', label: 'Modelando', hint: 'Montando a sua versão' },
  { key: 'rodando', label: 'Rodando', hint: 'Sua campanha está no ar' },
  { key: 'descartada', label: 'Descartada', hint: 'Não vale a pena agora' }
];

export const CHECKLIST_ITEMS = [
  { key: 'hook', label: 'Hook / gancho dos primeiros segundos' },
  { key: 'promessa', label: 'Promessa principal clara' },
  { key: 'prova', label: 'Prova social ou autoridade' },
  { key: 'oferta', label: 'Estrutura da oferta (bônus, escassez)' },
  { key: 'preco', label: 'Preço e forma de pagamento' },
  { key: 'garantia', label: 'Garantia e pós-venda' }
];

export function offerMeta(offer) {
  if (!offer) return {};
  if (offer.meta && typeof offer.meta === 'object') return offer.meta;
  return decodeNotes(offer.funnel_notes ?? offer.notes).meta || {};
}

/** Lê os atributos extras com valores seguros. */
export function getExtras(offer) {
  const m = offerMeta(offer);
  const rating = Number(m.rating);
  return {
    fav: m.fav === true,
    rating: Number.isFinite(rating) ? Math.min(5, Math.max(0, Math.round(rating))) : 0,
    tags: Array.isArray(m.tags) ? m.tags.filter((t) => typeof t === 'string' && t.trim()).slice(0, 12) : [],
    stage: STAGES.some((s) => s.key === m.stage) ? m.stage : 'radar',
    order: Number.isFinite(Number(m.order)) ? Number(m.order) : null,
    checklist: m.checklist && typeof m.checklist === 'object' ? m.checklist : {},
    modelagens: Array.isArray(m.modelagens) ? m.modelagens.slice(0, 20) : []
  };
}

export function normalizeTag(tag) {
  return String(tag || '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

export function allTags(offers) {
  const count = new Map();
  (offers || []).forEach((o) => getExtras(o).tags.forEach((t) => count.set(t, (count.get(t) || 0) + 1)));
  return Array.from(count.entries()).sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch (e) {
    return '';
  }
}

/** Nome do anunciante/página para agrupar: ID da página quando existe, senão o nome. */
export function advertiserKey(offer) {
  const id = offer.page_id && offer.page_id !== 'N/A' && offer.page_id !== '4' ? offer.page_id : '';
  return id || (offer.name || '').trim().toLowerCase();
}

/**
 * Possíveis duplicadas: mesma página de vendas (domínio + caminho) ou mesmo
 * anunciante. Devolve Map(id -> [{ id, name, reason }]).
 */
export function findDuplicates(offers) {
  const byLanding = new Map();
  const byAdvertiser = new Map();

  (offers || []).forEach((o) => {
    const landing = o.landing_page || o.destination_url || '';
    const host = domainOf(landing);
    if (host) {
      let key = host;
      try {
        key = host + new URL(landing).pathname.replace(/\/$/, '');
      } catch (e) {}
      if (!byLanding.has(key)) byLanding.set(key, []);
      byLanding.get(key).push(o);
    }
    // Mesmo anunciante E mesmo anúncio (ID da biblioteca). Dois anúncios
    // diferentes da mesma página são ofertas distintas, não duplicata.
    const adv = advertiserKey(o);
    if (adv) {
      const key = `${adv}|${offerMeta(o).library_id || ''}`;
      if (!byAdvertiser.has(key)) byAdvertiser.set(key, []);
      byAdvertiser.get(key).push(o);
    }
  });

  const result = new Map();
  const add = (o, other, reason) => {
    if (o.id === other.id) return;
    if (!result.has(o.id)) result.set(o.id, []);
    const list = result.get(o.id);
    if (!list.some((x) => x.id === other.id)) list.push({ id: other.id, name: other.name, reason });
  };

  byLanding.forEach((group) => {
    if (group.length > 1) group.forEach((o) => group.forEach((other) => add(o, other, 'mesma página de vendas')));
  });
  byAdvertiser.forEach((group) => {
    if (group.length > 1) group.forEach((o) => group.forEach((other) => add(o, other, 'mesmo anunciante e mesmo anúncio')));
  });

  return result;
}

const DAY_MS = 86400000;

function daysBetweenIso(iso, now = new Date()) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (isNaN(d.getTime())) return null;
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  return Math.round((today - d) / DAY_MS);
}

export const ALERT_DEFAULTS = { diasSemMedicao: 3, diasLonga: 100, quedaPercentual: 30 };

export function loadAlertPrefs() {
  try {
    return { ...ALERT_DEFAULTS, ...(JSON.parse(localStorage.getItem('minerai_alert_prefs') || '{}')) };
  } catch (e) {
    return { ...ALERT_DEFAULTS };
  }
}

export function saveAlertPrefs(prefs) {
  try {
    localStorage.setItem('minerai_alert_prefs', JSON.stringify(prefs));
  } catch (e) {}
}

/**
 * Alertas calculados a partir do acervo (sem servidor):
 *  - medicao: sem contagem de anúncios há N dias
 *  - longa: passou de X dias rodando
 *  - queda: a última medição caiu Y% em relação à anterior
 *  - estagio: o estágio automático mudou e o card ainda mostra o antigo no banco
 */
// Eventos que o rastreio diário da extensão grava em `track_events` (ver
// extension/rastreio-regras.js). Cada um fica visível por 7 dias.
const TRACK_EVENT_DAYS = 7;
const TRACK_SEVERITY = { morreu: 'alta', escalou: 'alta', decaindo: 'media', criativo_saiu: 'baixa', voltou: 'baixa' };

function fmtDiaMes(iso) {
  const [, m, d] = String(iso || '').match(/^\d{4}-(\d{2})-(\d{2})/) || [];
  return d ? `${d}/${m}` : '';
}

function trackEventText(e) {
  switch (e.tipo) {
    case 'escalou': return `foi de ${e.de} para ${e.para} anúncios ativos.`;
    case 'decaindo': return `caiu de ${e.de} para ${e.para} anúncios ativos.`;
    case 'morreu': return `o anunciante parou todos os anúncios (visto em ${fmtDiaMes(e.data)}).`;
    case 'criativo_saiu': return `o anúncio que você salvou parou, mas o anunciante segue com ${e.para} anúncios.`;
    case 'voltou': return `o anunciante voltou com ${e.para} anúncios.`;
    default: return '';
  }
}

export function computeAlerts(offers, prefs = loadAlertPrefs()) {
  const alerts = [];
  const now = new Date();

  (offers || []).forEach((o) => {
    const extras = getExtras(o);
    if (extras.stage === 'descartada') return;

    const meta = offerMeta(o);
    const history = normalizeHistory(o.history);
    const last = history[history.length - 1];
    const prev = history[history.length - 2];
    const sinceLast = last ? daysBetweenIso(last.date, now) : null;

    // Medida pelo rastreio automático nos últimos 2 dias: não pede medição à mão.
    const sinceTracked = daysBetweenIso(meta.tracked_at, now);
    const trackedRecently = sinceTracked !== null && sinceTracked <= 2;

    (Array.isArray(meta.track_events) ? meta.track_events : []).forEach((e) => {
      const age = daysBetweenIso(e?.data, now);
      if (age === null || age > TRACK_EVENT_DAYS || !TRACK_SEVERITY[e.tipo]) return;
      alerts.push({ type: e.tipo, severity: TRACK_SEVERITY[e.tipo], offer: o, text: trackEventText(e) });
    });

    if (!trackedRecently && (sinceLast === null || sinceLast >= prefs.diasSemMedicao)) {
      alerts.push({
        type: 'medicao',
        severity: 'media',
        offer: o,
        text: sinceLast === null
          ? 'Nunca teve medição registrada.'
          : `Última medição há ${sinceLast} ${sinceLast === 1 ? 'dia' : 'dias'}.`
      });
    }

    const days = resolveRunningDays(o);
    if (days >= prefs.diasLonga) {
      alerts.push({ type: 'longa', severity: 'alta', offer: o, text: `Já são ${days} dias no ar.` });
    }

    // Com medições do anunciante, quem avisa queda é o "Decaindo" do rastreio
    // (que nunca compara número novo com o antigo do criativo).
    const temAnunciante = history.some((h) => h.kind === 'anunciante');
    if (!temAnunciante && last && prev && prev.count > 0) {
      const drop = Math.round(((prev.count - last.count) / prev.count) * 100);
      if (drop >= prefs.quedaPercentual) {
        alerts.push({
          type: 'queda',
          severity: 'alta',
          offer: o,
          text: `Caiu de ${prev.count} para ${last.count} anúncios (${drop}%).`
        });
      }
    }

    const shown = resolveStatus(o);
    if (!meta.status_manual && !meta.dead_since && o.status && shown !== o.status) {
      alerts.push({ type: 'estagio', severity: 'baixa', offer: o, text: `Estágio avançou para "${shown}" pelo tempo rodando.` });
    }
  });

  const weight = { alta: 0, media: 1, baixa: 2 };
  return alerts.sort((a, b) => weight[a.severity] - weight[b.severity]);
}

/**
 * Hora ('HH:MM') da medição automática mais recente de hoje, ou null.
 * O rastreio da extensão grava `tracked_at` como 'YYYY-MM-DDTHH:MM' local.
 */
export function ultimoRastreioHoje(offers) {
  const hoje = todayIso();
  let ultimo = '';
  (offers || []).forEach((o) => {
    const t = String(offerMeta(o).tracked_at || '');
    if (t.startsWith(hoje) && t > ultimo) ultimo = t;
  });
  return ultimo.length >= 16 ? ultimo.slice(11, 16) : null;
}

export const ALERT_LABELS = {
  morreu: { label: 'Morreu', icon: '⛔' },
  escalou: { label: 'Escalou', icon: '🚀' },
  decaindo: { label: 'Decaindo', icon: '📉' },
  criativo_saiu: { label: 'Criativo saiu do ar', icon: '🎬' },
  voltou: { label: 'Voltou ao ar', icon: '🔁' },
  medicao: { label: 'Precisa de medição', icon: '📏' },
  longa: { label: 'Longa duração', icon: '⏳' },
  queda: { label: 'Queda de anúncios', icon: '📉' },
  estagio: { label: 'Mudou de estágio', icon: '🏷️' }
};

function weekStart(date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // segunda = 0
  d.setDate(d.getDate() - day);
  return d;
}

/** Rankings e séries para a página de Inteligência. */
export function computeInsights(offers) {
  const list = offers || [];
  const niches = new Map();
  const advertisers = new Map();
  const domains = new Map();

  list.forEach((o) => {
    const status = resolveStatus(o);
    const days = resolveRunningDays(o);

    const n = o.niche || 'Sem nicho';
    if (!niches.has(n)) niches.set(n, { name: n, total: 0, winners: 0, days: 0, ads: 0 });
    const ni = niches.get(n);
    ni.total += 1;
    ni.days += days;
    ni.ads += Number(o.ads_count) || 0;
    if (status === 'winner' || status === 'scaling') ni.winners += 1;

    const key = advertiserKey(o);
    if (key) {
      if (!advertisers.has(key)) advertisers.set(key, { name: o.name, pageId: o.page_id, total: 0, offers: [] });
      const a = advertisers.get(key);
      a.total += 1;
      a.offers.push(o);
    }

    const host = domainOf(o.landing_page || o.destination_url || '');
    if (host && !/facebook\.com|instagram\.com/.test(host)) {
      domains.set(host, (domains.get(host) || 0) + 1);
    }
  });

  const nicheRanking = Array.from(niches.values())
    .map((n) => ({ ...n, avgDays: n.total ? Math.round(n.days / n.total) : 0, avgAds: n.total ? Math.round(n.ads / n.total) : 0 }))
    .sort((a, b) => b.total - a.total);

  const recurrentAdvertisers = Array.from(advertisers.values()).filter((a) => a.total > 1).sort((a, b) => b.total - a.total);
  const domainRanking = Array.from(domains.entries()).map(([host, total]) => ({ host, total })).sort((a, b) => b.total - a.total);

  // Últimas 8 semanas: quantas garimpadas e quantas em alta (vencedora/escalando).
  const weeks = [];
  const start = weekStart(new Date());
  for (let i = 7; i >= 0; i -= 1) {
    const ws = new Date(start);
    ws.setDate(ws.getDate() - i * 7);
    const we = new Date(ws);
    we.setDate(we.getDate() + 7);
    const inWeek = list.filter((o) => {
      const c = new Date(o.created_at || 0);
      return c >= ws && c < we;
    });
    weeks.push({
      label: `${String(ws.getDate()).padStart(2, '0')}/${String(ws.getMonth() + 1).padStart(2, '0')}`,
      mined: inWeek.length,
      hot: inWeek.filter((o) => ['winner', 'scaling'].includes(resolveStatus(o))).length
    });
  }

  const statusCount = { testing: 0, pre_scaling: 0, scaling: 0, winner: 0, paused: 0 };
  list.forEach((o) => {
    const s = resolveStatus(o);
    statusCount[s] = (statusCount[s] || 0) + 1;
  });

  return { nicheRanking, recurrentAdvertisers, domainRanking, weeks, statusCount, total: list.length };
}

/** Planilha CSV (separada por ;) do acervo, com BOM para o Excel abrir os acentos. */
export function offersToCsv(offers) {
  const header = [
    'nome',
    'nicho',
    'status',
    'coluna_esteira',
    'nota',
    'favorita',
    'etiquetas',
    'dias_rodando',
    'anuncios_ativos',
    'pagina_id',
    'biblioteca',
    'pagina_vendas',
    'criada_em',
    'anotacoes'
  ];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = (offers || []).map((o) => {
    const x = getExtras(o);
    return [
      o.name,
      o.niche,
      resolveStatus(o),
      x.stage,
      x.rating,
      x.fav ? 'sim' : 'não',
      x.tags.join('|'),
      resolveRunningDays(o),
      o.ads_count,
      o.page_id,
      o.library_url,
      o.landing_page || o.destination_url,
      (o.created_at || '').slice(0, 10),
      o.notes ?? decodeNotes(o.funnel_notes).notes
    ]
      .map(esc)
      .join(';');
  });
  return '﻿' + [header.join(';'), ...rows].join('\n');
}

export function downloadText(filename, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Cópia da oferta com o bloco de metadados já alterado, para a tela mudar na
 * hora (estrela, nota, esteira) enquanto o banco salva atrás. Chave null sai.
 */
export function withMetaPatch(offer, patch) {
  const meta = { ...offerMeta(offer) };
  Object.entries(patch || {}).forEach(([k, v]) => {
    if (v === null) delete meta[k];
    else meta[k] = v;
  });
  return { ...offer, meta };
}
