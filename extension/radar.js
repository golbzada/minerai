// ==============================================================================
// MINERAÍ EXTENSÃO - RADAR DO NICHO (service worker)
// ==============================================================================
// Uma vez por dia, para cada busca salva ("mapas mentais", "emagrecer"), lê a
// busca na Biblioteca (mais vistos) e guarda os anunciantes do topo. A página
// Radar do painel mostra quem está escalando com 10 a 45 dias no ar.
//
// As buscas e os resultados ficam no chrome.storage, separados por conta (sem
// mudar o banco). O painel conversa com isto pelo bridge.js (RADAR_*).
//
// Roda DEPOIS do rastreio das ofertas do dia e nunca ao mesmo tempo que ele:
// os dois leem a Biblioteca, e ler em dobro aumenta a chance de a Meta frear.
//
// Usa de background.js/rastreio.js: buscarBiblioteca, pausaPadrao, agoraLocal,
// getAuthValida, getCurrentUser, safeUuid, todayIso, lerEstadoRastreio,
// rastreioRodando, DASHBOARD_URLS, DASHBOARD_OFICIAL.
// Design: docs/superpowers/specs/2026-10-13-radar-do-nicho-design.md
// ==============================================================================

const RADAR_PREFIXO = 'minerai_radar:';
const RADAR_MAX_BUSCAS = 10;
const RADAR_TERMO_MAX = 60;
const RADAR_FALHAS_SEGUIDAS = 3;
const RADAR_ALARME_AGORA = 'radar-agora';
const RADAR_BRASIL_POR_BUSCA = 8;   // checagens no Brasil por busca gringa, por dia
const RADAR_BRASIL_MAX = 2000;      // anunciantes lembrados no cache do Brasil

let radarRodando = false;

/** Cada conta tem o próprio Radar (mais de uma pessoa pode usar o mesmo Chrome). */
async function chaveDoRadar() {
  const { user } = await getCurrentUser();
  const id = safeUuid(user?.id);
  return id ? `${RADAR_PREFIXO}${id}` : null;
}

async function lerRadar(chave) {
  const vazio = { buscas: [], resultados: {}, vistos: {}, brasil: {} };
  if (!chave) return vazio;
  const r = await chrome.storage.local.get([chave]);
  return { ...vazio, ...(r[chave] || {}) };
}

async function salvarRadar(chave, radar) {
  await chrome.storage.local.set({ [chave]: radar });
}

/**
 * Lê o mais novo, aplica a mudança e grava. Nunca grava uma cópia antiga da
 * memória: a pessoa pode mudar as buscas no painel enquanto o Radar roda.
 */
