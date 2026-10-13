// ==============================================================================
// MINERAÍ EXTENSÃO - RADAR DO NICHO (service worker)
// ==============================================================================
// Uma vez por dia, para cada busca salva ("mapas mentais", "emagrecer"), lê a
// busca na Biblioteca (mais vistos) e guarda os anunciantes do topo. A página
// Radar do painel mostra quem está escalando com 10 a 45 dias no ar.
//
// As buscas e os resultados ficam no chrome.storage (sem mudar o banco). O
// painel conversa com isto pelo bridge.js (mensagens RADAR_*).
// Usa de background.js/rastreio.js: buscarBiblioteca, pausaPadrao, agoraLocal,
// getAuthValida, todayIso, DASHBOARD_URLS, DASHBOARD_OFICIAL.
// Design: docs/superpowers/specs/2026-10-13-radar-do-nicho-design.md
// ==============================================================================

const RADAR_KEY = 'minerai_radar';
const RADAR_MAX_BUSCAS = 10;
const RADAR_TERMO_MAX = 60;

let radarRodando = false;

async function lerRadar() {
  const r = await chrome.storage.local.get([RADAR_KEY]);
  return { buscas: [], resultados: {}, vistos: {}, ...(r[RADAR_KEY] || {}) };
}

async function salvarRadar(radar) {
  await chrome.storage.local.set({ [RADAR_KEY]: radar });
}

/** Termo em minúsculas, sem espaços sobrando; país BR/US/ALL... */
function limparBusca(b) {
  const termo = String((b && b.termo) || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, RADAR_TERMO_MAX);
  const p = String((b && b.pais) || '').toUpperCase();
  return termo ? { termo, pais: /^(ALL|[A-Z]{2})$/.test(p) ? p : 'BR' } : null;
}

/**
 * Lista nova de buscas vinda do painel: limpa, sem repetir, até 10. Quem já
 * existia mantém o id (e com ele os resultados e os "vistos").
 */
function mesclarBuscas(atuais, pedidas) {
  const porChave = new Map((atuais || []).map((b) => [`${b.termo}|${b.pais}`, b]));
  const vistas = new Set();
  const saida = [];
  (Array.isArray(pedidas) ? pedidas : []).forEach((p) => {
    const b = limparBusca(p);
    if (!b || saida.length >= RADAR_MAX_BUSCAS) return;
    const chave = `${b.termo}|${b.pais}`;
    if (vistas.has(chave)) return;
    vistas.add(chave);
    const existente = porChave.get(chave);
    saida.push(existente || { id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, ...b });
  });
  return saida;
}

function avisarRadar(novas) {
  if (!novas || !chrome.notifications?.create) return;
  chrome.notifications.create('minerai-radar', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Mineraí: radar do nicho',
    message: `${novas} ${novas === 1 ? 'oferta nova escalando' : 'ofertas novas escalando'} nos seus nichos. Clique para ver.`
  });
}

/**
 * Roda as buscas que ainda não rodaram hoje (ou todas, com `forcar`).
 */
async function radarTick({ forcar = false, pausa = pausaPadrao } = {}) {
  if (radarRodando) return;
  radarRodando = true;
  try {
    const R = self.MineraiRadar;
    let radar = await lerRadar();
    const hoje = todayIso();
    if (!radar.buscas.length) return;
    if (radar.parado === 'bloqueio' && radar.paradoEm === hoje && !forcar) return;

    // O radar é parte do Mineraí: só roda com a conta conectada.
    const { token } = await getAuthValida();
    if (!token) return;

    const pendentes = radar.buscas.filter((b) => forcar || (radar.resultados[b.id] || {}).data !== hoje);
    radar.parado = null;
    let novas = 0;

    for (let i = 0; i < pendentes.length; i += 1) {
      const busca = pendentes[i];
      const html = await buscarBiblioteca(R.urlDaBusca(busca.termo, busca.pais));
      const leitura = R.extrairAnuncios(html);
      if (html === null || self.MineraiRastreio.pareceBloqueio(html) || leitura.total === null) {
        radar.parado = 'bloqueio';
        radar.paradoEm = hoje;
        break;
      }

      const anterior = radar.resultados[busca.id];
      const { achados, vistos } = R.montarAchados(leitura.anuncios, {
        hoje,
        vistos: radar.vistos[busca.id] || {},
        primeiraRodada: !anterior
      });

      // Rodar de novo no mesmo dia não pode apagar a comparação com ontem.
      const totalAnterior = anterior
        ? (anterior.data === hoje ? anterior.totalAnterior ?? null : anterior.total ?? null)
        : null;

      radar.resultados[busca.id] = { data: hoje, rodadoEm: agoraLocal(), total: leitura.total, totalAnterior, achados };
      radar.vistos[busca.id] = vistos;
      novas += achados.filter((a) => a.novo && a.novaEscalando).length;

      // Relê antes de salvar: a pessoa pode ter mudado as buscas no painel.
      const atual = await lerRadar();
      radar = { ...radar, buscas: atual.buscas };
      await salvarRadar(radar);
      if (i < pendentes.length - 1) await pausa();
    }

    if (novas > 0 && radar.notificadoEm !== hoje) {
      avisarRadar(novas);
      radar.notificadoEm = hoje;
    }
    await salvarRadar(radar);
  } catch (e) {
    console.warn('[Mineraí] Radar interrompido:', e.message);
  } finally {
    radarRodando = false;
  }
}

chrome.notifications.onClicked.addListener((id) => {
  if (id !== 'minerai-radar') return;
  chrome.tabs.create({ url: `${DASHBOARD_OFICIAL}/radar` });
  chrome.notifications.clear(id);
});

// Painel (pelo bridge.js): listar, salvar buscas e rodar agora. Só do NOSSO painel.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !String(message.type || '').startsWith('RADAR_')) return undefined;
  const doPainel = Boolean(sender?.url && DASHBOARD_URLS.some((base) => sender.url.startsWith(`${base}/`)));
  if (!doPainel) {
    sendResponse({ success: false, error: 'Origem não autorizada.' });
    return true;
  }

  if (message.type === 'RADAR_LISTAR') {
    lerRadar().then((radar) => sendResponse({
      success: true,
      buscas: radar.buscas,
      resultados: radar.resultados,
      parado: radar.parado || null,
      paradoEm: radar.paradoEm || null,
      rodando: radarRodando
    }));
    return true;
  }

  if (message.type === 'RADAR_SALVAR_BUSCAS') {
    lerRadar().then(async (radar) => {
      const buscas = mesclarBuscas(radar.buscas, message.buscas);
      const ids = new Set(buscas.map((b) => b.id));
      const filtrar = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([id]) => ids.has(id)));
      await salvarRadar({ ...radar, buscas, resultados: filtrar(radar.resultados), vistos: filtrar(radar.vistos) });
      sendResponse({ success: true, buscas });
    });
    return true;
  }

  if (message.type === 'RADAR_RODAR') {
    radarTick({ forcar: true });
    sendResponse({ success: true });
    return true;
  }

  return undefined;
});
