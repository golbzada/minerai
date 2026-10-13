// ==============================================================================
// MINERAÍ EXTENSÃO - RASTREIO DIÁRIO DAS OFERTAS (service worker)
// ==============================================================================
// Uma vez por dia, com o Chrome aberto, mede cada oferta salva: quantos
// anúncios ativos o anunciante tem e se o anúncio salvo ainda está no ar.
// Grava no histórico e avisa quando uma oferta escalou ou morreu.
//
// Sem abrir aba nenhuma: lê o HTML da Biblioteca por fetch (texto puro), uma
// oferta por vez, com pausa entre elas. As regras (eventos, fila, estágio)
// ficam em rastreio-regras.js; aqui só o "fazer": rede, banco e chrome.*.
//
// Carregado por background.js (importScripts): usa SUPABASE_URL,
// DASHBOARD_OFICIAL, getAuthValida, supabaseHeaders, writeOffer, decodeNotes,
// encodeNotes, clip, safeUuid e todayIso de lá.
// Design: docs/superpowers/specs/2026-10-13-rastreio-automatico-design.md
// ==============================================================================

const RASTREIO_KEY = 'minerai_rastreio';
const RASTREIO_ALARME = 'rastreio';
const RASTREIO_CONTINUAR = 'rastreio-continuar';
// Um tick trabalha no máximo isto e agenda a continuação: o service worker
// pode ser encerrado, e o progresso fica salvo a cada oferta.
const RASTREIO_LOTE_MS = 100 * 1000;
const RASTREIO_TIMEOUT_MS = 15000;
const RASTREIO_FALHAS_SEGUIDAS = 3; // leituras sem número seguidas = Meta freando
const RASTREIO_COLUNAS = 'id,name,history,status,funnel_notes,page_id';
const META_LIBRARY = 'https://www.facebook.com/ads/library/';

let rastreioRodando = false;