async function atualizarRadar(chave, mudar) {
  const atual = await lerRadar(chave);
  const novo = mudar(atual) || atual;
  await salvarRadar(chave, novo);
  return novo;
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

/**
 * O Radar automático só roda quando o rastreio das ofertas de hoje já
 * terminou (ou parou), está ligado e não foi freado pela Meta.
 */
function rastreioLiberaRadar(estado, hoje) {
  const e = estado || {};
  if (e.ligado === false) return false;
  if (e.dia !== hoje) return false;
  if (e.parado === 'bloqueio') return false;
  return Boolean(e.terminadoEm || e.parado);
}

/**
 * Gringa x Brasil: para os anunciantes escolhidos, conta na Biblioteca do
 * Brasil os anúncios do mesmo anunciante e os que citam o mesmo site.
 * Devolve { cache: {pageId: {...}}, bloqueio }.
 */
async function checarBrasil(achados, cache, hoje, pausa) {
  const R = self.MineraiRadar;
  const RR = self.MineraiRastreio;
  const novos = {};
  const ids = R.escolherParaChecarBrasil(achados, cache, hoje, RADAR_BRASIL_POR_BUSCA);

  const contar = async (query) => {
    await pausa();
    const html = await buscarBiblioteca(query);
    if (html !== null && RR.pareceBloqueio(html)) return { bloqueio: true };
    return { total: RR.lerTotal(html) };
  };

  for (const id of ids) {
    const achado = achados.find((a) => a.pageId === id);
    const anunciante = await contar(R.urlAnuncianteNoPais(id, 'BR'));
    if (anunciante.bloqueio) return { cache: novos, bloqueio: true };
    if (anunciante.total === null) continue; // não respondeu: tenta outro dia

    let site = null;
    const dominio = R.dominioDoLink(achado && achado.link);
    if (dominio) {
      const r = await contar(R.urlSiteNoPais(dominio, 'BR'));
      if (r.bloqueio) return { cache: novos, bloqueio: true };
      site = r.total;
    }
    novos[id] = { data: hoje, anunciante: anunciante.total, site, dominio };
  }
  return { cache: novos, bloqueio: false };
}

/** Junta o cache novo do Brasil, esquecendo os mais antigos acima do limite. */
function juntarCacheBrasil(atual, novos) {
  const junto = { ...(atual || {}), ...(novos || {}) };
  const chaves = Object.keys(junto);
  if (chaves.length > RADAR_BRASIL_MAX) {
    chaves
      .sort((a, b) => String(junto[a].data).localeCompare(String(junto[b].data)))
      .slice(0, chaves.length - RADAR_BRASIL_MAX)
      .forEach((k) => delete junto[k]);
  }
  return junto;
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
 * Roda as buscas que ainda não rodaram hoje (ou todas, com `forcar`, que é o
 * "Rodar agora" do painel).
 */
async function radarTick({ forcar = false, pausa = pausaPadrao } = {}) {
  if (radarRodando) return;
  // Biblioteca ocupada pelo rastreio das ofertas: o "Rodar agora" fica para
  // logo depois; o automático espera a próxima vez.
  if (rastreioRodando) {
    if (forcar) chrome.alarms.create(RADAR_ALARME_AGORA, { delayInMinutes: 1 });
    return;
  }

  radarRodando = true;
  try {
    const R = self.MineraiRadar;
    const hoje = todayIso();
    const chave = await chaveDoRadar();
    if (!chave) return;
    const { token } = await getAuthValida();
    if (!token) return;

    const inicial = await lerRadar(chave);
    if (!inicial.buscas.length) return;
    if (!forcar) {
      if (inicial.parado === 'bloqueio' && inicial.paradoEm === hoje) return;
      if (!rastreioLiberaRadar(await lerEstadoRastreio(), hoje)) return;
    }

    const pendentes = inicial.buscas
      .filter((b) => forcar || (inicial.resultados[b.id] || {}).data !== hoje)
      .map((b) => b.id);
    if (!pendentes.length) return;

    let novas = 0;
    let falhas = 0;
    let parado = null;
    let leu = 0;

    for (const id of pendentes) {
      const radar = await lerRadar(chave);
      const busca = radar.buscas.find((b) => b.id === id);
      if (!busca) continue; // removida no painel enquanto o Radar rodava

      if (leu > 0) await pausa();
      leu += 1;
      const html = await buscarBiblioteca(R.urlDaBusca(busca.termo, busca.pais));
      if (html !== null && self.MineraiRastreio.pareceBloqueio(html)) {
        parado = 'bloqueio';
        break;
      }

      const leitura = R.extrairAnuncios(html);
      if (html === null || leitura.total === null) {
        // Falhou só esta (rede caiu, demorou): pula e tenta na próxima vez.
        falhas += 1;
        if (falhas >= RADAR_FALHAS_SEGUIDAS) {
          parado = 'falha';
          break;
        }
        continue;
      }
      falhas = 0;

      const anterior = radar.resultados[busca.id];
      const primeiraRodada = !anterior || (anterior.data === hoje && anterior.primeira === true);
      const montado = R.montarAchados(leitura.anuncios, {
        hoje,
        vistos: radar.vistos[busca.id] || {},
        primeiraRodada
      });
      const { vistos } = montado;
      let { achados } = montado;

      // Busca de fora do Brasil: confere se essas ofertas já rodam aqui.
      let brasilNovo = {};
      if (busca.pais !== 'BR' && busca.pais !== 'ALL') {
        const checagem = await checarBrasil(achados, radar.brasil || {}, hoje, pausa);
        brasilNovo = checagem.cache;
        if (checagem.bloqueio) parado = 'bloqueio';
        achados = R.aplicarBrasil(achados, { ...(radar.brasil || {}), ...brasilNovo });
      }
      // Rodar de novo no mesmo dia não pode apagar a comparação com ontem.
      const totalAnterior = anterior
        ? (anterior.data === hoje ? anterior.totalAnterior ?? null : anterior.total ?? null)
        : null;
      novas += achados.filter((a) => a.novo && a.novaEscalando).length;

      await atualizarRadar(chave, (r) => {
        if (!r.buscas.some((b) => b.id === busca.id)) return r;
        return {
          ...r,
          resultados: {
            ...r.resultados,
            [busca.id]: { data: hoje, rodadoEm: agoraLocal(), total: leitura.total, totalAnterior, primeira: primeiraRodada, achados }
          },
          vistos: { ...r.vistos, [busca.id]: vistos },
          brasil: juntarCacheBrasil(r.brasil, brasilNovo)
        };
      });
      if (parado) break;
    }

    await atualizarRadar(chave, (r) => {
      const fim = { ...r, parado, paradoEm: parado ? hoje : null };
      if (novas > 0 && r.notificadoEm !== hoje) {
        avisarRadar(novas);
        fim.notificadoEm = hoje;
      }
      return fim;
    });
  } catch (e) {
    console.warn('[Mineraí] Radar interrompido:', e.message);
  } finally {
    radarRodando = false;
  }
}

chrome.alarms.onAlarm.addListener((alarme) => {
  if (alarme.name === RADAR_ALARME_AGORA) radarTick({ forcar: true });
});

chrome.notifications.onClicked.addListener((id) => {
  if (id !== 'minerai-radar') return;
  chrome.tabs.create({ url: `${DASHBOARD_OFICIAL}/radar` });
  chrome.notifications.clear(id);
});

const RADAR_SEM_LOGIN = 'Conecte a extensão à sua conta: abra o painel logado.';

// Painel (pelo bridge.js): listar, salvar buscas e rodar agora. Só do NOSSO painel.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !String(message.type || '').startsWith('RADAR_')) return undefined;
  const doPainel = Boolean(sender?.url && DASHBOARD_URLS.some((base) => sender.url.startsWith(`${base}/`)));
  if (!doPainel) {
    sendResponse({ success: false, error: 'Origem não autorizada.' });
    return true;
  }
  const falhar = (e) => sendResponse({ success: false, error: (e && e.message) || 'Não deu para usar o Radar agora.' });

  if (message.type === 'RADAR_LISTAR') {
    chaveDoRadar()
      .then(async (chave) => {
        if (!chave) return sendResponse({ success: false, error: RADAR_SEM_LOGIN });
        const radar = await lerRadar(chave);
        return sendResponse({
          success: true,
          buscas: radar.buscas,
          resultados: radar.resultados,
          parado: radar.parado || null,
          paradoEm: radar.paradoEm || null,
          rodando: radarRodando
        });
      })
      .catch(falhar);
    return true;
  }

  if (message.type === 'RADAR_SALVAR_BUSCAS') {
    chaveDoRadar()
      .then(async (chave) => {
        if (!chave) return sendResponse({ success: false, error: RADAR_SEM_LOGIN });
        const salvo = await atualizarRadar(chave, (radar) => {
          const buscas = mesclarBuscas(radar.buscas, message.buscas);
          const ids = new Set(buscas.map((b) => b.id));
          const filtrar = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([id]) => ids.has(id)));
          return { ...radar, buscas, resultados: filtrar(radar.resultados), vistos: filtrar(radar.vistos) };
        });
        return sendResponse({ success: true, buscas: salvo.buscas });
      })
      .catch(falhar);
    return true;
  }

  if (message.type === 'RADAR_RODAR') {
    radarTick({ forcar: true });
    sendResponse({ success: true });
    return true;
  }

  return undefined;
});
