// ==============================================================================
// MINERAÍ EXTENSÃO - REGRAS DO RASTREIO DIÁRIO (funções puras)
// ==============================================================================
// Usado em três lugares: o content script (ao minerar), o service worker
// (rastreio diário) e os testes (`npm test`). Por isso não toca em DOM, rede
// nem chrome.*: só recebe dados e devolve dados. Fica em `self.MineraiRastreio`.
//
// Faixas de estágio: precisam ficar iguais às de src/utils/offerMeta.js.
// ==============================================================================

(function () {
  'use strict';

  const STAGE_DAYS = {
    pre_scaling: 10,  // 1 a 9 dias   -> Teste
    scaling: 30,      // 10 a 29 dias -> Pré-escala
    winner: 150       // 30 a 149     -> Escalando | 150+ -> Vencedor
  };

  // Com tempo E muitos anúncios ativos do anunciante, já é Escalando antes
  // dos 30 dias. Muito anúncio em poucos dias pode ser só teste.
  const STAGE_BY_ADS = [
    { days: 15, ads: 10 },
    { days: 20, ads: 7 }
  ];

  // Limites do rastreio (design de 13/10/2026). Ajuste aqui.
  const LIMITES = {
    teto: 200,          // ofertas por dia (favoritas sempre entram)
    escalouFator: 1.5,  // hoje >= 1,5x a menor leitura da janela...
    escalouMin: 5,      // ...e pelo menos +5 anúncios
    decaiFator: 0.5,    // hoje <= metade da maior leitura da janela...
    decaiBaseMin: 4,    // ...que precisa ter sido pelo menos 4
    janelaDias: 7,      // janela de comparação e de vida dos eventos
    eventosMax: 5       // eventos guardados por oferta
  };

  const KIND = 'anunciante';

  // ---------------------------------------------------------------------------
  // Datas: sempre 'YYYY-MM-DD' (dia local já resolvido por quem chama).
  // ---------------------------------------------------------------------------
  function diaUtc(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  }

  function diffDias(de, ate) {
    return Math.round((diaUtc(ate) - diaUtc(de)) / 86400000);
  }

  // ---------------------------------------------------------------------------
  // Leitura do HTML da Biblioteca (confirmado na Biblioteca real em 13/10/2026)
  // ---------------------------------------------------------------------------

  /** ID real da página do anunciante e se o anúncio salvo ainda está no ar. */
  function lerAnuncio(html, libraryId) {
    const texto = String(html || '');
    const at = texto.indexOf(`"ad_archive_id":"${libraryId}"`);
    if (!libraryId || at < 0) return { pageId: '', ativo: null };

    const depois = texto.slice(at, at + 4000);
    const antes = texto.slice(Math.max(0, at - 4000), at);

    let pageId = '';
    const pageDepois = depois.match(/"page_id":"(\d{6,})"/);
    if (pageDepois) {
      pageId = pageDepois[1];
    } else {
      const todos = antes.match(/"page_id":"(\d{6,})"/g);
      if (todos) pageId = todos[todos.length - 1].replace(/\D/g, '');
    }

    let ativo = null;
    const ativoDepois = depois.match(/"is_active":(true|false)/);
    if (ativoDepois) {
      ativo = ativoDepois[1] === 'true';
    } else {
      const todos = antes.match(/"is_active":(true|false)/g);
      if (todos) ativo = todos[todos.length - 1].endsWith('true');
    }

    return { pageId, ativo };
  }

  /** Total de anúncios ativos (o "~N resultados"); null quando não veio. */
  function lerTotal(html) {
    const m = String(html || '').match(/"search_results_connection":\{"count":(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  /** A Meta pediu captcha: hora de parar. */
  function pareceBloqueio(html) {
    return /"xfb_ad_library_is_captcha_required":true/.test(String(html || ''));
  }

  // ---------------------------------------------------------------------------
  // Histórico (mesmo formato do painel, com `kind` nas medições do anunciante)
  // ---------------------------------------------------------------------------
  function historyEntry(date, count, kind) {
    const n = Math.max(0, Number(count) || 0);
    // Grava nas duas nomenclaturas para o painel e os backups antigos lerem.
    const entry = { date, count: n, ads_count: n, result_date: date, results_count: n };
    if (kind) entry.kind = kind;
    return entry;
  }

  function upsertHistory(history, date, count, kind) {
    const byDate = new Map();

    (Array.isArray(history) ? history : []).forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const raw = item.date || item.result_date;
      if (!raw) return;
      const key = String(raw).slice(0, 10);
      const n = Number(item.count ?? item.ads_count ?? item.results_count ?? 0) || 0;
      byDate.set(key, { n, kind: typeof item.kind === 'string' ? item.kind : undefined });
    });

    byDate.set(date, { n: Math.max(0, Number(count) || 0), kind });

    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([d, v]) => historyEntry(d, v.n, v.kind));
  }

  // ---------------------------------------------------------------------------
  // Estágio
  // ---------------------------------------------------------------------------
  function classifyStage(daysRunning, pageActiveAds) {
    const days = Number(daysRunning) || 0;
    const ads = Number(pageActiveAds) || 0;
    if (days >= STAGE_DAYS.winner) return 'winner';
    if (days >= STAGE_DAYS.scaling) return 'scaling';
    if (ads && STAGE_BY_ADS.some((r) => days >= r.days && ads >= r.ads)) return 'scaling';
    if (days >= STAGE_DAYS.pre_scaling) return 'pre_scaling';
    return 'testing';
  }

  /** Dias no ar: congela na data em que a oferta morreu. */
  function diasNoAr(startDate, deadSince, hoje) {
    if (!startDate) return 1;
    const fim = deadSince || hoje;
    const n = diffDias(startDate, fim) + 1;
    return Number.isFinite(n) ? Math.max(1, n) : 1;
  }

  // ---------------------------------------------------------------------------
  // Avaliação de uma leitura diária -> metadados novos + eventos
  // ---------------------------------------------------------------------------

  /** Leituras do anunciante dentro da janela, sem a de hoje. */
  function janela(history, date) {
    return (Array.isArray(history) ? history : [])
      .filter((h) => h && h.kind === KIND)
      .filter((h) => {
        const d = diffDias(String(h.date || h.result_date || '').slice(0, 10), date);
        return d >= 1 && d <= LIMITES.janelaDias;
      })
      .map((h) => Number(h.count ?? h.ads_count ?? 0) || 0);
  }

  function avaliarLeitura(anterior, leitura) {
    const metaAntes = (anterior && anterior.meta) || {};
    const history = (anterior && anterior.history) || [];
    const { date, total, ativo, pageIdConfirmado } = leitura;
    const meta = { ...metaAntes };
    const eventos = [];

    const primeira =
      metaAntes.page_active_ads == null && !history.some((h) => h && h.kind === KIND);

    // --- Morte: exige ID confirmado, zero anúncios e o anúncio salvo inativo,
    //     em duas leituras de dias diferentes.
    const pareceMorta = total === 0 && ativo === false && pageIdConfirmado === true;
    let voltou = false;

    if (pareceMorta) {
      if (!meta.dead_since) {
        if (meta.dead_check && meta.dead_check !== date) {
          meta.dead_since = meta.dead_check;
          meta.dead_check = undefined;
          eventos.push({ tipo: 'morreu', data: date, de: Number(metaAntes.page_active_ads) || 0, para: 0 });
        } else {
          meta.dead_check = date;
        }
      }
    } else {
      meta.dead_check = undefined;
      if (meta.dead_since && total > 0) {
        voltou = true;
        meta.dead_since = undefined;
        eventos.push({ tipo: 'voltou', data: date, de: 0, para: total });
      }
    }

    // --- Escalou / decaindo (só com leituras do anunciante; nunca na primeira)
    if (!primeira && !voltou && total > 0) {
      let valores = janela(history, date);
      // Sem leitura do anunciante na janela, vale a da mineração — só se for
      // recente: número de meses atrás geraria "escalou" falso.
      const idadeBase = diffDias(String(metaAntes.page_active_ads_at || ''), date);
      if (!valores.length && metaAntes.page_active_ads != null && idadeBase >= 0 && idadeBase <= LIMITES.janelaDias) {
        valores = [Number(metaAntes.page_active_ads) || 0];
      }

      if (valores.length) {
        const menor = Math.min(...valores);
        const maior = Math.max(...valores);
        // Base zero (oferta que voltou, leitura vazia) não serve para "escalou".
        if (menor > 0 && total >= menor * LIMITES.escalouFator && total - menor >= LIMITES.escalouMin) {
          eventos.push({ tipo: 'escalou', data: date, de: menor, para: total });
        } else if (maior >= LIMITES.decaiBaseMin && total <= maior * LIMITES.decaiFator) {
          eventos.push({ tipo: 'decaindo', data: date, de: maior, para: total });
        }
      }
    }

    // --- Criativo salvo saiu do ar, mas o anunciante segue rodando
    if (!primeira && ativo === false && total > 0 && metaAntes.ad_active === true) {
      eventos.push({ tipo: 'criativo_saiu', data: date, de: total, para: total });
    }

    // --- Eventos: sem repetir o mesmo tipo dentro da janela; esquece os velhos
    const recentes = (Array.isArray(metaAntes.track_events) ? metaAntes.track_events : [])
      .filter((e) => e && diffDias(e.data, date) <= LIMITES.janelaDias);
    const novos = eventos.filter(
      (e) => !recentes.some((r) => r.tipo === e.tipo && diffDias(r.data, date) < LIMITES.janelaDias)
    );
    const todos = recentes.concat(novos)
      .sort((a, b) => String(a.data).localeCompare(String(b.data)))
      .slice(-LIMITES.eventosMax);

    meta.page_active_ads = total;
    meta.page_active_ads_at = date;
    if (ativo !== null && ativo !== undefined) meta.ad_active = ativo;
    meta.tracked_at = leitura.agora || date;
    meta.track_events = todos.length ? todos : undefined;

    return { meta, eventos: novos };
  }

  // ---------------------------------------------------------------------------
  // Fila do dia
  // ---------------------------------------------------------------------------
  /** Última vez que o rastreio passou pela oferta (mediu ou só tentou). */
  function ultimaPassagem(meta) {
    const medida = String((meta && meta.tracked_at) || '');
    const tentada = String((meta && meta.track_tentativa) || '');
    return medida > tentada ? medida : tentada;
  }

  function montarFila(offers, hoje) {
    const lista = (Array.isArray(offers) ? offers : []).filter((o) => {
      const m = (o && o.meta) || {};
      if (!o || !o.id) return false;
      if (m.stage === 'descartada') return false;
      // Já medida ou já tentada hoje (sem ID, leitura falhou): fica para amanhã.
      return !ultimaPassagem(m).startsWith(hoje);
    });

    const porAntiguidade = (a, b) => ultimaPassagem(a.meta).localeCompare(ultimaPassagem(b.meta));

    const favoritas = lista.filter((o) => (o.meta || {}).fav === true).sort(porAntiguidade);
    const demais = lista.filter((o) => (o.meta || {}).fav !== true).sort(porAntiguidade);

    return favoritas.concat(demais)
      .slice(0, Math.max(LIMITES.teto, favoritas.length))
      .map((o) => o.id);
  }

  // ---------------------------------------------------------------------------
  // Texto do estado para o popup
  // ---------------------------------------------------------------------------
  /** A rodada de hoje está andando? (trava o "Rodar agora" só nesse caso) */
  function estaMedindo(estado, rodando, hoje) {
    if (rodando) return true;
    const e = estado || {};
    return e.dia === hoje && Array.isArray(e.fila) && e.fila.length > 0 && !e.terminadoEm && !e.parado;
  }

  function resumoDoRastreio(estado, rodando, hoje) {
    const e = estado || {};
    if (e.ligado === false) return 'Desligado';
    if (e.parado === 'sem_login') return 'Conecte a conta para medir.';
    if (e.parado === 'plano') return 'Plano inativo: rastreio pausado.';
    if (e.dia !== hoje) return 'Ainda não rodou hoje.';
    if (e.parado === 'bloqueio') return 'A Meta pediu uma pausa. Tenta de novo amanhã.';

    const fila = Array.isArray(e.fila) ? e.fila : [];
    if (rodando || (fila.length && !e.terminadoEm)) return `Medindo: ${e.feitas || 0} de ${e.total || 0}`;
    if (!e.terminadoEm) return 'Ainda não rodou hoje.';

    const hora = String(e.terminadoEm).slice(11, 16);
    const partes = [`Hoje às ${hora}`, `${e.feitas || 0} ${e.feitas === 1 ? 'oferta' : 'ofertas'}`];
    const ev = e.eventos || {};
    const eventos = [];
    if (ev.escalou) eventos.push(`${ev.escalou} ${ev.escalou === 1 ? 'escalou' : 'escalaram'}`);
    if (ev.morreu) eventos.push(`${ev.morreu} ${ev.morreu === 1 ? 'morreu' : 'morreram'}`);
    if (eventos.length) partes.push(eventos.join(', '));
    return partes.join(' · ');
  }

  self.MineraiRastreio = {
    resumoDoRastreio,
    estaMedindo,
    STAGE_DAYS,
    STAGE_BY_ADS,
    LIMITES,
    KIND,
    diffDias,
    lerAnuncio,
    lerTotal,
    pareceBloqueio,
    historyEntry,
    upsertHistory,
    classifyStage,
    diasNoAr,
    avaliarLeitura,
    montarFila
  };
})();