/** Pausa entre leituras: 2,5 a 4 s, para a Meta não estranhar. */
function pausaPadrao() {
  const ms = 2500 + Math.floor(Math.random() * 1500);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 'YYYY-MM-DDTHH:MM' no horário local (o painel mostra "hoje às 09:12"). */
function agoraLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

async function lerEstadoRastreio() {
  const r = await chrome.storage.local.get([RASTREIO_KEY]);
  return { ligado: true, ...(r[RASTREIO_KEY] || {}) };
}

async function salvarEstadoRastreio(estado) {
  await chrome.storage.local.set({ [RASTREIO_KEY]: estado });
}

/** HTML de uma página da Biblioteca. `null` = falhou (rede, HTTP de erro, tempo). */
async function buscarBiblioteca(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RASTREIO_TIMEOUT_MS);
  try {
    const res = await fetch(`${META_LIBRARY}?${query}`, { credentials: 'include', signal: controller.signal });
    return res.ok ? await res.text() : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lê uma oferta na Biblioteca.
 * -> { total: number|null, ativo, pageId, pageIdConfirmado, country, bloqueio }
 */
async function lerOfertaNaBiblioteca(meta, linha) {
  const R = self.MineraiRastreio;
  const libraryId = /^\d{6,}$/.test(String(meta.library_id || '')) ? String(meta.library_id) : '';

  let anuncio = { pageId: '', ativo: null };
  if (libraryId) {
    const html = await buscarBiblioteca(`id=${libraryId}`);
    if (html && R.pareceBloqueio(html)) return { bloqueio: true };
    anuncio = R.lerAnuncio(html, libraryId);
  }

  const conhecido = /^\d{6,}$/.test(String(meta.page_id_real || '')) ? String(meta.page_id_real) : '';
  const salvo = /^\d{6,}$/.test(String(linha.page_id || '')) ? String(linha.page_id) : '';
  const pageId = anuncio.pageId || conhecido || salvo;
  const pageIdConfirmado = Boolean(anuncio.pageId || conhecido);
  if (!pageId) return { total: null, ativo: anuncio.ativo, pageId: '', pageIdConfirmado: false };

  const contar = async (pais) => {
    const html = await buscarBiblioteca(
      `active_status=active&ad_type=all&country=${pais}&view_all_page_id=${pageId}&media_type=all`
    );
    if (html && R.pareceBloqueio(html)) return { bloqueio: true };
    return { total: R.lerTotal(html) };
  };

  let country = /^(ALL|[A-Z]{2})$/.test(String(meta.country || '')) ? meta.country : '';
  let leitura = await contar(country || 'BR');
  if (leitura.bloqueio) return { bloqueio: true };

  // Oferta antiga (sem país): o zero no Brasil pode ser só porque ela roda
  // lá fora. Com o anúncio salvo ativo, tenta o mundo todo.
  if (!country && leitura.total === 0 && anuncio.ativo === true) {
    const mundo = await contar('ALL');
    if (mundo.bloqueio) return { bloqueio: true };
    if (mundo.total > 0) {
      leitura = mundo;
      country = 'ALL';
    }
  }
  if (!country && leitura.total > 0) country = 'BR';

  return {
    total: leitura.total,
    ativo: anuncio.ativo,
    pageId: anuncio.pageId || conhecido,
    pageIdConfirmado,
    country
  };
}

/** Busca a linha da oferta (fresca, logo antes de gravar). */
async function buscarLinhaOferta(id, token) {
  const uuid = safeUuid(id);
  if (!uuid) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/offers?id=eq.${uuid}&select=${RASTREIO_COLUNAS}&limit=1`, {
      headers: supabaseHeaders(token)
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0] || null;
  } catch (e) {
    return null;
  }
}

/** Grava a medição do dia. Devolve os eventos (escalou, morreu...). */
async function gravarMedicao(linha, leitura, hoje, token) {
  const R = self.MineraiRastreio;
  const { notes, meta } = decodeNotes(linha.funnel_notes);

  const avaliacao = R.avaliarLeitura(
    { meta, history: linha.history },
    {
      date: hoje,
      total: leitura.total,
      ativo: leitura.ativo,
      pageIdConfirmado: leitura.pageIdConfirmado,
      agora: agoraLocal()
    }
  );

  const novaMeta = {
    ...avaliacao.meta,
    page_id_real: leitura.pageId || meta.page_id_real,
    country: leitura.country || meta.country
  };

  const patch = {
    history: R.upsertHistory(linha.history, hoje, leitura.total, R.KIND),
    ads_count: leitura.total,
    funnel_notes: clip(encodeNotes(notes, novaMeta), 10000),
    updated_at: new Date().toISOString()
  };

  // Estágio fixado à mão no painel não é tocado.
  if (!meta.status_manual) {
    patch.status = R.classifyStage(R.diasNoAr(meta.start_date, novaMeta.dead_since, hoje), leitura.total);
  }

  await writeOffer(`${SUPABASE_URL}/rest/v1/offers?id=eq.${safeUuid(linha.id)}`, 'PATCH', patch, token);
  return avaliacao.eventos;
}

/** Monta a fila do dia com as ofertas da pessoa. */
async function montarFilaDoDia(userId, token, hoje) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/offers?user_id=eq.${userId}&select=id,funnel_notes&order=updated_at.desc&limit=2000`,
    { headers: supabaseHeaders(token) }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  const ofertas = (rows || []).map((r) => ({ id: r.id, meta: decodeNotes(r.funnel_notes).meta }));
  return self.MineraiRastreio.montarFila(ofertas, hoje);
}

/** "3 ofertas escalaram, 1 morreu". */
function resumoEventos(eventos) {
  const partes = [];
  if (eventos.escalou) partes.push(`${eventos.escalou} ${eventos.escalou === 1 ? 'oferta escalou' : 'ofertas escalaram'}`);
  if (eventos.morreu) partes.push(`${eventos.morreu} ${eventos.morreu === 1 ? 'morreu' : 'morreram'}`);
  return partes.join(', ');
}

/** Uma notificação por rodada, só com o que ainda não foi avisado hoje. */
function avisarFimDaRodada(estado) {
  const eventos = estado.eventos || {};
  const ja = estado.notificado || {};
  const novos = {
    escalou: Math.max(0, (eventos.escalou || 0) - (ja.escalou || 0)),
    morreu: Math.max(0, (eventos.morreu || 0) - (ja.morreu || 0))
  };
  estado.notificado = { escalou: eventos.escalou || 0, morreu: eventos.morreu || 0 };
  const resumo = resumoEventos(novos);
  if (!resumo || !chrome.notifications?.create) return;
  chrome.notifications.create('minerai-rastreio', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Mineraí: rastreio de hoje',
    message: `${resumo}. Clique para ver os alertas.`
  });
}

/**
 * Um passo do rastreio. Começa a rodada do dia se ainda não começou, mede
 * ofertas por até RASTREIO_LOTE_MS e agenda a continuação.
 * `forcar` = botão "Rodar agora" (roda mesmo desligado ou depois de freio).
 */
async function rastreioTick({ forcar = false, pausa = pausaPadrao } = {}) {
  if (rastreioRodando) return;
  rastreioRodando = true;
  try {
    let estado = await lerEstadoRastreio();
    if (estado.ligado === false && !forcar) return;

    const hoje = todayIso();
    const { user, token } = await getAuthValida();
    const userId = safeUuid(user?.id);
    if (!token || !userId) {
      await salvarEstadoRastreio({ ...estado, parado: 'sem_login' });
      return;
    }

    const novoDia = estado.dia !== hoje;
    if (!novoDia && estado.parado === 'bloqueio' && !forcar) return;

    if (novoDia || forcar || !Array.isArray(estado.fila)) {
      const fila = await montarFilaDoDia(userId, token, hoje);
      if (!fila) return;
      if (novoDia) {
        estado = {
          ligado: estado.ligado,
          dia: hoje,
          fila,
          total: fila.length,
          feitas: 0,
          eventos: { escalou: 0, morreu: 0, decaindo: 0 },
          notificado: { escalou: 0, morreu: 0 },
          iniciadoEm: agoraLocal(),
          terminadoEm: null,
          parado: null
        };
      } else if (fila.length) {
        // "Rodar agora" no mesmo dia: mede só as que ainda não foram medidas.
        estado = { ...estado, fila, total: (estado.feitas || 0) + fila.length, terminadoEm: null };
      } else {
        await salvarEstadoRastreio({ ...estado, parado: null });
        return;
      }
    }
    estado.parado = null;
    await salvarEstadoRastreio(estado);

    const inicio = Date.now();
    let falhasSeguidas = 0;

    while (estado.fila.length && Date.now() - inicio < RASTREIO_LOTE_MS) {
      const id = estado.fila[0];
      const linha = await buscarLinhaOferta(id, token);

      if (linha) {
        const meta = decodeNotes(linha.funnel_notes).meta;
        const leitura = await lerOfertaNaBiblioteca(meta, linha);

        if (leitura.bloqueio) {
          estado.parado = 'bloqueio';
          break;
        }

        if (leitura.total === null || leitura.total === undefined) {
          falhasSeguidas += 1;
          if (falhasSeguidas >= RASTREIO_FALHAS_SEGUIDAS) {
            estado.parado = 'bloqueio';
            break;
          }
        } else {
          falhasSeguidas = 0;
          try {
            const eventos = await gravarMedicao(linha, leitura, hoje, token);
            eventos.forEach((e) => {
              if (e.tipo in estado.eventos) estado.eventos[e.tipo] += 1;
            });
          } catch (e) {
            if (/plano está inativo/i.test(e.message)) {
              estado.parado = 'plano';
              break;
            }
            console.warn('[Mineraí] Rastreio: não deu para gravar uma oferta:', e.message);
          }
        }
      }

      estado.fila.shift();
      estado.feitas = (estado.feitas || 0) + 1;
      await salvarEstadoRastreio(estado);
      if (estado.fila.length) await pausa();
    }

    if (!estado.fila.length && !estado.parado) {
      if (!estado.terminadoEm) {
        estado.terminadoEm = agoraLocal();
        avisarFimDaRodada(estado);
      }
    } else if (!estado.parado) {
      chrome.alarms.create(RASTREIO_CONTINUAR, { delayInMinutes: 0.5 });
    }
    await salvarEstadoRastreio(estado);
  } catch (e) {
    console.warn('[Mineraí] Rastreio interrompido:', e.message);
  } finally {
    rastreioRodando = false;
  }
}

// ------------------------------------------------------------------------------
// Gatilhos: alarme periódico ("já rodou hoje?"), abrir o Chrome, instalar.
// ------------------------------------------------------------------------------
function agendarRastreio() {
  chrome.alarms.create(RASTREIO_ALARME, { delayInMinutes: 1, periodInMinutes: 30 });
}

chrome.runtime.onInstalled.addListener(agendarRastreio);
chrome.runtime.onStartup.addListener(agendarRastreio);

chrome.alarms.onAlarm.addListener((alarme) => {
  if (alarme.name === RASTREIO_ALARME || alarme.name === RASTREIO_CONTINUAR) rastreioTick();
});

chrome.notifications.onClicked.addListener((id) => {
  if (id !== 'minerai-rastreio') return;
  chrome.tabs.create({ url: `${DASHBOARD_OFICIAL}/alertas` });
  chrome.notifications.clear(id);
});

// Popup: estado, "Rodar agora" e liga/desliga. Só páginas da própria extensão
// (sem aba = popup), nunca um content script.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const doPopup = sender?.id === chrome.runtime.id && !sender?.tab;
  if (!message || !String(message.type || '').startsWith('RASTREIO_')) return undefined;
  if (!doPopup) {
    sendResponse({ success: false, error: 'Origem não autorizada.' });
    return true;
  }

  if (message.type === 'RASTREIO_STATUS') {
    lerEstadoRastreio().then((estado) => sendResponse({ success: true, estado, rodando: rastreioRodando }));
    return true;
  }

  if (message.type === 'RASTREIO_RODAR') {
    rastreioTick({ forcar: true });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'RASTREIO_LIGAR') {
    lerEstadoRastreio().then(async (estado) => {
      await salvarEstadoRastreio({ ...estado, ligado: message.ligado !== false });
      if (message.ligado !== false) agendarRastreio();
      sendResponse({ success: true });
    });
    return true;
  }

  return undefined;
});
